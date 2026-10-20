import { useState } from 'react';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { can } from '../../services/authz';
import { getOrganisation } from '../../services/catalog/admin';
import { useActor } from '../../services/hooks';
import { EmptyState, ErrorState, NoAccess, Skeleton, Tabs } from '../../components/primitives/feedback';
import { OrgChart } from './OrgChart';
import { EmptyValue } from '../../components/primitives/display';
import { InfoTip } from '../../components/primitives/InfoTip';
import { PageHeader } from '../../components/shell/PageHeader';

const O = L.admin.organisation;

/** ADM-01 / FR-119: divisions, territories / hubs and the reporting hierarchy that drives visibility and approvals. */
export function OrganisationPage() {
  const actor = useActor();
  const [tab, setTab] = useState<'chart' | 'lists'>('chart');
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
  return (
    <div className="page">
      {header}
      <Tabs label={O.tabsLabel} value={tab} onChange={setTab} tabs={[{ id: 'chart', label: O.tabChart }, { id: 'lists', label: O.tabLists }]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'chart' &&
          (tree.length ? (
            <OrgChart tree={tree} ws={actor.workspaceId} divisions={divisions} />
          ) : (
            <EmptyState icon="users" title={O.noUsers} />
          ))}
        {tab === 'lists' && (
          <div className="cat-grid">
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
        )}
      </div>
      {inactive.length > 0 && <p className="muted small">{O.inactive(inactive.length)}</p>}
    </div>
  );
}
