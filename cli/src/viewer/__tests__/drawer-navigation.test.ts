import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Annotation } from '../pack.js';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
const root = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(hooks.slots[index]) : value; }];
  },
  useRef: (current: unknown) => ({ current }),
  useId: () => 'comment-field',
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
}));
vi.mock('react-dom/client', () => ({ createRoot: () => root }));
vi.mock('../diagram.js', () => ({ Diagram: () => null, MeasureDiagram: () => null }));
vi.mock('../alignment-graph.js', () => ({ initialExpandedGroups: () => [], projectDiagram: () => ({}), reconcileSelection: (id: string) => id, buildDiagram: vi.fn() }));
vi.mock('../posted-comments.js', () => ({ usePostedComments: () => ({ content: null, show: vi.fn() }) }));
// The harness invokes real handlers and rerenders state without a DOM dependency.
type Props = { children?: ReactNode; 'aria-label'?: string; onClick?: () => void; onSelect: (id: string | null) => void; onAnnotate: (id: string) => void; view: string; setView: (view: string) => void; commentScope: string; setCommentScope: (scope: string) => void; options: { value: string; label: string }[]; onChange: (value: string) => void; annotations?: Annotation[]; onDelete?: (id: string) => void; selected: string | null; focusKey: number; draftKey: string; label: string; onSave?: (text: string) => void; setOpen: (open: boolean) => void };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function rerender<T>(render: () => T): T { hooks.cursor = 0; return render(); }
afterEach(() => { vi.unstubAllGlobals(); hooks.slots = []; });

it('wires graph Comment, fresh and same-item selection, and detail navigation through App', async () => {
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => ({ textContent: JSON.stringify({ packVersion: 'v1', designDocument: { name: 'Design overview' }, viewState: {}, reviewState: {}, source: { map: { id: 'design' } }, graph: { nodes: [], groups: [], edges: [] } }) }) });
  vi.stubGlobal('localStorage', { getItem: () => null });
  const { Drawer } = await import('../drawer.js');
  const { Diagram } = await import('../diagram.js');
  await import('../main.js');
  const strict = root.render.mock.calls[0][0] as ReactElement<{ children: ReactElement }>;
  const App = strict.props.children.type as () => ReactNode;
  const tree = () => elements(rerender(App));
  const drawer = () => tree().find(node => node.type === Drawer)!;
  const graph = () => tree().find(node => node.type === Diagram)!;
  graph().props.onAnnotate('item:author');
  expect(drawer().props).toMatchObject({ selected: 'item:author', view: 'comments', commentScope: 'item:author', focusKey: 1 });
  for (const scope of ['all', 'group:design:root', 'item:other']) {
    drawer().props.setCommentScope(scope);
    graph().props.onSelect('item:author');
    expect(drawer().props).toMatchObject({ selected: 'item:author', view: 'comments', commentScope: 'item:author' });
  }
  drawer().props.setCommentScope('all');
  graph().props.onSelect('edge:next');
  expect(drawer().props).toMatchObject({ selected: 'edge:next', view: 'comments', commentScope: 'edge:next' });
  drawer().props.onSelect('item:author');
  expect(drawer().props).toMatchObject({ selected: 'item:author', view: 'details' });
  drawer().props.onSelect('group:design:root');
  expect(drawer().props).toMatchObject({ selected: null, view: 'details' });
  graph().props.onAnnotate('edge:next');
  expect(drawer().props).toMatchObject({ view: 'comments', commentScope: 'edge:next', focusKey: 2 });
});

