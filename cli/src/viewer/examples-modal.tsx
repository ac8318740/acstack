import { useEffect, useId, useRef, useState } from 'react';
import { MousePointerClick, X } from 'lucide-react';
import { CommentForm } from './drawer.js';
import { Dropdown } from './dropdown.js';
import { ExampleFrame, type FrameControl } from './example-frame.js';
import { useDesignReview } from './design-approval.js';
import { exampleCapture, examplesFor, exampleView, fixtureTable, setExampleView, type ElementExample, type ExampleView } from './examples.js';
import type { Selection } from './od-bridge/protocol.js';
import { defaultFor, tweakPayload, type Tweak } from './od-bridge/tweaks.js';
import { type Annotation, annotationId, pack } from './pack.js';
import { SidebarMarkdown } from './sidebar-markdown.js';

const KIND_LABELS: Record<ElementExample['kind'], string> = { html: 'HTML mock', 'od-build': 'OpenDesigner build', markdown: 'Markdown', fixture: 'Fixture' };
type Comments = { annotations: Annotation[]; setAnnotations: (annotations: Annotation[]) => void };

const commentsOn = (annotations: Annotation[], nodeId: string, path: string) =>
  annotations.filter(annotation => annotation.target.type === 'node' && annotation.target.id === nodeId && annotation.example?.path === path);

// Opens one example, optionally on one variant, from a link such as an approval blocker.
export type ExampleLink = { nodeId: string; path: string; variant?: string };

