import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  appendAnnotationEvent,
  createAnnotationFeedbackHandoff,
  exportAnnotationFeedbackMarkdown,
} from './alignment-feedback.js';

function reviewPack(packVersion = 'pack-2026-10-12.1') {
  return {
    packVersion,
    source: {
      map: { id: 'checkout-redesign', version: 'map-v7' },
      references: [
        { id: 'spec-checkout', kind: 'spec', title: 'Checkout redesign spec', uri: 'specs/checkout.md#goals' },
        { id: 'adr-local', kind: 'adr', title: 'Local viewer only', uri: 'docs/adr/0018-alignment-packs-use-local-viewers.md' },
      ],
    },
    graph: {
      groups: [{ id: 'group-payment', label: 'Payment experience', summary: 'Customers can pay with saved or new methods.' }],
      nodes: [
        {
          id: 'node-saved-card',
          groupId: 'group-payment',
          label: 'Saved card payment',
          technicalLabel: 'vault-token charge',
          summary: 'Lets returning customers pay with a card they already trust.',
          technicalSummary: 'Charge the vault token.\n\nRetry once on a network error.',
          sourceRefs: ['spec-checkout', 'adr-local'],
        },
      ],
      edges: [
        {
          id: 'edge-saved-card-risk',
          fromNodeId: 'node-saved-card',
          toNodeId: 'node-saved-card',
          relationship: 'conflicts',
          label: 'Saved card risk needs review',
          summary: 'Stored cards need fraud and compliance review before rollout.',
          sourceRefs: ['adr-local'],
        },
      ],
      aggregateEdges: [],
    },
    viewState: { globalDepth: 2, expandedGroups: ['group-payment'], semanticZoom: 'business' },
    reviewState: {},
  };
}

async function tempPath(name: string) {
  const dir = await mkdtemp(join(tmpdir(), 'acstack-feedback-'));
  return join(dir, name);
}

describe('alignment annotation feedback', () => {
  it('appends annotation events as JSONL with version, target, evidence, comment, author, and time', async () => {
    const annotationsPath = await tempPath('annotations.jsonl');

    await appendAnnotationEvent({
      annotationsPath,
      packVersion: 'pack-2026-10-12.1',
      target: { type: 'node', id: 'node-saved-card' },
      selectedText: 'pay with a card they already trust',
      sourceRef: 'spec-checkout',
      comment: 'This overstates current customer trust research.',
      author: 'Product lead',
      time: '2026-10-12T10:15:00.000Z',
    });

    const lines = (await readFile(annotationsPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      packVersion: 'pack-2026-10-12.1',
      target: { type: 'node', id: 'node-saved-card' },
      selectedText: 'pay with a card they already trust',
      sourceRef: 'spec-checkout',
      comment: 'This overstates current customer trust research.',
      author: 'Product lead',
      time: '2026-10-12T10:15:00.000Z',
    });
  });

  it('exports grouped Markdown feedback with pack version, target ids, annotations, and graph context', async () => {
    const annotationsPath = await tempPath('annotations.jsonl');
    const feedbackPath = await tempPath('feedback.md');
    await writeFile(
      annotationsPath,
      [
        JSON.stringify({
          packVersion: 'pack-2026-10-12.1',
          target: { type: 'node', id: 'node-saved-card' },
          selectedText: 'card they already trust',
          comment: 'Trust claim needs source evidence.',
          author: 'Reviewer A',
          time: '2026-10-12T10:15:00.000Z',
        }),
        JSON.stringify({
          packVersion: 'pack-2026-10-12.1',
          target: { type: 'edge', id: 'edge-saved-card-risk' },
          sourceRef: 'adr-local',
          comment: 'Flag this dependency as a launch blocker.',
        }),
      ].join('\n') + '\n'
    );

    const result = await exportAnnotationFeedbackMarkdown({
      annotationsPath,
      feedbackPath,
      pack: reviewPack('pack-2026-10-12.1'),
    });

    const markdown = await readFile(feedbackPath, 'utf8');
    expect(result.markdown).toBe(markdown);
    expect(markdown).toContain('pack-2026-10-12.1');
    expect(markdown).toContain('node-saved-card');
    expect(markdown).toContain('edge-saved-card-risk');
    expect(markdown).toContain('Trust claim needs source evidence.');
    expect(markdown).toContain('Flag this dependency as a launch blocker.');
    expect(markdown).toContain('card they already trust');
    expect(markdown).toContain('adr-local');
    expect(markdown).toContain('Saved card payment');
    expect(markdown).toContain('- Technical definition:\n\n  > Charge the vault token.\n  >\n  > Retry once on a network error.');
    expect(markdown).toContain('Stored cards need fraud and compliance review before rollout.');
    expect(markdown.indexOf('node-saved-card')).toBeLessThan(markdown.indexOf('edge-saved-card-risk'));
  });

  it('creates a short agent handoff message that points at the feedback file', () => {
    const message = createAnnotationFeedbackHandoff('/tmp/checkout-feedback.md');

    expect(message).toContain('/tmp/checkout-feedback.md');
    expect(message).toMatch(/agent/i);
    expect(message).toMatch(/feedback/i);
  });

  it('rejects feedback export when annotation records belong to a different pack version', async () => {
    const annotationsPath = await tempPath('annotations.jsonl');
    const feedbackPath = await tempPath('feedback.md');
    await writeFile(
      annotationsPath,
      JSON.stringify({
        packVersion: 'pack-2026-10-12.0',
        target: { type: 'node', id: 'node-saved-card' },
        comment: 'This belongs to the previous review pack.',
      }) + '\n'
    );

    await expect(
      exportAnnotationFeedbackMarkdown({
        annotationsPath,
        feedbackPath,
        pack: reviewPack('pack-2026-10-12.1'),
      })
    ).rejects.toThrow(/packVersion.*pack-2026-10-12\.0.*pack-2026-10-12\.1/i);
  });

  it('throws a useful line-numbered error for malformed JSONL annotations', async () => {
    const annotationsPath = await tempPath('annotations.jsonl');
    const feedbackPath = await tempPath('feedback.md');
    await writeFile(
      annotationsPath,
      JSON.stringify({
        packVersion: 'pack-2026-10-12.1',
        target: { type: 'node', id: 'node-saved-card' },
        comment: 'Valid first annotation.',
      }) + '\n' +
        '{not valid json}\n'
    );

    await expect(
      exportAnnotationFeedbackMarkdown({
        annotationsPath,
        feedbackPath,
        pack: reviewPack('pack-2026-10-12.1'),
      })
    ).rejects.toThrow(/annotations\.jsonl.*line 2.*json/i);
  });
});
