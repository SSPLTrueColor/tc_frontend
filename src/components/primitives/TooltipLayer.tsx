import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * ONE global tooltip layer (mounted once in <App/>). Rendered in a portal on top of
 * everything, so tooltips are never clipped by tables, sticky columns or scroll areas.
 *
 * It shows:
 *  1. `data-tooltip="text"` on any element (optional `data-tooltip-placement="right"`),
 *  2. the full text of any element truncated with an ellipsis or line clamp.
 * Hover (short delay) or keyboard focus opens it; leaving, scrolling, clicking or Esc closes it.
 */
interface Tip {
  text: string;
  /** Optional heading for list tooltips (data-tooltip-title); text lines become list items. */
  title?: string;
  rect: DOMRect;
  placement: 'top' | 'bottom' | 'right';
}

function isClipped(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const clamp = (cs as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp;
  if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return true;
  if (clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1) return true;
  return false;
}

function findTarget(t: EventTarget | null): { el: Element; text: string; title?: string; placement: Tip['placement'] } | null {
  if (!(t instanceof Element)) return null;
  if (t.closest('.tooltip-bubble')) return null;
  // Walk outwards from the hovered element; the NEAREST source wins. On the same element,
  // truncated text beats a data-tooltip hint (the full value matters most).
  const explicitOf = (node: Element) => {
    const text = node.getAttribute('data-tooltip') ?? '';
    if (!text) return null;
    const pl = node.getAttribute('data-tooltip-placement');
    // Icon rail sits at the screen's left edge, so its tooltips open to the right.
    const placement: Tip['placement'] = pl === 'right' || pl === 'bottom' ? pl : node.closest('.rail') ? 'right' : 'top';
    return { el: node, text, title: node.getAttribute('data-tooltip-title') ?? undefined, placement };
  };
  let el: Element | null = t;
  for (let i = 0; el && i < 4; i++, el = el.parentElement) {
    if (el instanceof HTMLElement && isClipped(el)) {
      const text = el.innerText.replace(/\s+/g, ' ').trim();
      if (text) return { el, text, placement: 'top' };
    }
    if (el.hasAttribute('data-tooltip')) return explicitOf(el);
  }
  const explicit = t.closest('[data-tooltip]');
  if (explicit) return explicitOf(explicit);
  return null;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; arrow: number; placement: Tip['placement'] } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const show = (e: Event, delay: number) => {
      const found = findTarget(e.target);
      if (!found) {
        if (current) hide();
        return;
      }
      if (found.el === current) return;
      current = found.el;
      clearTimeout(timer);
      timer = setTimeout(() => setTip({ text: found.text, title: found.title, rect: found.el.getBoundingClientRect(), placement: found.placement }), delay);
    };
    const over = (e: MouseEvent) => show(e, 350);
    const focus = (e: FocusEvent) => {
      // Keyboard focus only (not mouse clicks); browsers without :focus-visible fall back to showing.
      let keyboard = true;
      try {
        keyboard = (e.target as Element).matches(':focus-visible');
      } catch {
        /* unsupported selector */
      }
      if (keyboard) show(e, 0);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current) hide();
    };
    // Tap/click on an element marked data-tooltip-toggle (e.g. the ⓘ icon) opens its tooltip
    // immediately (mousedown already closed any other tooltip).
    const click = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tooltip-toggle]');
      if (!el) return;
      current = null;
      show(e, 0);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', key);
    document.addEventListener('click', click);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', key);
      document.removeEventListener('click', click);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Place above (default), flip below when there is no room, keep inside the viewport.
  useLayoutEffect(() => {
    if (!tip || !bubble.current) {
      setPos(null);
      return;
    }
    const b = bubble.current.getBoundingClientRect();
    const r = tip.rect;
    const gap = 8;
    const vw = window.innerWidth;
    if (tip.placement === 'right') {
      setPos({ top: r.top + r.height / 2 - b.height / 2, left: r.right + gap, arrow: b.height / 2, placement: 'right' });
      return;
    }
    let placement: Tip['placement'] = tip.placement;
    let top = placement === 'top' ? r.top - b.height - gap : r.bottom + gap;
    if (placement === 'top' && top < 8) {
      placement = 'bottom';
      top = r.bottom + gap;
    } else if (placement === 'bottom' && top + b.height > window.innerHeight - 8) {
      placement = 'top';
      top = r.top - b.height - gap;
    }
    const centre = r.left + r.width / 2;
    const left = Math.min(Math.max(8, centre - b.width / 2), vw - b.width - 8);
    setPos({ top, left, arrow: Math.min(Math.max(12, centre - left), b.width - 12), placement });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      className={`tooltip-bubble tip-${pos?.placement ?? tip.placement}${tip.title ? ' has-list' : ''}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, ['--tip-arrow' as string]: `${pos?.arrow ?? 0}px` }}
    >
      {tip.title ? (
        <>
          <span className="tooltip-title">{tip.title}</span>
          <span className="tooltip-list">
            {tip.text.split('\n').map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </span>
        </>
      ) : (
        tip.text
      )}
    </div>,
    document.body,
  );
}
