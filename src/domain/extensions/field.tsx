/** Field & performance module: hooks (BR-42 … BR-47), approval types and record actions. */
import { Link } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { useToast } from '../../components/primitives/feedback';
import { registerRecordActions, type RecordExtensionProps } from '../../components/resource/extensions';
import { addDays, startOfWeek, todayKey } from '../../lib/dates';
import { call, errorMessage } from '../../services/api/client';
import { getDb } from '../../services/db';
import { employeeOf, trackedKmFor } from '../../services/field/field';
import { attendanceMetrics, conveyanceAmount, expenseLimit, managerLevel, periodLabel, periodStartFor } from '../../services/field/rules';
import { getPolicies } from '../../services/policies';
import { masterLabel } from '../../services/registry';
import { type HookContext, registerResourceHooks } from '../../services/resourceHooks';
import { insertRecordIn, patchRecordIn, updateRecord } from '../../services/runtime';
import { ServiceError, type Approval } from '../../services/types';
import { registerApprovalType, requestApprovalIn } from '../../services/workflow';


const fail = (field: string, message: string) => {
  throw new ServiceError('validation', message, { fieldErrors: { [field]: message } });
};
const ownerDefault = (ctx: HookContext, c: Record<string, unknown>) => {
  if (!c.employeeId) c.employeeId = ctx.actor.staffId;
};
const roleOf = (staffId: unknown) => String(employeeOf(staffId)?.roleId ?? 'sales_exec');
const divisionsOf = (staffId: unknown) => ((employeeOf(staffId)?.divisionIds as string[] | undefined) ?? []).slice();
const rows = (ctx: HookContext, key: string) => ctx.d.records[key] ?? [];
const recordOf = (ctx: HookContext, key: string, id: string) => rows(ctx, key).find((r) => r.id === id);

// ---------------------------------------------------------------- regularisation (ATT-04)

registerResourceHooks('regularisations', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    c.status = 'pending';
    const date = String(c.date ?? '');
    if (date > todayKey()) fail('date', 'You can only regularise today or past days');
    if (c.requestedCheckIn && String(c.requestedCheckIn).slice(0, 10) !== date) fail('requestedCheckIn', 'Check-in must be on the selected date');
    if (c.requestedCheckOut && String(c.requestedCheckOut).slice(0, 10) !== date) fail('requestedCheckOut', 'Check-out must be on the selected date');
    if (rows(ctx, 'regularisations').some((r) => r.employeeId === c.employeeId && r.date === date && r.status === 'pending')) fail('date', 'A request for this date is already pending');
  },
  afterCreate: (ctx, r) =>
    requestApprovalIn(ctx, {
      type: 'attendance.regularisation',
      resource: 'regularisations',
      recordId: r.id,
      reason: String(r.reason),
      summary: `Attendance correction ${r.date} · ${employeeOf(r.employeeId)?.fullName ?? r.employeeId} (${String(r.requestedCheckIn).slice(11)}–${String(r.requestedCheckOut).slice(11)})`,
      levels: [managerLevel(roleOf(r.employeeId))],
      divisionIds: divisionsOf(r.employeeId),
    }),
});

registerApprovalType('attendance.regularisation', {
  label: 'Attendance regularisation',
  onApproved: (ctx, a) => {
    const r = recordOf(ctx, 'regularisations', a.recordId);
    if (!r) return;
    patchRecordIn(ctx, 'regularisations', r.id, { status: 'approved', decisionNote: a.decisionNote ?? '' }, `Approved (${a.id})`);
    const m = attendanceMetrics({ checkInAt: String(r.requestedCheckIn), checkOutAt: String(r.requestedCheckOut), status: 'present' }, getPolicies().shift);
    const values = { checkInAt: r.requestedCheckIn, checkOutAt: r.requestedCheckOut, workMinutes: m.workMinutes, lateByMin: m.lateByMin, earlyByMin: m.earlyByMin, status: m.status, regularised: true };
    const existing = rows(ctx, 'attendance').find((x) => x.employeeId === r.employeeId && x.date === r.date);
    if (existing) patchRecordIn(ctx, 'attendance', existing.id, values, `Regularised by ${a.id}`);
    else insertRecordIn(ctx, 'attendance', { employeeId: r.employeeId, date: r.date, ...values, checkInPlace: 'Regularised (no GPS)', locationSource: 'regularisation' });
  },
  onRejected: (ctx, a) => patchRecordIn(ctx, 'regularisations', a.recordId, { status: 'rejected', decisionNote: a.decisionNote ?? '' }, `Rejected (${a.id})`),
});

