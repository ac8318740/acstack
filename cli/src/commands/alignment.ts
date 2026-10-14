import { Command } from 'commander';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { createAnnotationFeedbackHandoff, exportAnnotationFeedbackMarkdown } from '../lib/alignment-feedback.js';
import { renderAlignmentPackHtml } from '../lib/alignment-pack-renderer.js';
import { alignmentPackStoragePaths, ignoreGeneratedPacks } from '../lib/alignment-pack-lifecycle.js';
import { AlignmentPackSchema, type AlignmentPack, ReviewAnnotationSchema, ReviewStateSchema } from '../lib/alignment-packs.js';
import { REVIEW_PATH, REVIEW_TOKEN_HEADER, REVIEW_TOKEN_META } from '../lib/alignment-review-protocol.js';
import { ACSTACK_DIR, MAPS_DIR } from '../lib/constants.js';
import { type MapNode, loadNodes, mapDir } from '../lib/nodes.js';
import { ensureDir, fail, inProject } from '../lib/utils.js';

const OPENER_BIN = 'acstack-open';
// Next to the Playwriter bridge (19988) and the opener (19989), so one SSH config covers all three.
const REVIEW_PORT = 19990;

const FeedbackSchema = z
  .object({
    packVersion: z.string().min(1),
    reviewState: ReviewStateSchema,
    annotations: z.array(ReviewAnnotationSchema).default([]),
  })
  .strict();

// A review body is a few comments; anything bigger is not from the page this run served.
const MAX_REVIEW_BYTES = 1_000_000;

type Feedback = z.infer<typeof FeedbackSchema>;

interface MapOptions {
  map?: string;
}

interface AlignOptions extends MapOptions {
  feedback?: string;
}

function requireMapName(map: string | undefined): string {
  if (!map) fail('Name a map with --map <name>.');
  // The name becomes a folder under acstack/maps and acstack/alignment-packs, so it may not climb out of them.
  if (!/^[\w.-]+$/.test(map) || map === '.' || map === '..') fail(`Map name "${map}" may use only letters, digits, ".", "_" and "-".`);
  return map;
}

function mapVersion(map: string, nodes: MapNode[]): string {
  const stableNodes = nodes.map(node => ({
    id: node.id,
    title: node.title,
    status: node.status,
    mode: node.mode,
    kind: node.kind,
    label: node.label,
    answers: node.answers,
    blockedBy: node.blockedBy,
    pinned: node.pinned,
    summary: node.summary,
    body: node.body,
  }));
  const digest = createHash('sha256')
    .update(JSON.stringify({ map, nodes: stableNodes }))
    .digest('hex')
    .slice(0, 12);
  return `map-${digest}`;
}

// Maps written before nodes carried a summary still get a readable business line: the body's opening paragraph.
function firstParagraph(body: string): string {
  const paragraph = body.split(/\n\s*\n/).find(block => block.trim() && !block.trim().startsWith('#')) ?? '';
  return paragraph.replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim();
}

function buildPack(map: string, nodes: MapNode[]): AlignmentPack {
  const version = mapVersion(map, nodes);
  const pack = {
    packVersion: `${map}@${version}`,
    source: {
      map: { id: map, version },
      references: nodes.map(node => ({
        id: node.id,
        kind: 'map-node',
        title: node.title,
        uri: join(ACSTACK_DIR, MAPS_DIR, map, node.file),
      })),
    },
    graph: {
      groups: [
        {
          id: 'map',
          label: map,
          summary: `Map ${map}`,
          sourceRefs: nodes.map(node => node.id),
        },
      ],
      nodes: nodes.map(node => ({
        id: node.id,
        groupId: 'map',
        label: node.label,
        technicalLabel: node.title,
        summary: node.summary || firstParagraph(node.body) || node.title,
        technicalSummary: node.body || undefined,
        sourceRefs: [node.id],
      })),
      edges: nodes
        .filter(node => node.answers)
        .map(node => ({
          id: `${node.answers}-answers-${node.id}`,
          fromNodeId: node.answers as string,
          toNodeId: node.id,
          relationship: 'answers',
          // The arrow runs from the question to its answer, so the label reads in that direction.
          label: 'answered by',
          summary: `${node.label} answers ${nodes.find(parent => parent.id === node.answers)?.label ?? node.answers}`,
          sourceRefs: [node.id, node.answers as string],
        })),
      aggregateEdges: [],
    },
    viewState: {
      globalDepth: 1,
      expandedGroups: ['map'],
      semanticZoom: 'business',
    },
    reviewState: {},
  };
  return AlignmentPackSchema.parse(pack);
}

