import { createElement, act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Drawer } from '../drawer.js';
import { DesignApproval, DesignApprovalProvider, ElementLock, useBlockerNavigation, useLockCapture } from '../design-approval.js';
import { pack } from '../pack.js';
import { DesignQuestions, useQuestionCounts } from '../design-questions.js';
import type { DesignAnswer } from '../../lib/design-review.js';
import { MermaidDiagram } from '../sidebar-markdown.js';

vi.mock('../pack.js', () => {
  const syncState = { status: 'Saved' };
  return {
    diagramId: (target: { id: string }) => `item:${target.id}`,
    targetLabel: (target: { id: string }) => target.id,
    pack: { documentKind: 'design', graph: { nodes: [], edges: [], groups: [] }, source: { references: [] } },
    liveComments: true,
    token: 'test-token',
    usePackRevision: () => 0,
    useReviewAnnotations: () => ({ syncState, flush: () => Promise.resolve() }),
  };
});
vi.mock('../dropdown.js', () => ({ Dropdown: () => null }));

// Minimal host DOM for React's real reconciler; events call React's committed handlers.
class Host {
  nodeType = 1;
  tagName: string;
  nodeName: string;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  parentNode: Host | null = null;
  childNodes: Host[] = [];
  style = { setProperty: vi.fn() };
  attributes: Record<string, string> = {};
  value = '';
  textContent = '';
  nodeValue: string | null = null;
  set defaultValue(value: string) { this.textContent = String(value); }
  get defaultValue() { return this.textContent; }
  ownerDocument!: Host;
  constructor(name: string) { this.tagName = this.nodeName = name.toUpperCase(); }
  appendChild(child: Host) { return this.insertBefore(child, null); }
  insertBefore(child: Host, before: Host | null) {
    child.parentNode?.removeChild(child);
    this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: Host) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
  setAttribute(name: string, value: string) { this.attributes[name] = String(value); }
  removeAttribute(name: string) { delete this.attributes[name]; }
  addEventListener() {}
  removeEventListener() {}
  focus = vi.fn();
  scrollIntoView = vi.fn();
  animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => void>();
  getAnimations = vi.fn<() => { cancel: () => void }[]>(() => []);
  get parentElement() { return this.parentNode; }
  showModal() { this.setAttribute('open', ''); }
  close() { this.removeAttribute('open'); }
  get firstChild(): Host | null { return this.childNodes[0] ?? null; }
  get lastChild(): Host | null { return this.childNodes.at(-1) ?? null; }
}
type Handlers = { type?: string; children?: string; onClick?: (event?: { preventDefault: () => void; stopPropagation: () => void }) => void; onClose?: () => void; checked?: boolean; onChange?: (event: { target: { value: string; checked?: boolean } }) => void; onKeyDown?: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => void };
function handlers(host: Host): Handlers {
  const key = Object.keys(host).find(key => key.startsWith('__reactProps$'))!;
  return (host as unknown as Record<string, Handlers>)[key];
}
function all(host: Host): Host[] { return [host, ...host.childNodes.flatMap(all)]; }
afterEach(() => vi.unstubAllGlobals());

it('filters questions by scope without discarding drafts or expansion, and scopes tab entry to the selection', () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = create('div');
  const root = createRoot(container as unknown as HTMLElement);
  const original = pack.designDocument;
  pack.designDocument = { id: 'scope', name: 'Design', summary: 'Design summary', questions: ['first', 'second'].map(id => ({ id, target: { type: 'node', id }, question: `Question ${id}` })) };
  let props: ComponentProps<typeof Drawer> = {
    open: true, setOpen: vi.fn(), view: 'questions', setView: vi.fn(), commentScope: 'all', setCommentScope: vi.fn(), questionScope: 'selection:item:first', setQuestionScope: vi.fn(),
    selected: 'item:first', diagram: { nodes: [], edges: [], nodeToVisible: { first: 'item:first', second: 'item:second' } }, focusKey: 0,
    annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn(),
  };
  const render = (next: Partial<ComponentProps<typeof Drawer>> = {}) => { props = { ...props, ...next }; act(() => root.render(createElement(Drawer, props))); };
  const ids = () => all(container).filter(node => node.attributes.class === 'question-card').map(node => node.attributes['data-question-id']);
  const firstSummary = () => all(container).find(node => node.tagName === 'BUTTON' && node.attributes['aria-label'] === 'Question first')!;
  try {
    render();
    expect(ids()).toEqual(['first']);
    act(() => handlers(firstSummary()).onClick?.());
    act(() => handlers(all(container).find(node => node.tagName === 'TEXTAREA')!).onChange?.({ target: { value: 'Keep this scoped draft' } }));
    render({ questionScope: 'item:second' });
    expect(ids()).toEqual(['second']);
    render({ questionScope: 'item:unknown' });
    expect(ids()).toEqual([]);
    expect(all(container).some(node => node.textContent === 'No questions for this target.')).toBe(true);
    render({ questionScope: 'all' });
    expect(ids()).toEqual(['first', 'second']);
    expect(firstSummary().attributes['aria-expanded']).toBe('true');
    expect(all(container).find(node => node.tagName === 'TEXTAREA')!.value).toBe('Keep this scoped draft');
    render({ view: 'comments', selected: 'item:second' });
    act(() => handlers(all(container).find(node => node.attributes.class === 'drawer-tabs')!.childNodes[2]).onClick?.());
    expect(props.setQuestionScope).toHaveBeenLastCalledWith('selection:item:second');
    expect(props.setView).toHaveBeenLastCalledWith('questions');
  } finally { act(() => root.unmount()); if (original) pack.designDocument = original; else delete pack.designDocument; }
});

