import { useEffect, useRef } from 'react';
import { hasOpenLayer } from '../../components/primitives/overlay';
import type { ViewId } from './calendarUtils';

export interface ShortcutActions {
  today: () => void;
  prev: () => void;
  next: () => void;
  view: (v: ViewId) => void;
  create: () => void;
  search: () => void;
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || !!el.closest?.('[role="listbox"],[role="menu"]');
};

/** T today · M/W/D/A views · ← → previous / next · C create · / search. Ignored while typing or when a dialog / popover is open. */
export function useCalendarShortcuts(actions: ShortcutActions, enabled = true) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || hasOpenLayer()) return;
      const a = ref.current;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (k === 't') run(a.today);
      else if (k === 'm') run(() => a.view('dayGridMonth'));
      else if (k === 'w') run(() => a.view('timeGridWeek'));
      else if (k === 'd') run(() => a.view('timeGridDay'));
      else if (k === 'a') run(() => a.view('agenda'));
      else if (k === 'c') run(a.create);
      else if (k === '/') run(a.search);
      else if (k === 'ArrowLeft') run(a.prev);
      else if (k === 'ArrowRight') run(a.next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
