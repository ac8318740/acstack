import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { effect, setTarget } = vi.hoisted(() => ({ effect: { run: undefined as (() => (() => void)) | undefined }, setTarget: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: (run: () => (() => void)) => { effect.run = run; },
  useLayoutEffect: () => {},
  useId: () => 'tooltip-id',
  useRef: (current: unknown) => ({ current }),
  useState: () => [null, setTarget],
}));
import { AppTooltipLayer } from '../tooltip.js';

class Target {
  dataset = { tooltip: 'Helpful hint' };
  constructor(private hidden = false, private focusVisible = true) {}
  matches() { return this.focusVisible; }
  closest(selector: string) { return selector === '[data-tooltip]' ? this : this.hidden ? this : null; }
  contains(node: unknown) { return node === this; }
}
let documentEvents: EventTarget;
let windowEvents: EventTarget;
let cleanup: (() => void) | undefined;
function dispatch(type: string, target: unknown = new Target(), properties = {}, host = documentEvents) {
  const event = new Event(type);
  Object.defineProperties(event, Object.fromEntries(Object.entries({ target, relatedTarget: null, pointerType: 'mouse', buttons: 0, ...properties }).map(([key, value]) => [key, { value }])));
  host.dispatchEvent(event);
}
beforeEach(() => {
  vi.useFakeTimers();
  setTarget.mockClear();
  documentEvents = new EventTarget();
  windowEvents = new EventTarget();
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('window', windowEvents);
  vi.stubGlobal('Element', Target);
  AppTooltipLayer();
  cleanup = effect.run!();
});
afterEach(() => { cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('delays pointer hints but shows keyboard focus immediately', () => {
  const target = new Target();
  dispatch('pointerover', target);
  vi.advanceTimersByTime(299);
  expect(setTarget).not.toHaveBeenCalledWith(target);
  vi.advanceTimersByTime(1);
  expect(setTarget).toHaveBeenLastCalledWith(target);
  dispatch('focusin', target);
  expect(setTarget).toHaveBeenLastCalledWith(target);
});
it('cancels pending hints and gives pointer departure a short grace period', () => {
  dispatch('pointerover');
  dispatch('pointerout');
  vi.advanceTimersByTime(500);
  expect(setTarget.mock.calls.every(([value]) => value === null)).toBe(true);
  const target = new Target();
  dispatch('pointerover', target);
  vi.advanceTimersByTime(300);
  dispatch('pointerout', target);
  vi.advanceTimersByTime(149);
  expect(setTarget).toHaveBeenLastCalledWith(target);
  vi.advanceTimersByTime(1);
  expect(setTarget).toHaveBeenLastCalledWith(null);
});
it('keeps the keyboard hint when the pointer leaves its focused trigger', () => {
  const target = new Target();
  dispatch('focusin', target);
  dispatch('pointerout', target);
  dispatch('pointerover', new Target());
  vi.advanceTimersByTime(500);
  expect(setTarget).toHaveBeenLastCalledWith(target);
  dispatch('focusout', target);
  expect(setTarget).toHaveBeenLastCalledWith(null);
});
it('does not bypass the hover delay for mouse focus', () => {
  const target = new Target(false, false);
  dispatch('pointerover', target);
  dispatch('focusin', target);
  vi.advanceTimersByTime(299);
  expect(setTarget).not.toHaveBeenCalledWith(target);
  vi.advanceTimersByTime(1);
  expect(setTarget).toHaveBeenLastCalledWith(target);
});
it.each(['focusout', 'pointerdown', 'dragstart', 'scroll', 'keydown', 'resize'])('dismisses on %s', type => {
  dispatch('focusin');
  setTarget.mockClear();
  dispatch(type, undefined, { key: 'Escape' }, type === 'resize' ? windowEvents : documentEvents);
  expect(setTarget).toHaveBeenLastCalledWith(null);
});
it('ignores measurement targets, touch hover and focus, and dragging pointers', () => {
  const hidden = new Target(true);
  dispatch('pointerover', hidden);
  dispatch('focusin', hidden);
  dispatch('pointerover', new Target(), { pointerType: 'touch' });
  dispatch('pointerdown', new Target(), { pointerType: 'touch' });
  dispatch('focusin');
  dispatch('pointerover', new Target(), { buttons: 1 });
  vi.advanceTimersByTime(500);
  expect(setTarget.mock.calls.every(([value]) => value === null)).toBe(true);
  const target = new Target();
  dispatch('keydown', target, { key: 'Tab' });
  dispatch('focusin', target);
  expect(setTarget).toHaveBeenLastCalledWith(target);
});