it.each([false, true])('scrolls, focuses, and briefly emphasizes each navigation request without changing drafts (reduced motion=%s)', reduced => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const original = pack.designDocument;
  pack.designDocument = { id: 'test', name: 'Test', summary: 'Test', questions: ['first', 'second'].map(id => ({ id, question: id, target: { type: 'node', id: 'app' } })) };
  const container = create('div'), root = createRoot(container as unknown as HTMLElement);
  const onDraft = vi.fn();
  Object.assign(window, { matchMedia: vi.fn(() => ({ matches: reduced })) });
  let focusQuestion = { id: 'second' };
  const render = () => root.render(createElement(DesignQuestions, { selected: null, diagram: { nodes: [], edges: [], nodeToVisible: {} }, drafts: { second: { answer: 'Keep my draft' } }, onDraft, onDetails: vi.fn(), focusQuestion }));
  const summary = () => all(container).find(node => node.attributes['aria-label'] === 'second')!;
  try {
    act(render);
    expect(summary().attributes['aria-expanded']).toBe('true');
    expect(summary().focus).toHaveBeenCalledOnce();
    expect(summary().scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    const card = summary().parentNode!;
    const frames = card.animate.mock.calls[0][0];
    expect(frames[0].backgroundColor).toBe('var(--accent-soft)');
    expect(frames[0] === frames[1]).toBe(reduced);
    const cancel = vi.fn();
    card.getAnimations.mockReturnValue([{ cancel }]);
    expect(all(container).find(node => node.tagName === 'TEXTAREA')?.value).toBe('Keep my draft');
    act(() => handlers(summary()).onClick?.());
    act(render);
    expect(summary().attributes['aria-expanded']).toBe('false');
    focusQuestion = { id: 'second' };
    act(render);
    expect(summary().attributes['aria-expanded']).toBe('true');
    expect(summary().focus).toHaveBeenCalledTimes(2);
    expect(card.animate).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onDraft).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); if (original) pack.designDocument = original; else delete pack.designDocument; }
});