it('opens All from the rail, preserves active scope, and scopes the Details tab to selection', async () => {
  const { Drawer, CommentForm } = await import('../drawer.js');
  const props = { open: false, setOpen: vi.fn(), view: 'details' as const, setView: vi.fn(), commentScope: 'all', setCommentScope: vi.fn(), selected: null, diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 8, annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() };
  const rail = elements(rerender(() => Drawer(props)));
  rail.find(node => node.props['aria-label']?.startsWith('All comments'))!.props.onClick!();
  expect(props.setView).toHaveBeenCalledExactlyOnceWith('comments');
  expect(props.setCommentScope).toHaveBeenCalledExactlyOnceWith('all');
  expect(props.setOpen).toHaveBeenCalledExactlyOnceWith(true);
  props.setView.mockClear();
  rail.find(node => node.props['aria-label'] === 'Open details panel')!.props.onClick!();
  expect(props.setView).toHaveBeenCalledExactlyOnceWith('details');
  for (const scope of ['all', 'group:design:root']) {
    const pane = elements(rerender(() => Drawer({ ...props, open: true, view: 'comments', commentScope: scope, selected: 'item:author' })));
    expect(pane.filter(node => node.props['aria-label']?.startsWith('All comments'))).toHaveLength(0);
    const form = pane.find(node => node.type === CommentForm)!;
    expect(form.props.label).toBe('Comment on document');
    expect(form.props.focusKey).toBe(8);
    form.props.onSave!('General feedback');
    expect(props.onComment).toHaveBeenLastCalledWith({ type: 'group', id: 'design:root' }, 'General feedback');
    props.setView.mockClear(); props.setCommentScope.mockClear();
    pane.find(node => node.type === 'button' && node.props.children === 'Comments')!.props.onClick!();
    expect(props.setView).not.toHaveBeenCalled();
    expect(props.setCommentScope).not.toHaveBeenCalled();
  }
  const details = elements(rerender(() => Drawer({ ...props, open: true, selected: 'item:author' })));
  expect(details.filter(node => node.props['aria-label']?.startsWith('All comments'))).toHaveLength(0);
  details.find(node => node.type === 'button' && node.props.children === 'Comments')!.props.onClick!();
  expect(props.setView).toHaveBeenLastCalledWith('comments');
  expect(props.setCommentScope).toHaveBeenLastCalledWith('item:author');
});

it('filters and composes to an unselected target, then removes and adds options with actual comments', async () => {
  const { Drawer, CommentForm, Comments } = await import('../drawer.js');
  const { Dropdown } = await import('../dropdown.js');
  let annotations: Annotation[] = [
    { id: 'node-note', packVersion: 'v1', target: { type: 'node', id: 'other' }, comment: 'Other feedback' },
    { id: 'edge-note', packVersion: 'v1', target: { type: 'edge', id: 'next' }, comment: 'Edge feedback' },
  ];
  let commentScope = 'item:author';
  const onSelect = vi.fn();
  const onComment = vi.fn((target: Annotation['target'], comment: string) => { annotations = [...annotations, { id: `new-${annotations.length}`, packVersion: 'v1', target, comment }]; });
  const pane = () => elements(rerender(() => Drawer({ open: true, setOpen: vi.fn(), view: 'comments', setView: vi.fn(), commentScope, setCommentScope: scope => { commentScope = scope; }, selected: 'item:author', diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 8, annotations, setAnnotations: next => { annotations = next; }, onEdit: vi.fn(), onSelect, onComment, onOpenGroup: vi.fn() })));
  const options = () => pane().find(node => node.type === Dropdown)!.props.options;
  expect(options().map(option => option.value)).toEqual(['all', 'edge:next', 'item:other']);
  expect(pane().find(node => node.type === CommentForm)!.props.label).toBe('Comment on author');
  pane().find(node => node.type === CommentForm)!.props.onSave!('First author comment');
  expect(options().map(option => option.value)).toContain('item:author');
  pane().find(node => node.type === Dropdown)!.props.onChange('item:other');
  expect(onSelect).not.toHaveBeenCalled();
  expect(pane().find(node => node.type === Comments)!.props.annotations?.map(note => note.id)).toEqual(['node-note']);
  pane().find(node => node.type === CommentForm)!.props.onSave!('New other comment');
  expect(onComment).toHaveBeenLastCalledWith({ type: 'node', id: 'other' }, 'New other comment');
  for (const id of ['node-note', 'new-3']) pane().find(node => node.type === Comments)!.props.onDelete!(id);
  expect(options().map(option => option.value)).not.toContain('item:other');
  expect(annotations.map(note => note.id)).toEqual(['edge-note', 'new-2']);
  expect(pane().find(node => node.type === CommentForm)!.props.label).toBe('Comment on other');
  pane().find(node => node.type === Dropdown)!.props.onChange('edge:next');
  pane().find(node => node.type === CommentForm)!.props.onSave!('More edge feedback');
  expect(onComment).toHaveBeenLastCalledWith({ type: 'edge', id: 'next' }, 'More edge feedback');
});

