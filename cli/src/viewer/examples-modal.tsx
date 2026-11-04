import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, MousePointerClick, SlidersHorizontal, X } from 'lucide-react';
import { Dropdown } from './dropdown.js';
import { ExampleFrame, type FrameControl } from './example-frame.js';
import { useDesignReview } from './design-approval.js';
import { cacheExample, cachedExample, exampleCapture, isCurrent, exampleView, fixtureTable, setExampleView, valuesOf, withVariant, type ElementExample, type ExampleView } from './examples.js';
import type { ExampleSummary } from '../lib/alignment-packs.js';
import { REVIEW_TOKEN_HEADER } from '../lib/alignment-review-protocol.js';
import type { Selection } from './od-bridge/protocol.js';
import { defaultFor, tweakPayload, type Tweak } from './od-bridge/tweaks.js';
import { type Annotation, annotationId, pack, token } from './pack.js';
import { SidebarMarkdown } from './sidebar-markdown.js';

const KIND_LABELS: Record<ElementExample['kind'], string> = { html: 'Mock', 'od-build': 'Mock', markdown: 'Document', fixture: 'Sample data' };

export const examplesFor = (nodeId: string): ExampleSummary[] => pack.graph.nodes.find(node => node.id === nodeId)?.examples ?? [];

// Content loads on open, behind the review token, so large builds never sit in the page.
async function fetchExample(nodeId: string, summary: ExampleSummary): Promise<ElementExample> {
  if (!token) throw new Error('Examples open only in the live review that `acstack design-doc` serves.');
  const response = await fetch(`/api/examples?element=${encodeURIComponent(nodeId)}&path=${encodeURIComponent(summary.path)}`, { headers: { [REVIEW_TOKEN_HEADER]: token } });
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Cannot load this example');
  const example = { ...body, path: summary.path, title: summary.title, ...(summary.illustrative && { illustrative: true }) } as ElementExample;
  cacheExample(nodeId, example, summary.revision);
  return example;
}
function useExample(nodeId: string, summary: ExampleSummary) {
  const [state, setState] = useState<{ path: string; error?: string }>({ path: summary.path });
  const [, loaded] = useState(0);
  useEffect(() => {
    // A changed source keeps showing the last content until the new one arrives, so the frame reloads in place.
    if (isCurrent(nodeId, summary)) return;
    let live = true;
    setState({ path: summary.path });
    fetchExample(nodeId, summary).then(() => { if (live) loaded(count => count + 1); }, (error: unknown) => { if (live) setState({ path: summary.path, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [nodeId, summary.path, summary.revision]);
  return { example: cachedExample(nodeId, summary.path), error: state.path === summary.path ? state.error : undefined };
}
type Comments = { annotations: Annotation[]; setAnnotations: (annotations: Annotation[]) => void };

const commentsOn = (annotations: Annotation[], nodeId: string, path: string) =>
  annotations.filter(annotation => annotation.target.type === 'node' && annotation.target.id === nodeId && annotation.example?.path === path);

// Opens one example, optionally on one variant, from a link such as an approval blocker.
// `comment` names a comment to reveal once the example has loaded.
export type ExampleLink = { nodeId: string; path: string; variant?: string; comment?: string };

// Registers every element's example capture once, so Lock and approval record it whichever drawer tab is showing.
export function useExampleCaptures() {
  const review = useDesignReview();
  useEffect(() => {
    if (!review) return;
    const captures = review.captures.current;
    const ids = pack.graph.nodes.map(node => node.id).filter(id => examplesFor(id).some(example => example.kind === 'od-build'));
    for (const id of ids) captures.set(id, () => exampleCapture(id, examplesFor(id).flatMap(summary => cachedExample(id, summary.path) ?? [])));
    return () => { for (const id of ids) captures.delete(id); };
  }, [review]);
}

export function ExamplesTab({ nodeId, link, annotations, setAnnotations }: { nodeId: string; link?: ExampleLink } & Comments) {
  const examples = examplesFor(nodeId);
  const follow = (target?: ExampleLink) => {
    if (!target || target.nodeId !== nodeId || !examples.some(example => example.path === target.path)) return null;
    if (target.variant) setExampleView(nodeId, target.path, { ...exampleView(nodeId, target.path), variant: target.variant });
    return target.path;
  };
  const [open, setOpen] = useState<string | null>(() => follow(link));
  const [revealComment, setRevealComment] = useState(link?.nodeId === nodeId ? link.comment : undefined);
  useEffect(() => { const path = follow(link); if (path) { setOpen(path); setRevealComment(link?.comment); } }, [link]);
  if (!examples.length) return <p className="muted">This element has no examples.</p>;
  return (
    <section className="section">
      <ul className="example-list">
        {examples.map(example => {
          const count = commentsOn(annotations, nodeId, example.path).length;
          return (
            <li key={example.path}>
              <button type="button" className="relationship-link example-link" aria-haspopup="dialog" onClick={() => { setRevealComment(undefined); setOpen(example.path); }}>
                <span><span className="relationship-label">{example.title}</span><span className="relationship-endpoint">{KIND_LABELS[example.kind]}{example.illustrative ? ', illustrative' : ''}{count ? `, ${count} comment${count === 1 ? '' : 's'}` : ''}</span></span><ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {open && <ExamplesModal nodeId={nodeId} examples={examples} path={open} reveal={revealComment} onPath={setOpen} onClose={() => setOpen(null)} annotations={annotations} setAnnotations={setAnnotations} />}
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
type Anchor = NonNullable<Annotation['example']>;
type AnchorSelection = NonNullable<Anchor['selections']>[number];
// Labels read as plain words: "PayButton" becomes "Pay button", and a container's run of text
// gives way to its first line, which is its heading or label. The raw name stays in a tooltip.
export const componentLabel = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/ ([A-Z])(?=[a-z])/g, (_, letter: string) => ` ${letter.toLowerCase()}`).trim();
const brief = (text: string) => { const line = text.split('\n').map(part => part.trim()).find(Boolean) ?? ''; return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line; };
export const describe = (selection: { selector: string; text?: string; component?: { name: string } }) => {
  const text = brief(selection.text ?? '');
  if (selection.component) return text ? `${componentLabel(selection.component.name)}: ${text}` : componentLabel(selection.component.name);
  return text || 'Element';
};
const rawName = (selection: { selector: string; component?: { name: string } }) => selection.component?.name ?? selection.selector;
const anchorLabel = (anchor: Anchor) => anchor.selections?.length ? anchor.selections.map(describe).join('; ') : 'Whole example';
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
    <div className="example-tweaks">
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
    <div className="example-composer">
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

export function ExamplesModal({ nodeId, examples, path, reveal, onPath, onClose, annotations, setAnnotations }: {
  nodeId: string;
  examples: ExampleSummary[];
  path: string;
  reveal?: string;
  onPath: (path: string) => void;
  onClose: () => void;
} & Comments) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<FrameControl | null>(null);
  const titleId = useId();
  const summary = examples.find(item => item.path === path) ?? examples[0];
  const { example: content, error } = useExample(nodeId, summary);
  const example = content ?? summary;
  const [shown, setShown] = useState(() => ({ path: example.path, view: exampleView(nodeId, example.path) }));
  const view = shown.path === example.path ? shown.view : exampleView(nodeId, example.path);
  const updateView = (next: ExampleView) => { setExampleView(nodeId, example.path, next); setShown({ path: example.path, view: next }); };
  // Opening an example counts as having it on screen, which is what a lock captures.
  useEffect(() => { setExampleView(nodeId, example.path, exampleView(nodeId, example.path)); }, [example.path]);
  const variant = content?.kind === 'od-build' ? content.variants.find(item => item.id === view.variant) ?? content.variants[0] : undefined;
  const html = content?.kind === 'html' ? content.html : content?.kind === 'od-build' && variant ? withVariant(content.html, variant.id) : undefined;
  const tweaks = content?.kind === 'od-build' ? [...content.tweaks ?? [], ...variant?.tweaks ?? []] : [];
  const tokens = content?.kind === 'od-build' && content.tokens ? new Map(Object.entries(content.tokens)) : null;
  const values = valuesOf(view, variant?.id);
  const setValue = (id: string, value: string) => updateView({ ...view, values: { ...view.values, [variant?.id ?? '']: { ...values, [id]: value } } });
  const review = useDesignReview();
  const chosen = review?.chosenVariant(nodeId, example.path);
  const [choosing, setChoosing] = useState<string>();
  const choose = () => {
    if (!variant) return;
    setChoosing(undefined);
    review?.chooseVariant(nodeId, example.path, variant.id, Object.fromEntries(tweaks.filter(tweak => tweak.type !== 'state').map(tweak => [tweak.id, values[tweak.id] ?? defaultFor(tweak)])))
      .catch((error: unknown) => setChoosing(error instanceof Error ? error.message : String(error)));
  };
  const comments = commentsOn(annotations, nodeId, example.path);
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
  }, [example.path, variant?.id]);
  // Marks only for comments made on the variant on screen; a comment's number is its place in the list.
  const onScreen = (anchor?: Anchor) => anchor?.variant === variant?.id;
  const marks = comments.flatMap((comment, index) => onScreen(comment.example) ? (comment.example?.selections ?? []).map((selection, at) => ({ key: `${comment.id}#${at}`, label: index + 1, selector: selection.selector })) : []);
  const post = (comment: string) => {
    const anchor: Anchor = { path: example.path };
    if (variant) anchor.variant = variant.id;
    if (picked.length) anchor.selections = picked.map(anchorSelection);
    if (tweaks.length) anchor.tweaks = Object.fromEntries(tweaks.map(tweak => [tweak.id, values[tweak.id] ?? defaultFor(tweak)]));
    setAnnotations([...annotations, { id: annotationId(), packVersion: pack.packVersion, target: { type: 'node', id: nodeId }, example: anchor, comment, time: new Date().toISOString() }]);
    setDrafts(previous => ({ ...previous, [example.path]: '' }));
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
    <ExampleFrame key={`${example.path}#${variant?.id ?? ''}`} path={example.path} html={html} title={variant ? `${example.title}, ${variant.label ?? variant.id}` : example.title}
      picker={picker} marks={marks} tweaks={tweakPayload(tweaks, values, tokens)} control={frame} events={{
        // A comment opened from the drawer flashes its element once the frame has drawn its marks.
        onApplied: () => { const id = pendingReveal.current; pendingReveal.current = undefined; if (id && comments.some(comment => comment.id === id)) frame.current?.reveal(`${id}#0`); },
        onPicker: setPicker,
        onSelection: setPicked,
        onMarkClick: key => { const id = key.slice(0, key.lastIndexOf('#')); if (comments.some(comment => comment.id === id)) setFocused(id); },
        onRevealed: (key, found) => setUnanchored(previous => found ? previous.filter(id => id !== key) : [...new Set([...previous, key])]),
        onEscape: close,
      }} />
  ) : content?.kind === 'markdown' ? <div className="example-doc"><div className="markdown"><SidebarMarkdown hideImages>{content.markdown}</SidebarMarkdown></div></div>
    : content?.kind === 'fixture' ? <div className="example-doc"><FixtureView format={content.format} data={content.data} /></div>
      : error ? <div className="example-doc" role="alert"><p>This example could not load.</p><pre>{error}</pre></div> : <p className="example-loading" role="status">Loading example...</p>;
  return (
    <dialog ref={dialog} className="examples-modal" aria-labelledby={titleId} onClose={onClose}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
      onMouseUp={event => event.stopPropagation()}>
      <header className="examples-head">
        <h2 id={titleId}><span className="examples-crumb">{element}</span><span aria-hidden="true"> / </span>Examples</h2>
        <button type="button" className="icon-btn" aria-label="Close examples" data-tooltip="Close" autoFocus onClick={close}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="examples-toolbar" role="toolbar" aria-label="Example controls">
        <Dropdown label="Example" value={example.path} currentLabel={<><span className="example-kind">{KIND_LABELS[example.kind]}</span>{example.title}</>} options={examples.map(item => ({ value: item.path, label: `${item.title} (${KIND_LABELS[item.kind]})` }))} onChange={onPath} />
        {example.illustrative && <span className="example-tag" data-tooltip="Shown for illustration; not a requirement">Illustrative</span>}
        {variants.length > 1 && variant && (
          <div className="segmented" role="group" aria-label="Variant">
            {variants.map(item => <button key={item.id} type="button" aria-pressed={item.id === variant.id} onClick={() => updateView({ ...view, variant: item.id })}>{item.id === chosen && <Check size={14} aria-label="Chosen" />}{item.label ?? item.id}</button>)}
          </div>
        )}
        {review && variants.length > 1 && variant && (chosen === variant.id
          ? <span className="example-chosen" role="status"><Check size={14} aria-hidden="true" />Chosen</span>
          : <button type="button" className="btn" disabled={review.pending} onClick={choose}>Choose this variant</button>)}
        {choosing && <span className="error" role="alert">{choosing}</span>}
        <span className="toolbar-spacer" />
        {tweaks.length > 0 && <TweaksPopover tweaks={tweaks} values={values} onChange={setValue} />}
        {html !== undefined && <button type="button" className="btn" aria-pressed={picker} onClick={() => setPicker(!picker)}><MousePointerClick size={16} aria-hidden="true" />{picker ? 'Picking' : 'Pick elements'}</button>}
      </div>
      <div className="examples-main">
        <div className="examples-stage">{stage}</div>
        <aside className="examples-rail" aria-label="Comments on this example">
          <h3 className="rail-title">Comments{comments.length > 0 && <span className="rail-count-text">{comments.length}</span>}</h3>
          {comments.length ? <ol className="example-comment-list">
            {comments.map((comment, index) => {
              const anchor = comment.example!;
              const key = `${comment.id}#0`;
              const variantName = (id?: string) => variants.find(item => item.id === id)?.label ?? id;
              const target = anchor.selections?.length ? anchorLabel(anchor) : variant && anchor.variant !== variant.id ? `On ${variantName(anchor.variant) ?? 'another variant'}` : 'Whole example';
              return (
                <li key={comment.id} className={focused === comment.id ? 'focused' : undefined}>
                  <span className="mark-number" aria-hidden="true">{index + 1}</span>
                  <div>
                    {onScreen(anchor) && anchor.selections?.length
                      ? <button type="button" className="link comment-target" data-tooltip={anchor.selections.map(rawName).join('; ')} ref={element => { if (focused === comment.id) element?.focus(); }} onClick={() => frame.current?.reveal(key)}>{target}</button>
                      : <span className="comment-target">{target}</span>}
                    {anchor.variant && !onScreen(anchor) && anchor.selections?.length ? <span className="comment-variant">On {variantName(anchor.variant)}</span> : null}
                    <p>{comment.comment}</p>
                    {unanchored.includes(key) && <p className="hint" role="status">This element is no longer in the example.</p>}
                  </div>
                </li>
              );
            })}
          </ol> : <p className="rail-empty">No comments on this example yet.</p>}
          <div className="rail-composer">
            {picked.length > 0 && <div className="example-picks">
              <p className="picks-count">{picked.length} element{picked.length === 1 ? '' : 's'} picked</p>
              <ul aria-label="Picked elements">
                {picked.map(item => <li key={item.id} className="chip" data-tooltip={rawName(item)}><span>{describe(item)}</span><button type="button" aria-label={`Remove ${describe(item)}`} onClick={() => unpick(item.id)}><X size={12} aria-hidden="true" /></button></li>)}
              </ul>
            </div>}
            <Composer key={example.path} label={picked.length ? `Comment on ${picked.length} picked element${picked.length === 1 ? '' : 's'}` : 'Comment on this example'}
              placeholder={picked.length ? `Comment on ${picked.length === 1 ? 'this element' : `these ${picked.length} elements`}` : picker ? 'Click elements in the mock to pick them' : 'Comment on this example'}
              text={drafts[example.path] ?? ''} onText={text => setDrafts(previous => ({ ...previous, [example.path]: text }))} onPost={post} />
          </div>
        </aside>
      </div>
    </dialog>
  );
}

// Where a comment on an example sits, for lists outside the modal: the example, its variant, and the picked elements.
export function ExampleContext({ nodeId, anchor }: { nodeId: string; anchor: Anchor }) {
  const summary = examplesFor(nodeId).find(item => item.path === anchor.path);
  const content = cachedExample(nodeId, anchor.path);
  const variant = anchor.variant && (content?.kind === 'od-build' ? content.variants.find(item => item.id === anchor.variant)?.label : undefined) || anchor.variant;
  return (
    <p className="comment-example">
      <span>{[summary?.title ?? anchor.path, variant].filter(Boolean).join(' · ')}</span>
      {anchor.selections?.length ? <span className="comment-example-picks" data-tooltip={anchor.selections.map(rawName).join('; ')}>{anchorLabel(anchor)}</span> : null}
    </p>
  );
}