it('defers Mermaid execution until its enclosing disclosure is visible and cleans up observation', () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let notify: (width: number) => void = () => {};
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: (entries: { contentRect: { width: number } }[]) => void) { notify = width => callback([{ contentRect: { width } }]); }
    observe = observe;
    disconnect = disconnect;
  });
  const container = create('div');
  const root = createRoot(container as unknown as HTMLElement);
  const documents = () => Object.values(all(container).find(node => node.tagName === 'IFRAME')!.attributes).filter(value => value.includes('Content-Security-Policy'));
  try {
    act(() => root.render(createElement(MermaidDiagram, { source: 'flowchart LR\n A --> B' })));
    expect(observe).toHaveBeenCalledOnce();
    expect(documents()).toHaveLength(0);
    act(() => notify(0));
    expect(documents()).toHaveLength(0);
    act(() => notify(300));
    expect(documents()).toHaveLength(1);
    expect(disconnect).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); }
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it('retains composer and posted-comment edits through actual child unmounts, scoped navigation, save, and cancel', () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = create('div');
  const root = createRoot(container as unknown as HTMLElement);
  let props: ComponentProps<typeof Drawer> = {
    open: true, setOpen: vi.fn(), view: 'comments', setView: vi.fn(), questionScope: 'all', setQuestionScope: vi.fn(), commentScope: 'item:first', setCommentScope: vi.fn(),
    selected: 'item:first', diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0,
    annotations: ['first', 'second'].map(id => ({ id, packVersion: 'v1', target: { type: 'node', id }, comment: `Saved ${id}` })),
    setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn(),
  };
  const render = (next: Partial<ComponentProps<typeof Drawer>> = {}) => { props = { ...props, ...next }; act(() => root.render(createElement(Drawer, props))); };
  const fields = () => all(container).filter(node => node.tagName === 'TEXTAREA');
  const button = (label: string) => all(container).find(node => node.tagName === 'BUTTON' && (handlers(node).children === label || node.attributes['aria-label'] === label))!;
  const click = (label: string) => { act(() => handlers(button(label)).onClick!()); };
  const type = (index: number, text: string) => { act(() => handlers(fields()[index]).onChange!({ target: { value: text } })); };
  try {
    render();
    type(0, 'Draft first');
    click('Edit comment');
    type(1, 'Edit first');
    const unmounted = fields();
    expect(unmounted.map(field => field.value)).toEqual(['Draft first', 'Edit first']);
    render({ view: 'details', selected: null });
    expect(fields()).toHaveLength(0);
    expect(unmounted.every(field => field.parentNode === null || !all(container).includes(field))).toBe(true);
    render({ view: 'comments' });
    expect(fields().map(field => field.value)).toEqual(['Draft first', 'Edit first']);
    expect(fields()[0]).not.toBe(unmounted[0]);
    render({ commentScope: 'item:second', selected: 'item:second' });
    type(0, 'Draft second');
    click('Edit comment');
    type(1, 'Edit second');
    render({ commentScope: 'all' });
    expect(fields().map(field => field.value)).toEqual(['Edit first', 'Edit second']);
    render({ open: false });
    expect(fields()).toHaveLength(0);
    render({ open: true, commentScope: 'item:first', selected: 'item:first' });
    expect(fields().map(field => field.value)).toEqual(['Draft first', 'Edit first']);
    click('Post comment');
    click('Save');
    expect(props.onComment).toHaveBeenCalledExactlyOnceWith({ type: 'node', id: 'first' }, 'Draft first');
    expect(props.onEdit).toHaveBeenCalledExactlyOnceWith('first', 'Edit first');
    expect(fields().map(field => field.value)).toEqual(['']);
    render({ commentScope: 'item:second' });
    expect(fields().map(field => field.value)).toEqual(['Draft second', 'Edit second']);
    click('Cancel');
    click('Edit comment');
    expect(fields()[1].value).toBe('Saved second');
    type(1, 'Discard with Escape');
    act(() => handlers(fields()[1]).onKeyDown!({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
    click('Edit comment');
    expect(fields()[1].value).toBe('Saved second');
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(props.onComment).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
  }
});

it('retries approval after a temporary input check failure without changing saved comments or reloading', async () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const expected = { sourceRevision: 'source-1', reviewRevision: 0, commentsDigest: 'comments-1', mapInputsDigest: 'map-1' };
  const status = (valid: boolean) => ({ ok: true, json: () => Promise.resolve({ ...expected, approval: { valid } }) });
  const fetch = vi.fn<(_url: string, options: RequestInit) => Promise<ReturnType<typeof status>>>()
    .mockResolvedValueOnce(status(false))
    .mockRejectedValueOnce(new Error('Temporary connection failure'))
    .mockResolvedValueOnce(status(false))
    .mockResolvedValueOnce(status(true));
  vi.stubGlobal('fetch', fetch);
  const container = create('div');
  const root = createRoot(container as unknown as HTMLElement);
  const button = (scope: Host, label: string) => all(scope).find(node => node.tagName === 'BUTTON' && handlers(node).children === label)!;
  try {
    await act(() => Promise.resolve(root.render(createElement(DesignApprovalProvider, {
      children: createElement('div', null,
        createElement('header', null, createElement(DesignApproval, { compact: true })),
        createElement(DesignApproval)),
    }))));
    const header = all(container).find(node => node.tagName === 'HEADER')!;
    const details = all(container).find(node => node.attributes['aria-label'] === 'Design approval')!;
    const dialog = all(container).find(node => node.tagName === 'DIALOG')!;
    act(() => handlers(button(details, 'Approve this version')).onClick!());
    await act(() => Promise.resolve(handlers(button(dialog, 'Approve this version')).onClick!()));
    expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'GET']);
    expect(button(header, 'Approve this version').attributes).not.toHaveProperty('disabled');
    expect(button(details, 'Approve this version').attributes).not.toHaveProperty('disabled');

    act(() => handlers(button(header, 'Approve this version')).onClick!());
    await act(() => Promise.resolve(handlers(button(dialog, 'Approve this version')).onClick!()));
    expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'GET', 'GET', 'POST']);
    const body = fetch.mock.calls[3][1].body;
    if (typeof body !== 'string') throw new Error('Approval must send a JSON string');
    expect(JSON.parse(body)).toEqual({ decision: 'approved', expected });
    expect(all(header).filter(node => node.tagName === 'BUTTON').map(node => handlers(node).children)).toContain('Approved');
    expect(all(details).filter(node => node.tagName === 'BUTTON').map(node => handlers(node).children)).toContain('Approved');
  } finally {
    act(() => root.unmount());
  }
});

