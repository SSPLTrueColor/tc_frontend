import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { formatDateTime } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { loadPendingApprovals, type PendingApprovalRow, quotationsApi } from '../../services/api/quotations';
import { can, canReadResource } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { ServiceError } from '../../services/types';
import { Button, IconButton } from '../../components/primitives/Button';
import { EmptyState, ErrorState, NoAccess, Skeleton, StatusChip, Tabs, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { SearchInput, Textarea } from '../../components/primitives/controls';
import { Table } from '../../components/primitives/Table';

const P = L.quotations.pending;
const PAGE = 25;
type Tab = 'mine' | 'all';
type SortKey = 'quoteNo' | 'value' | 'discount' | 'waiting';
const LEVELS = Object.values(L.roles.approvalLevels);

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/**
 * ROUTES.quotationPendingApprovals — QUO-06 / QUO-14 Pending Approvals.
 * "Awaiting My Approval" = requests at the viewer's level (approve.l1 / l2 / l3 within their division);
 * "All Pending" = every pending discount request on quotations the viewer can see.
 */
export function PendingApprovalsPage() {
  const actor = useActor();
  const isApprover = ['approve.l1', 'approve.l2', 'approve.l3'].some((c) => can(actor, c));
  const q = useServiceQuery(() => loadPendingApprovals(actor), [actor.user.id]);
  const [tab, setTab] = useState<Tab>(isApprover ? 'mine' : 'all');
  const [search, setSearch] = useState('');
  const [division, setDivision] = useState('');
  const [level, setLevel] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'waiting', dir: -1 });
  const [page, setPage] = useState(0);
  const [deciding, setDeciding] = useState<{ row: PendingApprovalRow; decision: 'approved' | 'rejected' } | null>(null);

  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = all
      .filter((r) => (tab === 'mine' ? r.canDecide : true))
      .filter((r) => (!division || r.divisionId === division) && (!level || r.levelName === level))
      .filter((r) => !needle || `${r.quoteNo} ${r.customerName} ${r.ownerName} ${r.approval.id}`.toLowerCase().includes(needle));
    const val = (r: PendingApprovalRow): string | number => (sort.key === 'value' ? r.grandTotal : sort.key === 'discount' ? r.discountPct : sort.key === 'waiting' ? r.waitingHours : r.quoteNo);
    return [...list].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [all, tab, search, division, level, sort]);

  if (!canReadResource(actor, 'quotations') && !isApprover) return <NoAccess what={P.noAccess} />;

  const mine = all.filter((r) => r.canDecide);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE);
  const filtered = !!(search || division || level);
  const resetPage = () => setPage(0);
  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      className="th-btn"
      aria-label={P.sortBy(label)}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'quoteNo' ? 1 : -1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
    >
      <span className="th-label">{label}</span>
      <span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
    </button>
  );

  return (
    <div className="page">
      <PageHeader title={L.nav.pages.quotationPendingApprovals.title} description={P.description} />
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="stats" aria-label={L.nav.pages.quotationPendingApprovals.title}>
            <Stat label={P.statWaiting} value={all.length} />
            <Stat label={P.statMine} value={mine.length} />
            <Stat label={P.statOverdue} value={all.filter((r) => r.overdue).length} />
            <Stat label={P.statValue} value={formatMoney(all.reduce((s, r) => s + r.grandTotal, 0))} />
          </section>
          <Tabs<Tab>
            label={L.nav.pages.quotationPendingApprovals.title}
            value={tab}
            onChange={(t) => {
              setTab(t);
              resetPage();
            }}
            tabs={[
              { id: 'mine', label: P.tabMine, count: mine.length },
              { id: 'all', label: P.tabAll, count: all.length },
            ]}
          />
          <div className="toolbar">
            <SearchInput dense placeholder={P.search} aria-label={P.searchLabel} value={search} onChange={(e) => (setSearch(e.target.value), resetPage())} />
            <SelectMenu label={P.filterDivision} value={division} options={[{ value: '', label: P.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => (setDivision(v), resetPage())} />
            <SelectMenu label={P.filterLevel} value={level} options={[{ value: '', label: P.allLevels }, ...LEVELS.map((l) => ({ value: l, label: l }))]} onChange={(v) => (setLevel(v), resetPage())} />
          </div>
          <div className="content-surface">
            {rows.length === 0 ? (
              <EmptyState icon="check-square" title={filtered ? P.emptyFiltered : tab === 'mine' ? P.emptyMine : P.emptyAll}>
                {filtered ? P.emptyFilteredBody : tab === 'mine' ? P.emptyMineBody : P.emptyAllBody}
              </EmptyState>
            ) : (
              <>
                
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">{sortBtn('quoteNo', P.colQuotation)}</th>
                        <th scope="col">{P.colCustomer}</th>
                        <th scope="col">{P.colExecutive}</th>
                        <th scope="col" className="th-num">
                          {sortBtn('value', P.colValue)}
                        </th>
                        <th scope="col" className="th-num">
                          {sortBtn('discount', P.colDiscount)}
                        </th>
                        <th scope="col">{P.colLevel}</th>
                        <th scope="col">{sortBtn('waiting', P.colWaiting)}</th>
                        <th scope="col">{P.colActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => (
                        <tr key={r.approval.id}>
                          <td>
                            <Link className="rel-link" to={recordPeekPath('tc', 'quotations', r.quoteId)}>
                              {r.quoteNo}
                            </Link>
                            <div className="muted small">
                              {r.approval.id} · {masterLabel('division', r.divisionId)}
                            </div>
                          </td>
                          <td>{r.customerName}</td>
                          <td>{r.ownerName}</td>
                          <td className="td-num">{formatMoney(r.grandTotal)}</td>
                          <td className="td-num">{r.discountPct}%</td>
                          <td>
                            {r.levelName}
                            <div className="muted small">{P.levelOf(r.step, r.steps)}</div>
                          </td>
                          <td className="nowrap">
                            {formatDateTime(r.waitingSince)}
                            <div className={`small ${r.overdue ? 'text-danger' : 'muted'}`}>{P.hoursAgo(r.waitingHours)}</div>
                            {(r.overdue || r.approval.remindedAt) && (
                              <div className="qt-pending-flags">
                                {r.approval.remindedAt ? (
                                  <span title={P.remindedTip(formatDateTime(r.approval.remindedAt))}>
                                    <StatusChip label={P.reminded} tone="warning" />
                                  </span>
                                ) : (
                                  <span title={P.overdueTip}>
                                    <StatusChip label={P.overdue} tone="danger" />
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            {r.canDecide ? (
                              <div className="qt-pending-actions">
                                <Button size="compact" variant="primary" onClick={() => setDeciding({ row: r, decision: 'approved' })}>
                                  {L.quotations.actions.approve}
                                </Button>
                                <Button size="compact" onClick={() => setDeciding({ row: r, decision: 'rejected' })}>
                                  {L.quotations.actions.reject}
                                </Button>
                              </div>
                            ) : (
                              <span className="muted small">{r.ownRequest ? P.ownRequest : P.notYourLevel(r.levelName)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                
                <div className="grid-footer">
                  <span className="grid-footer-range">{P.range(current * PAGE + 1, Math.min(rows.length, (current + 1) * PAGE), rows.length)}</span>
                  <nav className="grid-pages" aria-label={P.pageOf(current + 1, pageCount)}>
                    <IconButton icon="chevron-left" label={P.prev} disabledReason={current === 0 ? P.firstPage : undefined} onClick={() => setPage(current - 1)} />
                    <span className="muted small">{P.pageOf(current + 1, pageCount)}</span>
                    <IconButton icon="chevron-right" label={P.next} disabledReason={current >= pageCount - 1 ? P.lastPage : undefined} onClick={() => setPage(current + 1)} />
                  </nav>
                </div>
              </>
            )}
          </div>
        </>
      )}
      {deciding && <DecideDialog row={deciding.row} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </div>
  );
}

/** Approve / Reject confirmation with comment (required to reject). */
function DecideDialog({ row, decision, onClose }: { row: PendingApprovalRow; decision: 'approved' | 'rejected'; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const approve = decision === 'approved';
  const last = row.step === row.steps;
  const inFlight = useRef(false);
  const submit = async () => {
    if (inFlight.current) return;
    if (!approve && note.trim().length < 5) {
      setError(P.commentRequired);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await quotationsApi.decideApproval(actor, row.approval.id, decision, note, row.approval.version);
      toast(approve ? P.approved(row.quoteNo, last) : P.rejected(row.quoteNo));
      onClose();
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors?.note) setError(e.fieldErrors.note);
      toast(errorMessage(e), 'danger');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      role="alertdialog"
      title={approve ? P.approveTitle(row.quoteNo) : P.rejectTitle(row.quoteNo)}
      description={approve ? P.approveBody(row.discountPct, row.levelName, last) : P.rejectBody}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            {L.quotations.actions.cancel}
          </Button>
          <Button variant={approve ? 'primary' : 'danger'} loading={busy} onClick={() => void submit()}>
            {approve ? L.quotations.actions.approve : L.quotations.actions.reject}
          </Button>
        </>
      }
    >
      <p className="muted small">
        {row.customerName} · {formatMoney(row.grandTotal)} · {row.approval.reason}
      </p>
      <div className="form-field">
        <label className="field-label" htmlFor="qpa-note">
          {P.comment} {approve ? <span className="optional">{L.quotations.common.optional}</span> : <span className="req">*</span>}
        </label>
        <Textarea id="qpa-note" className="textarea" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!error || undefined} />
        {error && <p className="field-error">{error}</p>}
      </div>
    </Dialog>
  );
}
