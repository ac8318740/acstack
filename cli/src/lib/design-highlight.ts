import type { DesignHighlight } from './alignment-packs.js';

// Coordinates address the original Markdown: 1-based UTF-16 columns, exclusive end.
export function highlightOffsets(source: string, range: Pick<DesignHighlight, 'start' | 'end'>): [number, number] {
  const lines = source.split('\n');
  const offset = ({ line, column }: DesignHighlight['start']) => {
    const text = lines[line - 1]?.replace(/\r$/, '');
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || text === undefined || column > text.length + 1) throw new Error('Highlight position is outside the Markdown detail');
    const index = lines.slice(0, line - 1).reduce((total, value) => total + value.length + 1, 0) + column - 1;
    if (/[\uD800-\uDBFF]/.test(source[index - 1] ?? '') && /[\uDC00-\uDFFF]/.test(source[index] ?? '')) throw new Error('Highlight position splits a Unicode character');
    return index;
  };
  const start = offset(range.start), end = offset(range.end);
  if (end <= start) throw new Error('Highlight end must follow start');
  return [start, end];
}