// ---------------------------------------------------------------- expenses (ATT-08, BR-46)

function priceExpense(c: Record<string, unknown>) {
  const rates = getPolicies().conveyance;
  if (c.expenseType === 'conveyance') {
    const km = Number(c.km);
    if (!(km > 0)) fail('km', 'Enter the distance travelled');
    c.amount = conveyanceAmount(km, String(c.vehicleType ?? 'two_wheeler'), rates);
  }
  c.policyLimit = expenseLimit(String(c.expenseType), String(c.vehicleType ?? 'two_wheeler'), rates);
  if (Number(c.amount) > Number(c.policyLimit) && !String(c.justification ?? '').trim()) fail('justification', `Above the policy limit of ₹${Number(c.policyLimit).toLocaleString('en-IN')} — add a justification`);
}

registerResourceHooks('expenseClaims', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    priceExpense(c);
  },
  beforeUpdate: (_ctx, before, c) => {
    if (!['draft', 'rejected'].includes(String(before.status))) throw new ServiceError('invalid_state', 'Only draft or rejected claims can be edited.');
    priceExpense(c);
  },
  beforeTransition: (_ctx, r, to) => {
    if (to === 'submitted') priceExpense(r);
  },
  afterTransition: (ctx, _before, after) => {
    if (after.status !== 'submitted') return;
    requestApprovalIn(ctx, {
      type: 'expense.claim',
      resource: 'expenseClaims',
      recordId: after.id,
      reason: String(after.justification ?? ''),
      summary: `${after.id} · ${masterLabel('expenseType', after.expenseType)} ₹${Number(after.amount).toLocaleString('en-IN')} · ${employeeOf(after.employeeId)?.fullName ?? ''}`,
      amount: Number(after.amount),
      levels: [managerLevel(roleOf(after.employeeId)), { capability: 'approve.finance', label: 'Accounts' }],
      divisionIds: divisionsOf(after.employeeId),
    });
  },
});

registerApprovalType('expense.claim', {
  label: 'Expense claim',
  onApproved: (ctx, a) => patchRecordIn(ctx, 'expenseClaims', a.recordId, { status: 'approved' }, `Approved (${a.id})`),
  onRejected: (ctx, a) => patchRecordIn(ctx, 'expenseClaims', a.recordId, { status: 'rejected' }, `Rejected (${a.id}): ${a.decisionNote ?? ''}`),
});

function ExpenseActions({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const km = record.claimDate ? trackedKmFor(String(record.employeeId), String(record.claimDate)) : null;
  if (record.expenseType !== 'conveyance' || !['draft', 'rejected'].includes(String(record.status))) return null;
  return (
    <Button
      icon="activity"
      disabledReason={record.employeeId !== actor.staffId ? 'Only the claimant can change this claim' : km === null ? 'No tracked route on this date' : undefined}
      onClick={async () => {
        try {
          await call(() => updateRecord(actor, 'expenseClaims', record.id, { km }, record.version));
          toast(`Distance set to ${km} km from the tracked route`);
        } catch (e) {
          toast(errorMessage(e), 'danger');
        }
      }}
    >
      Fill km from tracked route{km !== null ? ` (${km} km)` : ''}
    </Button>
  );
}
registerRecordActions('expenseClaims', ExpenseActions);

// ---------------------------------------------------------------- leave (ATT-09)

const eachDay = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
};

registerResourceHooks('leaves', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    if (String(c.toDate) < String(c.fromDate)) fail('toDate', 'End date must be on or after the start date');
    if (eachDay(String(c.fromDate), String(c.toDate)).length > 30) fail('toDate', 'A single application can cover at most 30 days');
    const clash = rows(ctx, 'leaves').find((l) => l.employeeId === c.employeeId && ['pending', 'approved'].includes(String(l.status)) && String(l.fromDate) <= String(c.toDate) && String(l.toDate) >= String(c.fromDate));
    if (clash) fail('fromDate', `Overlaps leave ${clash.id} (${clash.fromDate} – ${clash.toDate})`);
  },
  afterCreate: (ctx, l) =>
    requestApprovalIn(ctx, {
      type: 'leave.request',
      resource: 'leaves',
      recordId: l.id,
      reason: String(l.reason),
      summary: `${masterLabel('leaveType', l.leaveType)} leave ${l.fromDate} to ${l.toDate} · ${employeeOf(l.employeeId)?.fullName ?? ''}`,
      levels: [managerLevel(roleOf(l.employeeId))],
      divisionIds: divisionsOf(l.employeeId),
    }),
  afterTransition: (ctx, before, after) => {
    if (after.status !== 'cancelled') return;
    ctx.d.approvals.filter((a) => a.recordId === after.id && a.status === 'pending').forEach((a) => ((a.status = 'withdrawn'), a.version++));
    if (before.status === 'approved') {
      const days = new Set(eachDay(String(after.fromDate), String(after.toDate)));
      ctx.d.records.attendance = rows(ctx, 'attendance').filter((x) => !(x.employeeId === after.employeeId && days.has(String(x.date)) && x.status === 'leave' && !x.checkInAt));
    }
  },
});

