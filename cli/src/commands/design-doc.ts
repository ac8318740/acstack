import { Command, Option } from 'commander';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDesignDoc, designDocToPack, renderDesignDocMarkdown } from '../lib/design-doc.js';
import { renderAlignmentPackHtml } from '../lib/alignment-pack-renderer.js';
import { inProject } from '../lib/utils.js';
import { openDesignLifecycle } from '../lib/design-lifecycle.js';
import { createReviewServer, listenForReview, REVIEW_PORT } from '../lib/review-server.js';
import { migrateDesignReview } from '../lib/design-migration.js';
import { DiagramOrientationSchema, type DiagramOrientation } from '../lib/alignment-packs.js';
import { ANNOTATIONS_PATH } from '../lib/alignment-review-protocol.js';

export function generateDesignDoc(entry: string, output: string, markdown?: string, orientation: DiagramOrientation = 'top-to-bottom'): void {
  const doc = loadDesignDoc(entry);
  const html = renderAlignmentPackHtml(designDocToPack(doc, orientation));
  // Exclusive creation protects authored inputs and existing reviewer artifacts, including symlinks.
  writeFileSync(resolve(output), html, { flag: 'wx' });
  if (markdown) writeFileSync(resolve(markdown), renderDesignDocMarkdown(doc, orientation), { flag: 'wx' });
}
export function register(program: Command): void {
  const lifecycle = program.command('design-review').description('Inspect and reconcile exact authored design revisions');
  lifecycle.command('migrate <entry>').requiredOption('--legacy-dir <path>', 'Legacy pack directory')
    .requiredOption('--mapping <json-file>', 'Explicit legacy-to-design target mapping')
    .option('--feedback <json-file>', 'Optional exported legacy feedback')
    .action(inProject((root, entry: string, options: { legacyDir: string; mapping: string; feedback?: string }) => {
      console.log(JSON.stringify(migrateDesignReview(root, entry, options)));
    }));
  lifecycle.command('status <entry>').option('--review-file <path>', 'Canonical historical feedback snapshot')
    .action(inProject((root, entry: string, options: { reviewFile?: string }) => {
      console.log(JSON.stringify(openDesignLifecycle(root, entry, options.reviewFile).status()));
    }));
  lifecycle.command('reconcile <entry>').requiredOption('--input <json-file>', 'Explicit reconciliation decisions')
    .option('--review-file <path>', 'Canonical historical feedback snapshot')
    .action(inProject((root, entry: string, options: { input: string; reviewFile?: string }) => {
      if (!statSync(options.input).isFile() || statSync(options.input).size > 1_000_000) throw new Error('Invalid reconciliation input');
      let input: unknown;
      try {
        input = JSON.parse(readFileSync(options.input, 'utf8')) as unknown;
      } catch (error) {
        throw new Error(`Invalid reconciliation input ${options.input}: ${(error as Error).message}`);
      }
      console.log(JSON.stringify(openDesignLifecycle(root, entry, options.reviewFile).reconcile(input)));
    }));
  program.command('design-doc <entry>')
    .description('Review an authored design with live, durable comments')
    .addOption(new Option('--orientation <orientation>', 'Diagram flow direction').choices(DiagramOrientationSchema.options).default('top-to-bottom'))
    .option('--port <port>', 'Local review port', String(REVIEW_PORT))
    .option('--markdown <path>', 'Also generate a GitHub-readable Markdown companion')
    .action(inProject(async (root, entry: string, options: { port: string; markdown?: string; orientation: DiagramOrientation }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');
      const lifecycle = openDesignLifecycle(root, entry);
      const doc = lifecycle.doc;
      const pack = designDocToPack(doc, options.orientation);
      if (options.markdown) writeFileSync(resolve(options.markdown), renderDesignDocMarkdown(doc, options.orientation), { flag: 'wx' });
      lifecycle.status();
      const review = lifecycle.review;
      const handoffPrompt = `Read the review JSON at ${JSON.stringify(review.reviewPath)}. Resolve feedback against the authored design entry ${JSON.stringify(resolve(entry))} and update the authored source to address the comments. Explain unresolved decisions, run design-review status, explicitly reconcile the selected feedback and map contributions with design-review reconcile, and reopen the review with design-doc for approval of the resulting revision.`;
      const server = createReviewServer({ handoffPrompt, html: renderAlignmentPackHtml(pack), path: ANNOTATIONS_PATH, mode: 'comments', designReview: { get: lifecycle.status, post: lifecycle.approve }, get: review.get, post: review.post });
      console.log(`Agent feedback: ${review.reviewPath}`);
      await listenForReview(server, port, doc.name);
    }));
}
