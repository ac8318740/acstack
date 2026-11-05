import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, MousePointerClick, SlidersHorizontal, X } from 'lucide-react';
import { Dropdown } from './dropdown.js';
import { MockFrame, type FrameControl } from './mock-frame.js';
import { useDesignReview } from './design-approval.js';
import { cacheMock, cachedMock, mockCapture, isCurrent, mockView, fixtureTable, setMockView, valuesOf, withVariant, type ElementMock, type MockView } from './mocks.js';
import type { MockSummary } from '../lib/alignment-packs.js';
import { REVIEW_TOKEN_HEADER } from '../lib/alignment-review-protocol.js';
import type { Selection } from './od-bridge/protocol.js';
import { defaultFor, tweakPayload, type Tweak } from './od-bridge/tweaks.js';
import { type Annotation, annotationId, pack, token } from './pack.js';
import { SidebarMarkdown } from './sidebar-markdown.js';

const KIND_LABELS: Record<ElementMock['kind'], string> = { html: 'Mock', 'od-build': 'Mock', markdown: 'Document', fixture: 'Sample data' };

export const mocksFor = (nodeId: string): MockSummary[] => pack.graph.nodes.find(node => node.id === nodeId)?.mocks ?? [];

// Content loads on open, behind the review token, so large builds never sit in the page.
async function fetchMock(nodeId: string, summary: MockSummary): Promise<ElementMock> {
  if (!token) throw new Error('Mocks open only in the live review that `acstack design-doc` serves.');
  const response = await fetch(`/api/mocks?element=${encodeURIComponent(nodeId)}&path=${encodeURIComponent(summary.path)}`, { headers: { [REVIEW_TOKEN_HEADER]: token } });
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Cannot load this mock');
  const mock = { ...body, path: summary.path, title: summary.title, ...(summary.illustrative && { illustrative: true }) } as ElementMock;
  cacheMock(nodeId, mock, summary.revision);
  return mock;
}
function useMock(nodeId: string, summary: MockSummary) {
  const [state, setState] = useState<{ path: string; error?: string }>({ path: summary.path });
  const [, loaded] = useState(0);
  useEffect(() => {
    // A changed source keeps showing the last content until the new one arrives, so the frame reloads in place.
    if (isCurrent(nodeId, summary)) return;
    let live = true;
    setState({ path: summary.path });
    fetchMock(nodeId, summary).then(() => { if (live) loaded(count => count + 1); }, (error: unknown) => { if (live) setState({ path: summary.path, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [nodeId, summary.path, summary.revision]);
  return { mock: cachedMock(nodeId, summary.path), error: state.path === summary.path ? state.error : undefined };
}
type Comments = { annotations: Annotation[]; setAnnotations: (annotations: Annotation[]) => void };

const commentsOn = (annotations: Annotation[], nodeId: string, path: string) =>
  annotations.filter(annotation => annotation.target.type === 'node' && annotation.target.id === nodeId && annotation.mock?.path === path);

// Opens one mock, optionally on one variant, from a link such as an approval blocker.
// `comment` names a comment to reveal once the mock has loaded.
export type MockLink = { nodeId: string; path: string; variant?: string; comment?: string };

// Registers every element's mock capture once, so Lock and approval record it whichever drawer tab is showing.
export function useMockCaptures() {
  const review = useDesignReview();
  useEffect(() => {
    if (!review) return;
    const captures = review.captures.current;
    const ids = pack.graph.nodes.map(node => node.id).filter(id => mocksFor(id).some(mock => mock.kind === 'od-build'));
    for (const id of ids) captures.set(id, () => mockCapture(id, mocksFor(id).flatMap(summary => cachedMock(id, summary.path) ?? [])));
    return () => { for (const id of ids) captures.delete(id); };
  }, [review]);
}

/** Lists the mocks of each element in `nodeIds`, labelled by element; a click opens that mock's modal. */
export function MocksTab({ nodeIds, empty, link, annotations, setAnnotations }: { nodeIds: string[]; empty: string; link?: MockLink } & Comments) {
  const follow = (target?: MockLink) => {
    // A link opens even before the filter catches up with the element it selects.
    if (!target || !mocksFor(target.nodeId).some(mock => mock.path === target.path)) return null;
    if (target.variant) setMockView(target.nodeId, target.path, { ...mockView(target.nodeId, target.path), variant: target.variant });
    return { nodeId: target.nodeId, path: target.path };
  };
  const [open, setOpen] = useState<{ nodeId: string; path: string } | null>(() => follow(link));
  const [revealComment, setRevealComment] = useState(link?.comment);
  useEffect(() => { const target = follow(link); if (target) { setOpen(target); setRevealComment(link?.comment); } }, [link]);
  const listed = nodeIds.filter(nodeId => mocksFor(nodeId).length);
  if (!listed.length) return <p className="muted">{empty}</p>;
  return (
    <section className="section">
      {listed.map(nodeId => (
        <div key={nodeId} className="mock-group">
          <h3 className="mock-group-title">{pack.graph.nodes.find(node => node.id === nodeId)?.label ?? nodeId}</h3>
          <ul className="mock-list">
            {mocksFor(nodeId).map(mock => {
              const count = commentsOn(annotations, nodeId, mock.path).length;
              return (
                <li key={mock.path}>
                  <button type="button" className="relationship-link mock-link" aria-haspopup="dialog" onClick={() => { setRevealComment(undefined); setOpen({ nodeId, path: mock.path }); }}>
                    <span><span className="relationship-label">{mock.title}</span><span className="relationship-endpoint">{KIND_LABELS[mock.kind]}{mock.illustrative ? ', illustrative' : ''}{count ? `, ${count} comment${count === 1 ? '' : 's'}` : ''}</span></span><ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {open && <MocksModal key={open.nodeId} nodeId={open.nodeId} mocks={mocksFor(open.nodeId)} path={open.path} reveal={revealComment} onPath={path => setOpen({ nodeId: open.nodeId, path })} onClose={() => setOpen(null)} annotations={annotations} setAnnotations={setAnnotations} />}
    </section>
  );
}

export function FixtureView({ format, data }: { format: 'json' | 'csv'; data: string }) {
  const table = fixtureTable(format, data);
  if ('error' in table) return <p role="alert">{table.error}</p>;
  return (
    <div className="fixture-table">
      <table>
        <thead><tr>{table.columns.map((column, index) => <th key={index} scope="col"><code>{column}</code></th>)}</tr></thead>
        <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Frame-supplied fields are untrusted: they appear as plain text only.
type Anchor = NonNullable<Annotation['mock']>;
type AnchorSelection = NonNullable<Anchor['selections']>[number];
// Labels read as plain words: "PayButton" becomes "Pay button", and a container's run of text
// gives way to its first line, which is its heading or label. The raw name stays in a tooltip.
export const componentLabel = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/ ([A-Z])(?=[a-z])/g, (_, letter: string) => ` ${letter.toLowerCase()}`).trim();
// A table row's innerText separates cells with tabs, so its first cell (the item name) leads the label.
const brief = (text: string) => { const line = text.split(/[\n\t]/).map(part => part.trim()).find(Boolean) ?? ''; return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line; };
export const describe = (selection: { selector: string; text?: string; component?: { name: string } }) => {
  const text = brief(selection.text ?? '');
  if (selection.component) return text ? `${componentLabel(selection.component.name)}: ${text}` : componentLabel(selection.component.name);
  return text || 'Element';
};
const rawName = (selection: { selector: string; component?: { name: string } }) => selection.component?.name ?? selection.selector;
const anchorLabel = (anchor: Anchor) => anchor.selections?.length ? anchor.selections.map(describe).join('; ') : 'Whole mock';
// Keys follow ReviewAnnotationSchema's order, because the save acknowledgement compares the server's parsed copy as JSON.
const anchorSelection = ({ selector, text, rect, component }: Selection): AnchorSelection => ({
  selector, ...(text ? { text } : {}), rect,
  ...(component ? { component: { name: component.name, ...(component.source ? { source: component.source } : {}), ...(component.props ? { props: component.props } : {}), ...(component.fixture ? { fixture: component.fixture } : {}) } } : {}),
});

// ACStack draws OpenDesigner's tweak controls; the frame only applies the payload the host computes.
export function TweakControls({ tweaks, values, onChange }: { tweaks: Tweak[]; values: Record<string, string>; onChange: (id: string, value: string) => void }) {
  const fieldId = useId();
  if (!tweaks.length) return null;
  return (
    <div className="mock-tweaks">
      {tweaks.map(tweak => {
        const id = `${fieldId}-${tweak.id}`;
        const value = values[tweak.id] ?? defaultFor(tweak);
        if (tweak.type === 'select' || tweak.type === 'state') {
          const options = (tweak.options ?? []).map(option => typeof option === 'string' ? { value: option, label: option } : option);
          return <div key={tweak.id} className="tweak-row"><span className="tweak-label">{tweak.label}</span><Dropdown label={tweak.label} value={value} options={options} onChange={next => onChange(tweak.id, next)} /></div>;
        }
        if (tweak.type === 'toggle') return <label key={tweak.id} className="tweak-row tweak-toggle"><span className="tweak-label">{tweak.label}</span><input type="checkbox" role="switch" checked={value === '1' || value === (tweak.on ?? '1')} onChange={event => onChange(tweak.id, event.target.checked ? '1' : '0')} /></label>;
        return (
          <div key={tweak.id} className="tweak-row">
            <label className="tweak-label" htmlFor={id}>{tweak.label}{tweak.type === 'slider' && <span className="tweak-value">{value}{tweak.unit ?? ''}</span>}</label>
            {tweak.type === 'slider' ? <input id={id} type="range" min={tweak.min ?? 0} max={tweak.max ?? 100} step={tweak.step ?? 1} value={value} onChange={event => onChange(tweak.id, event.target.value)} />
              : tweak.type === 'color' ? <div className="tweak-color"><input id={id} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={event => onChange(tweak.id, event.target.value)} /><span>{value}</span></div>
                : <input id={id} type="text" value={value} onChange={event => onChange(tweak.id, event.target.value)} />}
          </div>
        );
      })}
    </div>
  );
}

// A native popover: the browser gives it light dismiss and Escape, and it stays in the dialog's top layer.
function TweaksPopover({ tweaks, values, onChange }: { tweaks: Tweak[]; values: Record<string, string>; onChange: (id: string, value: string) => void }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<CSSProperties>();
  return <>
    <button ref={button} type="button" className="btn" popoverTarget={id} aria-haspopup="dialog"><SlidersHorizontal size={16} aria-hidden="true" />Tweaks</button>
    <div id={id} popover="auto" role="dialog" aria-label="Tweaks" className="tweaks-popover" style={place}
      onToggle={event => {
        if ((event as unknown as ToggleEvent).newState !== 'open' || !button.current) return;
        const rect = button.current.getBoundingClientRect();
        setPlace({ top: rect.bottom + 6, left: Math.max(8, rect.right - 320) });
      }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      <TweakControls tweaks={tweaks} values={values} onChange={onChange} />
    </div>
  </>;
}

function Composer({ label, placeholder, text, onText, onPost }: { label: string; placeholder: string; text: string; onText: (text: string) => void; onPost: (text: string) => void }) {
  const id = useId();
  const post = () => { if (text.trim()) onPost(text.trim()); };
  return (
    <div className="mock-composer">
      <label className="visually-hidden" htmlFor={id}>{label}</label>
      <textarea id={id} rows={3} value={text} placeholder={placeholder} onChange={event => onText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); post(); } }} />
      <div className="row between">
        <span className="hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd></span>
        <button type="button" className="btn primary" disabled={!text.trim()} onClick={post}>Post comment</button>
      </div>
    </div>
  );
}

export function MocksModal({ nodeId, mocks, path, reveal, onPath, onClose, annotations, setAnnotations }: {
  nodeId: string;
  mocks: MockSummary[];
  path: string;
  reveal?: string;
  onPath: (path: string) => void;
  onClose: () => void;
} & Comments) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<FrameControl | null>(null);
  const titleId = useId();
  const summary = mocks.find(item => item.path === path) ?? mocks[0];
  const { mock: content, error } = useMock(nodeId, summary);
  const mock = content ?? summary;
  const [shown, setShown] = useState(() => ({ path: mock.path, view: mockView(nodeId, mock.path) }));
  const view = shown.path === mock.path ? shown.view : mockView(nodeId, mock.path);
  const updateView = (next: MockView) => { setMockView(nodeId, mock.path, next); setShown({ path: mock.path, view: next }); };
  // Opening a mock counts as having it on screen, which is what a lock captures.
  useEffect(() => { setMockView(nodeId, mock.path, mockView(nodeId, mock.path)); }, [mock.path]);
  const variant = content?.kind === 'od-build' ? content.variants.find(item => item.id === view.variant) ?? content.variants[0] : undefined;
  const html = content?.kind === 'html' ? content.html : content?.kind === 'od-build' && variant ? withVariant(content.html, variant.id) : undefined;
  const tweaks = content?.kind === 'od-build' ? [...content.tweaks ?? [], ...variant?.tweaks ?? []] : [];
  const tokens = content?.kind === 'od-build' && content.tokens ? new Map(Object.entries(content.tokens)) : null;
  const values = valuesOf(view, variant?.id);
  const setValue = (id: string, value: string) => updateView({ ...view, values: { ...view.values, [variant?.id ?? '']: { ...values, [id]: value } } });
  const review = useDesignReview();
  const chosen = review?.chosenVariant(nodeId, mock.path);
  const [choosing, setChoosing] = useState<string>();
  const choose = () => {
    if (!variant) return;
    setChoosing(undefined);
    review?.chooseVariant(nodeId, mock.path, variant.id, Object.fromEntries(tweaks.filter(tweak => tweak.type !== 'state').map(tweak => [tweak.id, values[tweak.id] ?? defaultFor(tweak)])))
      .catch((error: unknown) => setChoosing(error instanceof Error ? error.message : String(error)));
  };
  const comments = commentsOn(annotations, nodeId, mock.path);
  const [picker, setPicker] = useState(false);
  const [picked, setPicked] = useState<Selection[]>([]);
  const [unanchored, setUnanchored] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | undefined>(reveal);
  const pendingReveal = useRef(reveal);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => { dialog.current?.showModal(); }, []);
  const firstView = useRef(true);
  useEffect(() => {
    // The first view keeps a linked comment in focus; later switches start clean.
    if (firstView.current) { firstView.current = false; return; }
    setPicker(false); setPicked([]); setFocused(undefined);
  }, [mock.path, variant?.id]);
  // Marks only for comments made on the variant on screen; a comment's number is its place in the list.
  const onScreen = (anchor?: Anchor) => anchor?.variant === variant?.id;
  const marks = comments.flatMap((comment, index) => onScreen(comment.mock) ? (comment.mock?.selections ?? []).map((selection, at) => ({ key: `${comment.id}#${at}`, label: index + 1, selector: selection.selector })) : []);
  const post = (comment: string) => {
    const anchor: Anchor = { path: mock.path };
    if (variant) anchor.variant = variant.id;
    if (picked.length) anchor.selections = picked.map(anchorSelection);
    if (tweaks.length) anchor.tweaks = Object.fromEntries(tweaks.map(tweak => [tweak.id, values[tweak.id] ?? defaultFor(tweak)]));
    setAnnotations([...annotations, { id: annotationId(), packVersion: pack.packVersion, target: { type: 'node', id: nodeId }, mock: anchor, comment, time: new Date().toISOString() }]);
    setDrafts(previous => ({ ...previous, [mock.path]: '' }));
    frame.current?.clearSelections();
    setPicked([]);
    setPicker(false);
  };
  const unpick = (id: number) => {
    frame.current?.removeSelection(id);
    // The frame renumbers the rest from 1 without echoing a selection.
    setPicked(previous => previous.filter(item => item.id !== id).map((item, index) => ({ ...item, id: index + 1 })));
  };
  const close = () => dialog.current?.close();
  const element = pack.graph.nodes.find(node => node.id === nodeId)?.label ?? nodeId;
  const variants = content?.kind === 'od-build' ? content.variants : [];
  const stage = html !== undefined ? (
    <MockFrame key={`${mock.path}#${variant?.id ?? ''}`} path={mock.path} html={html} title={variant ? `${mock.title}, ${variant.label ?? variant.id}` : mock.title}
      picker={picker} marks={marks} tweaks={tweakPayload(tweaks, values, tokens)} control={frame} events={{
        // A comment opened from the drawer flashes its element once the frame has drawn its marks.
        onApplied: () => { const id = pendingReveal.current; pendingReveal.current = undefined; if (id && comments.some(comment => comment.id === id)) frame.current?.reveal(`${id}#0`); },
        onPicker: setPicker,
        onSelection: setPicked,
        onMarkClick: key => { const id = key.slice(0, key.lastIndexOf('#')); if (comments.some(comment => comment.id === id)) setFocused(id); },
        onRevealed: (key, found) => setUnanchored(previous => found ? previous.filter(id => id !== key) : [...new Set([...previous, key])]),
        onEscape: close,
      }} />
  ) : content?.kind === 'markdown' ? <div className="mock-doc"><div className="markdown"><SidebarMarkdown hideImages>{content.markdown}</SidebarMarkdown></div></div>
    : content?.kind === 'fixture' ? <div className="mock-doc"><FixtureView format={content.format} data={content.data} /></div>
      : error ? <div className="mock-doc" role="alert"><p>This mock could not load.</p><pre>{error}</pre></div> : <p className="mock-loading" role="status">Loading mock...</p>;
  return (
    <dialog ref={dialog} className="mocks-modal" aria-labelledby={titleId} onClose={onClose}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
      onMouseUp={event => event.stopPropagation()}>
      <header className="mocks-head">
        <h2 id={titleId}><span className="mocks-crumb">{element}</span><span aria-hidden="true"> / </span>Mocks</h2>
        <button type="button" className="icon-btn" aria-label="Close mocks" data-tooltip="Close" autoFocus onClick={close}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="mocks-toolbar" role="toolbar" aria-label="Mock controls">
        <Dropdown label="Mock" value={mock.path} currentLabel={<><span className="mock-kind">{KIND_LABELS[mock.kind]}</span>{mock.title}</>} options={mocks.map(item => ({ value: item.path, label: `${item.title} (${KIND_LABELS[item.kind]})` }))} onChange={onPath} />
        {mock.illustrative && <span className="mock-tag" data-tooltip="Shown for illustration; not a requirement">Illustrative</span>}
        {variants.length > 1 && variant && (
          <div className="segmented" role="group" aria-label="Variant">
            {variants.map(item => <button key={item.id} type="button" aria-pressed={item.id === variant.id} onClick={() => updateView({ ...view, variant: item.id })}>{item.id === chosen && <Check size={14} aria-label="Chosen" />}{item.label ?? item.id}</button>)}
          </div>
        )}
        {/* Illustrative mocks are not requirements, so there is nothing to choose. */}
        {review && !mock.illustrative && variants.length > 1 && variant && (chosen === variant.id
          ? <span className="mock-chosen" role="status"><Check size={14} aria-hidden="true" />Chosen</span>
          : <button type="button" className="btn" disabled={review.pending} onClick={choose}>Choose this variant</button>)}
        {choosing && <span className="error" role="alert">{choosing}</span>}
        <span className="toolbar-spacer" />
        {tweaks.length > 0 && <TweaksPopover tweaks={tweaks} values={values} onChange={setValue} />}
        {html !== undefined && <button type="button" className="btn" aria-pressed={picker} onClick={() => setPicker(!picker)}><MousePointerClick size={16} aria-hidden="true" />{picker ? 'Picking' : 'Pick elements'}</button>}
      </div>
      <div className="mocks-main">
        <div className="mocks-stage">{stage}</div>
        <aside className="mocks-rail" aria-label="Comments on this mock">
          <h3 className="rail-title">Comments{comments.length > 0 && <span className="rail-count-text">{comments.length}</span>}</h3>
          {comments.length ? <ol className="mock-comment-list">
            {comments.map((comment, index) => {
              const anchor = comment.mock!;
              const key = `${comment.id}#0`;
              const variantName = (id?: string) => variants.find(item => item.id === id)?.label ?? id;
              const target = anchor.selections?.length ? anchorLabel(anchor) : variant && anchor.variant !== variant.id ? `On ${variantName(anchor.variant) ?? 'another variant'}` : 'Whole mock';
              return (
                <li key={comment.id} className={focused === comment.id ? 'focused' : undefined}>
                  <span className="mark-number" aria-hidden="true">{index + 1}</span>
                  <div>
                    {onScreen(anchor) && anchor.selections?.length
                      ? <button type="button" className="link comment-target" data-tooltip={anchor.selections.map(rawName).join('; ')} ref={element => { if (focused === comment.id) element?.focus(); }} onClick={() => frame.current?.reveal(key)}>{target}</button>
                      : <span className="comment-target">{target}</span>}
                    {anchor.variant && !onScreen(anchor) && anchor.selections?.length ? <span className="comment-variant">On {variantName(anchor.variant)}</span> : null}
                    <p>{comment.comment}</p>
                    {unanchored.includes(key) && <p className="hint" role="status">This element is no longer in the mock.</p>}
                  </div>
                </li>
              );
            })}
          </ol> : <p className="rail-empty">No comments on this mock yet.</p>}
          <div className="rail-composer">
            {picked.length > 0 && <div className="mock-picks">
              <p className="picks-count">{picked.length} element{picked.length === 1 ? '' : 's'} picked</p>
              <ul aria-label="Picked elements">
                {picked.map(item => <li key={item.id} className="chip" data-tooltip={rawName(item)}><span>{describe(item)}</span><button type="button" aria-label={`Remove ${describe(item)}`} onClick={() => unpick(item.id)}><X size={12} aria-hidden="true" /></button></li>)}
              </ul>
            </div>}
            <Composer key={mock.path} label={picked.length ? `Comment on ${picked.length} picked element${picked.length === 1 ? '' : 's'}` : 'Comment on this mock'}
              placeholder={picked.length ? `Comment on ${picked.length === 1 ? 'this element' : `these ${picked.length} elements`}` : picker ? 'Click elements in the mock to pick them' : 'Comment on this mock'}
              text={drafts[mock.path] ?? ''} onText={text => setDrafts(previous => ({ ...previous, [mock.path]: text }))} onPost={post} />
          </div>
        </aside>
      </div>
    </dialog>
  );
}

// Where a comment on a mock sits, for lists outside the modal: the mock, its variant, and the picked elements.
export function MockContext({ nodeId, anchor }: { nodeId: string; anchor: Anchor }) {
  const summary = mocksFor(nodeId).find(item => item.path === anchor.path);
  const content = cachedMock(nodeId, anchor.path);
  const variant = anchor.variant && (content?.kind === 'od-build' ? content.variants.find(item => item.id === anchor.variant)?.label : undefined) || anchor.variant;
  return (
    <p className="comment-mock">
      <span>{[summary?.title ?? anchor.path, variant].filter(Boolean).join(' · ')}</span>
      {anchor.selections?.length ? <span className="comment-mock-picks" data-tooltip={anchor.selections.map(rawName).join('; ')}>{anchorLabel(anchor)}</span> : null}
    </p>
  );
}