function writePack(root: string, map: string, pack: AlignmentPack): string {
  const paths = alignmentPackStoragePaths({ root, map, packVersion: pack.packVersion });
  ensureDir(paths.directory);
  ignoreGeneratedPacks(root);
  writeFileSync(paths.packHtml, renderAlignmentPackHtml(pack));
  return paths.packHtml;
}

function generatePack(root: string, map: string): { pack: AlignmentPack; path: string } {
  if (!existsSync(mapDir(root, map))) {
    fail(`Map '${map}' does not exist.`);
  }
  const pack = buildPack(map, loadNodes(root, map));
  const path = writePack(root, map, pack);
  return { pack, path };
}

function readFeedback(path: string): Feedback {
  try {
    return FeedbackSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
  } catch (error) {
    fail(`Cannot read feedback from ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function importFeedback(pack: AlignmentPack, feedback: Feedback): AlignmentPack {
  if (feedback.packVersion !== pack.packVersion) {
    throw new Error(`Feedback version mismatch: received ${feedback.packVersion}, current pack version is ${pack.packVersion}.`);
  }
  if (feedback.reviewState.approval?.packVersion !== undefined && feedback.reviewState.approval.packVersion !== pack.packVersion) {
    throw new Error(
      `Feedback approval version mismatch: received ${feedback.reviewState.approval.packVersion}, current pack version is ${pack.packVersion}.`
    );
  }
  const stale = feedback.annotations.find(annotation => annotation.packVersion !== pack.packVersion);
  if (stale) throw new Error(`Comment version mismatch: received ${stale.packVersion}, current pack version is ${pack.packVersion}.`);
  return AlignmentPackSchema.parse({
    ...pack,
    reviewState: feedback.reviewState,
  });
}

// Records a review on this machine: review state in the pack, comments as annotations.jsonl, and feedback.md for the agent.
// The prompt is what the reviewer pastes into their agent's chat, so it names the map, the decision, and the file to read.
async function applyFeedback(root: string, map: string, pack: AlignmentPack, feedback: Feedback): Promise<{ lines: string[]; prompt: string }> {
  const count = feedback.annotations.length;
  // Without comments there is nothing to change, and feedback.md would still hold an older review's comments.
  if (feedback.reviewState.approval?.status === 'changes-requested' && !count) throw new Error('Request changes needs at least one comment.');
  const reviewed = importFeedback(pack, feedback);
  const path = writePack(root, map, reviewed);
  const lines = [`Alignment pack ${reviewed.packVersion} written to ${path}`, reviewSummary(reviewed)];
  const paths = alignmentPackStoragePaths({ root, map, packVersion: reviewed.packVersion });
  const comments = `${count} comment${count === 1 ? '' : 's'}`;
  const prompt =
    reviewed.reviewState.approval?.status === 'approved'
      ? `The alignment review of map "${map}" is approved.${count ? ` Read the ${comments} in ${paths.feedbackMarkdown} as notes.` : ''} Continue the work.`
      : `The alignment review of map "${map}" requests changes. Read the ${comments} in ${paths.feedbackMarkdown}, update the map to address each one, then run \`acstack align-viewer --map ${map}\` so I can review again.`;
  if (count) {
    // A review sends every comment it holds, so each one replaces the last.
    writeFileSync(paths.annotationsJsonl, feedback.annotations.map(annotation => `${JSON.stringify(annotation)}\n`).join(''));
    await exportAnnotationFeedbackMarkdown({ annotationsPath: paths.annotationsJsonl, feedbackPath: paths.feedbackMarkdown, pack: reviewed });
    lines.push(`${comments} imported.`, createAnnotationFeedbackHandoff(paths.feedbackMarkdown));
  }
  return { lines, prompt };
}

// Serves the pack on localhost until the reviewer approves or requests changes, then records the review and stops.
function serveReview(root: string, map: string, pack: AlignmentPack): Promise<void> {
  const port = Number(process.env.ACSTACK_ALIGN_PORT ?? REVIEW_PORT);
  // Only the page this run served knows the token, so another site open in the browser cannot post a review.
  const token = randomBytes(16).toString('hex');
  const html = renderAlignmentPackHtml(pack).replace('</head>', `<meta name="${REVIEW_TOKEN_META}" content="${token}">\n</head>`);
  // Set while one review is being recorded, so a double click cannot write two decisions.
  let busy = false;
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      // A DNS-rebinding page reaches 127.0.0.1 under its own host name; refusing it keeps the token unreadable.
      if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host ?? '')) return reply(421, { error: 'Unknown host' });
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
        return;
      }
      if (req.method !== 'POST' || req.url !== REVIEW_PATH) return reply(404, { error: 'Not found' });
      if (req.headers[REVIEW_TOKEN_HEADER] !== token) return reply(403, { error: 'This page is from an older review. Reload it.' });
      if (busy) return reply(409, { error: 'A review is already being recorded.' });
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MAX_REVIEW_BYTES) {
          reply(413, { error: 'Review too large' });
          req.destroy();
        }
      });
      req.on('end', () => {
        void (async () => {
          busy = true;
          try {
            const { lines, prompt } = await applyFeedback(root, map, pack, FeedbackSchema.parse(JSON.parse(body)));
            reply(200, { ok: true, prompt });
            for (const line of lines) console.log(line);
            server.close();
            server.closeAllConnections();
            resolve();
          } catch (err) {
            busy = false;
            reply(400, { error: err instanceof Error ? err.message : String(err) });
          }
        })();
      });
    });
    server.on('error', (err: NodeJS.ErrnoException) =>
      reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is busy. Close the other review, or set ACSTACK_ALIGN_PORT.`) : err)
    );
    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`;
      console.log(`Review ${map} at ${url}`);
      if (process.env.SSH_CONNECTION) {
        console.log(`Over SSH, forward the port from your own machine first:`);
        console.log(`  ssh -N -L ${port}:localhost:${port} ${hostname()}`);
        console.log(`Or add "LocalForward ${port} localhost:${port}" to that host in ~/.ssh/config to make it automatic.`);
      }
      console.log('Waiting for your review. Ctrl+C stops.');
      try {
        openArtifact(url);
      } catch {
        // The printed link still works; the opener is only a shortcut.
      }
    });
  });
}

