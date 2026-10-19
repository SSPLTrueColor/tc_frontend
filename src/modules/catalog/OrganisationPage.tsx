import { useState } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { recordPeekPath } from '../../lib/routes';
import { can } from '../../services/authz';
import { getOrganisation, type OrgNode } from '../../services/catalog/admin';
import { useActor } from '../../services/hooks';
import { masterLabel } from '../../services/registry';
import { Avatar, Badge, EmptyState, ErrorState, NoAccess, Skeleton } from '../../components/primitives/feedback';
import { EmptyValue } from '../../components/primitives/display';
import { InfoTip } from '../../components/primitives/InfoTip';
import { PageHeader } from '../../components/shell/PageHeader';

const O = L.admin.organisation;

/** Keeps a node when it or anyone below it matches; matching nodes keep their whole subtree. */
function filterTree(nodes: OrgNode[], q: string): OrgNode[] {
  if (!q) return nodes;
  return nodes.flatMap((n) => {
    const hit = `${String(n.employee.fullName)} ${String(n.employee.designation ?? '')}`.toLowerCase().includes(q);
    if (hit) return [n];
    const reports = filterTree(n.reports, q);
    return reports.length ? [{ ...n, reports }] : [];
  });
}

function Tree({ nodes, ws }: { nodes: OrgNode[]; ws: string }) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.employee.id}>
          <span className="cat-node">
            <Avatar name={String(n.employee.fullName)} size={22} />
            <Link className="rel-link" to={recordPeekPath(ws, 'employees', n.employee.id)}>
              {String(n.employee.fullName)}
            </Link>
            <span className="muted small">
              {String(n.employee.designation)} · {masterLabel('role', n.employee.roleId)}
            </span>
            {n.reports.length > 0 && <Badge tone="neutral">{n.reports.length}</Badge>}
          </span>
          {n.reports.length > 0 && <Tree nodes={n.reports} ws={ws} />}
        </li>
      ))}
    </ul>
  );
}

/** ADM-01 / FR-119: divisions, territories / hubs and the reporting hierarchy that drives visibility and approvals. */
export function OrganisationPage() {
  const actor = useActor();
  const [search, setSearch] = useState('');
  const q = useServiceQuery(() => getOrganisation(actor), [actor.user.id]);
  if (!can(actor, 'org.view')) return <NoAccess what={O.noAccessWhat} />;
  const header = <PageHeader title={L.nav.pages.organisationHierarchy.title} description={O.description} />;
  if (q.error)
    return (
      <div className="page">
        {header}
        <ErrorState title={O.loadError} onRetry={q.retry}>
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
  const shown = filterTree(tree, search.trim().toLowerCase());
  return (
    <div className="page">
      {header}
      <div className="cat-grid">
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            {O.hierarchy}
            <InfoTip text={O.hierarchyTip} label={O.hierarchyTipLabel} />
          </h2>
          <div className="toolbar">
            <input type="search" className="input input-compact" placeholder={O.searchPlaceholder} aria-label={O.searchLabel} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!tree.length ? (
            <EmptyState icon="users" title={O.noUsers} />
          ) : shown.length ? (
            <div className="cat-tree">
              <Tree nodes={shown} ws={actor.workspaceId} />
            </div>
          ) : (
            <EmptyState icon="search" title={O.noMatch} />
          )}
          {inactive.length > 0 && <p className="muted small">{O.inactive(inactive.length)}</p>}
        </section>
        <div className="cat-stack">
          <section className="panel">
            <h2 className="panel-title">{O.divisions}</h2>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">{O.division}</th>
                    <th scope="col">{O.head}</th>
                    <th scope="col" className="num">
                      {O.people}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {divisions.map((d) => (
                    <tr key={d.key}>
                      <td>{d.label}</td>
                      <td>{d.heads.length ? d.heads.join(', ') : <EmptyValue label={O.noHead} />}</td>
                      <td className="num">{d.employees}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2 className="panel-title dialog-title-row">
              {O.territories}
              <InfoTip text={O.territoriesTip} label={O.territoriesTipLabel} />
            </h2>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">{O.territory}</th>
                    <th scope="col">{O.state}</th>
                    <th scope="col">{O.people}</th>
                  </tr>
                </thead>
                <tbody>
                  {territories.map((t) => (
                    <tr key={t.key}>
                      <td>{t.label}</td>
                      <td>{t.state || <EmptyValue />}</td>
                      <td>{t.people.length ? t.people.join(', ') : <EmptyValue label={O.nobody} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
