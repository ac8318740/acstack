import { expect, it } from 'vitest';
import { highlightOffsets } from './design-highlight.js';

it('maps one-based exclusive ranges through CRLF, tabs, and Unicode without normalizing the source', () => {
  expect(highlightOffsets('A\r\n😀\tB\r\n', { start: { line: 2, column: 1 }, end: { line: 2, column: 3 } })).toEqual([3, 5]);
  expect(highlightOffsets('first\nsecond', { start: { line: 1, column: 3 }, end: { line: 2, column: 4 } })).toEqual([2, 9]);
});

it('rejects out-of-bounds, reversed, empty, noninteger, and split-surrogate positions', () => {
  const source = 'A\n😀 B';
  for (const range of [
    { start: { line: 0, column: 1 }, end: { line: 1, column: 2 } },
    { start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
    { start: { line: 1, column: 1 }, end: { line: 3, column: 1 } },
    { start: { line: 1, column: 1 }, end: { line: 1, column: 3 } },
    { start: { line: 2, column: 2 }, end: { line: 2, column: 3 } },
    { start: { line: 2, column: 1 }, end: { line: 2, column: 2 } },
    { start: { line: 1.5, column: 1 }, end: { line: 2, column: 3 } },
    { start: { line: 2, column: 3 }, end: { line: 1, column: 1 } },
    { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
  ]) expect(() => highlightOffsets(source, range)).toThrow(/Highlight/);
});
