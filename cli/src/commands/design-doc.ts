import { Command, Option } from 'commander';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { designCheck, designDocToPack, renderDesignDocMarkdown, targetingNodes } from '../lib/design-doc.js';
import { renderAlignmentPackHtml } from '../lib/alignment-pack-renderer.js';
import { inProject } from '../lib/utils.js';
import { changedElements, describeChange, loadMapDesign, openDesignLifecycle, reviewHistories } from '../lib/design-lifecycle.js';
import { createEventHub, createReviewServer, listenForReview, REVIEW_PORT, ReviewHttpError } from '../lib/review-server.js';
import { designWatchRoots, notifyDesign, watchDesign } from '../lib/design-watch.js';
import { mockPath, loadMockContent } from '../lib/design-mocks.js';
import { checkoutRoot } from '../lib/project.js';
import { DiagramOrientationSchema, type DiagramOrientation } from '../lib/alignment-packs.js';
import { ANNOTATIONS_PATH } from '../lib/alignment-review-protocol.js';

export function generateDesignDoc(root: string, map: string, output: string, markdown?: string, orientation: DiagramOrientation = 'top-to-bottom'): void {
  const { doc } = loadMapDesign(root, map);
  const html = renderAlignmentPackHtml(designDocToPack(doc, orientation));
  // Exclusive creation protects existing files and reviewer artifacts, including symlinks.
  writeFileSync(resolve(output), html, { flag: 'wx' });
  if (markdown) writeFileSync(resolve(markdown), renderDesignDocMarkdown(doc, orientation), { flag: 'wx' });
}
/**
 * A design doc review that follows the map: the watcher rebuilds the page and
 * pushes it to open viewers. A design change moves comments to a new review, so
 * the earlier ones stay obligations for the agent instead of vanishing.
 */
