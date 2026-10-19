import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/format';

/** Initials from a display name ("Dr. Amara Osei" → "AO"). */
export const initialsOf = (name: string) =>
  name
    .replace(/^Dr\.\s+/, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
const hueOf = (name: string) => [...name].reduce((h, c) => (h + c.charCodeAt(0) * 7) % 360, 0);

/**
 * Shared picture tile: shows the image when there is one, otherwise a soft coloured initials tile.
 * `shape="circle"` for people avatars, `"rounded"` for record images (like a product photo or "AP" tile).
 */
export function ImageTile({ src, name, size = 32, shape = 'rounded' }: { src?: string | null; name: string; size?: number; shape?: 'circle' | 'rounded' }) {
  const style = { width: size, height: size, ['--avatar-h' as string]: hueOf(name) };
  if (src) return <img className={cx('img-tile', `is-${shape}`)} src={src} alt="" width={size} height={size} style={style} loading="lazy" />;
  return (
    <span className={cx('img-tile img-tile-initials', `is-${shape}`)} style={style} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

/** One person: avatar + name — with a muted subtitle (e.g. role) as a second line when given. */
export function PersonChip({ name, src, subtitle }: { name: string; src?: string | null; subtitle?: string }) {
  if (!subtitle)
    return (
      <span className="person-chip">
        <ImageTile src={src} name={name} size={22} shape="circle" />
        <span className="person-name">{name}</span>
      </span>
    );
  return (
    <span className="person-chip is-rich">
      <ImageTile src={src} name={name} size={32} shape="circle" />
      <span className="person-lines">
        <span className="person-name">{name}</span>
        <span className="person-sub">{subtitle}</span>
      </span>
    </span>
  );
}

export interface PersonInfo {
  name: string;
  src?: string | null;
  subtitle?: string;
}

/**
 * Several people: overlapping avatars (max 3) then "+N". Hover / keyboard focus opens a people card:
 * an uppercase header band ("3 PEOPLE ASSIGNED") and one row per person — avatar, name, muted subtitle.
 */
export function AvatarStack({ people, label = 'people', max = 3 }: { people: PersonInfo[]; label?: string; max?: number }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean; arrow: number } | null>(null);
  const timer = useRef<number>();
  const heading = `${people.length} ${people.length === 1 ? 'person' : 'people'} assigned`;

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const W = 248;
      const left = Math.max(8, Math.min(r.left + r.width / 2 - 32, window.innerWidth - W - 8));
      const estH = 40 + Math.min(5, people.length) * 44;
      const below = r.bottom + 10 + estH < window.innerHeight || r.top < estH + 10;
      setPos({ left, top: below ? r.bottom + 8 : r.top - 8, below, arrow: r.left + r.width / 2 - left });
    }, 120);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPos(null), 120);
  };
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // scrolling the page closes the card, scrolling INSIDE the card's list does not
    const onScroll = (e: Event) => !(e.target instanceof Element && e.target.closest('.people-card')) && close();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <span
        ref={ref}
        className="avatar-stack"
        tabIndex={0}
        role="button"
        aria-label={`${heading}: ${people.map((p) => p.name).join(', ')}`}
        aria-expanded={!!pos}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.stopPropagation()}
      >
        {shown.map((p, i) => (
          <ImageTile key={`${p.name}-${i}`} src={p.src} name={p.name} size={26} shape="circle" />
        ))}
        {more > 0 && <span className="avatar-more">+{more}</span>}
      </span>
      {pos &&
        createPortal(
          <div
            className={cx('people-card', pos.below ? 'is-below' : 'is-above')}
            role="dialog"
            aria-label={`${heading} — ${label}`}
            style={{ left: pos.left, top: pos.top, ['--arrow-x' as string]: `${pos.arrow}px` }}
            onMouseEnter={() => window.clearTimeout(timer.current)}
            onMouseLeave={hide}
          >
            <div className="people-card-head">{heading}</div>
            <ul className="people-card-list">
              {people.map((p, i) => (
                <li key={`${p.name}-${i}`} className="people-card-row">
                  <ImageTile src={p.src} name={p.name} size={32} shape="circle" />
                  <span className="people-card-lines">
                    <span className="people-card-name">{p.name}</span>
                    {p.subtitle && <span className="people-card-sub">{p.subtitle}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
