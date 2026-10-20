import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { InfoTip } from '../primitives/InfoTip';
import { Icon } from '../primitives/Icon';
import { L } from '../../constants/labels';

export { InfoTip };

export const TOPBAR_TITLE_SLOT = 'topbar-title';

export interface Crumb {
  label: string;
  /** Where the crumb goes. */
  to?: string;
  /** Use instead of `to` when leaving must be intercepted (unsaved-changes guard). */
  onClick?: () => void;
}

/**
 * Page header — the same on every page:
 *   top bar:  breadcrumb › Title       (breadcrumb only on detail and nested pages; the title never scrolls away)
 *   page:     actions (right) — page descriptions are not shown
 * Put at most ONE primary (filled) button in `actions`; everything else is secondary, ghost, or in a ⋯ menu.
 */
export function PageHeader({ title, crumbs, actions, onBack }: { title: string; description?: string; crumbs?: Crumb[]; actions?: ReactNode; onBack?: () => void }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(TOPBAR_TITLE_SLOT)), []);
  useEffect(() => {
    document.title = L.common.docTitle(title);
  }, [title]);
  return (
    <>
      {slot &&
        createPortal(
          <>
            {onBack && !crumbs?.length && (
              <button type="button" className="page-back" aria-label={L.common.actions.back} data-tooltip={L.common.actions.back} onClick={onBack}>
                <Icon name="chevron-left" size={20} />
              </button>
            )}
            {!!crumbs?.length && (
              <nav className="crumbs" aria-label={L.common.nav.breadcrumb}>
                {crumbs.map((c) => (
                  <span key={c.label} className="crumb">
                    {c.to ? (
                      <Link to={c.to}>{c.label}</Link>
                    ) : c.onClick ? (
                      <button type="button" className="crumb-btn" onClick={c.onClick}>
                        {c.label}
                      </button>
                    ) : (
                      c.label
                    )}
                    <Icon name="chevron-right" size={12} />
                  </span>
                ))}
              </nav>
            )}
            <h1 className="page-title">{title}</h1>
          </>,
          slot,
        )}
      {/* Page descriptions are no longer shown under the title; `description` is kept so callers still compile. */}
      {actions && (
        <div className="page-intro">
          <span />
          {actions && <div className="page-actions">{actions}</div>}
        </div>
      )}
    </>
  );
}
