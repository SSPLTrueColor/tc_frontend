import { useState } from 'react';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { can } from '../../services/authz';
import { getOrganisation } from '../../services/catalog/admin';
import { useActor } from '../../services/hooks';
import { EmptyState, ErrorState, NoAccess, Tabs } from '../../components/primitives/feedback';
import { EmptyValue } from '../../components/primitives/display';
import { Clip, SettingsPage, SettingsSection, SettingsSkeleton } from '../../components/settings/kit';
import { usePaged } from './kit';
import { OrgChart } from './OrgChart';

const O = L.admin.organisation;
const title = L.nav.pages.organisationHierarchy.title;

/** ADM-01 / FR-119: divisions, territories / hubs and the reporting hierarchy that drives visibility and approvals. */
export function OrganisationPage() {
  const actor = useActor();
  const [tab, setTab] = useState<'chart' | 'lists'>('chart');
  const q = useServiceQuery(() => getOrganisation(actor), [actor.user.id]);
  const territories = usePaged(q.data?.territories ?? [], 10);
  if (!can(actor, 'org.view')) return <NoAccess what={O.noAccessWhat} />;
  if (q.error)
    return (
      <SettingsPage title={title} description={O.short}>
        <ErrorState title={O.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </SettingsPage>
    );
  if (!q.data)
    return (
      <SettingsPage title={title} description={O.short}>
        <SettingsSkeleton sections={2} />
      </SettingsPage>
    );
  const { divisions, tree, inactive } = q.data;
  return (
    <SettingsPage title={title} description={O.short}>
      <Tabs label={O.tabsLabel} value={tab} onChange={setTab} tabs={[{ id: 'chart', label: O.tabChart }, { id: 'lists', label: O.tabLists }]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="st-stack">
        {tab === 'chart' &&
          (tree.length ? (
            <SettingsSection wide title={O.hierarchy} help={O.hierarchyTip}>
              <OrgChart tree={tree} ws={actor.workspaceId} divisions={divisions} />
            </SettingsSection>
          ) : (
            <EmptyState icon="users" title={O.noUsers} />
          ))}
        {tab === 'lists' && (
          <>
            <SettingsSection wide title={O.divisions} help={O.divisionsHelp}>
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
                        <td>
                          <Clip text={d.label} />
                        </td>
                        <td className="st-cell-clip">{d.heads.length ? <Clip text={d.heads.join(', ')} /> : <EmptyValue label={O.noHead} />}</td>
                        <td className="num">{d.employees}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SettingsSection>
            <SettingsSection wide title={O.territories} help={O.territoriesTip}>
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
                    {territories.shown.map((t) => (
                      <tr key={t.key}>
                        <td>
                          <Clip text={t.label} />
                        </td>
                        <td>{t.state || <EmptyValue />}</td>
                        <td className="st-cell-clip">{t.people.length ? <Clip text={t.people.join(', ')} /> : <EmptyValue label={O.nobody} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {territories.footer(O.territory.toLowerCase())}
            </SettingsSection>
          </>
        )}
      </div>
      {inactive.length > 0 && <p className="muted small">{O.inactive(inactive.length)}</p>}
    </SettingsPage>
  );
}
