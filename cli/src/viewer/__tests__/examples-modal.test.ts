import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { FrameStatus } from '../example-frame.js';
import { componentLabel, describe as describeSelection, ExampleContext, ExamplesModal, ExamplesTab, FixtureView, TweakControls } from '../examples-modal.js';
import { cacheExample, exampleCapture, setExampleView, type ElementExample } from '../examples.js';
import { pack, type Annotation } from '../pack.js';

vi.mock('../pack.js', () => ({
  annotationId: () => 'id',
  token: 'secret',
  pack: { packVersion: 'v1', graph: { nodes: [], edges: [], groups: [] }, source: { references: [] } },
}));

const examples: ElementExample[] = [
  { kind: 'html', path: 'checkout.html', title: 'Checkout mock', html: '<button>Pay</button>' },
  {
    kind: 'od-build', path: 'cart', title: 'Cart build',
    tweaks: [{ id: 'density', label: 'Density', type: 'select', options: ['cozy', 'compact'], discardReason: '' }],
    variants: [
      { id: 'a', label: 'Grid', tweaks: [{ id: 'radius', label: 'Corner radius', type: 'slider', target: '--radius', min: 0, max: 24, unit: 'px', default: 8 }] },
      { id: 'b', label: 'List' },
    ],
    html: '<meta name="od-variant" content="a"><div data-od-component="Cart">Cart</div>',
  },
  { kind: 'markdown', path: 'flow.md', title: 'Checkout flow', markdown: '## Steps\n\n| Step | Who |\n|---|---|\n| Pay | Customer |\n\n```mermaid\nflowchart LR\n  A --> B\n```' },
  { kind: 'fixture', path: 'order.json', title: 'Order fixture', format: 'json', data: '[{"id":1,"note":"<img src=x onerror=alert(1)>"}]', illustrative: true },
];
const comment: Annotation = { id: 'c1', packVersion: 'v1', target: { type: 'node', id: 'checkout' }, example: { path: 'checkout.html', selections: [{ selector: '#pay', rect: { x: 0, y: 0, width: 10, height: 10 }, component: { name: 'PayButton' }, text: '<b>Pay</b>' }, { selector: '#total', rect: { x: 0, y: 20, width: 10, height: 10 } }] }, comment: 'Make it bigger' };

// The page lists summaries; the content arrives from the review server and is cached.
const summaries = examples.map(({ kind, path, title, illustrative }) => ({ kind, path, title, ...(illustrative && { illustrative }) }));
(pack.graph.nodes as unknown[]).push({ id: 'checkout', examples: summaries });
for (const example of examples) cacheExample('checkout', example);

const modal = (path: string, annotations: Annotation[] = []) => renderToStaticMarkup(createElement(ExamplesModal, { nodeId: 'checkout', examples: summaries, path, onPath: vi.fn(), onClose: vi.fn(), annotations, setAnnotations: vi.fn() }));

it('lists an element\'s examples with their kind in the Examples tab', () => {
  const html = renderToStaticMarkup(createElement(ExamplesTab, { nodeIds: ['checkout'], empty: 'None.', annotations: [comment], setAnnotations: vi.fn() }));
  for (const text of ['Checkout mock', 'Mock, 1 comment', 'Cart build', 'Document', 'Sample data, illustrative']) expect(html).toContain(text);
  expect(html).toContain('aria-haspopup="dialog"');
  expect(renderToStaticMarkup(createElement(ExamplesTab, { nodeIds: ['other'], empty: 'No examples match this filter.', annotations: [], setAnnotations: vi.fn() }))).toContain('No examples match this filter.');
});

it('labels each listed example by its element, across the whole design', () => {
  (pack.graph.nodes as unknown[]).push({ id: 'orders', label: 'Order history', examples: [summaries[0]] });
  try {
    const html = renderToStaticMarkup(createElement(ExamplesTab, { nodeIds: ['checkout', 'orders', 'plain'], empty: 'None.', annotations: [], setAnnotations: vi.fn() }));
    expect(html.match(/class="example-group"/g)).toHaveLength(2);
    expect(html).toContain('>Order history</h3>');
  } finally { (pack.graph.nodes as unknown[]).pop(); }
});

