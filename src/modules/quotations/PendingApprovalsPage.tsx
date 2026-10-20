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
import { Button } from '../../components/primitives/Button';
import { DataTable, type Column } from '../../components/primitives/DataTable';
import { KpiStrip } from '../../components/resource/ListCard';
import { NoAccess, StatusChip, Tabs, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { ListPage } from '../../components/shell/ListPage';
import { Textarea } from '../../components/primitives/controls';

const P = L.quotations.pending;
type Tab = 'mine' | 'all';
const LEVELS = Object.values(L.roles.approvalLevels);

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
  const [division, setDivision] = useState('');
  const [level, setLevel] = useState('');
  const [deciding, setDeciding] = useState<{ row: PendingApprovalRow; decision: 'approved' | 'rejected' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);

  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(
    () => all.filter((r) => (tab === 'mine' ? r.canDecide : true)).filter((r) => (!division || r.divisionId === division) && (!level || r.levelName === level)),
    [all, tab, division, level],
  );

  if (!canReadResource(actor, 'quotations') && !isApprover) return <NoAccess what={P.noAccess} />;

  const mine = all.filter((r) => r.canDecide);
  const chosen = all.filter((r) => selected.has(r.approval.id) && r.canDecide);

  const columns: Column<PendingApprovalRow>[] = [
    {
      key: 'quoteNo',
      label: P.colQuotation,
      sort: (r) => r.quoteNo,
      render: (r) => (
        <>
          <Link className="rel-link" to={recordPeekPath('tc', 'quotations', r.quoteId)}>
            {r.quoteNo}
          </Link>
          <div className="muted small">
            {r.approval.id} · {masterLabel('division', r.divisionId)}
          </div>
        </>
      ),
    },
    { key: 'customer', label: P.colCustomer, sort: (r) => r.customerName, render: (r) => r.customerName },
    { key: 'owner', label: P.colExecutive, sort: (r) => r.ownerName, render: (r) => r.ownerName },
    { key: 'value', label: P.colValue, num: true, sort: (r) => r.grandTotal, render: (r) => formatMoney(r.grandTotal) },
    { key: 'discount', label: P.colDiscount, num: true, sort: (r) => r.discountPct, render: (r) => `${r.discountPct}%` },
    {
      key: 'level',
      label: P.colLevel,
      sort: (r) => r.levelName,
      render: (r) => (
        <>
          {r.levelName}
          <div className="muted small">{P.levelOf(r.step, r.steps)}</div>
        </>
      ),
    },
    {
      key: 'waiting',
      label: P.colWaiting,
      sort: (r) => r.waitingHours,
      render: (r) => (
        <span className="nowrap">
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
        </span>
      ),
    },
    {
      key: 'act',
      label: P.colActions,
      render: (r) =>
        r.canDecide ? (
          <div className="qt-pending-actions">
            <Button size="compact" onClick={() => setDeciding({ row: r, decision: 'approved' })}>
              {L.quotations.actions.approve}
            </Button>
            <Button size="compact" onClick={() => setDeciding({ row: r, decision: 'rejected' })}>
              {L.quotations.actions.reject}
            </Button>
          </div>
        ) : (
          <span className="muted small">{r.ownRequest ? P.ownRequest : P.notYourLevel(r.levelName)}</span>
        ),
    },
  ];

  const title = L.nav.pages.quotationPendingApprovals.title;
  return (
    <ListPage
      title={title}
      description={P.description}
      kpis={
        <>
          {q.data && (
            <KpiStrip
              label={title}
              items={[
                { key: 'waiting', label: P.statWaiting, value: all.length, sub: P.noun },
                { key: 'mine', label: P.statMine, value: mine.length, sub: P.tabMine },
                { key: 'overdue', label: P.statOverdue, value: all.filter((r) => r.overdue).length, sub: P.overdue },
                { key: 'value', label: P.statValue, value: formatMoney(all.reduce((t, r) => t + r.grandTotal, 0)), sub: P.noun },
              ]}
            />
          )}
          <Tabs<Tab>
            label={title}
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'mine', label: P.tabMine, count: mine.length },
              { id: 'all', label: P.tabAll, count: all.length },
            ]}
          />
        </>
      }
    >
      <DataTable
        key={tab}
        label={title}
        noun={P.noun}
        rows={rows}
        rowKey={(r) => r.approval.id}
        columns={columns}
        loading={!q.data && !q.error}
        error={q.error}
        onRetry={q.retry}
        initialSort={{ key: 'waiting', dir: 'desc' }}
        search={(r) => `${r.quoteNo} ${r.customerName} ${r.ownerName} ${r.approval.id}`}
        summary={P.count(rows.length)}
        activeFilters={(division ? 1 : 0) + (level ? 1 : 0)}
        onClearFilters={() => (setDivision(''), setLevel(''))}
        empty={q.data && !rows.length && !division && !level ? { icon: 'check-square', title: tab === 'mine' ? P.emptyMine : P.emptyAll, body: tab === 'mine' ? P.emptyMineBody : P.emptyAllBody } : undefined}
        emptyText={P.emptyFiltered}
        filters={
          <>
            <SelectMenu label={P.filterDivision} value={division} options={[{ value: '', label: P.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={setDivision} />
            <SelectMenu label={P.filterLevel} value={level} options={[{ value: '', label: P.allLevels }, ...LEVELS.map((l) => ({ value: l, label: l }))]} onChange={setLevel} />
          </>
        }
        selection={{
          keys: selected,
          onChange: setSelected,
          canSelect: (r) => r.canDecide,
          selectAllLabel: P.selectAll,
          rowLabel: (r) => P.selectRow(String(r.quoteNo)),
          actions: (
            <>
              <span className="muted small">{P.selectedCount(chosen.length)}</span>{' '}
              <Button onClick={() => setSelected(new Set())}>{P.clearSelection}</Button>{' '}
              <Button variant="primary" onClick={() => setBulk(true)} disabled={!chosen.length}>
                {P.bulkApprove(chosen.length)}
              </Button>
            </>
          ),
        }}
      />
      {deciding && <DecideDialog row={deciding.row} decision={deciding.decision} onClose={() => setDeciding(null)} />}
      {bulk && <BulkApproveDialog rows={chosen} onClose={() => setBulk(false)} onDone={() => setSelected(new Set())} />}
    </ListPage>
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

/** Approve several requests at once with one optional comment; failures are listed, successes are kept. */
function BulkApproveDialog({ rows, onClose, onDone }: { rows: PendingApprovalRow[]; onClose: () => void; onDone: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const total = rows.reduce((n, r) => n + r.grandTotal, 0);
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of rows) {
      try {
        await quotationsApi.decideApproval(actor, r.approval.id, 'approved', note, r.approval.version);
        ok++;
      } catch {
        failed.push(String(r.quoteNo));
      }
    }
    inFlight.current = false;
    setBusy(false);
    toast(failed.length ? P.bulkPartial(ok, failed.join(', ')) : P.bulkDone(ok), failed.length ? 'danger' : 'success');
    onDone();
    onClose();
  };
  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      size="sm"
      role="alertdialog"
      title={P.bulkTitle(rows.length)}
      description={P.bulkBody(formatMoney(total))}
      footer={
        <>
          <Button onClick={onClose} data-autofocus disabled={busy}>
            {L.quotations.actions.cancel}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {P.bulkApprove(rows.length)}
          </Button>
        </>
      }
    >
      <ul className="plain-list small">
        {rows.map((r) => (
          <li key={r.approval.id}>
            {r.quoteNo} · {r.customerName} · {formatMoney(r.grandTotal)} · {r.discountPct}%
          </li>
        ))}
      </ul>
      <div className="form-field">
        <label className="field-label" htmlFor="qpa-bulk-note">
          {P.comment} <span className="optional">{L.quotations.common.optional}</span>
        </label>
        <Textarea id="qpa-bulk-note" className="textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}
