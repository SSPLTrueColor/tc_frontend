import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Multi-value cell (shared component): shows as many chips as fit on ONE line, then a "+N" chip.
 * Hovering/focusing "+N" opens the global tooltip with a heading ("5 WORKING DAYS") and the full list.
 * Re-measures when the cell is resized.
 */
export function OverflowChips({ items, label, tone, interactive = true }: { items: string[]; label: string; tone?: 'accent'; interactive?: boolean }) {
  const wrap = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(items.length);

  useLayoutEffect(() => {
    const calc = () => {
      const box = wrap.current;
      const m = measure.current;
      if (!box || !m) return;
      const avail = box.clientWidth;
      const chips = Array.from(m.children) as HTMLElement[];
      const gap = 4;
      const plusW = 34; // room reserved for the "+N" chip
      let used = 0;
      let n = 0;
      for (let i = 0; i < chips.length; i++) {
        const w = chips[i].offsetWidth + (i ? gap : 0);
        const needPlus = i < chips.length - 1 ? plusW + gap : 0;
        if (used + w + needPlus > avail) break;
        used += w;
        n++;
      }
      setFit(Math.max(n, Math.min(1, chips.length)));
    };
    calc();
    if (typeof ResizeObserver === 'undefined' || !wrap.current) return;
    const ro = new ResizeObserver(calc);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [items.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const hidden = items.length - fit;
  return (
    <span ref={wrap} className={`overflow-chips${tone ? ` overflow-chips--${tone}` : ''}`}>
      {/* invisible copy used only to measure chip widths */}
      <span ref={measure} className="overflow-chips-measure" aria-hidden="true">
        {items.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </span>
      {items.slice(0, fit).map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
      {hidden > 0 && (
        <span
          className="tag tag-more"
          tabIndex={interactive ? 0 : undefined}
          role={interactive ? 'button' : undefined}
          aria-label={interactive ? `${hidden} more: ${items.slice(fit).join(', ')}` : undefined}
          data-tooltip={items.join('\n')}
          data-tooltip-title={`${items.length} ${label}`}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}
