import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Rect = { left: number; top: number; width: number; height: number };
export function tooltipPosition(anchor: Rect, tooltip: { width: number; height: number }, viewport: { width: number; height: number }) {
  const margin = 8;
  const below = anchor.top + anchor.height + margin;
  const top = below + tooltip.height <= viewport.height - margin ? below : anchor.top - tooltip.height - margin;
  return {
    left: Math.max(margin, Math.min(anchor.left + (anchor.width - tooltip.width) / 2, viewport.width - tooltip.width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - tooltip.height - margin)),
  };
}
export function describedBy(value: string | null, id: string, add: boolean) {
  const tokens = (value ?? '').split(/\s+/).filter(token => token && token !== id);
  if (add) tokens.push(id);
  return tokens.join(' ') || null;
}

export function AppTooltipLayer() {
  const id = useId();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const dismiss = useRef<() => void>(() => {});
  const keepOpen = useRef<() => void>(() => {});
  const leave = useRef<() => void>(() => {});
  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    let touch = false;
    let focused: HTMLElement | null = null;
    const cancel = () => { clearTimeout(showTimer); clearTimeout(leaveTimer); };
    const hide = () => { cancel(); setTarget(null); };
    const hold = () => { clearTimeout(leaveTimer); };
    const deferHide = () => { if (focused) return; clearTimeout(showTimer); clearTimeout(leaveTimer); leaveTimer = setTimeout(hide, 150); };
    dismiss.current = hide;
    keepOpen.current = hold;
    leave.current = deferHide;
    const find = (node: EventTarget | null) => {
      const element = node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;
      return element && !element.closest('[inert], [aria-hidden="true"], [hidden]') && element.dataset.tooltip ? element : null;
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons || focused) return;
      touch = false;
      const element = find(event.target);
      if (!element || element.contains(event.relatedTarget as Node | null)) return;
      cancel();
      setTarget(null);
      showTimer = setTimeout(() => setTarget(element), 300);
    };
    const out = (event: PointerEvent) => {
      const element = find(event.target);
      if (element && !element.contains(event.relatedTarget as Node | null)) deferHide();
    };
    const focus = (event: FocusEvent) => {
      const element = find(event.target);
      if (touch || !element?.matches(':focus-visible')) return;
      focused = element;
      cancel();
      setTarget(element);
    };
    const blur = () => { focused = null; hide(); };
    const pointerDown = (event: PointerEvent) => { touch = event.pointerType === 'touch'; hide(); };
    const key = (event: KeyboardEvent) => { touch = false; if (event.key === 'Escape') hide(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('dragstart', hide, true);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      cancel();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('dragstart', hide, true);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);
  useLayoutEffect(() => {
    if (!target || !tip.current) return;
    setPosition(tooltipPosition(target.getBoundingClientRect(), tip.current.getBoundingClientRect(), { width: innerWidth, height: innerHeight }));
    target.setAttribute('aria-describedby', describedBy(target.getAttribute('aria-describedby'), id, true)!);
    const observer = new MutationObserver(() => { if (!target.isConnected) dismiss.current(); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      const value = describedBy(target.getAttribute('aria-describedby'), id, false);
      if (value) target.setAttribute('aria-describedby', value);
      else target.removeAttribute('aria-describedby');
    };
  }, [target, id]);
  return target ? createPortal(<div ref={tip} id={id} role="tooltip" className="ui-tooltip" style={{ position: 'fixed', ...position }} onPointerEnter={() => keepOpen.current()} onPointerLeave={() => leave.current()}>{target.dataset.tooltip}</div>, document.body) : null;
}
