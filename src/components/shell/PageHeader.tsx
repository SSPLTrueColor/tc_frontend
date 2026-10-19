import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { InfoTip } from '../primitives/InfoTip';
import { Icon } from '../primitives/Icon';
import { L } from '../../constants/labels';

export { InfoTip };

export const TOPBAR_TITLE_SLOT = 'topbar-title';

/**
 * Page header (project rule): the page title + ⓘ description tooltip render in the
 * TOP BAR (left), not in the page. No breadcrumb row. Optional `actions` render as
 * a right-aligned row in the page; list pages put their actions in the view toolbar.
 * `crumbs` is accepted for API compatibility but not rendered.
 */
export function PageHeader({ title, description, actions, onBack }: { title: string; description?: string; crumbs?: { label: string; to?: string }[]; actions?: ReactNode; onBack?: () => void }) {
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
            {onBack && (
              <button type="button" className="page-back" aria-label={L.common.actions.back} data-tooltip={L.common.actions.back} onClick={onBack}>
                <Icon name="chevron-left" size={20} />
              </button>
            )}
            <h1 className="page-title">{title}</h1>
            {/* Owner rule (latest): no ⓘ next to page titles; the description stays available to screen readers */}
            {description && <span className="sr-only">{description}</span>}
          </>,
          slot,
        )}
      {actions && (
        <div className="page-header">
          <div className="page-actions">{actions}</div>
        </div>
      )}
    </>
  );
}

