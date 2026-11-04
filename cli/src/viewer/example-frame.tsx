import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { BridgeHost, type FrameLike } from './od-bridge/host.js';
import type { FrameMessage, Mark, Selection, TweakPayload } from './od-bridge/protocol.js';
import { exampleDocument } from './examples.js';

export type FrameStatusValue = { state: 'loading' | 'ready' | 'closed' | 'mismatch' } | { state: 'error'; message: string };
export type FrameEvents = {
  onPicker: (on: boolean) => void;
  onSelection: (selections: Selection[]) => void;
  onMarkClick: (key: string) => void;
  onRevealed: (key: string, found: boolean) => void;
  onEscape: () => void;
};
// One-off commands for the frame; `reveal` reports back through onRevealed.
export type FrameControl = { reveal: (key: string) => void; removeSelection: (id: number) => void; clearSelections: () => void };

// The bridge has no way to remove its load listener, so a disposed bridge must stop hearing loads.
function liveFrame(element: HTMLIFrameElement, alive: () => boolean): FrameLike {
  return {
    get contentWindow() { return element.contentWindow; },
    setAttribute: (name, value) => element.setAttribute(name, value),
    addEventListener: (type, listener) => element.addEventListener(type, () => { if (alive()) listener(); }),
  };
}

// Mount with a key per document: the bridge counts this iframe's loads, so a new document needs a new iframe.
export function ExampleFrame({ html, title, picker, marks, tweaks, control, events }: {
  html: string;
  title: string;
  picker: boolean;
  marks: Mark[];
  tweaks: TweakPayload;
  control: RefObject<FrameControl | null>;
  events: FrameEvents;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const host = useRef<BridgeHost | null>(null);
  const latest = useRef({ picker, marks, tweaks, events });
  latest.current = { picker, marks, tweaks, events };
  const revealing = useRef<string | null>(null);
  const [status, setStatus] = useState<FrameStatusValue>({ state: 'loading' });

  // A layout effect starts the load before any frame task can run, so the bridge sees every load.
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    let alive = true;
    const bridge: BridgeHost = new BridgeHost({
      frame: liveFrame(element, () => alive),
      onClosed: () => setStatus({ state: 'closed' }),
      onVersionMismatch: () => setStatus({ state: 'mismatch' }),
      onMessage: message => handle(bridge, message),
    });
    host.current = bridge;
    control.current = {
      reveal: key => { revealing.current = key; bridge.send('reveal', { key }); },
      removeSelection: id => bridge.send('selection-remove', { id }),
      clearSelections: () => bridge.send('selection-clear'),
    };
    const receive = (event: MessageEvent) => bridge.receive(event);
    window.addEventListener('message', receive);
    bridge.load(() => { element.srcdoc = exampleDocument(html); });
    return () => { alive = false; host.current = null; control.current = null; window.removeEventListener('message', receive); };
  }, []);

  const handle = (bridge: BridgeHost, message: FrameMessage) => {
    const { events, marks, tweaks, picker } = latest.current;
    switch (message.type) {
      case 'ready': bridge.init({ tokens: [], tweaks, picker, keys: ['escape'], marks }); break;
      case 'applied': setStatus({ state: 'ready' }); bridge.send('marks', { items: marks }); break;
      case 'selection': events.onSelection(message.items); break;
      case 'picker': events.onPicker(false); break;
      case 'key': if (message.combo === 'escape') events.onEscape(); break;
      case 'mark-click': events.onMarkClick(message.key); break;
      case 'revealed': if (revealing.current) events.onRevealed(revealing.current, message.found); revealing.current = null; break;
      case 'error': setStatus({ state: 'error', message: message.message }); break;
    }
  };

  useEffect(() => { host.current?.setPicker(picker); }, [picker]);
  const markKey = JSON.stringify(marks);
  useEffect(() => { host.current?.send('marks', { items: marks }); }, [markKey]);
  const tweakKey = JSON.stringify(tweaks);
  // Tweak edits never reload the frame; they resend `tweaks`.
  useEffect(() => { host.current?.send('tweaks', { ...tweaks }); }, [tweakKey]);

  return (
    <div className="example-frame">
      <FrameStatus status={status} />
      {/* Never add allow-same-origin: the frame would gain the viewer's origin and its write API. */}
      <iframe ref={frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" className={status.state === 'loading' ? 'loading' : undefined} />
    </div>
  );
}

// Frame-supplied text renders as text only.
export function FrameStatus({ status }: { status: FrameStatusValue }) {
  if (status.state === 'closed') return <p role="alert">This example navigated away and was stopped.</p>;
  if (status.state === 'mismatch') return <p role="alert">This example was built for a different OpenDesigner version; rebuild it.</p>;
  if (status.state === 'error') return <div role="alert"><p>This example failed to render.</p><pre>{status.message}</pre></div>;
  return null;
}
