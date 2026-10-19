import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void | (() => void))[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useId: () => 'scope',
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = next; }];
  },
  useLayoutEffect: vi.fn(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('react-dom', async original => ({ ...await original<typeof import('react-dom')>(), createPortal: (node: ReactNode) => node }));
import { Dropdown, dropdownPosition } from '../dropdown.js';

type Props = { children?: ReactNode; role?: string; ref?: { current: unknown }; 'aria-expanded'?: boolean; 'aria-selected'?: boolean; 'aria-activedescendant'?: string; id?: string; onClick?: () => void; onBlur?: () => void; onKeyDown?: (event: unknown) => void; onPointerDown?: (event: unknown) => void };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function harness() {
  vi.stubGlobal('document', { body: {} });
  let value = 'a';
  const changed = vi.fn((next: string) => { value = next; });
  const options = [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }, { value: 'c', label: 'Cherry' }];
  const tree = () => { hooks.cursor = 0; hooks.effects = []; return elements(Dropdown({ label: 'Fruit', value, options, onChange: changed })); };
  const trigger = () => tree().find(node => node.props.role === 'combobox')!;
  const focus = vi.fn();
  trigger().props.ref!.current = { focus, contains: (target: unknown) => target === 'trigger' };
  const key = (key: string) => {
    const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    trigger().props.onKeyDown!(event);
    return event;
  };
  const active = () => elements(tree().find(node => node.props.id === trigger().props['aria-activedescendant'])).find(node => node.type === 'span');
  return { tree, trigger, key, active, changed, focus };
}
afterEach(() => { hooks.slots = []; vi.unstubAllGlobals(); });

it('opens, navigates, selects with Enter/Space, and marks the selected option', () => {
  const h = harness();
  expect(h.trigger().props['aria-expanded']).toBe(false);
  h.key('ArrowDown');
  expect(h.active()?.props.children).toContain('Apple');
  h.key('ArrowDown');
  expect(h.active()?.props.children).toContain('Banana');
  h.key('Enter');
  expect(h.changed).toHaveBeenLastCalledWith('b');
  expect(h.trigger().props['aria-expanded']).toBe(false);
  expect(h.focus).toHaveBeenCalledOnce();
  h.key(' ');
  expect(elements(h.tree().find(node => node.props['aria-selected'])).find(node => node.type === 'span')?.props.children).toBe('Banana');
  h.key('End');
  expect(h.active()?.props.children).toContain('Cherry');
  h.key('Home');
  expect(h.active()?.props.children).toContain('Apple');
  h.key('ArrowUp');
  expect(h.active()?.props.children).toContain('Apple');
  h.key(' ');
  expect(h.changed).toHaveBeenLastCalledWith('a');
});

it('uses typeahead without committing, restores focus on Escape, and lets Tab leave normally', () => {
  const h = harness();
  h.key('c');
  expect(h.active()?.props.children).toContain('Cherry');
  expect(h.changed).not.toHaveBeenCalled();
  const escape = h.key('Escape');
  expect(escape.stopPropagation).toHaveBeenCalledOnce();
  expect(h.focus).toHaveBeenCalledOnce();
  h.trigger().props.onClick!();
  const tab = h.key('Tab');
  expect(tab.preventDefault).not.toHaveBeenCalled();
  expect(h.focus).toHaveBeenCalledOnce();
  expect(h.trigger().props['aria-expanded']).toBe(false);
});

it('selects by pointer, closes on blur, and dismisses outside pointer presses', () => {
  const h = harness();
  h.trigger().props.onClick!();
  h.tree().find(node => node.props.role === 'option' && node.props.id?.endsWith('-2'))!.props.onClick!();
  expect(h.changed).toHaveBeenLastCalledWith('c');
  h.trigger().props.onClick!();
  h.trigger().props.onBlur!();
  expect(h.trigger().props['aria-expanded']).toBe(false);
  h.trigger().props.onClick!();
  h.tree();
  const events = new EventTarget();
  vi.stubGlobal('document', events);
  const cleanup = hooks.effects[0]();
  const inside = new Event('pointerdown');
  Object.defineProperty(inside, 'target', { value: 'trigger' });
  events.dispatchEvent(inside);
  expect(h.trigger().props['aria-expanded']).toBe(true);
  events.dispatchEvent(new Event('pointerdown'));
  expect(h.trigger().props['aria-expanded']).toBe(false);
  if (cleanup) cleanup();
});

it('flips above a low trigger and clamps long menus within narrow viewports', () => {
  expect(dropdownPosition({ left: 980, top: 650, bottom: 690, width: 300 }, 600, { width: 1024, height: 720 })).toEqual({ left: 716, top: 366, width: 300, maxHeight: 280 });
  const small = dropdownPosition({ left: 4, top: 50, bottom: 90, width: 300 }, 600, { width: 220, height: 400 });
  expect(small).toEqual({ left: 8, top: 94, width: 204, maxHeight: 280 });
});