it('renders inline HTML in an opaque-origin frame with labelled controls', () => {
  const html = modal('checkout.html', [comment]);
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).not.toContain('allow-same-origin');
  expect(html).toContain('title="Checkout mock"');
  expect(html).toContain('aria-label="Close examples"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toMatch(/aria-labelledby="[^"]+"/);
  // The authored mock never lands in the viewer document; the bridge loads it into the frame.
  expect(html).not.toContain('<button>Pay</button>');
  expect(html).toContain('Pay button: &lt;b&gt;Pay&lt;/b&gt;; Element');
  expect(html).toContain('data-tooltip="PayButton; #total"');
  expect(html).toContain('<span class="mark-number" aria-hidden="true">1</span>');
  // One composer, no explanatory prose.
  expect(html.match(/<textarea/g)).toHaveLength(1);
  expect(html).not.toContain('Comments anchor to the whole example');
});

it('renders an OpenDesigner build in the srcdoc frame with a variant switcher and its tweaks', () => {
  const html = modal('cart');
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).toContain('title="Cart build, Grid"');
  expect(html).toContain('Pick elements');
  expect(html).toContain('Variant');
  expect(html).not.toContain('data-od-component');
  // Design-level and variant-level tweaks are both drawn, as ACStack controls.
  // Variants show as a segmented control; tweaks sit behind a popover button.
  expect(html).toMatch(/role="group" aria-label="Variant"><button type="button" aria-pressed="true">Grid<\/button><button type="button" aria-pressed="false">List<\/button>/);
  expect(html).toMatch(/popover="auto" role="dialog" aria-label="Tweaks"/);
  expect(html).toContain('Density');
  expect(html).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Corner radius<span class="tweak-value">8px<\/span><\/label><input id="\1" type="range" min="0" max="24"/);
});

it('draws a labelled control for each tweak type', () => {
  const html = renderToStaticMarkup(createElement(TweakControls, { values: { on: '1' }, onChange: vi.fn(), tweaks: [
    { id: 'brand', label: 'Brand', type: 'color', default: '#112233' },
    { id: 'on', label: 'Show badge', type: 'toggle', discardReason: '' },
    { id: 'copy', label: 'Heading', type: 'text', default: 'Hi' },
    { id: 'phase', label: 'State', type: 'state', options: [{ label: 'Loading', value: 'loading' }] },
  ] }));
  expect(html).toMatch(/for="[^"]+">Brand<\/label><div class="tweak-color"><input[^>]*type="color" value="#112233"/);
  expect(html).toMatch(/<label class="tweak-row tweak-toggle"><span class="tweak-label">Show badge<\/span><input type="checkbox" role="switch" checked=""\/><\/label>/);
  expect(html).toMatch(/for="[^"]+">Heading<\/label><input[^>]*type="text" value="Hi"/);
  expect(html).toContain('Loading');
});

it('renders Markdown and Mermaid with the existing renderer, with no picker', () => {
  const html = modal('flow.md');
  expect(html).toContain('<table>');
  expect(html).toContain('title="Mermaid diagram"');
  expect(html).not.toContain('Pick elements');
});

it('renders fixtures as a text-only table', () => {
  const html = modal('order.json');
  expect(html).toContain('<th scope="col"><code>note</code></th>');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<img');
  expect(renderToStaticMarkup(createElement(FixtureView, { format: 'csv', data: 'a\n<script>x</script>' }))).toContain('&lt;script&gt;');
});

it('renders frame-supplied error text and selections as text only', () => {
  const html = renderToStaticMarkup(createElement(FrameStatus, { status: { state: 'error', message: '<img src=x onerror=alert(1)>' } }));
  expect(html).toContain('This example failed to render.');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(renderToStaticMarkup(createElement(FrameStatus, { status: { state: 'closed' } }))).toContain('navigated away and was stopped');
  expect(describeSelection({ selector: '#a', text: '', component: { name: 'Card' } })).toBe('Card');
});

