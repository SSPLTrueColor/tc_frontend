/**
 * Loading placeholders. One family, one pulse: pages compose these inside the same frame as the real content
 * (panel, card, table) so nothing jumps when data arrives.
 *   Skeleton (n lines) · SkeletonLine (title / label / value / sub) · SkeletonBlock (chart area)
 */
import { L } from '../../constants/labels';
import { cx } from '../../lib/format';

/** n stacked lines: the default placeholder for a list, form or text block. */
export function Skeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('skeleton', className)} aria-busy="true" aria-label={L.common.states.loading}>
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

export type SkeletonSize = 'full' | 'title' | 'label' | 'value' | 'sub';
/** One bar: `title` for a card / panel heading, `value` for a big number, `label` / `sub` for the small lines around it. */
export function SkeletonLine({ size = 'full' }: { size?: SkeletonSize }) {
  return <span className={cx('skeleton-row', `is-${size}`)} aria-hidden="true" />;
}

/** A chart-sized area. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cx('skeleton-block', className)} aria-hidden="true" />;
}
