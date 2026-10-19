import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { can } from '../../services/authz';
import { getOrganisation, type OrgNode } from '../../services/catalog/admin';
import { useActor } from '../../services/hooks';
import { masterLabel } from '../../services/registry';
import { Avatar, Badge, EmptyState, ErrorState, NoAccess, Skeleton } from '../../components/primitives/feedback';
import { EmptyValue } from '../../components/primitives/display';
import { InfoTip } from '../../components/primitives/InfoTip';
import { PageHeader } from '../../components/shell/PageHeader';

function Tree({ nodes }: { nodes: OrgNode[] }) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.employee.id}>
          <span className="cat-node">
            <Avatar name={String(n.employee.fullName)} size={22} />
            <Link className="rel-link" to={`/employees?peek=${n.employee.id}`}>
              {String(n.employee.fullName)}
            </Link>
            <span className="muted small">
              {String(n.employee.designation)} · {masterLabel('role', n.employee.roleId)}
            </span>
            {n.reports.length > 0 && <Badge tone="neutral">{n.reports.length}</Badge>}
          </span>
          {n.reports.length > 0 && <Tree nodes={n.reports} />}
        </li>
      ))}
    </ul>
  );
}

/** FR-119: divisions, territories and the reporting hierarchy that drives visibility and approvals. */
export function OrganisationPage() {
  const actor = useActor();
  const q = useServiceQuery(() => getOrganisation(actor), [actor.user.id]);
  if (!can(actor, 'org.view')) return <NoAccess what="the organisation structure" />;
  const header = <PageHeader title="Organisation" description="Divisions, territories and reporting lines. Reporting managers decide who sees team records and who approves first; change them on the employee record." />;
  if (q.error)
    return (
      <div className="page">
        {header}
        <ErrorState title="Could not load the organisation" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        {header}
        <Skeleton rows={8} />
      </div>
    );
  const { divisions, territories, tree, inactive } = q.data;
  return (
    <div className="page">
      {header}
      <div className="cat-grid">
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            Reporting hierarchy
            <InfoTip text="Own → team (everyone below you) → division → company-wide. Edit “Reports to” on an employee to move them." label="About the hierarchy" />
          </h2>
          {tree.length ? (
            <div className="cat-tree">
              <Tree nodes={tree} />
            </div>
          ) : (
            <EmptyState icon="users" title="No active employees" />
          )}
          {inactive.length > 0 && <p className="muted small">{inactive.length} inactive employee(s) are not shown.</p>}
        </section>
        <div className="cat-stack">
          <section className="panel">
            <h2 className="panel-title">Divisions</h2>
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Division</th>
                  <th scope="col">Head</th>
                  <th scope="col" className="num">
                    People
                  </th>
                </tr>
              </thead>
              <tbody>
                {divisions.map((d) => (
                  <tr key={d.key}>
                    <td>{d.label}</td>
                    <td>{d.heads.length ? d.heads.join(', ') : <EmptyValue label="No head assigned" />}</td>
                    <td className="num">{d.employees}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel">
            <h2 className="panel-title dialog-title-row">
              Territories / hubs
              <InfoTip text="Territories are a master list (Configuration studio → Masters). People are linked on their employee record." label="About territories" />
            </h2>
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Territory</th>
                  <th scope="col">State</th>
                  <th scope="col">People</th>
                </tr>
              </thead>
              <tbody>
                {territories.map((t) => (
                  <tr key={t.key}>
                    <td>{t.label}</td>
                    <td>{t.state || <EmptyValue />}</td>
                    <td>{t.people.length ? t.people.join(', ') : <EmptyValue label="Nobody assigned" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
