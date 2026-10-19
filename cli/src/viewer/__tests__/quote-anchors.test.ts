import { expect, it } from 'vitest';
import { quoteOffsets, toReviewAnnotation } from '../quote-anchors.js';
import { ReviewAnnotationSchema } from '../../lib/alignment-packs.js';

it('resolves legacy quotes only when unambiguous, preserving Unicode and whitespace offsets', () => {
  expect(quoteOffsets('😀 first\nquote end', 'first\nquote')).toEqual([3]);
  expect(quoteOffsets('same same', 'same')).toEqual([]);
  expect(quoteOffsets('missing', 'quote')).toEqual([]);
  expect(quoteOffsets('text', '')).toEqual([]);
});
it('uses both contexts to distinguish repeats and fails closed on malformed or stale anchors', () => {
  expect(quoteOffsets('one same two same end', 'same', { prefix: 'one same two ', suffix: ' end' })).toEqual([13]);
  expect(quoteOffsets('one same two same end', 'same', { prefix: 'wrong', suffix: '' })).toEqual([]);
  for (const anchor of [null, {}, { prefix: 3, suffix: '' }, { prefix: '', suffix: [] }]) {
    expect(quoteOffsets('same', 'same', anchor)).toEqual([]);
  }
  expect(quoteOffsets('same same', 'same', { prefix: '', suffix: '' })).toEqual([]);
});
it('exports only CLI review fields, preserving author, source reference, and timestamps', () => {
  const annotation = { id: 'local', packVersion: 'v1', target: { type: 'node' as const, id: 'n' }, selectedText: 'quote', comment: 'feedback', time: 'now', author: 'Alex', sourceRef: 'src', quoteAnchor: { prefix: 'before', suffix: 'after' } };
  const wire = toReviewAnnotation(annotation);
  expect(wire).toEqual({ packVersion: 'v1', target: annotation.target, selectedText: 'quote', comment: 'feedback', time: 'now', author: 'Alex', sourceRef: 'src' });
  expect(ReviewAnnotationSchema.parse(wire)).toEqual(wire);
});
