import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Annotation } from './pack.js';
import { hitPostedRanges, resolvePostedRanges, type PostedRange } from './quote-anchors.js';
import { commentPosition } from './comment-position.js';
import { CommentEditor } from './comment-editor.js';
import { Pencil, X } from 'lucide-react';

type Preview = { ids: string[]; range?: Range; anchor: DOMRect; pinned: boolean; focus?: HTMLElement };
const interactive = 'button, a, input, textarea, select, [contenteditable="true"], .comment-form, .popover, .comments';

// Ranges and document listeners stay outside React; no source DOM is rewritten.
export function bindPostedComments(panel: { current: HTMLDivElement | null }, onPreview: (preview: Preview | null) => void) {
  let annotations: Annotation[] = [];
  let ranges: PostedRange[] = [];
  let active: Preview | null = null;
  let editing = false;
  let pinnedBeforeEdit = false;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = '';
  let down: { x: number; y: number; moved: boolean } | null = null;
  let selectedOnUp = false;
  let disposed = false;
  const cancel = () => { clearTimeout(showTimer); clearTimeout(hideTimer); pending = ''; };
  const close = (restore = false) => {
    cancel();
    const focus = active?.focus;
    active = null;
    editing = false;
    onPreview(null);
    if (restore && focus?.isConnected) focus.focus();
  };
  const publish = (hits: PostedRange[], pinned: boolean, fallback?: { annotation: Annotation; element: HTMLElement; keyboard: boolean }) => {
    cancel();
    const ids = new Set(hits.map(hit => hit.annotation.id));
    if (fallback) ids.add(fallback.annotation.id);
    // Equal text at different anchored occurrences represents different quotes.
    if (fallback?.annotation.selectedText) {
      for (const annotation of annotations) {
        if (annotation.target.type === fallback.annotation.target.type && annotation.target.id === fallback.annotation.target.id
          && annotation.selectedText === fallback.annotation.selectedText
          && JSON.stringify(annotation.quoteAnchor) === JSON.stringify(fallback.annotation.quoteAnchor)) ids.add(annotation.id);
      }
    }
    if (!ids.size) return;
    const range = hits.find(hit => Array.from(hit.range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0))?.range;
    active = { ids: [...ids], range, anchor: range?.getBoundingClientRect() ?? fallback!.element.getBoundingClientRect(), pinned,
      focus: fallback?.keyboard ? fallback.element : undefined };
    onPreview(active);
  };
  const refresh = (next = annotations) => {
    cancel();
    annotations = next;
    ranges = resolvePostedRanges(annotations);
    if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
      CSS.highlights.set('posted-comments', new Highlight(...ranges.map(hit => hit.range)));
    }
    if (active) {
      const ids = active.ids.filter(id => annotations.some(annotation => annotation.id === id));
      const source = active.range;
      const sourceValid = !source || ranges.some(({ annotation, range }) => ids.includes(annotation.id)
        && source.startContainer === range.startContainer && source.startOffset === range.startOffset
        && source.endContainer === range.endContainer && source.endOffset === range.endOffset);
      if (!ids.length) close();
      else if (ids.length !== active.ids.length || !sourceValid) {
        const range = ranges.find(hit => ids.includes(hit.annotation.id))?.range;
        active = { ...active, ids, range, anchor: range?.getBoundingClientRect() ?? active.anchor };
        onPreview(active);
      }
    }
  };
  const deferHide = () => {
    if (active?.pinned || editing) return;
    clearTimeout(showTimer);
    pending = '';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => close(), 180);
  };
  const hitsAt = (event: MouseEvent, allowHeader = false) => {
    const element = event.target instanceof Element ? event.target : null;
    const control = element?.closest(interactive);
    if (document.querySelector('.popover') || (control && !(allowHeader && control.matches('.header-select'))) || panel.current?.contains(element)) return [];
    return hitPostedRanges(ranges, event.clientX, event.clientY);
  };
  const move = (event: PointerEvent) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) down.moved = true;
    if (event.pointerType === 'touch' || event.buttons || active?.pinned || editing) return;
    if (panel.current?.contains(event.target as Node)) { clearTimeout(hideTimer); return; }
    const hits = hitsAt(event, true);
    const key = [...new Set(hits.map(hit => hit.annotation.id))].join('|');
    if (!key) { deferHide(); return; }
    clearTimeout(hideTimer);
    if (key === pending || active?.ids.join('|') === key) return;
    clearTimeout(showTimer);
    pending = key;
    showTimer = setTimeout(() => publish(hits, false), 280);
  };
  const pointerDown = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest?.('[data-review-handoff]')) return;
    down = { x: event.clientX, y: event.clientY, moved: false };
    selectedOnUp = false;
    cancel();
    if (!panel.current?.contains(event.target as Node)) close();
  };
  const click = (event: MouseEvent) => {
    const dragged = down?.moved || down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4;
    down = null;
    if (dragged || selectedOnUp || event.button !== 0 || window.getSelection()?.toString()) return;
    const hits = hitsAt(event);
    if (hits.length) {
      // Only a confirmed quote click takes precedence over the graph's own selection action.
      event.stopPropagation();
      publish(hits, true);
    }
  };
  // The draft binder clears native selection on mouseup, before click arrives.
  const mouseUp = () => { selectedOnUp = Boolean(window.getSelection()?.toString()); };
  const key = (event: KeyboardEvent) => {
    if ((event.target as Element | null)?.closest?.('[data-review-handoff]')) return;
    if (event.target instanceof Element && event.target.closest('.comment-editor')) return;
    if (event.key === 'Escape' && active) { event.stopPropagation(); close(true); }
  };
  const leave = () => deferHide();
  const observer = new MutationObserver(records => {
    const changed = records.some(record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      return !element?.closest('.posted-comment-popover, .popover, .comments, .comment-form, .measurement');
    });
    if (changed && !disposed) refresh();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-annotate-id', 'data-annotate-type', 'hidden', 'open'] });
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('click', click, true);
  document.addEventListener('mouseup', mouseUp, true);
  document.addEventListener('keydown', key, true);
  document.addEventListener('pointercancel', closeWithoutFocus);
  document.addEventListener('pointerout', out);
  function closeWithoutFocus() { down = null; close(); }
  function out(event: PointerEvent) { if (!event.relatedTarget) leave(); }
  return {
    refresh,
    close: () => close(true),
    hold: () => { clearTimeout(hideTimer); },
    setEditing: (value: boolean, keepPinned = false) => {
      if (value && !editing) pinnedBeforeEdit = active?.pinned ?? false;
      editing = value;
      if (value) cancel();
      if (active) active = { ...active, pinned: value || keepPinned || pinnedBeforeEdit };
    },
    leave,
    show: (annotation: Annotation, element: HTMLElement, keyboard: boolean) => publish(ranges.filter(hit => hit.annotation.id === annotation.id), true, { annotation, element, keyboard }),
    dispose: () => {
      disposed = true;
      cancel();
      observer.disconnect();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('mouseup', mouseUp, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointercancel', closeWithoutFocus);
      document.removeEventListener('pointerout', out);
      if (typeof CSS !== 'undefined') CSS.highlights?.delete('posted-comments');
    },
  };
}

export function usePostedComments(annotations: Annotation[], draftOpen: boolean, dismissDraft: () => void, onEdit: (id: string, comment: string) => void) {
  const panel = useRef<HTMLDivElement>(null);
  const binding = useRef<ReturnType<typeof bindPostedComments> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const dismiss = useRef(dismissDraft);
  dismiss.current = dismissDraft;
  useLayoutEffect(() => {
    const current = bindPostedComments(panel, next => {
      if (next?.pinned) dismiss.current();
      if (!next) setEditing(null);
      setPreview(next);
    });
    binding.current = current;
    return () => { current.dispose(); binding.current = null; };
  }, []);
  useLayoutEffect(() => { binding.current?.refresh(annotations); }, [annotations]);
  useEffect(() => { if (draftOpen) binding.current?.close(); }, [draftOpen]);
  useLayoutEffect(() => {
    const element = panel.current;
    const canvas = document.querySelector<HTMLElement>('.canvas');
    const drawer = document.querySelector<HTMLElement>('.drawer');
    if (!preview || !element || !canvas) return;
    const position = () => {
      const anchor = preview.range?.startContainer.isConnected ? preview.range.getBoundingClientRect() : preview.anchor;
      const place = () => commentPosition(anchor, canvas.getBoundingClientRect(), drawer?.getBoundingClientRect(), element.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, true);
      const bounds = place();
      element.style.maxWidth = `${bounds.maxWidth}px`;
      element.style.maxHeight = `${bounds.maxHeight}px`;
      const placed = place();
      element.style.left = `${placed.left}px`;
      element.style.top = `${placed.top}px`;
      element.style.visibility = 'visible';
    };
    position();
    if (preview.focus) element.querySelector<HTMLButtonElement>('button')?.focus();
    const movement = new MutationObserver(position);
    const watch = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'open'] };
    movement.observe(canvas, watch);
    if (drawer) movement.observe(drawer, watch);
    const observer = new ResizeObserver(position);
    observer.observe(element);
    observer.observe(canvas);
    if (drawer) observer.observe(drawer);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => { movement.disconnect(); observer.disconnect(); window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); };
  }, [preview]);
  const show = useCallback((annotation: Annotation, element: HTMLElement, keyboard: boolean) => {
    dismiss.current();
    binding.current?.show(annotation, element, keyboard);
  }, []);
  const entries = preview ? annotations.filter(annotation => preview.ids.includes(annotation.id)) : [];
  const editButton = (annotation: Annotation) => editing !== annotation.id && <button type="button" className="icon-btn" aria-label="Edit comment" data-tooltip="Edit comment" onClick={() => { binding.current?.setEditing(true); setEditing(annotation.id); }}><Pencil size={16} /></button>;
  return {
    show,
    content: preview && entries.length > 0 ? <div ref={panel} className="posted-comment-popover" role="dialog" aria-label="Saved comments" style={{ position: 'fixed', visibility: 'hidden' }} onPointerEnter={() => binding.current?.hold()} onPointerLeave={() => binding.current?.leave()}>
      <div className="row between"><h2>Saved comments</h2><div className="row">{entries.length === 1 && editButton(entries[0])}<button type="button" className="icon-btn" aria-label="Close saved comments" data-tooltip="Close saved comments" onClick={() => binding.current?.close()}><X size={16} /></button></div></div>
      {entries.map(annotation => <div className="posted-comment-entry" key={annotation.id}>
        {entries.length > 1 && <div className="row end">{editButton(annotation)}</div>}
        {annotation.selectedText && <blockquote>{annotation.selectedText}</blockquote>}
        {editing === annotation.id ? <CommentEditor key={annotation.id} comment={annotation.comment} onCancel={() => { setEditing(null); binding.current?.setEditing(false); }} onSave={comment => { onEdit(annotation.id, comment); setEditing(null); binding.current?.setEditing(false, true); }} /> : <>
          <p>{annotation.comment}</p>
        </>}
      </div>)}
    </div> : null,
  };
}
