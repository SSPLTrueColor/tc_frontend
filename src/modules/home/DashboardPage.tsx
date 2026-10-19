import { PageHeader } from '../../components/shell/PageHeader';
import { EmptyState } from '../../components/primitives/feedback';

export function DashboardPage() {
  return (
    <div className="page">
      <PageHeader title="Overview" description="Role-based summary of sales and service activity." />
      <EmptyState icon="layout-dashboard" title="Nothing here yet">
        Modules will appear here as they are built.
      </EmptyState>
    </div>
  );
}