it('keeps question drafts through tab and drawer unmounts, saves exact-input answers, and preserves stale drafts', async () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const expected = { sourceRevision: 'source-1', reviewRevision: 0, commentsDigest: 'before', mapInputsDigest: 'map-1' };
  let answer: string | undefined;
  let conflict = false;
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    if (options.method === 'POST') {
      if (conflict) return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Stale design answer; reload and reconcile.' }) });
      if (typeof options.body !== 'string') throw new Error('Answer must send JSON');
      answer = (JSON.parse(options.body) as { answer: string }).answer;
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...expected, mapInputsDigest: answer ? 'map-2' : 'map-1', openQuestions: answer ? [] : ['retry'], approval: { valid: false } }) });
  });
  vi.stubGlobal('fetch', fetch);
  const container = create('div');
  const root = createRoot(container as unknown as HTMLElement);
  let props: ComponentProps<typeof Drawer> = {
    open: true, setOpen: vi.fn(), view: 'questions', setView: vi.fn(), commentScope: 'all', setCommentScope: vi.fn(),
    questionScope: 'all', setQuestionScope: vi.fn(),
    selected: 'item:first', diagram: { nodes: [], edges: [], nodeToVisible: { first: 'item:first' } }, focusKey: 0,
    annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn(),
  };
  const render = async (next: Partial<ComponentProps<typeof Drawer>> = {}) => {
    props = { ...props, ...next };
    await act(() => Promise.resolve(root.render(createElement(DesignApprovalProvider, { children: createElement(Drawer, props) }))));
  };
  const field = () => all(container).find(node => node.tagName === 'TEXTAREA')!;
  const button = (label: string) => all(container).find(node => node.tagName === 'BUTTON' && handlers(node).children === label)!;
  const type = (text: string) => act(() => handlers(field()).onChange!({ target: { value: text } }));
  pack.designDocument = { id: 'document', name: 'Design', summary: 'Design summary', questions: [{ id: 'retry', target: { type: 'node', id: 'first' }, question: 'Retry after a conflict?' }] };
  try {
    await render();
    expect(field()).toBeUndefined();
    act(() => handlers(button('Expand all')).onClick!());
    type('Keep my pending answer.');
    await render({ view: 'details', selected: null });
    expect(field()).toBeUndefined();
    await render({ view: 'questions', selected: 'item:first' });
    act(() => handlers(button('Expand all')).onClick!());
    expect(field().value).toBe('Keep my pending answer.');
    await render({ open: false });
    await render({ open: true });
    act(() => handlers(button('Expand all')).onClick!());
    expect(field().value).toBe('Keep my pending answer.');
    conflict = true;
    type('Never discard this conflicting draft.');
    await act(() => Promise.resolve(handlers(button('Save answer')).onClick!()));
    expect(all(container).some(node => node.attributes.role === 'alert')).toBe(true);
    expect(field().value).toBe('Never discard this conflicting draft.');
    expect(button('View target details').attributes['aria-haspopup']).toBe('dialog');
    act(() => handlers(button('View target details')).onClick!());
    const dialog = all(container).find(node => node.tagName === 'DIALOG')!;
    expect(dialog?.attributes.open).toBe('');
    expect(props.setView).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(field().value).toBe('Never discard this conflicting draft.');
    const stopPropagation = vi.fn();
    act(() => handlers(dialog).onKeyDown!({ key: 'Escape', preventDefault: vi.fn(), stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledOnce();
    act(() => { handlers(button('Close')).onClick!(); handlers(dialog).onClose!(); });
    expect(all(container).some(node => node.attributes.class?.includes('target-details-modal'))).toBe(false);
    expect(field().value).toBe('Never discard this conflicting draft.');
    conflict = false;
    await act(() => Promise.resolve(handlers(button('Save answer')).onClick!()));
    const posts = fetch.mock.calls.filter(([, options]) => options.method === 'POST');
    const body = posts.at(-1)![1].body;
    if (typeof body !== 'string') throw new Error('Answer must send JSON');
    expect(JSON.parse(body)).toEqual({ questionId: 'retry', answer: 'Never discard this conflicting draft.', expected });
    // An answer resolves the node, so the question closes rather than offering an update.
    expect(field()).toBeUndefined();
    expect(button('Save answer')).toBeUndefined();
    expect(button('Collapse all')).toBeDefined();
  } finally { act(() => root.unmount()); delete pack.designDocument; }
});

it.each([true, false])('opens the shared inspector from detail sections without a question or changing the source disclosure (design=%s)', design => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const nodes = pack.graph.nodes, kind = pack.documentKind;
  pack.documentKind = design ? 'design' : undefined;
  pack.graph.nodes = [{ id: 'app', groupId: 'root', label: 'Application', summary: 'App summary', sourceRefs: [], technicalSummary: 'Canonical detail and concerns.' }];
  const container = create('div'), root = createRoot(container as unknown as HTMLElement);
  const props: ComponentProps<typeof Drawer> = { questionScope: 'all', setQuestionScope: vi.fn(), open: true, setOpen: vi.fn(), view: 'details', setView: vi.fn(), commentScope: 'all', setCommentScope: vi.fn(), selected: 'item:app', diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0, annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() };
  try {
    act(() => root.render(createElement(Drawer, props)));
    const disclosure = all(container).find(node => node.attributes.class === 'technical')!;
    const popout = all(disclosure).find(node => node.attributes['aria-label'] === 'Open details in modal')!;
    expect(popout, 'Detail sections need the same inspector as questions').toBeDefined();
    expect(popout.attributes['aria-haspopup']).toBe('dialog');
    expect(disclosure.attributes).not.toHaveProperty('open');
    const preventDefault = vi.fn(), stopPropagation = vi.fn();
    act(() => handlers(popout).onClick!({ preventDefault, stopPropagation }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    const modal = all(container).find(node => node.attributes.class?.includes('target-details-modal'))!;
    expect(modal.attributes.open).toBe('');
    expect(all(modal).find(node => node.attributes.class === 'technical')?.attributes.open).toBe('');
    expect(all(modal).some(node => node.textContent === 'Canonical detail and concerns.' || node.nodeValue === 'Canonical detail and concerns.')).toBe(true);
    expect(all(modal).some(node => node.attributes['aria-label'] === 'Open details in modal')).toBe(false);
    expect(disclosure.attributes).not.toHaveProperty('open');
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.setView).not.toHaveBeenCalled();
    act(() => handlers(modal).onClose!());
    expect(all(container).some(node => node.attributes.class?.includes('target-details-modal'))).toBe(false);
    expect(disclosure.attributes).not.toHaveProperty('open');
  } finally { act(() => root.unmount()); pack.graph.nodes = nodes; pack.documentKind = kind; }
});

it.each([false, true])('saves choice selections and Other through collapsed rows (multiple=%s)', async multiple => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const expected = { sourceRevision: 'source-1', reviewRevision: 0, commentsDigest: 'before', mapInputsDigest: 'map-1' };
  let saved: DesignAnswer | undefined;
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    if (options.method === 'POST') {
      if (typeof options.body !== 'string') throw new Error('Answer must send JSON');
      const body = JSON.parse(options.body) as DesignAnswer;
      saved = { questionId: body.questionId, answer: body.answer, choices: body.choices };
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...expected, openQuestions: saved ? [] : ['retry'], approval: { valid: false } }) });
  });
  vi.stubGlobal('fetch', fetch);
  const container = create('div');
  const root = createRoot(container as unknown as HTMLElement);
  const props: ComponentProps<typeof Drawer> = {
    open: true, setOpen: vi.fn(), view: 'questions', setView: vi.fn(), commentScope: 'all', setCommentScope: vi.fn(),
    questionScope: 'all', setQuestionScope: vi.fn(),
    selected: null, diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0,
    annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn(),
  };
  const countsSeen: Map<string, number>[] = [];
  function CountsProbe() { countsSeen.push(useQuestionCounts(props.diagram)); return null; }
  const button = (label: string) => all(container).find(node => node.tagName === 'BUTTON' && handlers(node).children === label)!;
  const inputs = () => all(container).filter(node => node.tagName === 'INPUT');
  const select = (index: number) => act(() => handlers(inputs()[index]).onChange!({ target: { value: '', checked: true } }));
  pack.designDocument = { id: 'document', name: 'Design', summary: 'Design summary', questions: [{ id: 'retry', target: { type: 'node', id: 'first' }, question: 'How should retry work?', choices: ['Yes', 'No'], multiple }] };
  try {
    await act(() => Promise.resolve(root.render(createElement(DesignApprovalProvider, { children: createElement('div', null, createElement(CountsProbe), createElement(Drawer, props)) }))));
    expect(countsSeen.length).toBeGreaterThan(1);
    expect(new Set(countsSeen).size).toBe(1);
    expect(inputs()).toHaveLength(0);
    act(() => handlers(button('Expand all')).onClick!());
    expect(inputs().map(input => handlers(input).type)).toEqual(Array<string>(3).fill(multiple ? 'checkbox' : 'radio'));
    expect(button('Save answer').attributes).toHaveProperty('disabled');
    select(0);
    select(1);
    expect(handlers(inputs()[0]).checked).toBe(multiple);
    select(2);
    act(() => handlers(all(container).find(node => node.tagName === 'TEXTAREA')!).onChange!({ target: { value: 'Keep the draft and ask again.' } }));
    act(() => handlers(button('Collapse all')).onClick!());
    expect(inputs()).toHaveLength(0);
    act(() => handlers(button('Expand all')).onClick!());
    expect(all(container).find(node => node.tagName === 'TEXTAREA')?.value).toBe('Keep the draft and ask again.');
    await act(() => Promise.resolve(handlers(button('Save answer')).onClick!()));
    expect(saved).toEqual({ questionId: 'retry', answer: 'Keep the draft and ask again.', choices: multiple ? ['Yes', 'No'] : [] });
    expect(countsSeen.at(-1)?.size).toBe(0);
    expect(inputs()).toHaveLength(0);
    const firstPost = fetch.mock.calls.find(([, options]) => options.method === 'POST')?.[1].body;
    if (typeof firstPost !== 'string') throw new Error('Missing answer request');
    expect(JSON.parse(firstPost)).toEqual({ questionId: 'retry', answer: 'Keep the draft and ask again.', choices: multiple ? ['Yes', 'No'] : [], expected });
  } finally { act(() => root.unmount()); delete pack.designDocument; }
});

