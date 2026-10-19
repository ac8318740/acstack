import { Children, createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { pack } from '../pack.js';
import type { DrawerView } from '../drawer.js';
import { commentScopeOptions, clampDrawerWidth, CommentForm, Comments, Details, DocumentOverview, Drawer as ActualDrawer, drawerWidthForKey, drawerWidthLimit, commentContext } from '../drawer.js';

vi.mock('../pack.js', () => ({
  liveComments: false,
  useReviewAnnotations: () => ({ annotations: [], setAnnotations: vi.fn(), syncState: undefined, flush: undefined, retry: vi.fn() }),
  targetLabel: () => 'Project developer',
  diagramId: () => 'item:author',
  pack: {
    designDocument: { name: 'Checkout design', summary: 'Customers place an order', detail: '## Customer journey\n\nReview the **basket**, then pay.' },
    graph: {
      groups: [{ id: 'owned', ownerNodeId: 'author', label: 'Owned group' }, { id: 'legacy', label: 'Legacy group' }],
      nodes: [
        { id: 'author', label: 'Project developer', summary: 'Authors designs', sourceRefs: [] },
        { id: 'github', label: 'GitHub', summary: 'Displays Markdown', sourceRefs: [] },
      ],
      edges: [
        { id: 'publishes', fromNodeId: 'author', toNodeId: 'github', label: 'Publishes' },
        { id: 'syncs', fromNodeId: 'author', toNodeId: 'github', label: 'Syncs', direction: 'bidirectional' },
      ],
    },
    source: { references: [] },
  },
}));

function Drawer(props: Omit<ComponentProps<typeof ActualDrawer>, 'view' | 'commentScope' | 'setCommentScope'> & { view: DrawerView | 'all-comments' | 'document-comments'; commentScope?: string }) {
  const { view } = props;
  return createElement(ActualDrawer, { ...props, view: view === 'details' ? 'details' : 'comments', commentScope: props.commentScope ?? (view === 'all-comments' ? 'all' : view === 'document-comments' ? 'group:design:root' : props.selected ?? 'group:design:root'), setCommentScope: vi.fn() });
}

type ButtonProps = { children?: ReactNode; onClick?: () => void };
function buttons(node: ReactNode): ReactElement<ButtonProps>[] {
  if (!isValidElement<ButtonProps>(node)) return [];
  return [
    ...(node.type === 'button' ? [node] : []),
    ...Children.toArray(node.props.children).flatMap(buttons),
  ];
}
function details(selected: string, onSelect: (id: string) => void) {
  return Details({ selected, onSelect, diagram: { nodes: [], edges: [], nodeToVisible: {} }, onOpenGroup: vi.fn() });
}

type OverviewProps = { children?: ReactNode; 'data-annotate-type'?: string; 'data-annotate-id'?: string; onSave?: (comment: string) => void; focusKey?: number; open?: boolean };
function elements(node: ReactNode): ReactElement<OverviewProps>[] {
  if (!isValidElement<OverviewProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

it('makes the overview summary and Markdown annotatable without including comment controls', () => {
  const content = DocumentOverview();
  const hosts = elements(content).filter(element => element.props['data-annotate-type']);
  expect(hosts.length).toBeGreaterThan(0);
  const authored = hosts.map(host => renderToStaticMarkup(host)).join('');
  expect(authored).toContain('Customers place an order');
  expect(authored).toContain('<strong>basket</strong>');
  expect(authored).toContain('Customer journey');
  for (const host of hosts) {
    expect(host.props).toMatchObject({ 'data-annotate-type': 'group', 'data-annotate-id': 'design:root' });
    expect(renderToStaticMarkup(host)).not.toContain('<textarea');
    expect(renderToStaticMarkup(host)).not.toContain('Select a component');
  }
});

it('keeps document feedback associated with the structural root rather than arbitrary nodes', () => {
  expect(commentContext(null, { nodes: [], edges: [], nodeToVisible: {} })?.target).toEqual({ type: 'group', id: 'design:root' });
  expect(renderToStaticMarkup(DocumentOverview())).not.toContain('textarea');
});

it('keeps document details free of comment controls', () => {
  const html = renderToStaticMarkup(createElement(Drawer, { open: true, setOpen: vi.fn(), view: 'details', setView: vi.fn(), selected: null, diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0, annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() }));
  expect(html).toContain('data-annotate-id="design:root"');
  expect(html).not.toContain('textarea');
  expect(html).toContain('Checkout design');
});

it('provides a keyboard preview action for every saved comment and renders comments as text', () => {
  const html = renderToStaticMarkup(createElement(Comments, {
    annotations: [{ id: 'saved', packVersion: 'v1', target: { type: 'node', id: 'author' }, selectedText: '<script>quote</script>', comment: '<img src=x onerror=alert(1)>' }],
    onSelect: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onShowComment: vi.fn(),
  }));
  expect(html).toContain('Show comment');
  expect(html).toContain('Delete this comment?');
  expect(html).toContain('&lt;script&gt;quote&lt;/script&gt;');
  expect(html).toContain('&lt;img');
  expect(html).not.toContain('<img');
});
it('clamps drawer width while retaining at least 320 pixels for the desktop canvas', () => {
  expect(clampDrawerWidth(100, 1360)).toBe(280);
  expect(clampDrawerWidth(900, 1360)).toBe(720);
  expect(clampDrawerWidth(720, 900)).toBe(580);
  expect(drawerWidthLimit(820)).toBe(500);
});

it('resizes with directional keys and jumps to limits with Home and End', () => {
  expect(drawerWidthForKey('ArrowLeft', 360, 1360)).toBe(380);
  expect(drawerWidthForKey('ArrowRight', 360, 1360)).toBe(340);
  expect(drawerWidthForKey('ArrowRight', 280, 1360)).toBe(280);
  expect(drawerWidthForKey('ArrowLeft', 580, 900)).toBe(580);
  expect(drawerWidthForKey('Home', 360, 1360)).toBe(280);
  expect(drawerWidthForKey('End', 360, 900)).toBe(580);
  expect(drawerWidthForKey('Enter', 360, 1360)).toBeUndefined();
});

it('exposes an accessible separator with the current width and limits', () => {
  const html = renderToStaticMarkup(createElement(Drawer, { open: true, setOpen: vi.fn(), view: 'details', setView: vi.fn(), selected: null, diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0, annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() }));
  expect(html).toContain('role="separator"');
  expect(html).toContain('aria-orientation="vertical"');
  expect(html).toContain('aria-valuenow="360"');
  expect(html).toContain('aria-valuemin="280"');
  expect(html).toContain('aria-valuemax="720"');
  expect(html).toContain('tabindex="0"');
});

it.each(['author', 'github'])('opens the relationship from %s, not the other endpoint', selected => {
  const onSelect = vi.fn();
  const link = buttons(details(`item:${selected}`, onSelect)).find(button => renderToStaticMarkup(button).includes('Publishes'));
  expect(link).toBeDefined();
  link!.props.onClick!();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('edge:publishes');
});

it('keeps endpoint navigation available inside relationship details, even when its edge is folded away', () => {
  const onSelect = vi.fn();
  const content = details('edge:publishes', onSelect);
  expect(renderToStaticMarkup(content)).toMatch(/<dt>From:<\/dt>.*Project developer.*<dt>To:<\/dt>.*GitHub/);
  const endpoints = buttons(content);
  expect(endpoints).toHaveLength(2);
  endpoints[0].props.onClick!();
  expect(onSelect).toHaveBeenLastCalledWith('item:author');
  endpoints[1].props.onClick!();
  expect(onSelect).toHaveBeenLastCalledWith('item:github');
});

it('keeps bidirectional meaning explicit with labeled endpoint rows', () => {
  expect(renderToStaticMarkup(details('edge:syncs', vi.fn()))).toContain('Bidirectional');
});

it('labels the comment field visibly and exposes the posting action and shortcut', () => {
  const html = renderToStaticMarkup(createElement(CommentForm, { onSave: vi.fn() }));
  expect(html).toMatch(/<label\b[^>]*\sfor="([^"]+)"[^>]*>Your comment<\/label><textarea\b[^>]*\sid="\1"/);
  expect(html).toContain('Post comment');
  expect(html).toContain('<kbd>Enter</kbd>');
});
it('keeps comment deletion behind a labeled dialog with a safe cancel action', () => {
  const html = renderToStaticMarkup(createElement(Drawer, { open: true, setOpen: vi.fn(), view: 'comments', setView: vi.fn(), selected: null, diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0, annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() }));
  expect(html).toMatch(/<dialog[^>]+aria-labelledby=/);
  expect(html).toContain('Delete this comment?');
  expect(html).toContain('autofocus=""');
  expect(html).toContain('Cancel');
  expect(html).not.toContain(' title=');
});

it('limits node, owned group, legacy group, root, and merged edge comments to their own targets', () => {
  const diagram = { nodes: [], edges: [], nodeToVisible: {} };
  const author = commentContext('item:author', diagram)!;
  expect(author.matches({ type: 'node', id: 'author' })).toBe(true);
  expect(author.matches({ type: 'group', id: 'owned' })).toBe(true);
  expect(author.matches({ type: 'node', id: 'github' })).toBe(false);
  expect(author.matches({ type: 'group', id: 'design:root' })).toBe(false);
  expect(commentContext('group:owned', diagram)?.target).toEqual(author.target);
  const legacy = commentContext('group:legacy', diagram)!;
  expect(legacy.matches({ type: 'group', id: 'legacy' })).toBe(true);
  expect(legacy.matches({ type: 'node', id: 'author' })).toBe(false);
  const root = commentContext(null, diagram)!;
  expect(root.matches({ type: 'group', id: 'design:root' })).toBe(true);
  expect(root.matches({ type: 'node', id: 'author' })).toBe(false);
  const edge = commentContext('edge:publishes', diagram)!;
  expect(edge.matches({ type: 'edge', id: 'publishes' })).toBe(true);
  expect(edge.matches({ type: 'edge', id: 'syncs' })).toBe(false);
  const merged = commentContext('edge:publishes', { ...diagram, edges: [{ id: 'merged', source: 'item:author', target: 'item:github', label: '2 links', childEdgeIds: ['publishes', 'syncs'], points: [], path: '' }] })!;
  expect(merged.matches({ type: 'edge', id: 'publishes' })).toBe(true);
  expect(merged.matches({ type: 'edge', id: 'syncs' })).toBe(true);
  expect(merged.matches({ type: 'edge', id: 'unrelated' })).toBe(false);
});

it('derives filter options from all comments, excluding empty targets and deduplicating owner aliases', () => {
  const annotations = [
    { id: 'a', packVersion: 'v1', target: { type: 'node' as const, id: 'github' }, comment: 'Unselected node' },
    { id: 'b', packVersion: 'v1', target: { type: 'edge' as const, id: 'publishes' }, comment: 'Unselected edge' },
    { id: 'c', packVersion: 'v1', target: { type: 'group' as const, id: 'owned' }, comment: 'Owner alias' },
    { id: 'd', packVersion: 'v1', target: { type: 'node' as const, id: 'author' }, comment: 'Owner node' },
  ];
  const html = renderToStaticMarkup(createElement(Drawer, { open: true, setOpen: vi.fn(), view: 'comments', setView: vi.fn(), selected: 'item:author', diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0, annotations, setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() }));
  expect(html).toContain('role="combobox"');
  expect(html).not.toContain('<select');
  const options = commentScopeOptions(annotations);
  expect(options.map(option => option.value)).toEqual(['all', 'item:github', 'item:author', 'edge:publishes']);
  expect(options.find(option => option.value === 'item:author')?.label).toContain('(2)');
  expect(options.some(option => option.value === 'group:design:root')).toBe(false);
  expect(commentScopeOptions([])).toEqual([{ value: 'all', label: 'All comments (0)' }]);
  expect(commentScopeOptions([...annotations, { id: 'root', packVersion: 'v1', target: { type: 'group', id: 'design:root' }, comment: 'Root' }])[1]).toEqual({ value: 'group:design:root', label: 'Document (1)' });
});

it('uses one Comments layout with scoped filters and a document composer in All and Document', () => {
  const annotations = [
    { id: 'a', packVersion: 'v1', target: { type: 'node' as const, id: 'author' }, comment: 'Author only' },
    { id: 'b', packVersion: 'v1', target: { type: 'group' as const, id: 'design:root' }, comment: 'Document only' },
  ];
  const render = (view: DrawerView | 'all-comments' | 'document-comments') => renderToStaticMarkup(createElement(Drawer, { open: true, setOpen: vi.fn(), view, setView: vi.fn(), selected: 'item:author', diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 1, annotations, setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() }));
  expect(render('details')).not.toContain('Author only');
  expect(render('details')).not.toContain('textarea');
  expect(render('comments')).toContain('Author only');
  expect(render('comments')).not.toContain('Document only');
  expect(render('comments')).toContain('textarea');
  expect(render('all-comments')).toContain('All comments');
  expect(render('all-comments')).toContain('Author only');
  expect(render('all-comments')).toContain('Document only');
  for (const view of ['comments', 'all-comments', 'document-comments'] as const) {
    expect(render(view)).toContain('>Comments</button>');
    expect(render(view)).toMatch(/aria-pressed="true">Comments<\/button>/);
    expect(render(view)).toContain('<h2>Comments</h2>');
    expect(render(view)).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Comment scope<\/label><button[^>]*id="\1"/);
    expect(render(view)).toContain('role="combobox"');
    expect(render(view)).not.toContain('<select');
    expect(render(view)).toContain('textarea');
    expect(render(view)).not.toContain('comments across this document');
  }
  expect(render('all-comments')).toContain('Comment on document');
  expect(render('all-comments')).toContain('2 comments');
  expect(render('document-comments')).toContain('Document only');
  expect(render('document-comments')).not.toContain('Author only');
  expect(render('document-comments')).toContain('1 comment</p>');
  expect(render('document-comments')).not.toContain('1 comments');
  expect(render('comments')).toContain('Comment on Project developer');
});

it('keeps legacy All comments read-only without inventing a document target', () => {
  const document = pack.designDocument;
  delete pack.designDocument;
  try {
    const render = (view: DrawerView | 'all-comments' | 'document-comments', selected: string | null) => renderToStaticMarkup(createElement(Drawer, { open: true, setOpen: vi.fn(), view, setView: vi.fn(), selected, diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0, annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() }));
    expect(render('all-comments', 'item:author')).not.toContain('textarea');
    expect(render('all-comments', 'item:author')).not.toContain('>Document</option>');
    expect(render('all-comments', 'item:author')).toContain('Select a box or relationship');
    expect(render('comments', 'item:author')).toContain('textarea');
    expect(render('comments', null)).not.toContain('textarea');
    expect(commentContext(null, { nodes: [], edges: [], nodeToVisible: {} })).toBeNull();
  } finally {
    pack.designDocument = document;
  }
});
