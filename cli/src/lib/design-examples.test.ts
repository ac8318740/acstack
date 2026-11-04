import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkElementExamples, elementFolder, ExampleEntrySchema, loadExampleContent, tokenMap, type ExampleEntry } from './design-examples.js';
import { designFromNodes } from './design-doc.js';
import { unchosenVariants } from './design-map.js';
import type { GraphNode } from './nodes.js';
import { EX, EXAMPLE_MAP, EXAMPLE_ROOT, exampleDesign } from '../example-design.js';

const dirs: string[] = [];
const path = process.env.PATH;
afterEach(() => { process.env.PATH = path; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// A project folder with one element folder, and a separate checkout for OpenDesigner.
function setup(files: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'design-examples-'));
  dirs.push(base);
  const root = join(base, 'project'), checkout = join(base, 'checkout');
  const folder = elementFolder(root, 'demo', '002');
  mkdirSync(folder, { recursive: true });
  mkdirSync(checkout);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  return { base, root, checkout, folder };
}
const entries = (...list: unknown[]) => list.map(entry => ExampleEntrySchema.parse(entry));
const check = (root: string, checkout: string, examples: ExampleEntry[], locked = false) => checkElementExamples(root, 'demo', [{ id: '002', locked, examples }], checkout);
const schema = JSON.stringify({ type: 'array', items: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' }, name: { type: 'string' } } } });
function openDesigner(checkout: string, variants: string[], build: string) {
  const design = join(checkout, '.open-designer/designs/checkout');
  mkdirSync(design, { recursive: true });
  writeFileSync(join(design, 'index.json'), JSON.stringify({ pages: [{ id: 'home', variants: variants.map(id => ({ id, file: `${id}.tsx` })) }] }));
  // A real subprocess stands in for OpenDesigner's CLI, with its documented JSON stdout.
  const bin = join(checkout, 'bin');
  mkdirSync(bin);
  writeFileSync(join(checkout, 'built.html'), build);
  writeFileSync(join(bin, 'open-designer'), `#!${process.execPath}
const args = process.argv.slice(2);
if (args.join(' ') !== 'build checkout --page home') { console.error('bad args ' + args.join(' ')); process.exit(2); }
if (require('node:fs').existsSync('fail')) { console.error('variant a: Unexpected token'); process.exit(1); }
console.log(JSON.stringify({ path: ${JSON.stringify(join(checkout, 'built.html'))}, size: ${Buffer.byteLength(build)}, design: 'checkout', page: 'home', variant: 'a', variants: ${JSON.stringify(variants)} }));
`);
  chmodSync(join(bin, 'open-designer'), 0o755);
  process.env.PATH = `${bin}:${path}`;
}

describe('element example config', () => {
  it('takes exactly one kind per entry, and a schema only with a fixture', () => {
    expect(() => ExampleEntrySchema.parse({ html: 'a.html', markdown: 'b.md' })).toThrow('exactly one');
    expect(() => ExampleEntrySchema.parse({})).toThrow('exactly one');
    expect(() => ExampleEntrySchema.parse({ html: 'a.html', schema: 's.json' })).toThrow('Only a fixture');
    expect(() => ExampleEntrySchema.parse({ od: { design: '../x', page: 'home' } })).toThrow();
  });

  it('reads examples from an element node config into the pack summaries', () => {
    const { root, checkout } = setup({ 'flow.md': '# Flow' });
    const block = (summary: string, yaml: string) => `<details>\n<summary>${summary}</summary>\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n</details>`;
    const node = (id: string, fields: Partial<GraphNode>): GraphNode => ({ id, title: `Node ${id}`, status: 'open', mode: 'hitl', kind: 'element', label: `Node ${id}`, answers: '001', blockedBy: [], pinned: false, ...fields });
    const { doc } = designFromNodes('demo', [
      node('001', { kind: 'destination', answers: undefined, body: '' }),
      node('002', { body: block('Design element', 'kind: component\nexamples:\n  - {title: Checkout flow, markdown: flow.md, illustrative: true}') }),
    ]);
    expect(check(root, checkout, doc.items[0].examples).summaries.get('002')).toEqual([{ kind: 'markdown', path: 'flow.md', title: 'Checkout flow', illustrative: true }]);
  });
});

describe('element example files', () => {
  it('keeps every path inside the element folder', () => {
    const { base, root, checkout, folder } = setup();
    writeFileSync(join(base, 'secret.html'), 'x');
    symlinkSync(join(base, 'secret.html'), join(folder, 'link.html'));
    for (const html of ['../secret.html', '/etc/passwd', 'a\\..\\b.html']) expect(() => check(root, checkout, entries({ html }))).toThrow('must be relative');
    expect(() => check(root, checkout, entries({ html: 'link.html' }))).toThrow('must be a file inside');
    expect(() => check(root, checkout, entries({ html: 'missing.html' }))).toThrow('does not exist');
  });

  it('validates JSON and CSV fixtures against their JSON Schema', () => {
    const { root, checkout } = setup({
      'people.json': JSON.stringify([{ id: 1, name: 'Ann' }]), 'bad.json': JSON.stringify([{ id: 'one' }]), 'people.schema.json': schema,
      'rows.csv': 'id,name\n1,Ann', 'rows.schema.json': JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', items: { required: ['id', 'name'], properties: { id: { type: 'string' } } } }),
      'big.json': JSON.stringify('x'.repeat(21 * 1024)), 'broken.json': '{',
    });
    expect(check(root, checkout, entries({ fixture: 'people.json', schema: 'people.schema.json' }, { fixture: 'rows.csv', schema: 'rows.schema.json' })).summaries.get('002')).toHaveLength(2);
    expect(() => check(root, checkout, entries({ fixture: 'bad.json', schema: 'people.schema.json' }))).toThrow(/does not match .*: data\/0 must have required property 'name'; data\/0\/id must be integer$/);
    expect(() => check(root, checkout, entries({ fixture: 'big.json' }))).toThrow('over 20 KB');
    expect(() => check(root, checkout, entries({ fixture: 'broken.json' }))).toThrow('not valid JSON');
    // Untyped fixtures are allowed when downstream code is untyped.
    expect(check(root, checkout, entries({ fixture: 'people.json' })).warnings).toEqual([]);
  });

  it('warns on single-variant mocks, inline HTML beside OpenDesigner, and illustrative-only locks', () => {
    const { root, checkout } = setup({ 'mock.html': '<p>Hi</p>', 'flow.md': '# Flow' });
    expect(check(root, checkout, entries({ html: 'mock.html' })).warnings).toEqual(['Element 002: mock mock.html has 1 variant; add another so the reviewer can compare options']);
    expect(check(root, checkout, entries({ markdown: 'flow.md', illustrative: true }), true).warnings).toEqual(['Element 002 is locked but has only illustrative examples, so none is a requirement']);
    openDesigner(checkout, ['a'], '');
    expect(check(root, checkout, entries({ html: 'mock.html' }), true).warnings).toEqual([expect.stringContaining('inline HTML; OpenDesigner is installed')]);
    const od = check(root, checkout, entries({ od: { design: 'checkout', page: 'home' } }));
    expect(od.summaries.get('002')).toEqual([{ kind: 'od-build', path: 'od:checkout/home', title: 'checkout home', variants: ['a'] }]);
    expect(od.warnings).toEqual(['Element 002: mock od:checkout/home has 1 variant; add another so the reviewer can compare options']);
    expect(() => check(root, checkout, entries({ od: { design: 'checkout', page: 'away' } }))).toThrow('has no page away');
    expect(() => check(root, checkout, entries({ od: { design: 'gone', page: 'home' } }))).toThrow('no readable');
  });
});

describe('example content', () => {
  it('builds an OpenDesigner example and returns its variants, tweaks, and token map', async () => {
    const { root, checkout } = setup();
    const meta = { page: { tweaks: [{ id: 'radius', type: 'slider', label: 'Radius', target: '--radius', transform: 'add' }] }, designTweaks: [{ id: 'density', type: 'select', label: 'Density', options: ['a'] }], variants: [{ id: 'a', label: 'Grid', tweaks: [] }, { id: 'b', tweaks: [{ id: 'x', type: 'text', label: 'X' }] }] };
    const build = `<meta name="od-variant" content="a">\n<script type="application/json" id="od-page">${JSON.stringify(meta)}</script>\n<style data-od-tokens="base">:root { --radius: 4px; --brand: #123 }</style><style data-od-tokens="brand">:root{--brand:#456;}</style>`;
    openDesigner(checkout, ['a', 'b'], build);
    const content = await loadExampleContent(root, 'demo', '002', ExampleEntrySchema.parse({ od: { design: 'checkout', page: 'home' } }), checkout);
    expect(content).toEqual({
      kind: 'od-build', html: build, tweaks: [...meta.designTweaks, ...meta.page.tweaks],
      variants: [{ id: 'a', label: 'Grid', tweaks: [] }, { id: 'b', tweaks: [{ id: 'x', type: 'text', label: 'X' }] }], tokens: { '--radius': '4px', '--brand': '#456' },
    });
    writeFileSync(join(checkout, 'fail'), '');
    await expect(loadExampleContent(root, 'demo', '002', ExampleEntrySchema.parse({ od: { design: 'checkout', page: 'home' } }), checkout)).rejects.toThrow('variant a: Unexpected token');
  });

  it('returns file examples, wrapping Mermaid in a fence longer than any in its source', async () => {
    const { root, checkout } = setup({ 'flow.mmd': 'flowchart LR\n  A -->|```| B', 'rows.csv': 'a\n1' });
    const load = (entry: unknown) => loadExampleContent(root, 'demo', '002', ExampleEntrySchema.parse(entry), checkout);
    expect(await load({ mermaid: 'flow.mmd' })).toEqual({ kind: 'markdown', markdown: '````mermaid\nflowchart LR\n  A -->|```| B\n````' });
    expect(await load({ fixture: 'rows.csv' })).toEqual({ kind: 'fixture', format: 'csv', data: 'a\n1' });
    await expect(load({ html: '../x.html' })).rejects.toThrow('must be relative');
  });

  it('reads only token sheets for the token map', () => {
    expect(tokenMap('<style>:root{--x:1}</style><style data-od-tokens="t">:root{--y: 2px}</style>')).toEqual({ '--y': '2px' });
  });
});

it('holds approval for each multi-variant mock on a loose element', () => {
  const item = (id: string, locked: boolean, variants: string[]) => ({ id, locked, exampleSummaries: [{ kind: 'od-build' as const, path: 'od:c/h', title: 'Checkout', variants }] });
  const doc = { items: [item('a', false, ['x', 'y']), item('b', true, ['x', 'y']), item('c', false, ['x'])] } as unknown as Parameters<typeof unchosenVariants>[0];
  expect(unchosenVariants(doc)).toEqual([{ kind: 'variant', targetId: 'a', label: 'Choose a variant of Checkout', nodeId: 'a', example: 'od:c/h' }]);
});

it('checks the worked example with one of each file kind', () => {
  const doc = exampleDesign();
  const { summaries, warnings } = checkElementExamples(EXAMPLE_ROOT, EXAMPLE_MAP, doc.items, EXAMPLE_ROOT);
  expect(summaries.get(EX.viewer)?.map(summary => [summary.kind, summary.path])).toEqual([
    ['html', 'examples-modal.html'], ['markdown', 'review-flow.md'], ['markdown', 'comment-anchor.mmd'], ['fixture', 'comments.json'],
  ]);
  expect(warnings).toEqual(['Element 008: mock examples-modal.html has 1 variant; add another so the reviewer can compare options']);
});