it('shares one confirmation and approval result between header and document controls', async () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let approved = false;
  const expected = { sourceRevision: 'source-1', reviewRevision: 0, commentsDigest: 'comments-1', mapInputsDigest: 'map-1' };
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    if (options.method === 'POST') approved = true;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...expected, approval: { valid: approved } }) });
  });
  vi.stubGlobal('fetch', fetch);
  const container = create('div');
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(() => Promise.resolve(root.render(createElement(DesignApprovalProvider, {
      children: createElement('div', null,
        createElement('header', null, createElement(DesignApproval, { compact: true })),
        createElement(DesignApproval)),
    }))));
    expect(fetch).toHaveBeenCalledTimes(1);
    const dialog = all(container).find(node => node.tagName === 'DIALOG')!;
    const button = (scope: Host, label: string) => all(scope).find(node => node.tagName === 'BUTTON' && handlers(node).children === label)!;
    const header = all(container).find(node => node.tagName === 'HEADER')!;
    const details = all(container).find(node => node.attributes['aria-label'] === 'Design approval')!;
    act(() => handlers(button(header, 'Approve this version')).onClick!());
    expect(dialog.attributes.open).toBe('');
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
    act(() => handlers(button(dialog, 'Cancel')).onClick!());
    expect(dialog.attributes.open).toBeUndefined();
    act(() => handlers(button(details, 'Approve this version')).onClick!());
    expect(all(container).filter(node => node.tagName === 'DIALOG' && node.attributes['aria-labelledby'] === 'design-approval-title')).toHaveLength(1);
    expect(dialog.attributes.open).toBe('');
    await act(() => Promise.resolve(handlers(button(dialog, 'Approve this version')).onClick!()));
    const posts = fetch.mock.calls.filter(([, options]) => options.method === 'POST');
    expect(posts).toHaveLength(1);
    const body = posts[0][1].body;
    if (typeof body !== 'string') throw new Error('Approval must send a JSON string');
    expect(JSON.parse(body)).toEqual({ decision: 'approved', expected });
    expect(button(header, 'Approved')).toBeDefined();
    expect(button(details, 'Approved')).toBeDefined();
    expect(dialog.attributes.open).toBeUndefined();
  } finally {
    act(() => root.unmount());
  }
});

