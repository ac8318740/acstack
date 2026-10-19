import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bindTextSelection } from '../text-selection.js';
import type { Draft } from '../pack.js';

let events: EventTarget;
let selection: { rangeCount: number; anchorNode: unknown; toString: () => string; getRangeAt: ReturnType<typeof vi.fn>; removeAllRanges: ReturnType<typeof vi.fn> };
let range: { getBoundingClientRect: ReturnType<typeof vi.fn>; cloneRange: ReturnType<typeof vi.fn> };
let highlights: Map<string, unknown>;
let controller: ReturnType<typeof bindTextSelection>;
const inside = {};
const onDraft = vi.fn<(draft: Draft | null) => void>();
const register = vi.fn();
function dispatch(type: string, target: unknown = {}, key = '') {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { target: { value: target }, key: { value: key } });
  const stop = vi.spyOn(event, 'stopPropagation');
  events.dispatchEvent(event);
  return { event, stop };
}
beforeEach(() => {
  events = new EventTarget();
  register.mockReset().mockImplementation(events.addEventListener.bind(events));
  events.addEventListener = register;
  highlights = new Map([['unrelated', {}]]);
  range = { getBoundingClientRect: vi.fn(() => ({ left: 20, top: 30 })), cloneRange: vi.fn() };
  const clone = { getBoundingClientRect: range.getBoundingClientRect };
  range.cloneRange.mockReturnValue(clone);
  selection = {
    rangeCount: 1,
    anchorNode: { parentElement: { closest: () => ({ dataset: { annotateType: 'node', annotateId: 'source' } }) } },
    toString: () => selection.rangeCount ? '  Source quote  ' : '',
    getRangeAt: vi.fn(() => range),
    removeAllRanges: vi.fn(() => { selection.rangeCount = 0; }),
  };
  vi.stubGlobal('document', events);
  vi.stubGlobal('window', { getSelection: () => selection });
  vi.stubGlobal('CSS', { highlights });
  vi.stubGlobal('Highlight', class { constructor(public range: unknown) {} });
  onDraft.mockReset();
  controller = bindTextSelection({ current: { contains: (target: unknown) => target === inside } as HTMLDivElement }, onDraft);
});
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); });

it('retains the cloned source range after native selection clears for textarea focus', () => {
  dispatch('mouseup');
  const draft = onDraft.mock.calls[0][0]!;
  expect(draft).toMatchObject({ target: { type: 'node', id: 'source' }, selectedText: 'Source quote', anchor: { left: 20, top: 30 } });
  expect(draft.range).toBe(range.cloneRange.mock.results[0].value);
  expect(highlights.get('comment-draft')).toMatchObject({ range: draft.range });
  expect(selection.removeAllRanges).toHaveBeenCalledOnce();
  dispatch('pointerdown', inside);
  dispatch('mouseup', inside);
  expect(onDraft).toHaveBeenCalledOnce();
  expect(highlights.has('comment-draft')).toBe(true);
});
it('dismisses outside in capture without reopening a stale quote, then accepts a fresh selection', () => {
  dispatch('mouseup');
  dispatch('pointerdown');
  expect(register).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
  expect(onDraft).toHaveBeenLastCalledWith(null);
  expect(highlights.has('comment-draft')).toBe(false);
  dispatch('mouseup');
  expect(onDraft).toHaveBeenCalledTimes(2);
  selection.rangeCount = 1;
  dispatch('mouseup');
  expect(onDraft.mock.calls[2][0]?.selectedText).toBe('Source quote');
});
it('takes Escape in capture even inside a textarea, but leaves other keys and inactive Escape alone', () => {
  expect(dispatch('keydown', inside, 'Escape').event.defaultPrevented).toBe(false);
  dispatch('mouseup');
  expect(dispatch('keydown', inside, 'Enter').event.defaultPrevented).toBe(false);
  const { event, stop } = dispatch('keydown', inside, 'Escape');
  expect(register).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  expect(event.defaultPrevented).toBe(true);
  expect(stop).toHaveBeenCalledOnce();
  expect(onDraft).toHaveBeenLastCalledWith(null);
  expect(highlights.has('comment-draft')).toBe(false);
  expect(dispatch('keydown', {}, 'Escape').event.defaultPrevented).toBe(false);
});
it('cleans up on post/cancel, replacement, and unmount without deleting unrelated highlights', () => {
  dispatch('mouseup');
  const old = highlights.get('comment-draft');
  selection.rangeCount = 1;
  dispatch('mouseup');
  expect(highlights.get('comment-draft')).not.toBe(old);
  controller.dismiss();
  expect(highlights.has('comment-draft')).toBe(false);
  expect(highlights.has('unrelated')).toBe(true);
  selection.rangeCount = 1;
  dispatch('mouseup');
  controller.dispose();
  expect(highlights.has('comment-draft')).toBe(false);
  onDraft.mockClear();
  dispatch('mouseup');
  dispatch('pointerdown');
  dispatch('keydown', inside, 'Escape');
  expect(onDraft).not.toHaveBeenCalled();
});
it('supports StrictMode setup-cleanup-setup without duplicate listeners', () => {
  controller.dispose();
  controller = bindTextSelection({ current: null }, onDraft);
  dispatch('mouseup');
  expect(onDraft).toHaveBeenCalledOnce();
});
it('keeps commenting usable without Custom Highlight support or a valid range', () => {
  vi.stubGlobal('CSS', undefined);
  vi.stubGlobal('Highlight', undefined);
  selection.rangeCount = 0;
  dispatch('mouseup');
  expect(onDraft).not.toHaveBeenCalled();
  selection.rangeCount = 1;
  dispatch('mouseup');
  expect(onDraft.mock.calls[0][0]?.selectedText).toBe('Source quote');
  controller.dismiss();
  expect(onDraft).toHaveBeenLastCalledWith(null);
});

it('preserves an unposted quote draft through handoff controls and dialog dismissal', () => {
  dispatch('mouseup');
  const handoff = { closest: (selector: string) => selector === '[data-review-handoff]' ? {} : null };
  dispatch('pointerdown', handoff);
  dispatch('mouseup', handoff);
  const { event, stop } = dispatch('keydown', handoff, 'Escape');
  expect(event.defaultPrevented).toBe(false);
  expect(stop).not.toHaveBeenCalled();
  expect(onDraft).toHaveBeenCalledOnce();
  expect(highlights.has('comment-draft')).toBe(true);
  dispatch('pointerdown', inside);
  expect(onDraft).toHaveBeenCalledOnce();
});
