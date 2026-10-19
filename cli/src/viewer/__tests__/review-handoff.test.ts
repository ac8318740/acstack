import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { copy, ReviewHandoff } from '../review-handoff.js';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void)[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
}));
type Props = {
  children?: ReactNode; disabled?: boolean; role?: string; 'aria-labelledby'?: string; 'data-review-handoff'?: boolean;
  ref?: { current: unknown }; onClick?: () => void; onClose?: () => void;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
const prompt = 'Read review JSON at "/project/review.json" against "/project/design.yaml"';
const flush = vi.fn<() => Promise<void>>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const modal = { showModal: vi.fn(), close: vi.fn() };
const trigger = { focus: vi.fn() };
function render() {
  hooks.cursor = 0;
  hooks.effects = [];
  const tree = elements(ReviewHandoff({ prompt, flush }));
  tree.find(node => node.type === 'dialog')!.props.ref!.current = modal;
  const send = tree.find(node => node.type === 'button' && node.props['data-review-handoff']);
  if (send?.props.ref) send.props.ref.current = trigger;
  for (const effect of hooks.effects) effect();
  return tree;
}
function button(label: string) {
  return render().find(node => node.type === 'button' && node.props.children === label)!;
}
beforeEach(() => {
  hooks.values = [];
  vi.clearAllMocks();
  flush.mockReset();
  writeText.mockReset().mockResolvedValue();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(() => vi.unstubAllGlobals());

it('copies only after the save barrier, blocks duplicate clicks, and returns to the review', async () => {
  let acknowledge!: () => void;
  flush.mockReturnValue(new Promise<void>(resolve => { acknowledge = resolve; }));
  const send = button('Send to agent');
  expect(send.props['data-review-handoff']).toBe(true);
  expect(render().find(node => node.type === 'dialog')?.props['data-review-handoff']).toBe(true);
  send.props.onClick!();
  send.props.onClick!();
  expect(flush).toHaveBeenCalledOnce();
  expect(button('Saving feedback...').props.disabled).toBe(true);
  expect(writeText).not.toHaveBeenCalled();
  expect(modal.showModal).not.toHaveBeenCalled();
  acknowledge();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(prompt));
  await vi.waitFor(() => expect(button('Send to agent').props.disabled).toBe(false));
  expect(modal.showModal).toHaveBeenCalled();
  const tree = render();
  expect(tree.find(node => node.type === 'h2')?.props.children).toBe('Feedback ready');
  expect(tree.some(node => node.props.children === 'Only posted comments are included. Unposted text stays in this review.')).toBe(true);
  expect(tree.find(node => node.type === 'pre')?.props.children).toBe(prompt);
  expect(tree.find(node => node.type === 'dialog')?.props['aria-labelledby']).toBe('handoff-title');
  button('Back to review').props.onClick!();
  expect(modal.close).toHaveBeenCalledOnce();
  tree.find(node => node.type === 'dialog')!.props.onClose!();
  modal.showModal.mockClear();
  render();
  expect(modal.showModal).not.toHaveBeenCalled();
});

it('keeps a failed send retryable without copying or opening completion', async () => {
  flush.mockRejectedValue(new Error('Not synced'));
  button('Send to agent').props.onClick!();
  await vi.waitFor(() => expect(render().find(node => node.props.role === 'alert')?.props.children).toBe('Not synced'));
  expect(writeText).not.toHaveBeenCalled();
  expect(modal.showModal).not.toHaveBeenCalled();
  expect(button('Send to agent').props.disabled).toBe(false);
  flush.mockResolvedValue();
  button('Send to agent').props.onClick!();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(prompt));
});

it.each(['absent', 'denied', 'throws'] as const)('shows the selectable prompt and Copy button when clipboard access is %s', async mode => {
  if (mode === 'absent') vi.stubGlobal('navigator', {});
  if (mode === 'denied') writeText.mockRejectedValue(new Error('Denied'));
  if (mode === 'throws') writeText.mockImplementation(() => { throw new Error('Unavailable'); });
  flush.mockResolvedValue();
  button('Send to agent').props.onClick!();
  await vi.waitFor(() => expect(button('Send to agent').props.disabled).toBe(false));
  const tree = render();
  expect(modal.showModal).toHaveBeenCalled();
  expect(tree.find(node => node.type === 'pre')?.props.children).toBe(prompt);
  const copyButton = tree.find(node => node.type === 'button' && Children.toArray(node.props.children).includes('Copy prompt'));
  expect(copyButton).toBeDefined();
  vi.stubGlobal('navigator', { clipboard: { writeText: writeText.mockResolvedValue() } });
  copyButton!.props.onClick!();
  await vi.waitFor(() => expect(render().some(node => node.type === 'button' && Children.toArray(node.props.children).includes('Copied'))).toBe(true));
});

it.each(['Back to review', 'Escape'])('restores focus to Send to agent after %s closes the native dialog', async exit => {
  flush.mockResolvedValue();
  button('Send to agent').props.onClick!();
  await vi.waitFor(() => expect(button('Send to agent').props.disabled).toBe(false));
  expect(modal.showModal).toHaveBeenCalled();
  if (exit === 'Back to review') {
    button('Back to review').props.onClick!();
    expect(modal.close).toHaveBeenCalledOnce();
  }
  // Both native Escape and close() dispatch the dialog's close event.
  render().find(node => node.type === 'dialog')!.props.onClose!();
  expect(trigger.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  modal.showModal.mockClear();
  render();
  expect(modal.showModal).not.toHaveBeenCalled();
});

it('also returns false when accessing the clipboard property throws', async () => {
  vi.stubGlobal('navigator', { get clipboard() { throw new Error('SecurityError'); } });
  await expect(copy(prompt)).resolves.toBe(false);
});
