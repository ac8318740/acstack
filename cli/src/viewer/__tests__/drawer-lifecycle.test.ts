import { createElement, act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Drawer } from '../drawer.js';

vi.mock('../pack.js', () => ({
  diagramId: (target: { id: string }) => `item:${target.id}`,
  targetLabel: (target: { id: string }) => target.id,
  pack: { graph: { nodes: [], edges: [], groups: [] }, source: { references: [] } },
}));
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
  focus() {}
  get firstChild(): Host | null { return this.childNodes[0] ?? null; }
  get lastChild(): Host | null { return this.childNodes.at(-1) ?? null; }
}
type Handlers = { children?: string; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; onKeyDown?: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => void };
function handlers(host: Host): Handlers {
  const key = Object.keys(host).find(key => key.startsWith('__reactProps$'))!;
  return (host as unknown as Record<string, Handlers>)[key];
}
function all(host: Host): Host[] { return [host, ...host.childNodes.flatMap(all)]; }
afterEach(() => vi.unstubAllGlobals());

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
    open: true, setOpen: vi.fn(), view: 'comments', setView: vi.fn(), commentScope: 'item:first', setCommentScope: vi.fn(),
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
