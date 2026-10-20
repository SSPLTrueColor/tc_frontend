import type { ReactNode } from 'react';
import { cx } from '../../lib/format';
import { PageHeader } from './PageHeader';

/**
 * The one layout for every computed list page (docs/COMPONENTS.md): header → optional KPI strip → filter bar → table → pagination.
 * Put a `DataTable` (which draws the filter bar and pagination) in `children`; pass `filters`, `summary` and `onClearFilters` to it.
 * At most ONE primary button in `actions`.
 */
export function ListPage({ title, description, actions, kpis, className, children }: { title: string; description?: string; actions?: ReactNode; kpis?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cx('page', className)}>
      <PageHeader title={title} description={description} actions={actions} />
      {kpis}
      <div className="content-surface">{children}</div>
    </div>
  );
}
