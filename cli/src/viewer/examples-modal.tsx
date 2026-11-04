import { useEffect, useId, useRef, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { CommentForm } from './drawer.js';
import { Dropdown } from './dropdown.js';
import { ExampleFrame } from './example-frame.js';
import { examplesFor, fixtureTable, type ElementExample } from './examples.js';
import type { Selection } from './od-bridge/protocol.js';
import { type Annotation, annotationId, pack } from './pack.js';
import { SidebarMarkdown } from './sidebar-markdown.js';

const KIND_LABELS: Record<ElementExample['kind'], string> = { html: 'HTML mock', 'od-build': 'OpenDesigner build', markdown: 'Markdown', fixture: 'Fixture' };
type Comments = { annotations: Annotation[]; setAnnotations: (annotations: Annotation[]) => void };

const commentsOn = (annotations: Annotation[], nodeId: string, path: string) =>
  annotations.filter(annotation => annotation.target.type === 'node' && annotation.target.id === nodeId && annotation.example?.path === path);

export function ExamplesTab({ nodeId, annotations, setAnnotations }: { nodeId: string } & Comments) {
  const examples = examplesFor(nodeId);
  const [open, setOpen] = useState<string | null>(null);
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
export const describe = (selection: Selection) => [selection.component?.name, selection.text || selection.selector].filter(Boolean).join(': ');
const anchorLabel = (example: NonNullable<Annotation['example']>) => example.selector ? [example.component, example.text ?? example.selector].filter(Boolean).join(': ') : 'Whole example';

export function ExamplesModal({ nodeId, examples, path, onPath, onClose, annotations, setAnnotations }: {
  nodeId: string;
  examples: ElementExample[];
  path: string;
  onPath: (path: string) => void;
  onClose: () => void;
} & Comments) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const example = examples.find(item => item.path === path) ?? examples[0];
  const framed = example.kind === 'html' || example.kind === 'od-build' ? example : null;
  const comments = commentsOn(annotations, nodeId, example.path);
  const [picker, setPicker] = useState(false);
  const [picked, setPicked] = useState<Selection | null>(null);
  const [reveal, setReveal] = useState<{ key: string; request: number }>();
  const [unanchored, setUnanchored] = useState<string[]>([]);
  const [focused, setFocused] = useState<string>();
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { setPicker(false); setPicked(null); setFocused(undefined); }, [example.path]);
  const marks = comments.flatMap((comment, index) => comment.example?.selector ? [{ key: comment.id, label: index + 1, selector: comment.example.selector }] : []);
  const post = (comment: string) => {
    const anchor: Annotation['example'] = { path: example.path };
    if (picked) Object.assign(anchor, { selector: picked.selector, component: picked.component?.name || undefined, fixture: picked.component?.fixture || undefined, text: picked.text || undefined });
    setAnnotations([...annotations, { id: annotationId(), packVersion: pack.packVersion, target: { type: 'node', id: nodeId }, example: anchor, comment, time: new Date().toISOString() }]);
    setPicked(null);
    setPicker(false);
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
          {framed && <button type="button" className="btn" aria-pressed={picker} onClick={() => setPicker(!picker)}><MousePointerClick size={16} aria-hidden="true" />{picker ? 'Picking element' : 'Pick element'}</button>}
          <button type="button" className="btn" aria-label="Close examples" autoFocus onClick={close}>Close</button>
        </div>
      </header>
      <div className="examples-body">
        <div className="example-view">
          {framed ? (
            <ExampleFrame key={framed.path} example={framed} picker={picker} marks={marks} reveal={reveal} hasSelection={Boolean(picked)} events={{
              onPicker: setPicker,
              onSelection: setPicked,
              onMarkClick: key => { if (comments.some(comment => comment.id === key)) setFocused(key); },
              onRevealed: (key, found) => setUnanchored(previous => found ? previous.filter(id => id !== key) : [...new Set([...previous, key])]),
              onNavigate: page => { const target = examples.find(item => item !== example && (item.path === page || item.path.replace(/\.[^./]+$/, '') === page)); if (target) onPath(target.path); },
              onEscape: close,
            }} />
          ) : example.kind === 'markdown' ? <div className="markdown"><SidebarMarkdown hideImages>{example.markdown}</SidebarMarkdown></div>
            : example.kind === 'fixture' ? <FixtureView format={example.format} data={example.data} /> : null}
        </div>
        <aside className="example-comments" aria-label="Comments on this example">
          {framed && <p className="hint" role="status">{picked ? `Selected: ${describe(picked)}` : picker ? 'Click an element in the example to anchor your comment.' : 'Comments anchor to the whole example unless you pick an element.'}</p>}
          <CommentForm key={example.path} label={picked ? 'Comment on the selected element' : 'Comment on this example'} onSave={post} onCancel={picked ? () => setPicked(null) : undefined} />
          {comments.length > 0 && <ol className="comments">
            {comments.map((comment, index) => (
              <li key={comment.id} className={focused === comment.id ? 'focused' : undefined}>
                {framed && comment.example?.selector
                  ? <button type="button" className="link strong" ref={element => { if (focused === comment.id) element?.focus(); }} onClick={() => setReveal({ key: comment.id, request: (reveal?.request ?? 0) + 1 })}>{index + 1}. {anchorLabel(comment.example)}</button>
                  : <strong>{index + 1}. {comment.example && anchorLabel(comment.example)}</strong>}
                {unanchored.includes(comment.id) && <p role="status">Unanchored: this element is no longer in the example.</p>}
                <p>{comment.comment}</p>
              </li>
            ))}
          </ol>}
        </aside>
      </div>
    </dialog>
  );
}
