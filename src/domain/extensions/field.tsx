/** Field Force (4.11) and Targets & Recognition (4.12): hooks (BR-42 … BR-47), approval types and record actions. */
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { Button } from '../../components/primitives/Button';
import { useToast } from '../../components/primitives/feedback';
import { registerRecordActions, type RecordExtensionProps } from '../../components/resource/extensions';
import { addDays, startOfWeek, todayKey } from '../../lib/dates';
import { call, errorMessage } from '../../services/api/client';
import { employeeOf, trackedKmFor } from '../../services/field/field';
import { attendanceMetrics, conveyanceAmount, expenseLimit, managerLevel, periodLabel, periodStartFor } from '../../services/field/rules';
import { getDb } from '../../services/db';
import { getPolicies } from '../../services/policies';
import { getResource, masterLabel } from '../../services/registry';
import { canUpdateRecord } from '../../services/authz';
import { type HookContext, registerResourceHooks } from '../../services/resourceHooks';
import { insertRecordIn, patchRecordIn, updateRecord } from '../../services/runtime';
import { ServiceError, type Approval } from '../../services/types';
import { registerApprovalType, requestApprovalIn } from '../../services/workflow';
import { LinkButton } from '../../components/primitives/controls';

const E = L.field.errors;
const AP = L.field.approvals;
const money = (n: unknown) => `₹${Number(n).toLocaleString('en-IN')}`;
const nameOf = (staffId: unknown) => String(employeeOf(staffId)?.fullName ?? staffId ?? '');

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

/** Required free text: trims it, and refuses whitespace-only input (the shared validator only checks for ''). */
const trimText = (c: Record<string, unknown>, key: string, required = true) => {
  if (typeof c[key] !== 'string') return;
  c[key] = (c[key] as string).trim();
  if (required && !c[key]) fail(key, E.whitespace);
};

/** The engine checks the create permission only; the new record must also fall inside the actor's write scope. */
const requireWriteScope = (ctx: HookContext, resKey: string, c: Record<string, unknown>, field: string, message: string) => {
  if (!canUpdateRecord(ctx.actor, getResource(resKey), { ...c, id: String(c.id ?? ''), workspaceId: ctx.actor.workspaceId, version: 1 } as never)) fail(field, message);
};

/** Keeps the approval card in step with an edited pending request. */
const refreshApproval = (ctx: HookContext, recordId: string, summary: string, reason: string) =>
  ctx.d.approvals
    .filter((a) => a.recordId === recordId && a.status === 'pending')
    .forEach((a) => {
      a.summary = summary;
      a.reason = reason;
      a.version++;
    });

// ---------------------------------------------------------------- regularisation (ATT-04)

function checkRegularisation(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  trimText(c, 'reason');
  const date = String(c.date ?? '');
  if (date > todayKey()) fail('date', E.regulariseFuture);
  if (c.requestedCheckIn && String(c.requestedCheckIn).slice(0, 10) !== date) fail('requestedCheckIn', E.checkInDate);
  if (c.requestedCheckOut && String(c.requestedCheckOut).slice(0, 10) !== date) fail('requestedCheckOut', E.checkOutDate);
  if (c.requestedCheckIn && c.requestedCheckOut && String(c.requestedCheckOut) <= String(c.requestedCheckIn)) fail('requestedCheckOut', E.checkOutAfterInStrict);
  if (rows(ctx, 'regularisations').some((r) => r.id !== selfId && r.employeeId === c.employeeId && r.date === date && r.status === 'pending')) fail('date', E.regularisationPending);
}
const regularisationSummary = (r: Record<string, unknown>) => AP.regularisationSummary(String(r.date), nameOf(r.employeeId), String(r.requestedCheckIn).slice(11), String(r.requestedCheckOut).slice(11));

