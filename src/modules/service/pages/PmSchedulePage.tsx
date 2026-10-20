import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { formatDate } from '../../../lib/dates';
import { recordNewPath, recordPagePath, resourcePath } from '../../../lib/routes';
import { L } from '../../../constants/labels';
import { errorMessage } from '../../../services/api/client';
import { loaders, serviceApi } from '../../../services/api/service';
import { can, perm } from '../../../services/authz';
import { useActor } from '../../../services/hooks';
import { activeMasterValues, masterValue } from '../../../services/registry';
import { recordTitle } from '../../../services/runtime';
import { filterPm, type PmTab } from '../../../services/service/pm';
import { ServiceError } from '../../../services/types';
import { Button, IconButton } from '../../../components/primitives/Button';
import { EmptyValue } from '../../../components/primitives/display';
import { StatusChip, Tabs, useToast } from '../../../components/primitives/feedback';
import { Dialog } from '../../../components/primitives/overlay';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import { ListPage } from '../../../components/shell/ListPage';
import { DataTable, type Column } from '../../../components/primitives/DataTable';
import { Checkbox, LinkButton, Textarea } from '../../../components/primitives/controls';

const S = L.service;
const P = S.pages.pmSchedule;
const TABS: PmTab[] = ['all', 'due', 'overdue', 'missed', 'done'];
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const tabLabel = (t: PmTab) => (t === 'all' ? P.all : S.masters.pmStatus.values[t]);

/**
 * PM Schedule (FR-085, SRV-11): one page for the auto-generated schedule and the PM visit list —
 * status tabs, search, service engineer / division filters, sort, pagination, assignment,
 * model-wise checklist completion and PM service tickets. PM visit records open at /pm-visits/:id.
 */
