import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { FrameStatus } from '../example-frame.js';
import { describe as describeSelection, ExamplesModal, ExamplesTab, FixtureView } from '../examples-modal.js';
import { setExampleSource, type ElementExample } from '../examples.js';
import type { Annotation } from '../pack.js';

vi.mock('../pack.js', () => ({
  annotationId: () => 'id',
  pack: { packVersion: 'v1', graph: { nodes: [], edges: [], groups: [] }, source: { references: [] } },
}));

const examples: ElementExample[] = [
  { kind: 'html', path: 'checkout.html', title: 'Checkout mock', html: '<button>Pay</button>' },
  { kind: 'od-build', path: 'cart.html', title: 'Cart build', html: '<div data-od-component="Cart">Cart</div>' },
  { kind: 'markdown', path: 'flow.md', title: 'Checkout flow', markdown: '## Steps\n\n| Step | Who |\n|---|---|\n| Pay | Customer |\n\n```mermaid\nflowchart LR\n  A --> B\n```' },
  { kind: 'fixture', path: 'order.json', title: 'Order fixture', format: 'json', data: '[{"id":1,"note":"<img src=x onerror=alert(1)>"}]', illustrative: true },
];
const comment: Annotation = { id: 'c1', packVersion: 'v1', target: { type: 'node', id: 'checkout' }, example: { path: 'checkout.html', selector: '#pay', component: 'PayButton', text: '<b>Pay</b>' }, comment: 'Make it bigger' };

const modal = (path: string, annotations: Annotation[] = []) => renderToStaticMarkup(createElement(ExamplesModal, { nodeId: 'checkout', examples, path, onPath: vi.fn(), onClose: vi.fn(), annotations, setAnnotations: vi.fn() }));

it('lists an element\'s examples with their kind in the Examples tab', () => {
  setExampleSource(id => id === 'checkout' ? examples : []);
  const html = renderToStaticMarkup(createElement(ExamplesTab, { nodeId: 'checkout', annotations: [comment], setAnnotations: vi.fn() }));
  for (const text of ['Checkout mock', 'HTML mock, 1 comment', 'OpenDesigner build', 'Markdown', 'Fixture, illustrative']) expect(html).toContain(text);
  expect(html).toContain('aria-haspopup="dialog"');
  expect(renderToStaticMarkup(createElement(ExamplesTab, { nodeId: 'other', annotations: [], setAnnotations: vi.fn() }))).toContain('This element has no examples.');
  setExampleSource(() => []);
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
  expect(html).toContain('1. PayButton: &lt;b&gt;Pay&lt;/b&gt;');
});

it('renders an OpenDesigner build in the same sandboxed srcdoc frame', () => {
  const html = modal('cart.html');
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).toContain('Pick element');
  expect(html).not.toContain('data-od-component');
});

it('renders Markdown and Mermaid with the existing renderer, with no picker', () => {
  const html = modal('flow.md');
  expect(html).toContain('<table>');
  expect(html).toContain('title="Mermaid diagram"');
  expect(html).not.toContain('Pick element');
});

it('renders fixtures as a text-only table', () => {
  const html = modal('order.json');
  expect(html).toContain('<th scope="col">note</th>');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<img');
  expect(renderToStaticMarkup(createElement(FixtureView, { format: 'csv', data: 'a\n<script>x</script>' }))).toContain('&lt;script&gt;');
});

it('renders frame-supplied error text and selections as text only', () => {
  const html = renderToStaticMarkup(createElement(FrameStatus, { status: { state: 'error', message: '<img src=x onerror=alert(1)>' } }));
  expect(html).toContain('This example failed to render.');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(renderToStaticMarkup(createElement(FrameStatus, { status: { state: 'closed' } }))).toContain('navigated away and was stopped');
  expect(describeSelection({ id: 1, selector: '#a', rect: { x: 0, y: 0, width: 1, height: 1 }, html: '', text: '', styles: {}, component: { name: 'Card' } })).toBe('Card: #a');
});