registerResourceHooks('regularisations', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    requireWriteScope(ctx, 'regularisations', c, 'date', E.notYourRecord);
    c.status = 'pending';
    checkRegularisation(ctx, c);
  },
  beforeUpdate: (ctx, before, c) => {
    if (before.status !== 'pending') throw new ServiceError('invalid_state', E.regularisationNotEditable);
    checkRegularisation(ctx, c, before.id);
    refreshApproval(ctx, before.id, regularisationSummary(c), String(c.reason));
  },
  afterCreate: (ctx, r) =>
    requestApprovalIn(ctx, {
      type: 'attendance.regularisation',
      resource: 'regularisations',
      recordId: r.id,
      reason: String(r.reason),
      summary: regularisationSummary(r),
      levels: [managerLevel(roleOf(r.employeeId))],
      divisionIds: divisionsOf(r.employeeId),
    }),
});

registerApprovalType('attendance.regularisation', {
  label: AP.regularisation,
  onApproved: (ctx, a) => {
    const r = recordOf(ctx, 'regularisations', a.recordId);
    if (!r) return;
    patchRecordIn(ctx, 'regularisations', r.id, { status: 'approved', decisionNote: a.decisionNote ?? '' }, AP.approved(a.id));
    const m = attendanceMetrics({ checkInAt: String(r.requestedCheckIn), checkOutAt: String(r.requestedCheckOut), status: 'present' }, getPolicies().shift);
    const values = { checkInAt: r.requestedCheckIn, checkOutAt: r.requestedCheckOut, workMinutes: m.workMinutes, lateByMin: m.lateByMin, earlyByMin: m.earlyByMin, status: m.status, regularised: true };
    const existing = rows(ctx, 'attendance').find((x) => x.employeeId === r.employeeId && x.date === r.date);
    if (existing) patchRecordIn(ctx, 'attendance', existing.id, values, AP.regularisedBy(a.id));
    else insertRecordIn(ctx, 'attendance', { employeeId: r.employeeId, date: r.date, ...values, checkInPlace: AP.regularisedPlace, locationSource: 'regularisation' });
  },
  onRejected: (ctx, a) => patchRecordIn(ctx, 'regularisations', a.recordId, { status: 'rejected', decisionNote: a.decisionNote ?? '' }, AP.rejected(a.id)),
});

// ---------------------------------------------------------------- expenses (ATT-08, BR-46)

function priceExpense(c: Record<string, unknown>) {
  const rates = getPolicies().conveyance;
  trimText(c, 'description');
  if (c.expenseType === 'conveyance') {
    const km = Number(c.km);
    if (!(km > 0)) fail('km', E.enterKm);
    c.amount = conveyanceAmount(km, String(c.vehicleType ?? 'two_wheeler'), rates);
  }
  if (!(Number(c.amount) > 0)) fail('amount', E.amountPositive);
  c.policyLimit = expenseLimit(String(c.expenseType), String(c.vehicleType ?? 'two_wheeler'), rates);
  if (Number(c.amount) > Number(c.policyLimit) && !String(c.justification ?? '').trim()) fail('justification', E.aboveLimit(money(c.policyLimit)));
}

/** One conveyance claim per person per day: the day's tracked km cannot be claimed twice. */
function noDuplicateConveyance(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  if (c.expenseType !== 'conveyance') return;
  const dup = rows(ctx, 'expenseClaims').find((x) => x.id !== selfId && x.employeeId === c.employeeId && x.expenseType === 'conveyance' && x.claimDate === c.claimDate);
  if (dup) fail('claimDate', E.duplicateConveyance(dup.id));
}

registerResourceHooks('expenseClaims', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    requireWriteScope(ctx, 'expenseClaims', c, 'description', E.notYourRecord);
    priceExpense(c);
    noDuplicateConveyance(ctx, c);
  },
  beforeUpdate: (ctx, before, c) => {
    if (!['draft', 'rejected'].includes(String(before.status))) throw new ServiceError('invalid_state', E.claimNotEditable);
    priceExpense(c);
    noDuplicateConveyance(ctx, c, before.id);
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
      summary: AP.expenseSummary(after.id, masterLabel('expenseType', after.expenseType), money(after.amount), nameOf(after.employeeId)),
      amount: Number(after.amount),
      levels: [managerLevel(roleOf(after.employeeId)), { capability: 'approve.finance', label: L.roles.accounts.label }],
      divisionIds: divisionsOf(after.employeeId),
    });
  },
});

