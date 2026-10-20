import { useEffect, useRef } from 'react';
import { hasOpenLayer } from '../components/primitives/overlay';

/**
 * Single-key shortcuts for the frequent actions on a page (N = new, / = search). They never fire while typing in a
 * field, with a modifier key held, or while a dialog / drawer / menu is open. Show the key in the button's tooltip.
 */
export function useShortcuts(map: Record<string, (() => void) | undefined>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (hasOpenLayer()) return;
      const fn = ref.current[e.key.toLowerCase()];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
