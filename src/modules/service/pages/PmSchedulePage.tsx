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
import { filterPm, type PmSort, type PmTab } from '../../../services/service/pm';
import { ServiceError } from '../../../services/types';
import { Button, IconButton } from '../../../components/primitives/Button';
import { EmptyValue } from '../../../components/primitives/display';
import { EmptyState, ErrorState, Skeleton, StatusChip, Tabs, useToast } from '../../../components/primitives/feedback';
import { Dialog } from '../../../components/primitives/overlay';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import { PageHeader } from '../../../components/shell/PageHeader';

const S = L.service;
const P = S.pages.pmSchedule;
const PAGE = 25;
const TABS: PmTab[] = ['all', 'due', 'overdue', 'missed', 'done'];
const SORTS: PmSort[] = ['due_asc', 'due_desc', 'customer'];
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
  const search = params.get('q') ?? '';
  const engineerId = params.get('engineer') ?? '';
  const divisionId = params.get('division') ?? '';
  const sort = SORTS.includes(params.get('sort') as PmSort) ? (params.get('sort') as PmSort) : undefined;
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
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
  const rows = filterPm(all, { tab, q: search, engineerId, divisionId, sort });
  const counts = (t: PmTab) => (t === 'all' ? all.length : all.filter((p) => p.status === t).length);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const filtered = !!(search || engineerId || divisionId);
  const act = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast(ok);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };
  return (
    <div className="page">
      <PageHeader
        title={L.nav.pages.pmSchedule.title}
        description={P.description}
        actions={
          perm(actor, 'pmVisits').create ? (
            <Link className="btn btn-primary" to={recordNewPath('pmVisits')}>
              <span className="btn-label">{S.actions.newPmVisit}</span>
            </Link>
          ) : undefined
        }
      />
      <Tabs<PmTab> label={P.tabsLabel} value={tab} onChange={(t) => update({ tab: t })} tabs={TABS.map((t) => ({ id: t, label: tabLabel(t), count: q.data ? counts(t) : undefined }))} />
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <input type="search" className="input input-compact" placeholder={P.searchPlaceholder} aria-label={P.searchLabel} value={search} onChange={(e) => update({ q: e.target.value || undefined })} />
        <SelectMenu
          label={P.engineerFilter}
          value={engineerId}
          options={[{ value: '', label: P.allEngineers }, { value: '__none', label: P.unassigned }, ...engineers]}
          onChange={(v) => update({ engineer: v || undefined })}
        />
        <SelectMenu label={P.divisionFilter} value={divisionId} options={[{ value: '', label: P.allDivisions }, ...divisions]} onChange={(v) => update({ division: v || undefined })} />
        <SelectMenu<PmSort> label={P.sortLabel} value={sort ?? (tab === 'done' ? 'due_desc' : 'due_asc')} options={SORTS.map((k) => ({ value: k, label: P.sorts[k] }))} onChange={(v) => update({ sort: v })} />
        {filtered && (
          <Button variant="ghost" onClick={() => update({ q: undefined, engineer: undefined, division: undefined })}>
            {S.actions.clearFilters}
          </Button>
        )}
        <span className="spacer" />
        <span className="toolbar-count muted">{P.count(rows.length)}</span>
      </div>
      <div className="content-surface">
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : !rows.length ? (
          <EmptyState icon="calendar-clock" title={filtered ? P.emptySearch : tab === 'all' ? P.emptyAll : P.empty(tabLabel(tab).toLowerCase())} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">{P.cols.due}</th>
                    <th scope="col">{P.cols.machine}</th>
                    <th scope="col">{P.cols.customer}</th>
                    <th scope="col">{P.cols.engineer}</th>
                    <th scope="col">{P.cols.status}</th>
                    <th scope="col">{P.cols.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(current * PAGE, current * PAGE + PAGE).map((p) => {
                    const st = masterValue('pmStatus', p.status);
                    const mineOrDesk = desk || p.engineerId === actor.staffId;
                    const open = p.status !== 'done';
                    return (
                      <tr key={p.id}>
                        <td className="nowrap">{formatDate(s(p.dueDate))}</td>
                        <td>
                          <Link to={recordPagePath(actor.workspaceId, 'pmVisits', p.id)}>{p.machineLabel}</Link>
                          <div className="muted small">
                            {p.id}
                            {p.model ? ` · ${p.model}` : ''}
                          </div>
                        </td>
                        <td>{p.customerLabel}</td>
                        <td>
                          {desk && open ? (
                            <SelectMenu label={P.engineerFor(p.id)} value={s(p.engineerId)} placeholder={P.assignPlaceholder} options={engineers} onChange={(v) => void act(serviceApi.assignPm(actor, p.id, v), S.toasts.pmAssigned)} />
                          ) : p.engineerId ? (
                            recordTitle('employees', p.engineerId)
                          ) : (
                            <EmptyValue />
                          )}
                        </td>
                        <td>{st && <StatusChip label={st.label} tone={st.tone} />}</td>
                        <td className="nowrap">
                          {open && (
                            <Button disabledReason={mineOrDesk ? undefined : P.otherEngineer} onClick={() => setCompleting(p.id)}>
                              {S.actions.complete}
                            </Button>
                          )}
                          {desk && open && !p.ticketId && <IconButton icon="plus" label={S.actions.raisePmTicket} onClick={() => void act(serviceApi.raisePmTicket(actor, p.id), S.toasts.pmTicketRaised)} />}
                          {!!p.ticketId && (
                            <Link className="link small" to={resourcePath(actor.workspaceId, 'tickets', { peek: s(p.ticketId) })}>
                              {s(p.ticketId)}
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid-footer">
              <span className="grid-footer-range">{S.pager.range(current * PAGE + 1, Math.min(rows.length, (current + 1) * PAGE), rows.length)}</span>
              <nav className="grid-pages" aria-label={S.pager.label}>
                <IconButton icon="chevron-left" label={S.pager.prev} disabledReason={current === 0 ? S.pager.first : undefined} onClick={() => update({ page: String(current - 1) })} />
                <IconButton icon="chevron-right" label={S.pager.next} disabledReason={current + 1 >= pages ? S.pager.last : undefined} onClick={() => update({ page: String(current + 1) })} />
              </nav>
            </div>
          </>
        )}
      </div>
      {completing && <CompletePmDialog pmId={completing} onClose={() => setCompleting(null)} />}
    </div>
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
              <input type="checkbox" checked={ok[i]} onChange={(e) => setOk(ok.map((x, j) => (j === i ? e.target.checked : x)))} /> {item}
            </label>
          </li>
        ))}
      </ul>
      <div className="form-field">
        <label className="field-label" htmlFor="pm-notes">
          {P.findings} {ok.some((x) => !x) && <span className="req">*</span>}
        </label>
        <textarea id="pm-notes" className="input textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} aria-invalid={!!error.notes || undefined} />
        {error.notes && <p className="field-error">{error.notes}</p>}
        {error.form && <p className="field-error">{error.form}</p>}
      </div>
    </Dialog>
  );
}
