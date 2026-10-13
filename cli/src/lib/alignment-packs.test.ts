import { describe, expect, it } from 'vitest';
import { AlignmentPackSchema, deriveAggregateEdges } from './alignment-packs.js';

function reviewPack() {
  return {
    packVersion: 'pack-2026-10-12.1',
    source: {
      map: { id: 'checkout-redesign', version: 'map-v7' },
      references: [
        { id: 'spec-checkout', kind: 'spec', title: 'Checkout redesign spec', uri: 'specs/checkout.md#goals' },
        { id: 'adr-local', kind: 'adr', title: 'Local viewer only', uri: 'docs/adr/0018-alignment-packs-use-local-viewers.md' },
      ],
    },
    graph: {
      groups: [
        { id: 'group-sign-in', label: 'Sign-in experience', summary: 'Customers can identify themselves before paying.' },
        { id: 'group-payment', label: 'Payment experience', summary: 'Customers can pay with saved or new methods.' },
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
          summary: 'Saved cards are only available after the customer is known.',
          sourceRefs: ['spec-checkout'],
        },
      ],
      aggregateEdges: [],
    },
    viewState: {
      globalDepth: 2,
      expandedGroups: ['group-sign-in'],
      semanticZoom: 'business',
    },
    reviewState: {
      approval: {
        packVersion: 'pack-2026-10-12.1',
        status: 'approved',
        approvedBy: 'Product lead',
        approvedAt: '2026-10-12T10:00:00.000Z',
      },
    },
  };
}

describe('alignment pack model', () => {
  it('stores pack version, source references, graph content, view state, and review state', () => {
    const pack = AlignmentPackSchema.parse(reviewPack());

    expect(pack.packVersion).toBe('pack-2026-10-12.1');
    expect(pack.source.map).toEqual({ id: 'checkout-redesign', version: 'map-v7' });
    expect(pack.source.references).toContainEqual({
      id: 'adr-local',
      kind: 'adr',
      title: 'Local viewer only',
      uri: 'docs/adr/0018-alignment-packs-use-local-viewers.md',
    });
    expect(pack.graph.groups.map(group => group.id)).toEqual(['group-sign-in', 'group-payment']);
    expect(pack.graph.nodes.map(node => node.id)).toEqual(['node-passwordless', 'node-saved-card']);
    expect(pack.graph.edges.map(edge => edge.id)).toEqual(['edge-sign-in-enables-card']);
    expect(pack.viewState).toEqual({
      globalDepth: 2,
      expandedGroups: ['group-sign-in'],
      semanticZoom: 'business',
    });
    expect(pack.reviewState.approval).toMatchObject({
      packVersion: 'pack-2026-10-12.1',
      status: 'approved',
    });
  });

  it('derives aggregate edges from hidden child edges and preserves their concrete edge ids', () => {
    const pack = AlignmentPackSchema.parse({
      ...reviewPack(),
      graph: {
        ...reviewPack().graph,
        edges: [
          {
            id: 'edge-profile-gates-card',
            fromNodeId: 'node-passwordless',
            toNodeId: 'node-saved-card',
            relationship: 'enables',
            label: 'Profile enables saved cards',
            aggregateLabel: 'Knowing the customer unlocks trusted payment options',
            summary: 'The payment group depends on a known customer.',
            sourceRefs: ['spec-checkout'],
          },
        ],
      },
      viewState: {
        globalDepth: 1,
        expandedGroups: [],
        semanticZoom: 'business',
      },
    });

    const aggregateEdges = deriveAggregateEdges(pack.graph, pack.viewState);

    expect(aggregateEdges).toContainEqual(
      expect.objectContaining({
        fromGroupId: 'group-sign-in',
        toGroupId: 'group-payment',
        childEdgeIds: ['edge-profile-gates-card'],
        label: 'Knowing the customer unlocks trusted payment options',
      })
    );
  });

  it('uses plain-English fallback labels for generated aggregate edges', () => {
    const pack = AlignmentPackSchema.parse({
      ...reviewPack(),
      viewState: {
        globalDepth: 1,
        expandedGroups: [],
        semanticZoom: 'business',
      },
    });

    const aggregateEdges = deriveAggregateEdges(pack.graph, pack.viewState);
    const label = aggregateEdges[0]?.label ?? '';

    expect(label).toContain('Sign-in experience');
    expect(label).toContain('Payment experience');
    expect(label).not.toMatch(/group-|node-|->|=>|depends_on|enables_/);
    expect(label).toMatch(/[A-Za-z]+ [A-Za-z]+/);
  });

  it('supports global depth, per-group expansion, and semantic zoom in view state', () => {
    const pack = AlignmentPackSchema.parse({
      ...reviewPack(),
      viewState: {
        globalDepth: 3,
        expandedGroups: ['group-payment'],
        semanticZoom: 'technical',
      },
    });

    expect(pack.viewState.globalDepth).toBe(3);
    expect(pack.viewState.expandedGroups).toEqual(['group-payment']);
    expect(pack.viewState.semanticZoom).toBe('technical');
  });

  it('rejects approval that names a different pack version', () => {
    expect(() =>
      AlignmentPackSchema.parse({
        ...reviewPack(),
        reviewState: {
          approval: {
            packVersion: 'pack-older-version',
            status: 'approved',
            approvedBy: 'Product lead',
            approvedAt: '2026-10-12T10:00:00.000Z',
          },
        },
      })
    ).toThrow(/pack version/i);
  });
});
