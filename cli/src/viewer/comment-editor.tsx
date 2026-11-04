import { useId, useState } from 'react';

export function CommentEditor({ comment, onSave, onCancel, text: controlledText, onTextChange }: {
  text?: string;
  onTextChange?: (text: string) => void;
  comment: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
}) {
  const [localText, setLocalText] = useState(comment);
  const text = controlledText ?? localText;
  const setText = onTextChange ?? setLocalText;
  const fieldId = useId();
  const save = () => { if (text.trim()) onSave(text.trim()); };
  return (
    <div className="comment-form comment-editor">
      <label className="comment-label" htmlFor={fieldId}>Edit comment</label>
      <textarea
        id={fieldId}
        autoFocus
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
        }}
        rows={3}
      />
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" onClick={save} disabled={!text.trim()}>Save</button>
      </div>
    </div>
  );
}