export function PmSchedulePage() {
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as PmTab) ? params.get('tab') : 'due') as PmTab;
  const engineerId = params.get('engineer') ?? '';
  const divisionId = params.get('division') ?? '';
  const peek = params.get('peek');
  const [completing, setCompleting] = useState<string | null>(null);
  const q = useServiceQuery(loaders.pm(actor), [actor.user.id]);
  const desk = can(actor, 'ticket.assign');
  const engineers = serviceApi.engineerOptions(actor);
  const divisions = activeMasterValues('division').map((d) => ({ value: d.key, label: d.label }));

  // Old list links (/pm-visits?peek=ID) arrive here; open the record page instead.
  if (peek) return <Navigate to={recordPagePath(actor.workspaceId, 'pmVisits', peek)} replace />;

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries({ page: undefined, ...patch }).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const all = q.data ?? [];
  const rows = filterPm(all, { tab, q: '', engineerId, divisionId, sort: 'due_asc' });
  const counts = (t: PmTab) => (t === 'all' ? all.length : all.filter((p) => p.status === t).length);
  const filtered = !!(engineerId || divisionId);
  const act = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast(ok);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };
  const columns: Column<(typeof all)[number]>[] = [
    { key: 'due', label: P.cols.due, className: 'nowrap', sort: (p) => s(p.dueDate), render: (p) => formatDate(s(p.dueDate)) },
    {
      key: 'machine',
      label: P.cols.machine,
      sort: (p) => p.machineLabel,
      render: (p) => (
        <>
          <Link to={recordPagePath(actor.workspaceId, 'pmVisits', p.id)}>{p.machineLabel}</Link>
          <div className="muted small">
            {p.id}
            {p.model ? ` · ${p.model}` : ''}
          </div>
        </>
      ),
    },
    { key: 'customer', label: P.cols.customer, sort: (p) => p.customerLabel, render: (p) => p.customerLabel },
    {
      key: 'engineer',
      label: P.cols.engineer,
      render: (p) =>
        desk && p.status !== 'done' ? (
          <SelectMenu label={P.engineerFor(p.id)} value={s(p.engineerId)} placeholder={P.assignPlaceholder} options={engineers} onChange={(v) => void act(serviceApi.assignPm(actor, p.id, v), S.toasts.pmAssigned)} />
        ) : p.engineerId ? (
          recordTitle('employees', p.engineerId)
        ) : (
          <EmptyValue />
        ),
    },
    {
      key: 'status',
      label: P.cols.status,
      sort: (p) => s(p.status),
      render: (p) => {
        const st = masterValue('pmStatus', p.status);
        return st ? <StatusChip label={st.label} tone={st.tone} /> : null;
      },
    },
    {
      key: 'act',
      label: P.cols.actions,
      className: 'nowrap',
      render: (p) => {
        const open = p.status !== 'done';
        return (
          <>
            {open && (
              <Button size="compact" disabledReason={desk || p.engineerId === actor.staffId ? undefined : P.otherEngineer} onClick={() => setCompleting(p.id)}>
                {S.actions.complete}
              </Button>
            )}
            {desk && open && !p.ticketId && <IconButton icon="plus" label={S.actions.raisePmTicket} onClick={() => void act(serviceApi.raisePmTicket(actor, p.id), S.toasts.pmTicketRaised)} />}
            {!!p.ticketId && (
              <Link className="link small" to={resourcePath(actor.workspaceId, 'tickets', { peek: s(p.ticketId) })}>
                {s(p.ticketId)}
              </Link>
            )}
          </>
        );
      },
    },
  ];
  return (
    <ListPage
      title={L.nav.pages.pmSchedule.title}
      description={P.description}
      actions={perm(actor, 'pmVisits').create ? <LinkButton variant="primary" to={recordNewPath('pmVisits')}>{S.actions.newPmVisit}</LinkButton> : undefined}
      kpis={<Tabs<PmTab> label={P.tabsLabel} value={tab} onChange={(t) => update({ tab: t })} tabs={TABS.map((t) => ({ id: t, label: tabLabel(t), count: q.data ? counts(t) : undefined }))} />}
    >
      <DataTable
        label={P.tableLabel}
        rows={rows}
        rowKey={(p) => p.id}
        noun={P.noun}
        loading={!q.data && !q.error}
        error={q.error}
        onRetry={q.retry}
        initialSort={{ key: 'due', dir: tab === 'done' ? 'desc' : 'asc' }}
        key={tab}
        initialSearch={params.get('q') ?? ''}
        search={(p) => `${p.id} ${p.machineLabel} ${p.customerLabel} ${p.model ?? ''}`}
        summary={P.count(rows.length)}
        activeFilters={(engineerId ? 1 : 0) + (divisionId ? 1 : 0)}
        onClearFilters={() => update({ engineer: undefined, division: undefined })}
        empty={!all.length ? { icon: 'calendar-clock', title: P.emptyAll } : undefined}
        emptyText={filtered ? P.emptySearch : P.empty(tabLabel(tab).toLowerCase())}
        filters={
          <>
            <SelectMenu label={P.engineerFilter} value={engineerId} options={[{ value: '', label: P.allEngineers }, { value: '__none', label: P.unassigned }, ...engineers]} onChange={(v) => update({ engineer: v || undefined })} />
            <SelectMenu label={P.divisionFilter} value={divisionId} options={[{ value: '', label: P.allDivisions }, ...divisions]} onChange={(v) => update({ division: v || undefined })} />
          </>
        }
        columns={columns}
      />
      {completing && <CompletePmDialog pmId={completing} onClose={() => setCompleting(null)} />}
    </ListPage>
  );
}

function CompletePmDialog({ pmId, onClose }: { pmId: string; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const items = serviceApi.checklistForVisit(pmId);
  const [ok, setOk] = useState<boolean[]>(items.map(() => true));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Record<string, string>>({});
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={P.completeTitle(pmId)}
      description={P.completeDescription}
      footer={
        <>
          <Button onClick={onClose}>{S.actions.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError({});
              try {
                await serviceApi.completePm(actor, pmId, { results: items.map((item, i) => ({ item, ok: ok[i] })), notes });
                toast(S.toasts.pmCompleted);
                onClose();
              } catch (e) {
                setError(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {S.actions.markCompleted}
          </Button>
        </>
      }
    >
      <ul className="plain-list">
        {items.map((item, i) => (
          <li key={item}>
            <label className="row-gap">
              <Checkbox checked={ok[i]} onChange={(e) => setOk(ok.map((x, j) => (j === i ? e.target.checked : x)))} /> {item}
            </label>
          </li>
        ))}
      </ul>
      <div className="form-field">
        <label className="field-label" htmlFor="pm-notes">
          {P.findings} {ok.some((x) => !x) && <span className="req">*</span>}
        </label>
        <Textarea id="pm-notes" className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} aria-invalid={!!error.notes || undefined} />
        {error.notes && <p className="field-error">{error.notes}</p>}
        {error.form && <p className="field-error">{error.form}</p>}
      </div>
    </Dialog>
  );
}