registerApprovalType('leave.request', {
  label: 'Leave',
  onApproved: (ctx, a: Approval) => {
    const l = patchRecordIn(ctx, 'leaves', a.recordId, { status: 'approved', decisionNote: a.decisionNote ?? '' }, `Approved (${a.id})`);
    for (const date of eachDay(String(l.fromDate), String(l.toDate))) {
      const existing = rows(ctx, 'attendance').find((x) => x.employeeId === l.employeeId && x.date === date);
      if (existing && !existing.checkInAt) patchRecordIn(ctx, 'attendance', existing.id, { status: 'leave' }, `Leave ${l.id}`);
      else if (!existing) insertRecordIn(ctx, 'attendance', { employeeId: l.employeeId, date, status: 'leave', lateByMin: 0, earlyByMin: 0 });
    }
  },
  onRejected: (ctx, a) => patchRecordIn(ctx, 'leaves', a.recordId, { status: 'rejected', decisionNote: a.decisionNote ?? '' }, `Rejected (${a.id})`),
});

// ---------------------------------------------------------------- visits & beat plan

registerResourceHooks('fieldVisits', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    if (!c.parentLabel) c.parentLabel = c.siteLabel;
    if (c.customerId && !c.parentResource) {
      c.parentResource = 'customers';
      c.parentId = c.customerId;
    }
  },
});

registerResourceHooks('beatPlans', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    c.weekStart = startOfWeek(String(c.date));
    c.status = 'planned';
    if (String(c.date) < todayKey()) fail('date', 'Plan today or a future day');
  },
  beforeUpdate: (_ctx, _b, c) => {
    c.weekStart = startOfWeek(String(c.date));
  },
});

// ---------------------------------------------------------------- targets (TGT-01)

function normaliseTarget(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  if (c.scopeType !== 'division' && !c.divisionId && c.employeeId) c.divisionId = divisionsOf(c.employeeId)[0];
  if (c.scopeType !== 'division' && c.employeeId && c.divisionId && !divisionsOf(c.employeeId).includes(String(c.divisionId))) fail('divisionId', 'This person does not belong to that division');
  if (c.periodStart) c.periodStart = periodStartFor(String(c.periodType), String(c.periodStart));
  const who = c.scopeType === 'division' ? masterLabel('division', c.divisionId) : `${employeeOf(c.employeeId)?.fullName ?? ''}${c.scopeType === 'team' ? ' (team)' : ''}`;
  c.name = `${who} · ${masterLabel('targetMetric', c.metric)}${c.productCategory ? ` · ${masterLabel('productType', c.productCategory)}` : ''} · ${periodLabel(String(c.periodType), String(c.periodStart))}`;
  const dup = rows(ctx, 'targets').find(
    (t) => t.id !== selfId && t.scopeType === c.scopeType && (t.employeeId ?? null) === (c.employeeId ?? null) && t.divisionId === c.divisionId && t.periodType === c.periodType && t.periodStart === c.periodStart && t.metric === c.metric && (t.productCategory ?? null) === (c.productCategory ?? null),
  );
  if (dup) fail('metric', `A target for the same scope, period and metric already exists (${dup.id})`);
}

registerResourceHooks('targets', {
  beforeCreate: (ctx, c) => normaliseTarget(ctx, c),
  beforeUpdate: (ctx, before, c) => normaliseTarget(ctx, c, before.id),
});

// ---------------------------------------------------------------- record actions

function AttendanceActions({ record }: RecordExtensionProps) {
  const hasRoute = ((record.routePoints as unknown[] | undefined) ?? []).length > 1 || getDb().records.attendance?.find((a) => a.id === record.id)?.routePoints;
  return hasRoute ? (
    <Link className="btn btn-secondary" to={`/attendance/${record.employeeId}/route?date=${record.date}`}>
      <span className="btn-label">View route</span>
    </Link>
  ) : null;
}
registerRecordActions('attendance', AttendanceActions);

