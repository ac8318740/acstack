import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Pencil, X } from 'lucide-react';
import type { Annotation } from '../pack.js';

// Drive the existing Node-only React fixtures through rerenders without adding a DOM framework.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[] }));
const root = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useRef: (current: unknown) => ({ current }),
  useId: () => 'comment-field',
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useLayoutEffect: vi.fn(),
}));
vi.mock('react-dom/client', () => ({ createRoot: () => root }));
vi.mock('../diagram.js', () => ({ Diagram: () => null, MeasureDiagram: () => null }));
vi.mock('../alignment-graph.js', () => ({ initialExpandedGroups: () => [], projectDiagram: () => ({}), reconcileSelection: (id: string) => id, buildDiagram: vi.fn() }));
vi.mock('../posted-comments.js', async original => {
  const actual = await original<typeof import('../posted-comments.js')>();
  return { ...actual, usePostedComments: vi.fn(actual.usePostedComments) };
});

type Props = { children?: ReactNode; 'aria-label'?: string; 'data-tooltip'?: string; onClick?: () => void; onSave?: (comment: string) => void; onCancel?: () => void; comment?: string; annotations?: Annotation[]; onEdit?: (id: string, comment: string) => void };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function rerender<T>(render: () => T): T { hooks.cursor = 0; hooks.effects = []; return render(); }
const first: Annotation = { id: 'saved', packVersion: 'v1', target: { type: 'node', id: 'author' }, selectedText: 'Original quote', quoteAnchor: { prefix: 'before ', suffix: ' after' }, time: '2026-01-01T00:00:00.000Z', comment: 'Original feedback' };
const other: Annotation = { ...first, id: 'other', comment: 'Keep this' };
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => ({ textContent: JSON.stringify({ packVersion: 'v1', viewState: {}, reviewState: {}, source: { map: { id: 'design' } }, graph: { nodes: [], groups: [], edges: [] } }) }) });
});
afterEach(() => { vi.unstubAllGlobals(); });
it('shares one main callback across both surfaces, changes only comment, and reloads existing storage', async () => {
  const storage = new Map([['alignment-pack:v1:annotations', JSON.stringify([first, other])]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  const { Drawer } = await import('../drawer.js');
  const { usePostedComments } = await import('../posted-comments.js');
  await import('../main.js');
  const strict = root.render.mock.calls[0][0] as ReactElement<{ children: ReactElement }>;
  const provider = strict.props.children as ReactElement<{ children: ReactElement }>;
  const App = provider.props.children.type as () => ReactNode;
  const drawer = () => elements(rerender(App)).find(node => node.type === Drawer)!;
  const original = drawer();
  expect(vi.mocked(usePostedComments).mock.lastCall?.[3]).toBe(original.props.onEdit);
  original.props.onEdit!(first.id, 'Updated feedback');
  expect(drawer().props.annotations).toEqual([{ ...first, comment: 'Updated feedback' }, other]);
  expect(vi.mocked(usePostedComments).mock.lastCall?.[0]).toEqual(drawer().props.annotations);
  hooks.effects[0](); // useStored persists the value through its existing effect.
  hooks.slots = []; // A fresh mount reads the saved browser value.
  expect(drawer().props.annotations).toEqual([{ ...first, comment: 'Updated feedback' }, other]);
});
it('edits the matching Comments entry and leaves cancelled text unchanged', async () => {
  const { Comments } = await import('../drawer.js');
  const { CommentEditor } = await import('../comment-editor.js');
  const onEdit = vi.fn();
  const render = () => elements(rerender(() => Comments({ annotations: [first, other], onEdit, onDelete: vi.fn(), onSelect: vi.fn() })));
  render().filter(node => node.type === 'button' && node.props['aria-label'] === 'Edit comment')[1].props.onClick!();
  let editor = render().find(node => node.type === CommentEditor)!;
  expect(editor.props.comment).toBe(other.comment);
  editor.props.onCancel!();
  expect(render().some(node => node.type === CommentEditor)).toBe(false);
  expect(onEdit).not.toHaveBeenCalled();
  render().filter(node => node.type === 'button' && node.props['aria-label'] === 'Edit comment')[1].props.onClick!();
  editor = render().find(node => node.type === CommentEditor)!;
  editor.props.onSave!('Second updated');
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(other.id, 'Second updated');
  expect(render().some(node => node.type === CommentEditor)).toBe(false);
});
it('puts accessible pencil and X actions in the popup header, with Edit before Close', async () => {
  const { usePostedComments } = await import('../posted-comments.js');
  const { CommentEditor } = await import('../comment-editor.js');
  hooks.slots = [{ ids: [first.id], anchor: {}, pinned: false }, null];
  const render = () => rerender(() => usePostedComments([first], false, vi.fn(), vi.fn())).content as ReactElement<Props>;
  const header = Children.toArray(render().props.children)[0];
  const buttons = elements(header).filter(node => node.type === 'button');
  expect(buttons.map(button => button.props['aria-label'])).toEqual(['Edit comment', 'Close saved comments']);
  expect(buttons.map(button => button.props['data-tooltip'])).toEqual(['Edit comment', 'Close saved comments']);
  expect(isValidElement(buttons[0].props.children) && buttons[0].props.children.type).toBe(Pencil);
  expect(isValidElement(buttons[1].props.children) && buttons[1].props.children.type).toBe(X);
  expect(elements(render()).filter(node => node.type === 'button' && node.props['aria-label'] === 'Edit comment')).toHaveLength(1);
  buttons[0].props.onClick!();
  expect(elements(render()).find(node => node.type === CommentEditor)?.props.comment).toBe(first.comment);
});

it('puts the matching edit icon beside Delete in each Comments header', async () => {
  const { Comments } = await import('../drawer.js');
  const tree = elements(rerender(() => Comments({ annotations: [first], onEdit: vi.fn(), onDelete: vi.fn(), onSelect: vi.fn() })));
  const item = tree.find(node => node.type === 'li')!;
  const header = Children.toArray(item.props.children)[0];
  const buttons = elements(header).filter(node => node.type === 'button');
  expect(buttons.slice(1).map(button => button.props['aria-label'])).toEqual(['Edit comment', 'Delete comment']);
  expect(isValidElement(buttons[1].props.children) && buttons[1].props.children.type).toBe(Pencil);
});

it('prefills, cancels, and saves the selected entry in the saved quote popup', async () => {
  const { usePostedComments } = await import('../posted-comments.js');
  const { CommentEditor } = await import('../comment-editor.js');
  hooks.slots = [{ ids: [first.id, other.id], anchor: {}, pinned: false }, null];
  const onEdit = vi.fn();
  const render = () => elements(rerender(() => usePostedComments([first, other], false, vi.fn(), onEdit)).content);
  render().filter(node => node.type === 'button' && node.props['aria-label'] === 'Edit comment')[0].props.onClick!();
  const editor = render().find(node => node.type === CommentEditor)!;
  expect(editor.props.comment).toBe(first.comment);
  editor.props.onCancel!();
  expect(onEdit).not.toHaveBeenCalled();
  expect(render().some(node => node.type === CommentEditor)).toBe(false);
  render().filter(node => node.type === 'button' && node.props['aria-label'] === 'Edit comment')[0].props.onClick!();
  render().find(node => node.type === CommentEditor)!.props.onSave!('Saved quote updated');
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(first.id, 'Saved quote updated');
  expect(render().some(node => node.type === CommentEditor)).toBe(false);
});