it('keeps grouped canvas edges scoped together but a dropdown edge exact', async () => {
  const { Drawer, Comments, commentScopeForSelection } = await import('../drawer.js');
  const annotations: Annotation[] = ['first', 'second', 'unrelated'].map(id => ({ id, packVersion: 'v1', target: { type: 'edge', id }, comment: id }));
  const diagram = { nodes: [], nodeToVisible: {}, edges: [{ id: 'merged', source: 'item:a', target: 'item:b', label: '2 links', childEdgeIds: ['first', 'second'], points: [], path: '' }] };
  const comments = (commentScope: string) => elements(rerender(() => Drawer({ open: true, setOpen: vi.fn(), view: 'comments', setView: vi.fn(), commentScope, setCommentScope: vi.fn(), selected: 'edge:first', diagram, focusKey: 0, annotations, setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() }))).find(node => node.type === Comments)!.props.annotations;
  expect(comments(commentScopeForSelection('edge:first', diagram))?.map(note => note.id)).toEqual(['first', 'second']);
  expect(comments('edge:first')?.map(note => note.id)).toEqual(['first']);
});

it('matches singleton and unknown canvas relationship scopes to their menu values', async () => {
  vi.stubGlobal('document', { getElementById: () => ({ textContent: JSON.stringify({ graph: { nodes: [], groups: [], edges: [] } }) }) });
  const { commentScopeForSelection, commentScopeOptions } = await import('../drawer.js');
  const diagram = { nodes: [], nodeToVisible: {}, edges: [{ id: 'edge:first', source: 'item:a', target: 'item:b', label: 'Link', childEdgeIds: ['first'], points: [], path: '' }] };
  const annotations: Annotation[] = [{ id: 'note', packVersion: 'v1', target: { type: 'edge', id: 'first' }, comment: 'Feedback' }];
  const scope = commentScopeForSelection('edge:first', diagram);
  expect(scope).toBe('edge:first');
  expect(commentScopeOptions(annotations).some(option => option.value === scope)).toBe(true);
  expect(commentScopeForSelection('edge:unknown', diagram)).toBe('edge:unknown');
  const grouped = { ...diagram, edges: [{ ...diagram.edges[0], childEdgeIds: ['first', 'second'] }] };
  expect(commentScopeForSelection('edge:first', grouped)).toBe('selection:edge:first');
});

it('keeps a separate composer draft for each target', async () => {
  const { CommentForm } = await import('../drawer.js');
  const onSave = vi.fn();
  const form = (draftKey: string) => elements(rerender(() => CommentForm({ draftKey, onSave })));
  const field = () => form('item:first').find(node => node.type === 'textarea')!;
  const textarea = field() as unknown as ReactElement<{ value: string; onChange: (event: { target: { value: string } }) => void }>;
  textarea.props.onChange({ target: { value: 'Keep this draft' } });
  expect((form('item:second').find(node => node.type === 'textarea')!.props as unknown as { value: string }).value).toBe('');
  expect((field().props as unknown as { value: string }).value).toBe('Keep this draft');
});
