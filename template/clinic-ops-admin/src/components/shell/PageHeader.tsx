import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { InfoTip } from '../primitives/InfoTip';

export { InfoTip };

export const TOPBAR_TITLE_SLOT = 'topbar-title';

/**
 * Page header (project rule): the page title + ⓘ description tooltip render in the
 * TOP BAR (left), not in the page. No breadcrumb row. Optional `actions` render as
 * a right-aligned row in the page; list pages put their actions in the view toolbar.
 * `crumbs` is accepted for API compatibility but not rendered.
 */
export function PageHeader({ title, description, actions }: { title: string; description?: string; crumbs?: { label: string; to?: string }[]; actions?: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(TOPBAR_TITLE_SLOT)), []);
  useEffect(() => {
    document.title = `${title} · Clinic Operations Admin`;
  }, [title]);
  return (
    <>
      {slot &&
        createPortal(
          <>
            <h1 className="page-title">{title}</h1>
            {description && <InfoTip text={description} label={`About ${title}`} />}
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