it('opens straight to a linked example and variant', () => {
  const html = renderToStaticMarkup(createElement(ExamplesTab, { nodeIds: ['checkout'], empty: 'None.', link: { nodeId: 'checkout', path: 'cart', variant: 'b' }, annotations: [], setAnnotations: vi.fn() }));
  expect(html).toContain('<dialog');
  expect(html).toContain('title="Cart build, List"');
  // A link for another element or a missing example opens nothing.
  expect(renderToStaticMarkup(createElement(ExamplesTab, { nodeIds: ['checkout'], empty: 'None.', link: { nodeId: 'other', path: 'cart' }, annotations: [], setAnnotations: vi.fn() }))).not.toContain('<dialog');
  expect(renderToStaticMarkup(createElement(ExamplesTab, { nodeIds: ['checkout'], empty: 'None.', link: { nodeId: 'checkout', path: 'gone' }, annotations: [], setAnnotations: vi.fn() }))).not.toContain('<dialog');
});

it('captures the viewed variant, its tweak values, and all its states for a lock', () => {
  const loaded: ElementExample[] = [{
    kind: 'od-build', path: 'cart', title: 'Cart', html: '',
    tweaks: [{ id: 'density', label: 'Density', type: 'select', options: ['cozy', 'compact'], discardReason: '' }],
    variants: [
      { id: 'a' },
      { id: 'b', tweaks: [{ id: 'phase', label: 'State', type: 'state', options: ['loading', { label: 'Empty', value: 'empty' }] }, { id: 'radius', label: 'Radius', type: 'slider', default: 8 }] },
    ],
  }, { kind: 'html', path: 'x.html', title: 'X', html: '' }];
  expect(exampleCapture('lock-node', loaded)).toBeUndefined();
  setExampleView('lock-node', 'cart', { variant: 'b', values: { b: { radius: '12' } } });
  setExampleView('lock-node', 'x.html', { values: {} });
  expect(exampleCapture('lock-node', loaded)).toEqual({ examples: { cart: { variant: 'b', tweaks: { density: 'cozy', radius: '12' }, states: { phase: ['loading', 'empty'] } } } });
});

it('shows a loading state until the example content arrives', () => {
  const html = renderToStaticMarkup(createElement(ExamplesModal, { nodeId: 'uncached', examples: [{ kind: 'html', path: 'a.html', title: 'A' }], path: 'a.html', onPath: vi.fn(), onClose: vi.fn(), annotations: [], setAnnotations: vi.fn() }));
  expect(html).toContain('Loading example...');
  expect(html).not.toContain('<iframe');
});

it('labels picked elements in plain words, using a container\'s first line', () => {
  expect(['PayButton', 'LineItem', 'OrderSummaryCard', 'nav-bar', 'CTA'].map(componentLabel)).toEqual(['Pay button', 'Line item', 'Order summary card', 'nav bar', 'CTA']);
  expect(describeSelection({ selector: 'div', text: 'Your order\nORDER 4821 · 4 NOV 2026\nItem Qty Price' })).toBe('Your order');
  expect(describeSelection({ selector: 'p', text: 'A very long sentence that keeps going well past forty characters' })).toBe('A very long sentence that keeps going w…');
  expect(describeSelection({ selector: 'span', text: '' })).toBe('Element');
});

it('names the example, variant, and picked elements for a comment listed outside the modal', () => {
  const html = renderToStaticMarkup(createElement(ExampleContext, { nodeId: 'checkout', anchor: { path: 'cart', variant: 'b', selections: [{ selector: '#pay', rect: { x: 0, y: 0, width: 1, height: 1 }, component: { name: 'PayButton' }, text: 'Pay' }] } }));
  expect(html).toContain('Cart build · List');
  expect(html).toContain('Pay button: Pay');
});

it('labels a picked table row by its first cell', () => {
  expect(describeSelection({ selector: 'tr', text: 'Gift wrap\nWRP-STD\t1\t£0.00\t£0.00', component: { name: 'ReceiptLine' } })).toBe('Receipt line: Gift wrap');
  expect(describeSelection({ selector: 'tr', text: 'Gift wrap\t1\t£0.00', component: { name: 'ReceiptLine' } })).toBe('Receipt line: Gift wrap');
});
