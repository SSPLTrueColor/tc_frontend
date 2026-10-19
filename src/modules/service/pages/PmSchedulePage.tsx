import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { formatDate } from '../../../lib/dates';
import { errorMessage } from '../../../services/api/client';
import { loaders, serviceApi } from '../../../services/api/service';
import { can } from '../../../services/authz';
import { getDb } from '../../../services/db';
import { useActor } from '../../../services/hooks';
import { masterValue } from '../../../services/registry';
import { recordTitle } from '../../../services/runtime';
import { ServiceError } from '../../../services/types';
import { Button, IconButton } from '../../../components/primitives/Button';
import { EmptyValue } from '../../../components/primitives/display';
import { EmptyState, ErrorState, Skeleton, StatusChip, Tabs, useToast } from '../../../components/primitives/feedback';
import { Dialog } from '../../../components/primitives/overlay';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import { PageHeader } from '../../../components/shell/PageHeader';

type Tab = 'due' | 'overdue' | 'missed' | 'done';
const PAGE = 25;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** FR-085: PM schedule by status with assignment, model-wise checklist completion and PM tickets. */
export function PmSchedulePage() {
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'due';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(0);
  const [completing, setCompleting] = useState<string | null>(null);
  const q = useServiceQuery(loaders.pm(actor), [actor.user.id]);
  const desk = can(actor, 'ticket.assign');
  const engineers = useMemo(
    () =>
      (getDb().records.employees ?? [])
        .filter((e) => e.roleId === 'engineer' && e.status !== 'inactive')
        .map((e) => ({ value: e.id, label: s(e.fullName) })),
    [],
  );
  const rows = (q.data ?? []).filter((p) => p.status === tab && (!search || `${p.id} ${p.machineLabel} ${p.model} ${p.customerLabel}`.toLowerCase().includes(search.toLowerCase())));
  const sorted = tab === 'done' ? [...rows].sort((a, b) => s(b.completedAt).localeCompare(s(a.completedAt))) : rows;
  const counts = (k: Tab) => (q.data ?? []).filter((p) => p.status === k).length;
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
      <PageHeader title="PM schedule" description="Preventive maintenance visits generated from warranties and AMC/CMC contracts. Overdue = past the due date; missed = more than 30 days overdue." />
      <Tabs<Tab>
        label="PM status"
        value={tab}
        onChange={(t) => {
          setPage(0);
          setParams({ tab: t });
        }}
        tabs={[
          { id: 'due', label: 'Due', count: counts('due') },
          { id: 'overdue', label: 'Overdue', count: counts('overdue') },
          { id: 'missed', label: 'Missed', count: counts('missed') },
          { id: 'done', label: 'Done', count: counts('done') },
        ]}
      />
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder="Search machine, model, customer" aria-label="Search PM visits" value={search} onChange={(e) => (setSearch(e.target.value), setPage(0))} />
        <span className="toolbar-count muted">{sorted.length} visits</span>
        <span className="spacer" />
        <Link to="/pmVisits" className="link small">
          Full list with filters
        </Link>
      </div>
      <div className="content-surface">
        {q.error ? (
          <ErrorState title="Could not load the PM schedule" onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : !sorted.length ? (
          <EmptyState icon="calendar-clock" title={search ? 'No matching PM visits' : `No ${tab} PM visits`} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">Due</th>
                    <th scope="col">Machine</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Engineer</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(page * PAGE, page * PAGE + PAGE).map((p) => {
                    const st = masterValue('pmStatus', p.status);
                    const mineOrDesk = desk || p.engineerId === actor.staffId;
                    return (
                      <tr key={p.id}>
                        <td className="nowrap">{formatDate(s(p.dueDate))}</td>
                        <td>
                          <Link to={`/pmVisits?peek=${p.id}`}>{p.machineLabel}</Link>
                          <div className="muted small">{p.model}</div>
                        </td>
                        <td>{p.customerLabel}</td>
                        <td>
                          {desk && p.status !== 'done' ? (
                            <SelectMenu label={`Engineer for ${p.id}`} value={s(p.engineerId)} placeholder="Assign…" options={engineers} onChange={(v) => void act(serviceApi.assignPm(actor, p.id, v), 'Engineer assigned')} />
                          ) : p.engineerId ? (
                            recordTitle('employees', p.engineerId)
                          ) : (
                            <EmptyValue />
                          )}
                        </td>
                        <td>{st && <StatusChip label={st.label} tone={st.tone} />}</td>
                        <td className="nowrap">
                          {p.status !== 'done' && (
                            <Button disabledReason={mineOrDesk ? undefined : 'Assigned to another engineer'} onClick={() => setCompleting(p.id)}>
                              Complete
                            </Button>
                          )}
                          {desk && p.status !== 'done' && !p.ticketId && <IconButton icon="plus" label="Raise PM ticket" onClick={() => void act(serviceApi.raisePmTicket(actor, p.id), 'PM ticket raised')} />}
                          {!!p.ticketId && (
                            <Link className="link small" to={`/tickets?peek=${s(p.ticketId)}`}>
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
              <span className="grid-footer-range">
                <strong>
                  {page * PAGE + 1}–{Math.min(sorted.length, (page + 1) * PAGE)}
                </strong>{' '}
                of {sorted.length}
              </span>
              <nav className="grid-pages" aria-label="Pagination">
                <IconButton icon="chevron-left" label="Previous page" disabledReason={page === 0 ? 'First page' : undefined} onClick={() => setPage(page - 1)} />
                <IconButton icon="chevron-right" label="Next page" disabledReason={(page + 1) * PAGE >= sorted.length ? 'Last page' : undefined} onClick={() => setPage(page + 1)} />
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
  const pm = (getDb().records.pmVisits ?? []).find((p) => p.id === pmId);
  const items = serviceApi.checklistFor(pm?.machineId);
  const [ok, setOk] = useState<boolean[]>(items.map(() => true));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Record<string, string>>({});
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Complete PM visit · ${pmId}`}
      description="Model-wise checklist. Untick anything that failed and describe it; raise a breakdown ticket if a repair is needed."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError({});
              try {
                await serviceApi.completePm(actor, pmId, { results: items.map((item, i) => ({ item, ok: ok[i] })), notes });
                toast('PM visit completed');
                onClose();
              } catch (e) {
                setError(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark done
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
          Findings {ok.some((x) => !x) && <span className="req">*</span>}
        </label>
        <textarea id="pm-notes" className="input textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} aria-invalid={!!error.notes || undefined} />
        {error.notes && <p className="field-error">{error.notes}</p>}
        {error.form && <p className="field-error">{error.form}</p>}
      </div>
    </Dialog>
  );
}