it('locks a loose element from its drawer against the exact tuple shown', async () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const expected = { sourceRevision: 'source-1', reviewRevision: 0, commentsDigest: 'before', mapInputsDigest: 'map-1' };
  let locked: string[] = [];
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    if (options.method === 'POST' && typeof options.body === 'string') locked = [(JSON.parse(options.body) as { lock: string }).lock];
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...expected, openQuestions: [], locked, approval: { valid: false } }) });
  });
  vi.stubGlobal('fetch', fetch);
  const nodes = pack.graph.nodes;
  pack.graph.nodes = [{ id: 'app', groupId: 'root', label: 'Application', summary: 'App summary', sourceRefs: [], locked: false }];
  const container = create('div'), root = createRoot(container as unknown as HTMLElement);
  const props: ComponentProps<typeof Drawer> = { questionScope: 'all', setQuestionScope: vi.fn(), open: true, setOpen: vi.fn(), view: 'details', setView: vi.fn(), commentScope: 'all', setCommentScope: vi.fn(), selected: 'item:app', diagram: { nodes: [], edges: [], nodeToVisible: {} }, focusKey: 0, annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn() };
  const pill = () => all(container).find(node => node.attributes['data-locked'] !== undefined)!;
  const lock = () => all(container).find(node => node.tagName === 'BUTTON' && handlers(node).children === 'Lock');
  try {
    await act(() => Promise.resolve(root.render(createElement(DesignApprovalProvider, { children: createElement(Drawer, props) }))));
    expect(handlers(pill()).children).toBe('Loose');
    await act(() => Promise.resolve(handlers(lock()!).onClick!()));
    const body = fetch.mock.calls.find(([, options]) => options.method === 'POST')?.[1].body;
    if (typeof body !== 'string') throw new Error('Lock must send JSON');
    expect(JSON.parse(body)).toEqual({ lock: 'app', expected });
    expect(handlers(pill()).children).toBe('Locked');
    expect(lock()).toBeUndefined();
  } finally { act(() => root.unmount()); pack.graph.nodes = nodes; }
});

