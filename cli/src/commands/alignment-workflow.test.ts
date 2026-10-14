import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'acstack.js');

function runCli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: 'utf-8',
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    timeout: 10_000,
  });
}

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'acstack-alignment-workflow-'));
  mkdirSync(join(root, 'acstack'), { recursive: true });
  writeFileSync(join(root, 'acstack', 'project.yaml'), '# test project\n');
  writeNode(root, 'demo', {
    id: '001',
    title: 'Checkout redesign',
    kind: 'destination',
    label: 'Checkout redesign',
    body: 'The checkout map aligns product, design, and engineering review.',
  });
  writeNode(root, 'demo', {
    id: '002',
    title: 'Saved card flow',
    kind: 'work',
    label: 'Saved cards',
    answers: '001',
    summary: 'Returning customers can pay with a card they saved before.',
    body: 'Connect saved card UX to the checkout destination and implementation notes.',
  });
  return root;
}

function writeNode(
  root: string,
  map: string,
  fixture: {
    id: string;
    title: string;
    kind: string;
    label: string;
    body: string;
    answers?: string;
    summary?: string;
  }
): void {
  const dir = join(root, 'acstack', 'maps', map);
  mkdirSync(dir, { recursive: true });
  const frontmatter = [
    'status: open',
    'mode: hitl',
    `kind: ${fixture.kind}`,
    `label: ${JSON.stringify(fixture.label)}`,
  ];
  if (fixture.answers) frontmatter.push(`answers: "${fixture.answers}"`);
  if (fixture.summary) frontmatter.push(`summary: ${JSON.stringify(fixture.summary)}`);
  frontmatter.push('blocked-by: []');
  const slug = fixture.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const content = `---\n${frontmatter.join('\n')}\n---\n\n# ${fixture.title}\n\n${fixture.body}\n`;
  writeFileSync(join(dir, `${fixture.id}-${slug}.md`), content);
}

function walkFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...walkFiles(path));
    else found.push(path);
  }
  return found;
}

type AlignmentPackData = {
  packVersion: string;
  source: { map: { id: string } };
  graph: {
    nodes: Array<{ id: string }>;
    edges: Array<{ fromNodeId: string; toNodeId: string }>;
  };
  reviewState: {
    approval?: {
      packVersion: string;
      status: string;
      approvedBy: string;
    };
  };
};

function parseAlignmentPackData(json: string): AlignmentPackData {
  return JSON.parse(json) as AlignmentPackData;
}

function alignmentPackArtifacts(root: string): Array<{ path: string; pack: AlignmentPackData }> {
  return walkFiles(root)
    .filter(path => path.endsWith('.html'))
    .map(path => ({ path, text: readFileSync(path, 'utf-8') }))
    .map(({ path, text }) => ({ path, match: text.match(/<script id="alignment-pack-data" type="application\/json">([\s\S]*?)<\/script>/) }))
    .filter((entry): entry is { path: string; match: RegExpMatchArray } => entry.match !== null)
    .map(({ path, match }) => ({ path, pack: parseAlignmentPackData(match[1]) }));
}

function sourceSnapshot(root: string): Record<string, string> {
  const mapRoot = join(root, 'acstack', 'maps');
  return Object.fromEntries(
    walkFiles(mapRoot).map(path => [relative(root, path), readFileSync(path, 'utf-8')])
  );
}

function writeFakeOpener(root: string): { binDir: string; logPath: string } {
  const binDir = join(root, 'bin');
  const logPath = join(root, 'open.log');
  mkdirSync(binDir, { recursive: true });
  const openerPath = join(binDir, 'acstack-open');
  writeFileSync(
    openerPath,
    `#!/bin/sh\nprintf '%s\n' "$@" >> ${JSON.stringify(logPath)}\n`
  );
  chmodSync(openerPath, 0o755);
  return { binDir, logPath };
}

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  root = makeProject();
});

