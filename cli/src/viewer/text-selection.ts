import type { Draft } from './pack.js';

// Own only the draft's highlight; other viewer highlights belong to their callers.
export function bindTextSelection(popover: { current: HTMLDivElement | null }, onDraft: (draft: Draft | null) => void) {
  let active = false;
  const clearHighlight = () => {
    if (typeof CSS !== 'undefined') CSS.highlights?.delete('comment-draft');
  };
  const dismiss = () => {
    if (!active) return;
    active = false;
    clearHighlight();
    window.getSelection()?.removeAllRanges();
    onDraft(null);
  };
  const onMouseUp = (event: MouseEvent) => {
    if ((event.target as Element | null)?.closest?.('[data-review-handoff]')) return;
    if (popover.current?.contains(event.target as Node)) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    const host = selection?.anchorNode?.parentElement?.closest<HTMLElement>('[data-annotate-type]');
    if (!selection?.rangeCount || !text || !host?.dataset.annotateType || !host.dataset.annotateId) return;
    const range = selection.getRangeAt(0).cloneRange();
    clearHighlight();
    // shortcut: unsupported browsers show only the popover quote; add a fallback if those browsers need source highlighting.
    if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
      CSS.highlights.set('comment-draft', new Highlight(range));
    }
    active = true;
    onDraft({
      target: { type: host.dataset.annotateType as Draft['target']['type'], id: host.dataset.annotateId },
      selectedText: text,
      anchor: range.getBoundingClientRect(),
      range,
    });
    // The soft custom highlight replaces the operating system's active selection.
    selection.removeAllRanges();
  };
  const onPointerDown = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest?.('[data-review-handoff]')) return;
    if (!popover.current?.contains(event.target as Node)) dismiss();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as Element | null)?.closest?.('[data-review-handoff]')) return;
    if (!active || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  return {
    dismiss,
    dispose: () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (active) clearHighlight();
      active = false;
    },
  };
}
