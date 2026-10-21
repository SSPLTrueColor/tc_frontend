import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListPage } from '../../components/shell/ListPage';
import { DataTable } from '../../components/primitives/DataTable';
import { Button } from '../../components/primitives/Button';
import { StatusChip, NoAccess } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { useActor } from '../../services/hooks';
import { canReadResource, perm } from '../../services/authz';
import { getResource } from '../../services/registry';
import { salesRows } from '../../services/sales';
import { recordPagePath } from '../../lib/routes';
import { LeadCardActions } from './LeadActions';
import { SalesWorkspaceTabs } from './SalesWorkspaceTabs';
import { L } from '../../constants/labels';

const W = L.leads.workspace;

type Row = ReturnType<typeof salesRows>[number];
export function SalesWorkspacePage() {
  const actor = useActor();
  const navigate = useNavigate();
  const [stage, setStage] = useState('');
  const [owner, setOwner] = useState('');
  const query = useServiceQuery(() => salesRows(actor), [actor.user.id, actor.workspaceId]);
  if (!canReadResource(actor, 'leads') && !canReadResource(actor, 'opportunities')) return <NoAccess what={W.noAccess} />;
  const rows = query.data ?? [];
  const open = (r: Row) => navigate(recordPagePath(actor.workspaceId, r.resource, r.record.id));
  return <ListPage title={W.title} tabs={<SalesWorkspaceTabs actor={actor} active="all" />}>
    <DataTable<Row> actions={perm(actor, 'leads').create && <Button icon="plus" onClick={() => navigate('/leads/new')}>{W.newLead}</Button>} label={W.tableLabel} noun={W.noun} rows={rows.filter((r) => (!stage || r.stage?.label === stage) && (!owner || r.owner === owner))}
      rowKey={(r) => r.key} loading={query.loading} error={query.error} onRetry={query.retry} selectable={false}
      search={(r) => `${r.record.id} ${r.name} ${r.customer} ${r.owner} ${r.stage?.label ?? ''}`}
      initialSort={{ key: 'name', dir: 'asc' }} onRowClick={open}
      activeFilters={Number(!!stage) + Number(!!owner)} onClearFilters={() => { setStage(''); setOwner(''); }}
      filters={<><SelectMenu label={W.stage} value={stage} onChange={setStage} options={[{ value: '', label: W.allStages }, ...[...new Set(rows.map((r) => r.stage?.label).filter(Boolean))].map((label) => ({ value: label!, label: label! }))]} />
        <SelectMenu label={W.owner} value={owner} onChange={setOwner} options={[{ value: '', label: W.allOwners }, ...[...new Set(rows.map((r) => r.owner))].map((label) => ({ value: label, label }))]} /></>}
      columns={[
        { key: 'name', label: W.columns.name, sort: (r) => r.name, render: (r) => <button className="id-link" onClick={() => open(r)}>{r.name}</button> },
        { key: 'type', label: W.columns.type, sort: (r) => r.resource, render: (r) => (r.resource === 'leads' ? W.types.leads : W.types.opportunities) },
        { key: 'customer', label: W.columns.customer, sort: (r) => r.customer, render: (r) => r.customer },
        { key: 'owner', label: W.columns.owner, sort: (r) => r.owner, render: (r) => r.owner },
        { key: 'stage', label: W.columns.stage, sort: (r) => r.stage?.label ?? '', render: (r) => <StatusChip label={r.stage?.label ?? W.unknownStage} tone={r.stage?.tone} /> },
        { key: 'act', label: W.columns.actions, render: (r) => <span onClick={(e) => e.stopPropagation()}>{r.resource === 'leads' ? <LeadCardActions actor={actor} res={getResource('leads')} record={r.record} /> : <Button onClick={() => open(r)}>{W.openOpportunity}</Button>}</span> },
      ]} />
  </ListPage>;
}