registerApprovalType('expense.claim', {
  label: AP.expense,
  onApproved: (ctx, a) => patchRecordIn(ctx, 'expenseClaims', a.recordId, { status: 'approved' }, AP.approved(a.id)),
  onRejected: (ctx, a) => patchRecordIn(ctx, 'expenseClaims', a.recordId, { status: 'rejected' }, AP.rejectedWith(a.id, a.decisionNote ?? '')),
});

function ExpenseActions({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const km = record.claimDate ? trackedKmFor(String(record.employeeId), String(record.claimDate)) : null;
  if (record.expenseType !== 'conveyance' || !['draft', 'rejected'].includes(String(record.status))) return null;
  return (
    <Button
      icon="activity"
      disabledReason={record.employeeId !== actor.staffId ? E.onlyClaimant : km === null ? E.noTrackedRoute : undefined}
      onClick={async () => {
        try {
          await call(() => updateRecord(actor, 'expenseClaims', record.id, { km }, record.version));
          toast(L.field.messages.kmFilled(Number(km)));
        } catch (e) {
          toast(errorMessage(e), 'danger');
        }
      }}
    >
      {km !== null ? L.field.actions.fillKmWith(km) : L.field.actions.fillKm}
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

function checkLeave(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  trimText(c, 'reason');
  if (String(c.toDate) < String(c.fromDate)) fail('toDate', E.leaveEndBeforeStart);
  if (eachDay(String(c.fromDate), String(c.toDate)).length > 30) fail('toDate', E.leaveTooLong);
  const clash = rows(ctx, 'leaves').find((l) => l.id !== selfId && l.employeeId === c.employeeId && ['pending', 'approved'].includes(String(l.status)) && String(l.fromDate) <= String(c.toDate) && String(l.toDate) >= String(c.fromDate));
  if (clash) fail('fromDate', E.leaveOverlap(clash.id, String(clash.fromDate), String(clash.toDate)));
}
const leaveSummary = (l: Record<string, unknown>) => AP.leaveSummary(masterLabel('leaveType', l.leaveType), String(l.fromDate), String(l.toDate), nameOf(l.employeeId));

registerResourceHooks('leaves', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    requireWriteScope(ctx, 'leaves', c, 'fromDate', E.notYourRecord);
    checkLeave(ctx, c);
  },
  beforeUpdate: (ctx, before, c) => {
    if (before.status !== 'pending') throw new ServiceError('invalid_state', E.leaveNotEditable);
    checkLeave(ctx, c, before.id);
    refreshApproval(ctx, before.id, leaveSummary(c), String(c.reason));
  },
  afterCreate: (ctx, l) =>
    requestApprovalIn(ctx, {
      type: 'leave.request',
      resource: 'leaves',
      recordId: l.id,
      reason: String(l.reason),
      summary: leaveSummary(l),
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
  label: AP.leave,
  onApproved: (ctx, a: Approval) => {
    const l = patchRecordIn(ctx, 'leaves', a.recordId, { status: 'approved', decisionNote: a.decisionNote ?? '' }, AP.approved(a.id));
    for (const date of eachDay(String(l.fromDate), String(l.toDate))) {
      const existing = rows(ctx, 'attendance').find((x) => x.employeeId === l.employeeId && x.date === date);
      if (existing && !existing.checkInAt) patchRecordIn(ctx, 'attendance', existing.id, { status: 'leave' }, AP.leaveMarked(l.id));
      else if (!existing) insertRecordIn(ctx, 'attendance', { employeeId: l.employeeId, date, status: 'leave', lateByMin: 0, earlyByMin: 0 });
    }
  },
  onRejected: (ctx, a) => patchRecordIn(ctx, 'leaves', a.recordId, { status: 'rejected', decisionNote: a.decisionNote ?? '' }, AP.rejected(a.id)),
});

// ---------------------------------------------------------------- visits & beat plan

registerResourceHooks('fieldVisits', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    requireWriteScope(ctx, 'fieldVisits', c, 'employeeId', E.notYourRecord);
    trimText(c, 'siteLabel');
    if (c.status === 'planned' && String(c.plannedFor ?? '') < todayKey()) fail('plannedFor', E.planPastVisit);
    if (!c.parentLabel) c.parentLabel = c.siteLabel;
    if (c.customerId && !c.parentResource) {
      c.parentResource = 'customers';
      c.parentId = c.customerId;
    }
  },
});

function noDuplicateBeat(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  const dup = rows(ctx, 'beatPlans').find((b) => b.id !== selfId && b.employeeId === c.employeeId && b.date === c.date && (c.customerId ? b.customerId === c.customerId : String(b.siteLabel).toLowerCase() === String(c.siteLabel).toLowerCase()));
  if (dup) fail('siteLabel', E.duplicatePlan(dup.id));
}

registerResourceHooks('beatPlans', {
  beforeCreate: (ctx, c) => {
    ownerDefault(ctx, c);
    requireWriteScope(ctx, 'beatPlans', c, 'employeeId', E.notYourRecord);
    trimText(c, 'siteLabel');
    c.weekStart = startOfWeek(String(c.date));
    c.status = 'planned';
    if (String(c.date) < todayKey()) fail('date', E.planPastDay);
    noDuplicateBeat(ctx, c);
  },
  beforeUpdate: (ctx, before, c) => {
    trimText(c, 'siteLabel');
    if (c.date !== before.date && String(c.date) < todayKey()) fail('date', E.planPastDay);
    c.weekStart = startOfWeek(String(c.date));
    noDuplicateBeat(ctx, c, before.id);
  },
});

// ---------------------------------------------------------------- targets (TGT-01)

function normaliseTarget(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  if (c.scopeType !== 'division' && !c.divisionId && c.employeeId) c.divisionId = divisionsOf(c.employeeId)[0];
  if (c.scopeType !== 'division' && c.employeeId && c.divisionId && !divisionsOf(c.employeeId).includes(String(c.divisionId))) fail('divisionId', L.targets.errors.notInDivision);
  if (c.periodStart) c.periodStart = periodStartFor(String(c.periodType), String(c.periodStart));
  const person = String(employeeOf(c.employeeId)?.fullName ?? '');
  const who = c.scopeType === 'division' ? masterLabel('division', c.divisionId) : c.scopeType === 'team' ? L.targets.name.team(person) : person;
  c.name = L.targets.name.join([who, masterLabel('targetMetric', c.metric), c.productCategory ? masterLabel('productType', c.productCategory) : '', periodLabel(String(c.periodType), String(c.periodStart))]);
  const dup = rows(ctx, 'targets').find(
    (t) => t.id !== selfId && t.scopeType === c.scopeType && (t.employeeId ?? null) === (c.employeeId ?? null) && t.divisionId === c.divisionId && t.periodType === c.periodType && t.periodStart === c.periodStart && t.metric === c.metric && (t.productCategory ?? null) === (c.productCategory ?? null),
  );
  if (dup) fail('metric', L.targets.errors.duplicate(dup.id));
}

registerResourceHooks('targets', {
  beforeCreate: (ctx, c) => {
    normaliseTarget(ctx, c);
    requireWriteScope(ctx, 'targets', c, c.scopeType === 'division' ? 'divisionId' : 'employeeId', L.targets.errors.outOfScope);
  },
  beforeUpdate: (ctx, before, c) => {
    normaliseTarget(ctx, c, before.id);
    requireWriteScope(ctx, 'targets', c, c.scopeType === 'division' ? 'divisionId' : 'employeeId', L.targets.errors.outOfScope);
  },
});

// ---------------------------------------------------------------- record actions

function AttendanceActions({ record }: RecordExtensionProps) {
  const points = (record.routePoints ?? getDb().records.attendance?.find((a) => a.id === record.id)?.routePoints) as unknown[] | undefined;
  const hasRoute = (points?.length ?? 0) > 1;
  return hasRoute ? (
    <LinkButton to={toPath(ROUTES.routeMapFor, { userId: String(record.employeeId) }, { date: String(record.date) })}>{L.field.actions.viewRoute}</LinkButton>
  ) : null;
}
registerRecordActions('attendance', AttendanceActions);
