import { useRef, useState, type ReactNode } from 'react';
import { L } from '../../constants/labels';
import { cx } from '../../lib/format';
import { Button } from './Button';
import { Icon } from './Icon';
import { Popover } from './overlay';

const LS = L.common.list;

/**
 * The app's one filter control for pages with their own filter widgets: funnel icon button (count badge when
 * filters are on) opening the standard filter panel — compact header · page filters in a 2-column grid · Clear all / Done.
 * Same look as the main lists' FilterButton (ViewControls); place it at the right end of the toolbar, before Columns.
 */
export function FilterPanelButton({ active, onClear, children }: { active: number; onClear?: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={ref}
        icon="filter"
        title={active ? LS.filtersActive(active) : LS.filters}
        aria-label={active ? LS.filtersActive(active) : LS.filters}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cx('filter-btn', 'is-icon-only', open && 'is-open', active > 0 && 'is-active')}
        onClick={() => setOpen((o) => !o)}
      >
        {active > 0 && <span className="filter-count" aria-hidden="true">{active}</span>}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={LS.filters} width={480} className="filter-pop" align="end">
        <div className="qf qf-grouped">
          <div className="qf-head">
            <span className="qf-head-icon" aria-hidden="true">
              <Icon name="filter" size={18} />
            </span>
            <div className="qf-head-text">
              <strong className="qf-head-title">{LS.filters}</strong>
              <p className="qf-hint">{LS.matchAllHint}</p>
            </div>
            <span className={cx('qf-active-count', active > 0 && 'is-on')}>{LS.filtersActiveCount(active)}</span>
          </div>
          <section className="qf-section">
            <div className="dt-filters">{children}</div>
          </section>
        </div>
        <div className="qf-foot">
          {onClear && (
            <Button variant="ghost" icon="reset" className="qf-clear" disabled={active === 0} onClick={onClear}>
              {L.common.actions.clearAll}
            </Button>
          )}
          <Button variant="primary" onClick={() => setOpen(false)}>
            {L.common.actions.done}
          </Button>
        </div>
      </Popover>
    </>
  );
}
