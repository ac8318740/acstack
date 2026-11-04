import { webcrypto } from 'node:crypto';
import { createElement, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ReviewAnnotationSchema } from '../../lib/alignment-packs.js';
import type { Annotation } from '../pack.js';

vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useEffect: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('creates distinct local comment IDs without secure-context randomUUID', async () => {
  vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const { annotationId } = await import('../pack.js');
  const first = annotationId();
  const second = annotationId();
  expect(first).toMatch(/^[a-f0-9]{32}$/);
  expect(second).toMatch(/^[a-f0-9]{32}$/);
  expect(second).not.toBe(first);
});

it('reloads quoted summary and Markdown feedback as existing group comments with the document label', async () => {
  vi.resetModules();
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => ({ textContent: JSON.stringify({
    packVersion: 'checkout@v1',
    graph: { groups: [{ id: 'design:root', label: 'Checkout design' }], nodes: [], edges: [] },
  }) }) });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const { useStored, targetLabel, diagramId } = await import('../pack.js');
  const annotations: Annotation[] = ['Customers place an order', 'Review the basket, then pay'].map((selectedText, index) => ({
    id: `comment-${index}`, packVersion: 'checkout@v1', target: { type: 'group', id: 'design:root' }, selectedText, comment: 'Clarify this step',
  }));
  function StoredComments({ initial }: { initial: Annotation[] }) {
    const [stored] = useStored('annotations', initial);
    return createElement('pre', null, JSON.stringify(stored));
  }
  renderToStaticMarkup(createElement(StoredComments, { initial: annotations }));
  for (const [effect] of vi.mocked(useEffect).mock.calls) effect();
  expect(storage.has('alignment-pack:checkout@v1:annotations')).toBe(true);
  const reloaded = renderToStaticMarkup(createElement(StoredComments, { initial: [] }));
  expect(reloaded).toBe(renderToStaticMarkup(createElement('pre', null, JSON.stringify(annotations))));
  for (const local of annotations) {
    const annotation = { packVersion: local.packVersion, target: local.target, selectedText: local.selectedText, comment: local.comment };
    expect(ReviewAnnotationSchema.parse(annotation)).toEqual(annotation);
    expect(targetLabel(annotation.target)).toBe('Checkout design');
    expect(diagramId(annotation.target)).toBe('group:design:root');
  }
});

it.each(['offline', 'legacy', 'live'] as const)('exposes handoff metadata and the flush barrier only for %s review pages', async mode => {
  vi.resetModules();
  const prompt = 'Read "/project/review.json" against "/project/design.yaml"';
  vi.stubGlobal('document', {
    querySelector: (selector: string) => selector.includes('acstack-review-token')
      ? (mode !== 'offline' ? { content: 'token' } : null)
      : (mode === 'live' ? { content: 'comments' } : null),
    getElementById: (id: string) => ({ textContent: JSON.stringify(id === 'acstack-review-handoff' ? prompt : { packVersion: 'v1' }) }),
  });
  vi.stubGlobal('localStorage', { getItem: () => null });
  const module = await import('../pack.js');
  expect(module.liveComments).toBe(mode === 'live');
  expect(module.handoffPrompt).toBe(mode === 'live' ? prompt : null);
  function Annotations() {
    const { flush } = module.useReviewAnnotations();
    return createElement('span', null, typeof flush);
  }
  expect(renderToStaticMarkup(createElement(Annotations))).toContain(mode === 'live' ? 'function' : 'undefined');
});

it.each(['{broken', '{}', 'null'])('ignores unusable handoff metadata without breaking the live review: %s', async metadata => {
  vi.resetModules();
  vi.stubGlobal('document', {
    querySelector: (selector: string) => ({ content: selector.includes('acstack-review-token') ? 'token' : 'comments' }),
    getElementById: (id: string) => ({ textContent: id === 'acstack-review-handoff' ? metadata : '{"packVersion":"v1"}' }),
  });
  vi.stubGlobal('localStorage', { getItem: () => null });
  const module = await import('../pack.js');
  expect(module.liveComments).toBe(true);
  expect(module.handoffPrompt).toBeNull();
});