export function liveDesignDoc(root: string, map: string, orientation: DiagramOrientation = 'top-to-bottom') {
  let lifecycle = openDesignLifecycle(root, map);
  // A corrupt review file still serves the page, read-only; the page and status name the file.
  try { lifecycle.status(); } catch (error) { if (!(error instanceof ReviewHttpError)) throw error; console.error(`warning: ${error.message}`); }
  const build = () => designDocToPack(lifecycle.doc, orientation);
  let html = renderAlignmentPackHtml(build());
  const events = createEventHub();
  // A corrupt review file names no carried reviews; the page reports the file itself.
  const carried = () => { try { return lifecycle.carried(); } catch (error) { if (error instanceof ReviewHttpError) return []; throw error; } };
  const prompt = () => `Read the review JSON at ${[lifecycle.review.reviewPath, ...carried().map(entry => entry.path)].map(path => JSON.stringify(path)).join(', ')}. Resolve each comment against the design doc on map ${JSON.stringify(map)} and update the map's element nodes to address the saved feedback. Answers the reviewer gave are already on the map as resolved question nodes; pick up their follow-ups at your next frontier recompute. Never lock an element yourself. Run design-review status, explicitly reconcile every comment with design-review reconcile (using --review-file for an earlier review), then reopen the review with design-doc for approval of the resulting revision.`;
  const reload = () => {
    try {
      const previous = lifecycle;
      const next = openDesignLifecycle(root, map);
      // A changed design moves comments to a new review; the earlier ones carry forward, tagged with what changed.
      if (next.review.reviewPath !== previous.review.reviewPath) next.carry([...previous.carried(), { path: previous.review.reviewPath, label: describeChange(previous.doc, next.doc) }]);
      next.status();
      lifecycle = next;
      const pack = build();
      html = renderAlignmentPackHtml(pack);
      events.send({ type: 'design', pack, handoffPrompt: prompt() });
    } catch (error) {
      // Mid-edit contradictions keep the last good page; the viewer shows why it stopped updating.
      events.send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  const server = createReviewServer({ handoffPrompt: prompt, html: () => html, events, path: ANNOTATIONS_PATH, mode: 'comments', designReview: { get: () => lifecycle.status(), post: body => {
    if (body && typeof body === 'object' && 'questionId' in body) return lifecycle.answer(body);
    if (body && typeof body === 'object' && 'lock' in body) return lifecycle.lock(body);
    if (body && typeof body === 'object' && 'chooseVariant' in body) return lifecycle.chooseVariant(body);
    return lifecycle.approve(body);
  } }, get: () => lifecycle.review.get(), post: body => lifecycle.review.post(body), mocks: async query => {
    // Content loads fresh on each request, so a rebuilt page's mocks are current without a cache to drop.
    const entry = lifecycle.doc.items.find(item => item.id === query.get('element'))?.mocks.find(mock => mockPath(mock) === query.get('path'));
    if (!entry) throw new ReviewHttpError(404, 'Unknown mock');
    return await loadMockContent(root, map, query.get('element')!, entry, checkoutRoot() ?? process.cwd());
  } });
  const unwatch = watchDesign(root, map, reload);
  return { server, events, reload, lifecycle: () => lifecycle, stop: () => { unwatch(); events.close(); server.close(); } };
}
// Editing a referenced OpenDesigner design reloads the page. Read once at start, so a newly referenced design needs a restart.
designWatchRoots.push((root, map) => {
  const checkout = checkoutRoot() ?? process.cwd();
  try {
    const designs = loadMapDesign(root, map, checkout).doc.items.flatMap(item => item.mocks.flatMap(mock => mock.od ? [mock.od.design] : []));
    return [...new Set(designs)].map(design => join(checkout, '.open-designer', 'designs', design));
  } catch { return []; }
});
const warn = (warnings: string[]) => { for (const warning of warnings) console.error(`warning: ${warning}`); };
export function register(program: Command): void {
  const lifecycle = program.command('design-review').description('Inspect and reconcile exact design doc revisions');
  lifecycle.command('status <map>').option('--review-file <path>', 'Canonical historical feedback snapshot')
    .action(inProject((root, map: string, options: { reviewFile?: string }) => {
      console.log(JSON.stringify(openDesignLifecycle(root, map, options.reviewFile).status()));
    }));
  lifecycle.command('approve-element <map> <id>')
    .description("Lock or re-approve one element. Only on the user's explicit instruction")
    .option('--variant <path=id>', 'The variant the user chose for a mock with several; repeat per mock', (value: string, list: string[]) => [...list, value], [])
    .action(inProject((root, map: string, id: string, options: { variant: string[] }) => {
      const variants = Object.fromEntries(options.variant.map(value => {
        const at = value.lastIndexOf('=');
        if (at <= 0 || at === value.length - 1) throw new Error(`--variant takes <mock path>=<variant id>, not ${value}`);
        return [value.slice(0, at), value.slice(at + 1)];
      }));
      console.log(JSON.stringify(openDesignLifecycle(root, map).approveElement(id, variants)));
    }));
  lifecycle.command('refresh <map>')
    .description('Tell a running design-doc review to rebuild, after a write it cannot see, such as a gh edit')
    .action(inProject((root, map: string) => {
      console.log(notifyDesign(root, map) ? `Notified the design doc for ${map}` : `No design-doc review has run for ${map}`);
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
        const { nodes, doc, warnings } = loadMapDesign(root, map);
        warn(warnings);
        const changed = changedElements(doc, reviewHistories(root, doc.id).values());
        const what = (id: string) => (doc.items.find(item => item.id === id)?.changes ?? []).map(change => change.label.toLowerCase()).join(', ');
        if (changed.length) throw new Error(`Changed since the user approved: ${changed.map(id => `${id} (${what(id)})`).join('; ')}. Report the change; re-approve only on the user's instruction (design-review approve-element).`);
        const clarity = designCheck(doc);
        warn(clarity.warnings);
        if (clarity.blocking.length) throw new Error(`Design doc ${doc.name} fails its clarity checks:\n${clarity.blocking.map(problem => `- ${problem}`).join('\n')}`);
        const open = doc.questions.filter(question => question.answer === undefined).length;
        const pending = targetingNodes(nodes);
        console.log(`Design doc ${doc.name}: ${doc.items.length} elements, ${open} open human ${open === 1 ? 'question' : 'questions'}, ${pending.length} unresolved map ${pending.length === 1 ? 'item' : 'items'}`);
        for (const node of pending) console.log(`${node.mode === 'afk' ? 'Agent work pending' : 'Human decision pending'}: ${node.title} (${node.id}, target ${node.answers})`);
        return;
      }
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');
      const live = liveDesignDoc(root, map, options.orientation);
      const doc = live.lifecycle().doc;
      warn(live.lifecycle().warnings);
      if (options.markdown) writeFileSync(resolve(options.markdown), renderDesignDocMarkdown(doc, options.orientation), { flag: 'wx' });
      const server = live.server;
      console.log(`Agent feedback: ${live.lifecycle().review.reviewPath}`);
      await listenForReview(server, port, doc.name);
    }));
}
