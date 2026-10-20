import { useCallback, useState, type ReactNode } from 'react';
import { cx } from '../../lib/format';
import { FillContext, ListActionsContext } from '../primitives/DataTable';
import { PageHeader } from './PageHeader';

/**
 * The one layout for every computed list page (docs/COMPONENTS.md): header → optional KPI strip → filter bar → table → pagination.
 * Same look as the menu lists: full width, no radius, rows scroll inside and the pagination stays at the bottom of the screen.
 * Put a `DataTable` (which draws the filter bar and pagination) in `children`; pass `filters`, `summary` and `onClearFilters` to it.
 * At most ONE primary button in `actions`.
 */
export function ListPage({ title, description, actions, tabs, kpis, className, children }: { title: string; description?: string; actions?: ReactNode; tabs?: ReactNode; kpis?: ReactNode; className?: string; children: ReactNode }) {
  // The page buttons move into the first table's filter bar (one row: search … count · buttons · filter · columns).
  const [owner, setOwner] = useState<string | null>(null);
  const claim = useCallback((id: string) => {
    setOwner((o) => o ?? id);
    return () => setOwner((o) => (o === id ? null : o));
  }, []);
  return (
    <div className={cx('page page-resource', className)}>
      <div className="page-main">
        <PageHeader title={title} description={description} actions={owner ? undefined : actions} />
        {tabs}
        {kpis}
        <ListActionsContext.Provider value={{ actions, owner, claim }}>
          <FillContext.Provider value={true}>{children}</FillContext.Provider>
        </ListActionsContext.Provider>
      </div>
    </div>
  );
}