describe('alignment pack workflow', () => {
  it('map generates a standalone alignment pack artifact by default for graph-capable map data', () => {
    const result = runCli(['map', '--map', 'demo'], { cwd: root });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const artifacts = alignmentPackArtifacts(root);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].pack.source.map.id).toBe('demo');
    expect(artifacts[0].pack.graph.nodes.map((node: { id: string }) => node.id)).toEqual(['001', '002']);
    expect(artifacts[0].pack.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromNodeId: '001', toNodeId: '002' }),
      ])
    );
  });

  it('align-viewer serves the pack on localhost, opens it, and records the review the page posts back', async () => {
    const opener = writeFakeOpener(root);
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [CLI_BIN, 'align-viewer', '--map', 'demo'], {
      cwd: root,
      env: { ...process.env, ACSTACK_ALIGN_PORT: String(port), SSH_CONNECTION: '', PATH: `${opener.binDir}:${process.env.PATH ?? ''}` },
    });
    let stdout = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    const url = `http://127.0.0.1:${port}/`;
    let html = '';
    for (let attempt = 0; attempt < 50 && !html; attempt += 1) {
      html = await fetch(url).then(res => res.text(), () => new Promise<string>(done => setTimeout(() => done(''), 100)));
    }
    const token = html.match(/name="acstack-review-token" content="([0-9a-f]+)"/)?.[1] ?? '';
    const packVersion = alignmentPackArtifacts(root)[0].pack.packVersion;
    const review = (headers: Record<string, string>) =>
      fetch(`${url}api/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          packVersion,
          reviewState: { approval: { packVersion, status: 'changes-requested' } },
          annotations: [{ packVersion, target: { type: 'node', id: '002' }, comment: 'Name the payment steps' }],
        }),
      });

    expect((await review({})).status).toBe(403);
    // A DNS-rebinding page arrives under its own host name.
    const rebound = await new Promise<number>(done =>
      request({ host: '127.0.0.1', port, path: '/', headers: { host: `evil.example:${port}` } }, res => done(res.statusCode ?? 0)).end()
    );
    expect(rebound).toBe(421);
    const accepted = await review({ 'x-review-token': token });
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as { prompt: string }).prompt).toMatch(/requests changes\. Read the 1 comment in .*feedback\.md/);
    await once(child, 'exit');

    expect(readFileSync(opener.logPath, 'utf-8').trim()).toBe(`http://localhost:${port}/`);
    expect(readFileSync(join(root, 'acstack', 'alignment-packs', 'demo', 'feedback.md'), 'utf-8')).toContain('Name the payment steps');
    expect(stdout).toContain('Review state: changes-requested');
  });

  it('does not keep align as a review command', () => {
    const result = runCli(['align', '--map', 'demo'], { cwd: root });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command 'align'");
  });

  it('gives each item a business summary and the full body as its technical definition', () => {
    const result = runCli(['map', '--map', 'demo'], { cwd: root });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const nodes = alignmentPackArtifacts(root)[0].pack.graph.nodes as Array<{ id: string; summary: string; technicalSummary?: string }>;
    expect(nodes.find(node => node.id === '002')).toMatchObject({
      summary: 'Returning customers can pay with a card they saved before.',
      technicalSummary: 'Connect saved card UX to the checkout destination and implementation notes.',
    });
    // No summary in the file: the body's first paragraph stands in.
    expect(nodes.find(node => node.id === '001')?.summary).toBe('The checkout map aligns product, design, and engineering review.');
  });

  it('changes the pack version when only a summary changes', () => {
    expect(runCli(['map', '--map', 'demo'], { cwd: root }).status).toBe(0);
    const before = alignmentPackArtifacts(root)[0].pack.packVersion;
    const file = join(root, 'acstack', 'maps', 'demo', '002-saved-card-flow.md');
    writeFileSync(file, readFileSync(file, 'utf-8').replace('a card they saved before', 'a stored card'));

    expect(runCli(['map', '--map', 'demo'], { cwd: root }).status).toBe(0);
    expect(alignmentPackArtifacts(root).map(artifact => artifact.pack.packVersion)).toContain(before);
    expect(new Set(alignmentPackArtifacts(root).map(artifact => artifact.pack.packVersion)).size).toBe(2);
  });

  it('refuses a request for changes with no comments, and a map name that leaves the maps folder', () => {
    expect(runCli(['map', '--map', 'demo'], { cwd: root }).status).toBe(0);
    const { packVersion } = alignmentPackArtifacts(root)[0].pack;
    const feedbackPath = join(root, 'empty.json');
    writeFileSync(feedbackPath, JSON.stringify({ packVersion, reviewState: { approval: { packVersion, status: 'changes-requested' } } }));

    const empty = runCli(['align-viewer', '--map', 'demo', '--feedback', feedbackPath], { cwd: root });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('Request changes needs at least one comment.');
    const escape = runCli(['map', '--map', '..'], { cwd: root });
    expect(escape.status).toBe(1);
    expect(escape.stderr).toContain('Map name ".."');
  });

  it('keeps generated packs out of git by default', () => {
    const result = runCli(['map', '--map', 'demo'], { cwd: root });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(readFileSync(join(root, 'acstack', 'alignment-packs', '.gitignore'), 'utf-8')).toMatch(/^\*$/m);
  });

  it('align-viewer records a review from a feedback file and reports review state', () => {
    const initial = runCli(['map', '--map', 'demo'], { cwd: root });
    expect(initial.status, initial.stderr || initial.stdout).toBe(0);
    const initialPack = alignmentPackArtifacts(root)[0].pack;
    const feedbackPath = join(root, 'feedback.json');
    writeFileSync(
      feedbackPath,
      JSON.stringify(
        {
          packVersion: initialPack.packVersion,
          reviewState: {
            approval: {
              packVersion: initialPack.packVersion,
              status: 'approved',
              approvedBy: 'design-review',
            },
          },
        },
        null,
        2
      )
    );
    const result = runCli(['align-viewer', '--map', 'demo', '--feedback', feedbackPath], { cwd: root });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const reviewed = alignmentPackArtifacts(root).at(-1)?.pack;
    expect(reviewed?.reviewState.approval).toEqual(
      expect.objectContaining({
        packVersion: initialPack.packVersion,
        status: 'approved',
        approvedBy: 'design-review',
      })
    );
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/approved|review/i);
  });

  it('align-viewer turns viewer comments into an agent feedback file', () => {
    const initial = runCli(['map', '--map', 'demo'], { cwd: root });
    expect(initial.status, initial.stderr || initial.stdout).toBe(0);
    const { packVersion } = alignmentPackArtifacts(root)[0].pack;
    const feedbackPath = join(root, 'feedback.json');
    writeFileSync(
      feedbackPath,
      JSON.stringify({
        packVersion,
        reviewState: { approval: { packVersion, status: 'changes-requested' } },
        annotations: [
          { packVersion, target: { type: 'node', id: '002' }, selectedText: 'design', comment: 'Name the payment steps', time: '2026-10-13T00:00:00Z' },
        ],
      })
    );

    const result = runCli(['align-viewer', '--map', 'demo', '--feedback', feedbackPath], { cwd: root });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const feedback = readFileSync(join(root, 'acstack', 'alignment-packs', 'demo', 'feedback.md'), 'utf-8');
    expect(feedback).toContain('Name the payment steps');
    expect(feedback).toContain('Selected text: design');
    expect(result.stdout).toContain('1 comment imported.');
  });

  it('align-viewer reports mismatched feedback pack versions without mutating source map files', () => {
    const initial = runCli(['map', '--map', 'demo'], { cwd: root });
    expect(initial.status, initial.stderr || initial.stdout).toBe(0);
    const before = sourceSnapshot(root);
    const feedbackPath = join(root, 'wrong-version-feedback.json');
    writeFileSync(
      feedbackPath,
      JSON.stringify(
        {
          packVersion: 'different-pack-version',
          reviewState: {
            approval: {
              packVersion: 'different-pack-version',
              status: 'approved',
              approvedBy: 'design-review',
            },
          },
        },
        null,
        2
      )
    );

    const result = runCli(['align-viewer', '--map', 'demo', '--feedback', feedbackPath], { cwd: root });

    expect(sourceSnapshot(root)).toEqual(before);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/version/i);
    expect(`${result.stdout}\n${result.stderr}`).toContain('different-pack-version');
  });
});
