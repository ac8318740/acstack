import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bindPostedComments } from '../posted-comments.js';
import type { Annotation } from '../pack.js';
import type { PostedRange } from '../quote-anchors.js';

const resolved = vi.hoisted(() => ({ ranges: [] as PostedRange[] }));
vi.mock('../quote-anchors.js', async original => ({
  ...await original<typeof import('../quote-anchors.js')>(),
  resolvePostedRanges: (annotations: Annotation[]) => resolved.ranges.filter(hit => annotations.some(annotation => hit.annotation.id === annotation.id)),
}));
class Target {
  isConnected = true;
  focus = vi.fn();
  constructor(public control = false, public header = false) {}
  closest(selector: string) { return selector !== '[data-review-handoff]' && this.control ? this : null; }
  matches(selector: string) { return this.header && selector === '.header-select'; }
  getBoundingClientRect() { return { left: 5, right: 25, top: 5, bottom: 25, width: 20, height: 20 }; }
}
const first: Annotation = { id: 'first', packVersion: 'v1', target: { type: 'node', id: 'n' }, selectedText: 'quote', comment: 'First' };
const second: Annotation = { ...first, id: 'second', comment: 'Second' };
let events: EventTarget;
let highlights: Map<string, unknown>;
let controller: ReturnType<typeof bindPostedComments>;
let draftOpen: boolean;
let selection: string;
let mutate: (records: unknown[]) => void;
const preview = vi.fn();
const observe = vi.fn();
const source = new Target();
const overlay = new Target();
function dispatch(type: string, target: unknown = source, properties = {}) {
  const event = new Event(type);
  Object.defineProperties(event, Object.fromEntries(Object.entries({ target, clientX: 15, clientY: 15, button: 0, buttons: 0, pointerType: 'mouse', ...properties }).map(([key, value]) => [key, { value }])));
  const stop = vi.spyOn(event, 'stopPropagation');
  events.dispatchEvent(event);
  return stop;
}
beforeEach(() => {
  vi.useFakeTimers();
  events = new EventTarget();
  Object.assign(events, { body: {}, querySelector: () => draftOpen ? {} : null });
  vi.stubGlobal('document', events);
  vi.stubGlobal('window', { getSelection: () => ({ toString: () => selection }) });
  vi.stubGlobal('Element', Target);
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: typeof mutate) { mutate = callback; }
    observe = observe;
    disconnect() {}
  });
  highlights = new Map([['comment-draft', 'draft'], ['other', 'untouched']]);
  vi.stubGlobal('CSS', { highlights });
  vi.stubGlobal('Highlight', class { constructor(...ranges: Range[]) { Object.assign(this, { ranges }); } });
  draftOpen = false;
  selection = '';
  resolved.ranges = [first, second].map(annotation => ({ annotation, range: {
    startContainer: { isConnected: true },
    getClientRects: () => [{ left: 10, right: 30, top: 10, bottom: 20, width: 20, height: 10 }],
    getBoundingClientRect: () => source.getBoundingClientRect(),
  } as unknown as Range }));
  preview.mockReset();
  observe.mockClear();
  controller = bindPostedComments({ current: { contains: (node: unknown) => node === overlay } as HTMLDivElement }, preview);
  controller.refresh([first, second]);
});
afterEach(() => { controller.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('delays hover, includes every overlapping comment, and allows crossing the gap to the preview', () => {
  dispatch('pointermove');
  vi.advanceTimersByTime(279);
  expect(preview).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['first', 'second'], pinned: false }));
  dispatch('pointermove', source, { clientX: 40 });
  vi.advanceTimersByTime(179);
  dispatch('pointermove', overlay);
  vi.advanceTimersByTime(500);
  expect(preview).not.toHaveBeenLastCalledWith(null);
  controller.leave();
  vi.advanceTimersByTime(180);
  expect(preview).toHaveBeenLastCalledWith(null);
});
it('previews annotated header labels on hover without intercepting their existing button action', () => {
  const header = new Target(true, true);
  dispatch('pointermove', header);
  vi.advanceTimersByTime(280);
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['first', 'second'], pinned: false }));
  dispatch('pointerdown', header);
  expect(dispatch('click', header)).not.toHaveBeenCalled();
  expect(preview).toHaveBeenLastCalledWith(null);
  preview.mockClear();
  dispatch('pointermove', new Target(true));
  vi.advanceTimersByTime(300);
  expect(preview.mock.calls.every(([value]) => value === null)).toBe(true);
});
it('pins a confirmed quote click without trapping input, then closes on outside click or Escape', () => {
  dispatch('pointerdown');
  expect(dispatch('click')).toHaveBeenCalledOnce();
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: true }));
  controller.leave();
  vi.advanceTimersByTime(500);
  expect(preview).not.toHaveBeenLastCalledWith(null);
  dispatch('pointerdown', overlay);
  expect(preview).not.toHaveBeenLastCalledWith(null);
  dispatch('keydown', overlay, { key: 'Escape' });
  expect(preview).toHaveBeenLastCalledWith(null);
  dispatch('click');
  dispatch('pointerdown', new Target(true));
  expect(preview).toHaveBeenLastCalledWith(null);
});
it('holds a hover preview while editing and resumes ordinary hover close after cancellation', () => {
  dispatch('pointermove');
  vi.advanceTimersByTime(280);
  controller.leave();
  controller.setEditing(true);
  dispatch('pointermove', source, { clientX: 40 });
  controller.leave();
  vi.advanceTimersByTime(500);
  expect(preview).not.toHaveBeenLastCalledWith(null);
  controller.setEditing(false);
  controller.leave();
  vi.advanceTimersByTime(180);
  expect(preview).toHaveBeenLastCalledWith(null);
});
it('keeps a saved edit pinned and its source highlight intact until ordinary close', () => {
  dispatch('pointermove');
  vi.advanceTimersByTime(280);
  controller.setEditing(true);
  controller.refresh([{ ...first, comment: 'Edited feedback' }, second]);
  controller.setEditing(false, true);
  controller.leave();
  vi.advanceTimersByTime(500);
  expect(preview).not.toHaveBeenLastCalledWith(null);
  expect(highlights.get('posted-comments')).toMatchObject({ ranges: resolved.ranges.map(hit => hit.range) });
  dispatch('keydown', overlay, { key: 'Escape' });
  expect(preview).toHaveBeenLastCalledWith(null);
});
it('lets Escape reach an editor before closing the saved panel', () => {
  dispatch('click');
  const field = new Target(true);
  field.closest = (selector?: string) => selector === '.comment-editor' ? field : null;
  expect(dispatch('keydown', field, { key: 'Escape' })).not.toHaveBeenCalled();
  expect(preview).not.toHaveBeenLastCalledWith(null);
  dispatch('keydown', overlay, { key: 'Escape' });
  expect(preview).toHaveBeenLastCalledWith(null);
});
it('preserves selection, dragging/panning, controls, and a fresh draft instead of intercepting their click', () => {
  dispatch('pointerdown');
  dispatch('pointermove', source, { clientX: 23, buttons: 1 });
  expect(dispatch('click')).not.toHaveBeenCalled();
  selection = 'new selection';
  expect(dispatch('click')).not.toHaveBeenCalled();
  selection = '';
  expect(dispatch('click', new Target(true))).not.toHaveBeenCalled();
  draftOpen = true;
  expect(dispatch('click')).not.toHaveBeenCalled();
  dispatch('pointermove');
  vi.advanceTimersByTime(300);
  expect(preview.mock.calls.every(([value]) => value === null)).toBe(true);
});
it('does not replace a new draft after the draft binder clears native selection on mouseup', () => {
  dispatch('pointerdown');
  selection = 'new quote';
  dispatch('mouseup');
  selection = ''; // v20 draft binder clears the operating system selection.
  expect(dispatch('click')).not.toHaveBeenCalled();
  expect(preview.mock.calls.every(([value]) => value === null)).toBe(true);
  dispatch('pointerdown');
  dispatch('mouseup');
  dispatch('click');
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: true }));
});
it('ignores touch hover but permits a mobile tap to pin', () => {
  dispatch('pointermove', source, { pointerType: 'touch' });
  vi.advanceTimersByTime(500);
  expect(preview).not.toHaveBeenCalled();
  dispatch('pointerdown', source, { pointerType: 'touch' });
  dispatch('click');
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: true }));
});
it('restores keyboard focus and provides fallback access to missing quotes and general comments', () => {
  const button = new Target(true);
  controller.show(first, button as unknown as HTMLElement, true);
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['first', 'second'], focus: button, pinned: true }));
  controller.close();
  expect(button.focus).toHaveBeenCalledOnce();
  controller.refresh([]);
  controller.show({ ...first, selectedText: undefined }, button as unknown as HTMLElement, true);
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['first'], range: undefined, anchor: button.getBoundingClientRect() }));
});
it('keeps equal quote text at different anchored occurrences separate in the keyboard preview', () => {
  const a = { ...first, quoteAnchor: { prefix: 'first ', suffix: '' } };
  const b = { ...second, quoteAnchor: { prefix: 'second ', suffix: '' } };
  controller.refresh([a, b]);
  controller.show(a, source as unknown as HTMLElement, true);
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['first'] }));
});
it('uses the Comments entry rectangle when a resolved quote is inside collapsed content', () => {
  resolved.ranges.forEach(hit => { hit.range.getClientRects = () => [] as unknown as DOMRectList; });
  controller.refresh([first]);
  controller.show(first, source as unknown as HTMLElement, true);
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ range: undefined, anchor: source.getBoundingClientRect() }));
});
it('rebuilds source highlights after DOM changes and updates or closes deleted previews without touching draft ownership', () => {
  dispatch('click');
  controller.refresh([second]);
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['second'] }));
  expect(highlights.get('posted-comments')).toMatchObject({ ranges: [resolved.ranges[1].range] });
  const before = highlights.get('posted-comments');
  mutate([{ target: source }]);
  expect(highlights.get('posted-comments')).not.toBe(before);
  controller.refresh([]);
  expect(preview).toHaveBeenLastCalledWith(null);
  controller.dispose();
  expect(highlights.has('posted-comments')).toBe(false);
  expect(highlights.get('comment-draft')).toBe('draft');
  expect(highlights.get('other')).toBe('untouched');
  preview.mockClear();
  dispatch('click');
  expect(preview).not.toHaveBeenCalled();
});
it('observes target attribute changes narrowly and removes ranges when a reused element changes target', () => {
  expect(observe).toHaveBeenCalledWith({}, expect.objectContaining({ attributes: true, attributeFilter: ['data-annotate-id', 'data-annotate-type', 'hidden', 'open'] }));
  resolved.ranges = [];
  mutate([{ type: 'attributes', attributeName: 'data-annotate-id', target: source }]);
  expect(highlights.get('posted-comments')).toMatchObject({ ranges: [] });
});
it('cancels a delayed hover when its annotation is deleted before the panel opens', () => {
  dispatch('pointermove');
  controller.refresh([]);
  vi.advanceTimersByTime(500);
  expect(preview).not.toHaveBeenCalled();
});
it('retains keyboard commenting without Custom Highlight support', () => {
  vi.stubGlobal('CSS', undefined);
  vi.stubGlobal('Highlight', undefined);
  controller.refresh([first]);
  controller.show(first, source as unknown as HTMLElement, true);
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['first'], pinned: true }));
});

it('preserves a posted-comment editor through handoff clicks and Escape', () => {
  controller.show(first, source as unknown as HTMLElement, false);
  controller.setEditing(true);
  preview.mockClear();
  const handoff = new Target();
  vi.spyOn(handoff, 'closest').mockImplementation(selector => selector === '[data-review-handoff]' ? handoff : null);
  dispatch('pointerdown', handoff);
  dispatch('keydown', handoff, { key: 'Escape' });
  expect(preview).not.toHaveBeenCalled();
});