// Registers every element's example capture once, so Lock and approval record it whichever drawer tab is showing.
export function useExampleCaptures() {
  const review = useDesignReview();
  useEffect(() => {
    if (!review) return;
    const captures = review.captures.current;
    const ids = pack.graph.nodes.map(node => node.id).filter(id => examplesFor(id).some(example => example.kind === 'od-build'));
    for (const id of ids) captures.set(id, () => exampleCapture(id));
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
  useEffect(() => { const path = follow(link); if (path) setOpen(path); }, [link]);
  if (!examples.length) return <p className="muted">This element has no examples.</p>;
  return (
    <section className="section">
      <ul className="example-list">
        {examples.map(example => {
          const count = commentsOn(annotations, nodeId, example.path).length;
          return (
            <li key={example.path}>
              <button type="button" className="relationship-link" aria-haspopup="dialog" onClick={() => setOpen(example.path)}>
                <span><span className="relationship-label">{example.title}</span><span className="relationship-endpoint">{KIND_LABELS[example.kind]}{example.illustrative ? ', illustrative' : ''}{count ? `, ${count} comment${count === 1 ? '' : 's'}` : ''}</span></span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && <ExamplesModal nodeId={nodeId} examples={examples} path={open} onPath={setOpen} onClose={() => setOpen(null)} annotations={annotations} setAnnotations={setAnnotations} />}
    </section>
  );
}

export function FixtureView({ format, data }: { format: 'json' | 'csv'; data: string }) {
  const table = fixtureTable(format, data);
  if ('error' in table) return <p role="alert">{table.error}</p>;
  return (
    <div className="fixture-table">
      <table>
        <thead><tr>{table.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Frame-supplied fields are untrusted: they appear as plain text only.
type Anchor = NonNullable<Annotation['example']>;
type AnchorSelection = NonNullable<Anchor['selections']>[number];
export const describe = (selection: { selector: string; text?: string; component?: { name: string } }) => [selection.component?.name, selection.text || selection.selector].filter(Boolean).join(': ');
const anchorLabel = (anchor: Anchor) => anchor.selections?.length ? anchor.selections.map(describe).join('; ') : 'Whole example';
const anchorSelection = ({ selector, text, rect, component }: Selection): AnchorSelection => ({
  selector, rect, ...(text ? { text } : {}),
  ...(component ? { component: { name: component.name, ...(component.source ? { source: component.source } : {}), ...(component.props ? { props: component.props } : {}), ...(component.fixture ? { fixture: component.fixture } : {}) } } : {}),
});

// ACStack draws OpenDesigner's tweak controls; the frame only applies the payload the host computes.
export function TweakControls({ tweaks, values, onChange }: { tweaks: Tweak[]; values: Record<string, string>; onChange: (id: string, value: string) => void }) {
  const fieldId = useId();
  if (!tweaks.length) return null;
  return (
    <fieldset className="example-tweaks">
      <legend>Tweaks</legend>
      {tweaks.map(tweak => {
        const id = `${fieldId}-${tweak.id}`;
        const value = values[tweak.id] ?? defaultFor(tweak);
        if (tweak.type === 'select' || tweak.type === 'state') {
          const options = (tweak.options ?? []).map(option => typeof option === 'string' ? { value: option, label: option } : option);
          return <div key={tweak.id} className="tweak-row"><span className="comment-label">{tweak.label}</span><Dropdown label={tweak.label} value={value} options={options} onChange={next => onChange(tweak.id, next)} /></div>;
        }
        if (tweak.type === 'toggle') return <label key={tweak.id} className="tweak-row"><input type="checkbox" checked={value === '1' || value === (tweak.on ?? '1')} onChange={event => onChange(tweak.id, event.target.checked ? '1' : '0')} />{tweak.label}</label>;
        return (
          <div key={tweak.id} className="tweak-row">
            <label className="comment-label" htmlFor={id}>{tweak.label}{tweak.type === 'slider' ? ` (${value}${tweak.unit ?? ''})` : ''}</label>
            {tweak.type === 'slider' ? <input id={id} type="range" min={tweak.min ?? 0} max={tweak.max ?? 100} step={tweak.step ?? 1} value={value} onChange={event => onChange(tweak.id, event.target.value)} />
              : tweak.type === 'color' ? <input id={id} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={event => onChange(tweak.id, event.target.value)} />
                : <input id={id} type="text" value={value} onChange={event => onChange(tweak.id, event.target.value)} />}
          </div>
        );
      })}
    </fieldset>
  );
}

export function ExamplesModal({ nodeId, examples, path, onPath, onClose, annotations, setAnnotations }: {
  nodeId: string;
  examples: ElementExample[];
  path: string;
  onPath: (path: string) => void;
  onClose: () => void;
} & Comments) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<FrameControl | null>(null);
  const titleId = useId();
  const example = examples.find(item => item.path === path) ?? examples[0];
  const [shown, setShown] = useState(() => ({ path: example.path, view: exampleView(nodeId, example.path) }));
  const view = shown.path === example.path ? shown.view : exampleView(nodeId, example.path);
  const updateView = (next: ExampleView) => { setExampleView(nodeId, example.path, next); setShown({ path: example.path, view: next }); };
  // Opening an example counts as having it on screen, which is what a lock captures.
  useEffect(() => { setExampleView(nodeId, example.path, exampleView(nodeId, example.path)); }, [example.path]);
  const variant = example.kind === 'od-build' ? example.variants.find(item => item.id === view.variant) ?? example.variants[0] : undefined;
  const html = example.kind === 'html' ? example.html : variant?.html;
  const tweaks = example.kind === 'od-build' ? [...example.tweaks ?? [], ...variant?.tweaks ?? []] : [];
  // shortcut: no token map, so `add` and `scale` slider tweaks emit nothing; pass the design system's tokens once node 011 carries them.
  const comments = commentsOn(annotations, nodeId, example.path);
  const [picker, setPicker] = useState(false);
  const [picked, setPicked] = useState<Selection[]>([]);
  const [unanchored, setUnanchored] = useState<string[]>([]);
  const [focused, setFocused] = useState<string>();
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { setPicker(false); setPicked([]); setFocused(undefined); }, [example.path, variant?.id]);
  // Marks only for comments made on the variant on screen; a comment's number is its place in the list.
  const onScreen = (anchor?: Anchor) => anchor?.variant === variant?.id;
  const marks = comments.flatMap((comment, index) => onScreen(comment.example) ? (comment.example?.selections ?? []).map((selection, at) => ({ key: `${comment.id}#${at}`, label: index + 1, selector: selection.selector })) : []);
  const post = (comment: string) => {
    const anchor: Anchor = { path: example.path };
    if (variant) anchor.variant = variant.id;
    if (picked.length) anchor.selections = picked.map(anchorSelection);
    if (tweaks.length) anchor.tweaks = Object.fromEntries(tweaks.map(tweak => [tweak.id, view.values[tweak.id] ?? defaultFor(tweak)]));
    setAnnotations([...annotations, { id: annotationId(), packVersion: pack.packVersion, target: { type: 'node', id: nodeId }, example: anchor, comment, time: new Date().toISOString() }]);
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
  return (
    <dialog ref={dialog} className="modal target-details-modal examples-modal" aria-labelledby={titleId} onClose={onClose}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
      onMouseUp={event => event.stopPropagation()}>
      <header className="target-details-head">
        <div><h2 id={titleId}>{example.title}</h2><p className="hint">{KIND_LABELS[example.kind]}{example.illustrative ? ', illustrative' : ''}: {example.path}</p></div>
        <div className="row">
          {examples.length > 1 && <Dropdown label="Example" value={example.path} currentLabel={example.title} options={examples.map(item => ({ value: item.path, label: item.title }))} onChange={onPath} />}
          {example.kind === 'od-build' && example.variants.length > 1 && variant && <Dropdown label="Variant" value={variant.id} currentLabel={variant.label ?? variant.id} options={example.variants.map(item => ({ value: item.id, label: item.label ?? item.id }))} onChange={id => updateView({ ...view, variant: id })} />}
          {html !== undefined && <button type="button" className="btn" aria-pressed={picker} onClick={() => setPicker(!picker)}><MousePointerClick size={16} aria-hidden="true" />{picker ? 'Picking elements' : 'Pick elements'}</button>}
          <button type="button" className="btn" aria-label="Close examples" autoFocus onClick={close}>Close</button>
        </div>
      </header>
      <div className="examples-body">
        <div className="example-view">
          {html !== undefined ? (
            <ExampleFrame key={`${example.path}#${variant?.id ?? ''}`} path={example.path} html={html} title={variant ? `${example.title}, ${variant.label ?? variant.id}` : example.title}
              picker={picker} marks={marks} tweaks={tweakPayload(tweaks, view.values)} control={frame} events={{
                onPicker: setPicker,
                onSelection: setPicked,
                onMarkClick: key => { const id = key.slice(0, key.lastIndexOf('#')); if (comments.some(comment => comment.id === id)) setFocused(id); },
                onRevealed: (key, found) => setUnanchored(previous => found ? previous.filter(id => id !== key) : [...new Set([...previous, key])]),
                onEscape: close,
              }} />
          ) : example.kind === 'markdown' ? <div className="markdown"><SidebarMarkdown hideImages>{example.markdown}</SidebarMarkdown></div>
            : example.kind === 'fixture' ? <FixtureView format={example.format} data={example.data} /> : null}
        </div>
        <aside className="example-comments" aria-label="Comments on this example">
          <TweakControls tweaks={tweaks} values={view.values} onChange={(id, value) => updateView({ ...view, values: { ...view.values, [id]: value } })} />
          {html !== undefined && (picked.length ? (
            <ul className="example-picks" aria-label="Selected elements">
              {picked.map(item => <li key={item.id}><span>{item.id}. {describe(item)}</span><button type="button" className="icon-btn" aria-label={`Remove selection ${item.id}`} onClick={() => unpick(item.id)}><X size={14} aria-hidden="true" /></button></li>)}
            </ul>
          ) : <p className="hint" role="status">{picker ? 'Click elements in the example to anchor your comment.' : 'Comments anchor to the whole example unless you pick elements.'}</p>)}
          <CommentForm key={example.path} label={picked.length ? `Comment on ${picked.length} selected element${picked.length === 1 ? '' : 's'}` : 'Comment on this example'} onSave={post} />
          {comments.length > 0 && <ol className="comments">
            {comments.map((comment, index) => {
              const anchor = comment.example!;
              const key = `${comment.id}#0`;
              return (
                <li key={comment.id} className={focused === comment.id ? 'focused' : undefined}>
                  {onScreen(anchor) && anchor.selections?.length
                    ? <button type="button" className="link strong" ref={element => { if (focused === comment.id) element?.focus(); }} onClick={() => frame.current?.reveal(key)}>{index + 1}. {anchorLabel(anchor)}</button>
                    : <strong>{index + 1}. {anchorLabel(anchor)}</strong>}
                  {anchor.variant && !onScreen(anchor) && <p className="hint">On variant {anchor.variant}</p>}
                  {unanchored.includes(key) && <p role="status">Unanchored: this element is no longer in the example.</p>}
                  <p>{comment.comment}</p>
                </li>
              );
            })}
          </ol>}
        </aside>
      </div>
    </dialog>
  );
}