it('lists approval blockers in a modal that links to each one, and sends lock captures', async () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const expected = { sourceRevision: 'source-1', reviewRevision: 0, commentsDigest: 'before', mapInputsDigest: 'map-1' };
  const blocker = { kind: 'question', targetId: 'app', label: 'Retry after a conflict?', nodeId: '104' };
  let blockers = [blocker];
  const posts: unknown[] = [];
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    if (options.method === 'POST' && typeof options.body === 'string') posts.push(JSON.parse(options.body));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...expected, openQuestions: ['104'], locked: [], blockers, approval: { valid: false, reason: blockers.length ? 'Open questions target this design' : 'This revision is not approved' } }) });
  });
  vi.stubGlobal('fetch', fetch);
  const nodes = pack.graph.nodes;
  pack.graph.nodes = [{ id: 'app', groupId: 'root', label: 'Application', summary: 'App summary', sourceRefs: [], locked: false }];
  const navigated: unknown[] = [];
  const capture = () => ({ variant: 'compact' });
  function Probe() { useBlockerNavigation(target => navigated.push(target)); useLockCapture('app', capture); return null; }
  const container = create('div'), root = createRoot(container as unknown as HTMLElement);
  const button = (label: string) => all(container).find(node => node.tagName === 'BUTTON' && handlers(node).children === label);
  const dialog = () => all(container).find(node => node.tagName === 'DIALOG' && node.attributes['aria-labelledby'] === 'design-blockers-title')!;
  const render = () => act(() => Promise.resolve(root.render(createElement(DesignApprovalProvider, { children: createElement('div', null, createElement(Probe), createElement(DesignApproval), createElement(ElementLock, { id: 'app', locked: false })) }))));
  try {
    await render();
    act(() => handlers(button('Approve this version')!).onClick!());
    expect(dialog().attributes.open).toBe('');
    act(() => handlers(button('Retry after a conflict?')!).onClick!());
    expect(navigated).toEqual([blocker]);
    expect(dialog().attributes).not.toHaveProperty('open');
    await act(() => Promise.resolve(handlers(button('Lock')!).onClick!()));
    expect(posts.at(-1)).toEqual({ lock: 'app', capture: { variant: 'compact' }, expected });
    blockers = [];
    await render();
    await act(() => Promise.resolve(handlers(all(container).filter(node => node.tagName === 'BUTTON' && handlers(node).children === 'Approve this version').at(-1)!).onClick!()));
    expect(posts.at(-1)).toEqual({ decision: 'approved', captures: { app: { variant: 'compact' } }, expected });
  } finally { act(() => root.unmount()); pack.graph.nodes = nodes; }
});

