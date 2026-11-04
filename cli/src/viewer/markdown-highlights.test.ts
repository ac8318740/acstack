import { expect, it, vi } from 'vitest';
import { revealHighlights } from './markdown-highlights.js';

it('opens every enclosing disclosure and scrolls only the first highlighted passage', () => {
  const container = { tagName: 'DIALOG', open: true, parentElement: null, querySelectorAll: vi.fn() };
  const outer = { tagName: 'DETAILS', open: false, parentElement: container };
  const section = { tagName: 'DIV', parentElement: outer };
  const inner = { tagName: 'DETAILS', open: false, parentElement: section };
  const first = { parentElement: inner, scrollIntoView: vi.fn() };
  const second = { parentElement: outer, scrollIntoView: vi.fn() };
  container.querySelectorAll.mockReturnValue([first, second]);
  expect(revealHighlights(container as unknown as HTMLElement)).toBe(true);
  expect(outer.open).toBe(true);
  expect(inner.open).toBe(true);
  expect(section).not.toHaveProperty('open');
  expect(first.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'center' });
  expect(second.scrollIntoView).not.toHaveBeenCalled();
});

it('reports ranges with no rendered text instead of inventing a nearby highlight', () => {
  const container = { querySelectorAll: () => [] };
  expect(revealHighlights(container as unknown as HTMLElement)).toBe(false);
});
