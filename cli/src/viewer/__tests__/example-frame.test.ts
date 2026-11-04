import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ExampleFrame, SNAPSHOT_WAIT_MS, type FrameControl } from '../example-frame.js';
import { OD_VERSION } from '../od-bridge/protocol.js';

// Minimal host DOM for React's real reconciler, with an iframe that records what the bridge sends and loads.
class Host {
  nodeType = 1;
  tagName: string;
  nodeName: string;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  parentNode: Host | null = null;
  childNodes: Host[] = [];
  style = { setProperty: vi.fn() };
  attributes: Record<string, string> = {};
  textContent = '';
  nodeValue: string | null = null;
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
  addEventListener(...args: unknown[]) { void args; }
  removeEventListener() {}
  get firstChild(): Host | null { return this.childNodes[0] ?? null; }
}
const log: string[] = [];
class Frame extends Host {
  sent: Array<Record<string, unknown>> = [];
  loads: Array<() => void> = [];
  contentWindow = { postMessage: (data: Record<string, unknown>) => { this.sent.push(data); log.push(`send ${String(data.type)}`); } };
  set srcdoc(value: string) { log.push(`load ${value.includes('second build') ? 'second' : 'first'}`); }
  // React also listens for iframe loads, with a capture flag; the bridge's listener has none.
  addEventListener(type: string, listener: () => void, options?: unknown) { if (type === 'load' && options === undefined) this.loads.push(listener); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); log.length = 0; });

it('reloads a rebuilt example through snapshot, then restore keyed to its path', async () => {
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  let frame: Frame | undefined;
  const create = (name: string) => {
    const node = name === 'iframe' ? (frame = new Frame(name)) : new Host(name);
    return Object.assign(node, { ownerDocument: document });
  };
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  let receive: ((event: unknown) => void) | undefined;
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, addEventListener: (_: string, listener: (event: unknown) => void) => { receive = listener; }, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 0; });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = new Host('div');
  container.ownerDocument = document;
  const root = createRoot(container as unknown as HTMLElement);
  const control = createRef<FrameControl>();
  const events = { onPicker: vi.fn(), onSelection: vi.fn(), onMarkClick: vi.fn(), onRevealed: vi.fn(), onEscape: vi.fn() };
  const render = (html: string) => act(() => root.render(createElement(ExampleFrame, { path: 'home.html', html, title: 'Home', picker: false, marks: [], tweaks: { vars: {}, attrs: {} }, control, events })));
  const fromFrame = (data: Record<string, unknown>) => act(() => receive?.({ source: frame!.contentWindow, origin: 'null', data: { od: OD_VERSION, ...data } }));
  const session = () => frame!.sent.at(-1)?.session;
  const load = () => act(() => { for (const listener of frame!.loads) listener(); });
  try {
    render('<p>first build</p>');
    load();
    fromFrame({ type: 'ready', page: 'home', variant: null, capabilities: [] });
    const first = frame!.sent.find(message => message.type === 'init')!;
    expect(first.restore).toBeUndefined();
    fromFrame({ type: 'selection', session: first.session, items: [] });
    render('<p>second build</p>');
    expect(log.at(-1)).toBe('send snapshot-request');
    fromFrame({ type: 'snapshot', session: session(), scroll: { x: 0, y: 640 }, app: { tab: 'notes' } });
    await act(() => Promise.resolve());
    expect(log.slice(-2)).toEqual(['send snapshot-request', 'load second']);
    load();
    fromFrame({ type: 'ready', page: 'home', variant: null, capabilities: [] });
    const second = frame!.sent.filter(message => message.type === 'init').at(-1)!;
    expect(second.restore).toEqual({ scroll: { x: 0, y: 640 }, selections: [], app: { tab: 'notes' } });
    expect(second.session).not.toBe(first.session);
  } finally { act(() => root.unmount()); }
});

it('reloads with the last scroll when the old frame never answers the snapshot', async () => {
  vi.useFakeTimers();
  const document = new Host('#document');
  document.nodeType = 9;
  document.ownerDocument = document;
  let frame: Frame | undefined;
  const create = (name: string) => Object.assign(name === 'iframe' ? (frame = new Frame(name)) : new Host(name), { ownerDocument: document });
  Object.assign(document, { createElement: create, createElementNS: (_: string, name: string) => create(name), createTextNode: (text: string) => Object.assign(create('#text'), { nodeType: 3, nodeValue: text }), activeElement: null });
  let receive: ((event: unknown) => void) | undefined;
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { document, addEventListener: (_: string, listener: (event: unknown) => void) => { receive = listener; }, removeEventListener() {}, HTMLIFrameElement: class {} });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 0; });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = Object.assign(new Host('div'), { ownerDocument: document });
  const root = createRoot(container as unknown as HTMLElement);
  const events = { onPicker: vi.fn(), onSelection: vi.fn(), onMarkClick: vi.fn(), onRevealed: vi.fn(), onEscape: vi.fn() };
  const render = (html: string) => act(() => root.render(createElement(ExampleFrame, { path: 'quiet.html', html, title: 'Quiet', picker: false, marks: [], tweaks: { vars: {}, attrs: {} }, control: createRef<FrameControl>(), events })));
  const fromFrame = (data: Record<string, unknown>) => act(() => receive?.({ source: frame!.contentWindow, origin: 'null', data: { od: OD_VERSION, ...data } }));
  const load = () => act(() => { for (const listener of frame!.loads) listener(); });
  try {
    render('<p>first build</p>');
    load();
    fromFrame({ type: 'ready', page: 'quiet', variant: null, capabilities: [] });
    fromFrame({ type: 'scroll', session: frame!.sent.at(-1)!.session, x: 0, y: 120 });
    render('<p>second build</p>');
    expect(log.includes('load second')).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(SNAPSHOT_WAIT_MS); });
    expect(log.at(-1)).toBe('load second');
    load();
    fromFrame({ type: 'ready', page: 'quiet', variant: null, capabilities: [] });
    expect(frame!.sent.filter(message => message.type === 'init').at(-1)!.restore).toEqual({ scroll: { x: 0, y: 120 }, selections: [] });
  } finally { act(() => root.unmount()); }
});
