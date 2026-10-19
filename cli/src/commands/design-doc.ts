import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDesignDoc, designDocToPack, renderDesignDocMarkdown } from '../lib/design-doc.js';
import { renderAlignmentPackHtml } from '../lib/alignment-pack-renderer.js';
import { inProject } from '../lib/utils.js';
import { openDesignReview } from '../lib/design-review.js';
import { createReviewServer, listenForReview, REVIEW_PORT } from '../lib/review-server.js';
import { ANNOTATIONS_PATH } from '../lib/alignment-review-protocol.js';

export function generateDesignDoc(entry: string, output: string, markdown?: string): void {
  const doc = loadDesignDoc(entry);
  const html = renderAlignmentPackHtml(designDocToPack(doc));
  // Exclusive creation protects authored inputs and existing reviewer artifacts, including symlinks.
  writeFileSync(resolve(output), html, { flag: 'wx' });
  if (markdown) writeFileSync(resolve(markdown), renderDesignDocMarkdown(doc), { flag: 'wx' });
}
export function register(program: Command): void {
  program.command('design-doc <entry>')
    .description('Review an authored design with live, durable comments')
    .option('--port <port>', 'Local review port', String(REVIEW_PORT))
    .option('--markdown <path>', 'Also generate a GitHub-readable Markdown companion')
    .action(inProject(async (root, entry: string, options: { port: string; markdown?: string }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535');
      const doc = loadDesignDoc(entry);
      const pack = designDocToPack(doc);
      if (options.markdown) writeFileSync(resolve(options.markdown), renderDesignDocMarkdown(doc), { flag: 'wx' });
      const review = openDesignReview(root, pack);
      const handoffPrompt = `Read the review JSON at ${JSON.stringify(review.reviewPath)}. Resolve feedback against the authored design entry ${JSON.stringify(resolve(entry))} and update the authored source to address the comments. Explain unresolved decisions and reopen the review for follow-up.`;
      const server = createReviewServer({ handoffPrompt, html: renderAlignmentPackHtml(pack), path: ANNOTATIONS_PATH, mode: 'comments', get: review.get, post: review.post });
      console.log(`Agent feedback: ${review.reviewPath}`);
      await listenForReview(server, port, doc.name);
    }));
}