it('offers one-click re-approval for an element changed since approval', async () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const expected = { sourceRevision: 'source-1', reviewRevision: 0, commentsDigest: 'before', mapInputsDigest: 'map-1' };
  let blockers = [{ kind: 'changed', targetId: 'app', label: 'Application', nodeId: 'app' }];
  const posts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    if (options.method === 'POST' && typeof options.body === 'string') { posts.push(JSON.parse(options.body)); blockers = []; }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...expected, openQuestions: [], locked: blockers.length ? [] : ['app'], blockers, approval: { valid: false } }) });
  }));
  const nodes = pack.graph.nodes;
  pack.graph.nodes = [{ id: 'app', groupId: 'root', label: 'Application', summary: 'App summary', sourceRefs: [], locked: false }];
  const container = create('div'), root = createRoot(container as unknown as HTMLElement);
  const buttons = (label: string) => all(container).filter(node => node.tagName === 'BUTTON' && handlers(node).children === label);
  const pill = () => all(container).find(node => node.attributes['data-locked'] !== undefined)!;
  try {
    await act(() => Promise.resolve(root.render(createElement(DesignApprovalProvider, { children: createElement('div', null, createElement(DesignApproval), createElement(ElementLock, { id: 'app', locked: false })) }))));
    expect(handlers(pill()).children).toBe('Changed since approval');
    act(() => handlers(buttons('Approve this version')[0]).onClick!());
    // One Re-approve in the blocker modal and one in the element's drawer.
    expect(buttons('Re-approve')).toHaveLength(2);
    await act(() => Promise.resolve(handlers(buttons('Re-approve')[0]).onClick!()));
    expect(posts).toEqual([{ lock: 'app', expected }]);
    expect(handlers(pill()).children).toBe('Locked');
    expect(buttons('Re-approve')).toHaveLength(0);
  } finally { act(() => root.unmount()); pack.graph.nodes = nodes; }
});

it('keeps the drawer view, expanded rows, and drafts when a rebuilt pack swaps in', () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  const create = (name: string) => Object.assign(new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, innerWidth: 1360, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = create('div');
  const root = createRoot(container as unknown as HTMLElement);
  const original = pack.designDocument;
  pack.designDocument = { id: 'live', name: 'Design', summary: 'Design summary', questions: [{ id: 'first', target: { type: 'node', id: 'first' }, question: 'Question first' }] };
  const props: ComponentProps<typeof Drawer> = {
    open: true, setOpen: vi.fn(), view: 'questions', setView: vi.fn(), commentScope: 'all', setCommentScope: vi.fn(), questionScope: 'all', setQuestionScope: vi.fn(),
    selected: 'item:first', diagram: { nodes: [], edges: [], nodeToVisible: { first: 'item:first', second: 'item:second' } }, focusKey: 0,
    annotations: [], setAnnotations: vi.fn(), onEdit: vi.fn(), onSelect: vi.fn(), onComment: vi.fn(), onOpenGroup: vi.fn(),
  };
  const render = () => act(() => root.render(createElement(Drawer, props)));
  const summary = (id: string) => all(container).find(node => node.tagName === 'BUTTON' && node.attributes['aria-label'] === `Question ${id}`);
  try {
    render();
    act(() => handlers(summary('first')!).onClick?.());
    act(() => handlers(all(container).find(node => node.tagName === 'TEXTAREA')!).onChange?.({ target: { value: 'Unsent answer' } }));
    // The swap replaces the data and re-renders; nothing remounts.
    pack.designDocument = { ...pack.designDocument, questions: [...pack.designDocument.questions!, { id: 'second', target: { type: 'node', id: 'second' }, question: 'Question second' }] };
    render();
    expect(summary('second')).toBeDefined();
    expect(summary('first')!.attributes['aria-expanded']).toBe('true');
    expect(all(container).find(node => node.tagName === 'TEXTAREA')!.value).toBe('Unsent answer');
  } finally { act(() => root.unmount()); pack.designDocument = original; }
});
