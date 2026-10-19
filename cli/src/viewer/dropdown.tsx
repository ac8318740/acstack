import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type DropdownOption = { value: string; label: string };

export function dropdownPosition(rect: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>, height: number, viewport: { width: number; height: number }) {
  const width = Math.min(Math.max(rect.width, 240), Math.max(0, viewport.width - 16));
  const below = Math.max(0, viewport.height - rect.bottom - 12);
  const above = Math.max(0, rect.top - 12);
  const flip = below < Math.min(height, 280) && above > below;
  const maxHeight = Math.min(280, Math.max(0, viewport.height - 16), flip ? above : below);
  const menuHeight = Math.min(height, maxHeight);
  const top = Math.max(8, Math.min(flip ? rect.top - menuHeight - 4 : rect.bottom + 4, viewport.height - menuHeight - 8));
  return { width, left: Math.max(8, Math.min(rect.left, viewport.width - width - 8)), top, maxHeight };
}

export function Dropdown({ id, label, value, currentLabel, options, onChange }: {
  id?: string;
  label: string;
  value: string;
  currentLabel?: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listId = `${triggerId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<ReturnType<typeof dropdownPosition> | null>(null);
  const search = useRef({ text: '', time: 0 });
  const close = (restore = false) => { setOpen(false); search.current.text = ''; if (restore) trigger.current?.focus(); };
  const choose = (index: number) => { if (options[index]) onChange(options[index].value); close(true); };
  const show = (index = Math.max(0, options.findIndex(option => option.value === value))) => { setActive(index); setOpen(true); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (trigger.current && menu.current) setPosition(dropdownPosition(trigger.current.getBoundingClientRect(), menu.current.scrollHeight, { width: window.innerWidth, height: window.innerHeight }));
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open, options]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (open) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, active]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); close(true); } return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!open) show(event.key === 'End' || event.key === 'ArrowUp' ? last : event.key === 'Home' ? 0 : undefined);
      else if (event.key === 'Enter' || event.key === ' ') choose(active);
      else setActive(event.key === 'Home' ? 0 : event.key === 'End' ? last : Math.max(0, Math.min(last, active + (event.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const now = Date.now();
    const text = (now - search.current.time > 700 ? '' : search.current.text) + event.key.toLocaleLowerCase();
    search.current = { text, time: now };
    const query = [...text].every(char => char === text[0]) ? text[0] : text;
    const start = open ? active : options.findIndex(option => option.value === value);
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (start + offset + options.length) % options.length;
      if (options[index].label.toLocaleLowerCase().startsWith(query)) { show(index); break; }
    }
  };
  return <>
    <button ref={trigger} id={triggerId} type="button" className="dropdown-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined} onKeyDown={onKeyDown} onClick={() => open ? close() : show()} onBlur={() => close()}>
      <span>{currentLabel ?? options.find(option => option.value === value)?.label ?? value}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={listId} role="listbox" aria-label={label} className="dropdown-menu" style={position ?? { visibility: 'hidden' }} onPointerDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value} data-index={index} data-active={index === active} className="dropdown-option" onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </>;
}
