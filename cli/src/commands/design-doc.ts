import { Command, Option } from 'commander';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { designDocToPack, renderDesignDocMarkdown } from '../lib/design-doc.js';
import { renderAlignmentPackHtml } from '../lib/alignment-pack-renderer.js';
import { inProject } from '../lib/utils.js';
import { changedElements, loadMapDesign, openDesignLifecycle, reviewHistories } from '../lib/design-lifecycle.js';
import { createReviewServer, listenForReview, REVIEW_PORT } from '../lib/review-server.js';
import { DiagramOrientationSchema, type DiagramOrientation } from '../lib/alignment-packs.js';
import { ANNOTATIONS_PATH } from '../lib/alignment-review-protocol.js';

export function generateDesignDoc(root: string, map: string, output: string, markdown?: string, orientation: DiagramOrientation = 'top-to-bottom'): void {
  const { doc } = loadMapDesign(root, map);
  const html = renderAlignmentPackHtml(designDocToPack(doc, orientation));
  // Exclusive creation protects existing files and reviewer artifacts, including symlinks.
  writeFileSync(resolve(output), html, { flag: 'wx' });
  if (markdown) writeFileSync(resolve(markdown), renderDesignDocMarkdown(doc, orientation), { flag: 'wx' });
}
const warn = (warnings: string[]) => { for (const warning of warnings) console.error(`warning: ${warning}`); };
export function register(program: Command): void {
  const lifecycle = program.command('design-review').description('Inspect and reconcile exact design doc revisions');
  lifecycle.command('status <map>').option('--review-file <path>', 'Canonical historical feedback snapshot')
    .action(inProject((root, map: string, options: { reviewFile?: string }) => {
      console.log(JSON.stringify(openDesignLifecycle(root, map, options.reviewFile).status()));
    }));
  lifecycle.command('approve-element <map> <id>')
    .description("Lock or re-approve one element. Only on the user's explicit instruction")
    .action(inProject((root, map: string, id: string) => {
      console.log(JSON.stringify(openDesignLifecycle(root, map).approveElement(id)));
    }));
  lifecycle.command('reconcile <map>').requiredOption('--input <json-file>', 'Explicit reconciliation decisions')
    .option('--review-file <path>', 'Canonical historical feedback snapshot')
    .action(inProject((root, map: string, options: { input: string; reviewFile?: string }) => {
      if (!statSync(options.input).isFile() || statSync(options.input).size > 1_000_000) throw new Error('Invalid reconciliation input');
      let input: unknown;
      try {
        input = JSON.parse(readFileSync(options.input, 'utf8')) as unknown;
      } catch (error) {
        throw new Error(`Invalid reconciliation input ${options.input}: ${(error as Error).message}`);
      }
      console.log(JSON.stringify(openDesignLifecycle(root, map, options.reviewFile).reconcile(input)));
    }));
  program.command('design-doc <map>')
    .description("Review a map's design doc with live, durable comments")
    .addOption(new Option('--orientation <orientation>', 'Diagram flow direction').choices(DiagramOrientationSchema.options).default('top-to-bottom'))
    .option('--port <port>', 'Local review port', String(REVIEW_PORT))
    .option('--markdown <path>', 'Also generate a GitHub-readable Markdown companion')
    .option('--check', 'Validate the design doc and print warnings without serving it')
    .action(inProject(async (root, map: string, options: { port: string; markdown?: string; orientation: DiagramOrientation; check?: boolean }) => {
      if (options.check) {
        const { doc, warnings } = loadMapDesign(root, map);
        warn(warnings);
        const changed = changedElements(doc, reviewHistories(root, doc.id).values());
        if (changed.length) throw new Error(`Changed since the user approved: ${changed.join(', ')}. Report the change; re-approve only on the user's instruction (design-review approve-element).`);
        console.log(`Design doc ${doc.name}: ${doc.items.length} elements, ${doc.questions.length} open questions`);
        return;
      }
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');
      const lifecycle = openDesignLifecycle(root, map);
      const doc = lifecycle.doc;
      warn(lifecycle.warnings);
      const pack = designDocToPack(doc, options.orientation);
      if (options.markdown) writeFileSync(resolve(options.markdown), renderDesignDocMarkdown(doc, options.orientation), { flag: 'wx' });
      lifecycle.status();
      const review = lifecycle.review;
      const handoffPrompt = `Read the review JSON at ${JSON.stringify(review.reviewPath)}. Resolve each comment against the design doc on map ${JSON.stringify(map)} and update the map's element nodes to address the saved feedback. Answers the reviewer gave are already on the map as resolved question nodes; pick up their follow-ups at your next frontier recompute. Never lock an element yourself. Run design-review status, explicitly reconcile every comment with design-review reconcile, then reopen the review with design-doc for approval of the resulting revision.`;
      const server = createReviewServer({ handoffPrompt, html: renderAlignmentPackHtml(pack), path: ANNOTATIONS_PATH, mode: 'comments', designReview: { get: lifecycle.status, post: body => {
        if (body && typeof body === 'object' && 'questionId' in body) return lifecycle.answer(body);
        if (body && typeof body === 'object' && 'lock' in body) return lifecycle.lock(body);
        return lifecycle.approve(body);
      } }, get: review.get, post: review.post });
      console.log(`Agent feedback: ${review.reviewPath}`);
      await listenForReview(server, port, doc.name);
    }));
}