function pathEntry(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function openArtifact(path: string): void {
  if (!pathEntry(OPENER_BIN)) return;
  const result = spawnSync(OPENER_BIN, [path], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status && result.status !== 0) {
    throw new Error(`${OPENER_BIN} exited with status ${result.status}`);
  }
}

function reviewSummary(pack: AlignmentPack): string {
  const approval = pack.reviewState.approval;
  if (!approval) return 'Review state: no approval imported.';
  const reviewer = approval.approvedBy ? ` by ${approval.approvedBy}` : '';
  return `Review state: ${approval.status}${reviewer} for ${approval.packVersion}.`;
}

export function register(program: Command): void {
  program
    .command('map')
    .description('Generate a standalone alignment pack for a map')
    .requiredOption('--map <name>', 'map name (files backend)')
    .action(
      inProject((root, opts: MapOptions) => {
        const map = requireMapName(opts.map);
        const { pack, path } = generatePack(root, map);
        console.log(`Alignment pack ${pack.packVersion} written to ${path}`);
      })
    );

  program
    .command('align-viewer')
    .description('Open an alignment artifact for review and record the decision')
    .requiredOption('--map <name>', 'map name (files backend)')
    .option('--feedback <path>', 'record a review from a feedback JSON file instead of opening the viewer')
    .action(
      inProject(async (root, opts: AlignOptions) => {
        const map = requireMapName(opts.map);
        const { pack } = generatePack(root, map);
        if (!opts.feedback) return serveReview(root, map, pack);
        for (const line of (await applyFeedback(root, map, pack, readFeedback(opts.feedback))).lines) console.log(line);
      })
    );
}
