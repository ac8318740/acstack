import { describe, expect, it } from 'vitest';
import { AlignmentPackSchema, type AlignmentPack } from './alignment-packs.js';

function sampleHierarchicalPack() {
  return {
    packVersion: 'pack-2026-10-12.281',
    source: {
      map: { id: 'checkout-redesign', version: 'map-v7' },
      references: [
        { id: 'spec-checkout', kind: 'spec', title: 'Checkout redesign spec', uri: 'specs/checkout.md#goals' },
        { id: 'adr-local', kind: 'adr', title: 'Local viewer only', uri: 'docs/adr/0018-alignment-packs-use-local-viewers.md' },
      ],
    },
    graph: {
      groups: [
        {
          id: 'group-checkout',
          label: 'Checkout journey',
          summary: 'The end-to-end path from recognition to payment.',
        },
        {
          id: 'group-sign-in',
          parentGroupId: 'group-checkout',
          label: 'Sign-in experience',
          summary: 'Customers can identify themselves before paying.',
        },
        {
          id: 'group-payment',
          parentGroupId: 'group-checkout',
          label: 'Payment experience',
          summary: 'Customers can pay with saved or new methods.',
        },
      ],
      nodes: [
        {
          id: 'node-passwordless',
          groupId: 'group-sign-in',
          label: 'Passwordless sign-in',
          technicalLabel: 'OIDC magic-link flow',
          summary: 'Lets returning customers sign in without remembering a password.',
          sourceRefs: ['spec-checkout'],
        },
        {
          id: 'node-saved-card',
          groupId: 'group-payment',
          label: 'Saved card payment',
          technicalLabel: 'vault-token charge',
          summary: 'Lets returning customers pay with a card they already trust.',
          sourceRefs: ['spec-checkout', 'adr-local'],
        },
      ],
      edges: [
        {
          id: 'edge-sign-in-enables-card',
          fromNodeId: 'node-passwordless',
          toNodeId: 'node-saved-card',
          relationship: 'enables',
          label: 'Sign-in unlocks saved cards',
          aggregateLabel: 'Knowing the customer unlocks trusted payment options',
          summary: 'Saved cards are only available after the customer is known.',
          sourceRefs: ['spec-checkout'],
        },
      ],
      aggregateEdges: [
        {
          id: 'aggregate-sign-in-to-payment',
          fromGroupId: 'group-sign-in',
          toGroupId: 'group-payment',
          label: 'Known customers can use trusted payment options',
          summary: 'The payment experience depends on successful recognition.',
          childEdgeIds: ['edge-sign-in-enables-card'],
          sourceRefs: ['spec-checkout'],
        },
      ],
    },
    viewState: {
      globalDepth: 1,
      expandedGroups: ['group-sign-in'],
      semanticZoom: 'business',
    },
    reviewState: {},
  };
}

function samplePack(): AlignmentPack {
  return AlignmentPackSchema.parse(sampleHierarchicalPack());
}

async function renderSamplePack(): Promise<string> {
  const { renderAlignmentPackHtml } = await import('./alignment-pack-renderer.js');
  return renderAlignmentPackHtml(samplePack());
}

describe('alignment pack renderer', () => {
  it('renders a standalone local HTML artifact with embedded pack JSON and no remote scripts styles or assets', async () => {
    const html = await renderSamplePack();

    expect(html).toMatch(/<!doctype html|<html/i);
    expect(html).toContain('pack-2026-10-12.281');
    expect(html).toContain('"graph"');
    expect(html).toContain('"group-sign-in"');
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=["']https?:\/\//i);
    expect(html).not.toMatch(/<link\b[^>]*\bhref=["']https?:\/\//i);
    expect(html).not.toMatch(/<(?:img|iframe|source)\b[^>]*\bsrc=["']https?:\/\//i);
    expect(html).not.toMatch(/@import\s+url\(["']?https?:\/\//i);
    expect(html).not.toMatch(/url\(["']?https?:\/\//i);
  });

  it('includes semantic zoom view-state data for global depth per-group expansion and zoom level', async () => {
    const html = await renderSamplePack();

    expect(html).toContain('"viewState"');
    expect(html).toContain('"globalDepth":1');
    expect(html).toContain('"expandedGroups":["group-sign-in"]');
    expect(html).toContain('"semanticZoom":"business"');
  });

  it('includes aggregate edge data that traces back to concrete child edge ids', async () => {
    const html = await renderSamplePack();

    expect(html).toContain('"aggregateEdges"');
    expect(html).toContain('"aggregate-sign-in-to-payment"');
    expect(html).toContain('"childEdgeIds":["edge-sign-in-enables-card"]');
    expect(html).toContain('Known customers can use trusted payment options');
  });

  it('includes approve and request-changes review actions tied to the pack version', async () => {
    const html = await renderSamplePack();

    expect(html).toMatch(/approve/i);
    expect(html).toMatch(/request\s+changes/i);
    expect(html).toContain('pack-2026-10-12.281');
  });

  it('uses a browser-free sample fixture with nested groups and declared aggregate edges', () => {
    const pack = samplePack();

    expect(pack.graph.groups).toContainEqual(
      expect.objectContaining({
        id: 'group-sign-in',
        parentGroupId: 'group-checkout',
      })
    );
    expect(pack.graph.groups).toContainEqual(
      expect.objectContaining({
        id: 'group-payment',
        parentGroupId: 'group-checkout',
      })
    );
    expect(pack.graph.aggregateEdges).toContainEqual(
      expect.objectContaining({
        fromGroupId: 'group-sign-in',
        toGroupId: 'group-payment',
        childEdgeIds: ['edge-sign-in-enables-card'],
      })
    );
  });

  it('inlines the bundled viewer so the pack opens offline', async () => {
    const { VIEWER_CSS, VIEWER_JS } = await import('./alignment-viewer.generated.js');
    const html = await renderSamplePack();

    expect(html).toContain(VIEWER_JS);
    expect(html).toContain(VIEWER_CSS);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const data = html.match(/<script id="alignment-pack-data" type="application\/json">(.*?)<\/script>/s)?.[1] ?? '';
    expect(JSON.parse(data)).toMatchObject({ packVersion: 'pack-2026-10-12.281' });
  });
});
