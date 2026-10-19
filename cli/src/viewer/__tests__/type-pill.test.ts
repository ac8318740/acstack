import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MeasureDiagram } from '../diagram.js';
import { ElementMetadata } from '../element-metadata.js';
import type { DiagramNode } from '../alignment-graph.js';

vi.mock('../pack.js', () => ({ pack: { graph: { nodes: [] }, source: { references: [] } } }));

it('renders a participant without inventing software interfaces', () => {
  const html = renderToStaticMarkup(createElement(ElementMetadata, { kind: 'actor' }));
  expect(html).toContain('Actor');
  expect(html).not.toContain('Interfaces');
});
it('preserves authored interfaces even for actors and unknown future values', () => {
  const html = renderToStaticMarkup(createElement(ElementMetadata, { kind: 'actor', channels: ['cli', 'custom'] }));
  expect(html).toContain('CLI');
  expect(html).toContain('custom');
});

it.each(['actor', 'component', 'store', 'external-system'])('keeps %s identifiable by text in shared measured card and group content', elementKind => {
  for (const kind of ['item', 'folded-group', 'group'] as const) {
    const node: DiagramNode = { id: 'item:example', refId: 'example', kind, elementKind, channels: ['web', 'cli'], label: 'Example', summary: 'Responsibilities', x: 0, y: 0, width: 300, height: 100 };
    const html = renderToStaticMarkup(createElement(MeasureDiagram, { diagram: { nodes: [node], edges: [], nodeToVisible: {} }, zoom: 'business', onMeasured: vi.fn() }));
    const label = { actor: 'Actor', component: 'Component', store: 'Store', 'external-system': 'External system' }[elementKind];
    expect(html).toContain(`<span class="type-pill" data-kind="${elementKind}">${label}</span>`);
    expect(html).toContain('role="group" aria-label="Interfaces"');
    expect(html).toContain('<span class="channel-pill">Web</span>');
    expect(html).toContain('<span class="channel-pill">CLI</span>');
    expect(html).not.toContain('type-pill web');
  }
});
