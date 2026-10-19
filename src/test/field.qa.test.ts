/**
 * QA regression tests for BRD 4.11 Field Force and 4.12 Targets & Recognition (defects found in the
 * QA pass; each test names the BRD / business-rule reference it protects).
 */
import { actorFor, perm } from '../services/authz';
import { createDb, __setDb, getDb } from '../services/db';
import { achievement, attendanceExceptions, beatPlanVsActual, checkIn, exportAchievement, grantLocationConsent, leaderboard, logVisit, myVisits, scorecard, startVisit } from '../services/field/field';
import { attendanceMetrics, orderNetValue } from '../services/field/rules';
import { createRecord, transitionRecord, updateRecord } from '../services/runtime';
import { decideApproval } from '../services/workflow';
import { fieldApi } from '../services/api/field';
import { setOffline } from '../services/offline';
import { addDays, todayKey } from '../lib/dates';
import { L } from '../constants/labels';
import '../domain/extensions/index';

const E = L.field.errors;
const at = (date: string, hhmm: string) => `${date}T${hhmm}`;
const today = () => todayKey();
const karan = () => actorFor('u_karan', 'tc'); // sales executive, Textile, reports to Rohan
const rohan = () => actorFor('u_rohan', 'tc'); // sales manager
const neha = () => actorFor('u_neha', 'tc'); // division head, Ink
const admin = () => actorFor('u_rahul', 'tc');
const SNEHA = 'E-1012';
const version = (key: string, id: string) => getDb().records[key].find((r) => r.id === id)!.version;

describe('field force QA', () => {
  beforeEach(() => {
    __setDb(createDb());
    localStorage.clear();
  });

  it('BR-43 shift arithmetic at the boundaries (grace 15 min, half-day < 4.5 h)', () => {
    const S = { start: '09:30', end: '18:30', graceMin: 15, halfDayHours: 4.5 };
    const d = '2026-10-19';
    expect(attendanceMetrics({ checkInAt: at(d, '09:45'), status: 'present' }, S).lateByMin).toBe(0);
    expect(attendanceMetrics({ checkInAt: at(d, '09:46'), status: 'present' }, S).lateByMin).toBe(16);
    const full = attendanceMetrics({ checkInAt: at(d, '09:30'), checkOutAt: at(d, '14:00'), status: 'present' }, S);
    expect(full).toMatchObject({ workMinutes: 270, status: 'present', earlyByMin: 270 });
    expect(attendanceMetrics({ checkInAt: at(d, '09:30'), checkOutAt: at(d, '13:59'), status: 'present' }, S).status).toBe('half_day');
    expect(attendanceMetrics({ checkInAt: at(d, '09:30'), checkOutAt: at(d, '18:29'), status: 'present' }, S).earlyByMin).toBe(1);
    expect(attendanceMetrics({ checkInAt: at(d, '09:30'), checkOutAt: at(d, '18:30'), status: 'on_tour' }, S).status).toBe('on_tour');
  });

  it('ATT-02 mock GPS attempt is blocked AND shows on the Exception Dashboard', () => {
    const k = karan();
    getDb().records.attendance = getDb().records.attendance.filter((a) => !(a.employeeId === k.staffId && a.date === today()));
    grantLocationConsent(k);
    expect(() => checkIn(k, { at: at(today(), '09:20'), point: { lat: 21.17, lng: 72.83 }, place: 'Surat', source: 'mock_app' })).toThrow(E.mockCheckIn);
    const rec = getDb().records.attendance.find((a) => a.employeeId === k.staffId && a.date === today())!;
    expect(rec.mockLocation).toBe(true);
    expect(getDb().audit.some((x) => x.action === 'attendance.mock_location' && x.recordId === rec.id)).toBe(true);
    expect(attendanceExceptions(rohan(), today()).some((x) => x.employee.id === k.staffId && x.kind === 'mock_location')).toBe(true);
    // A genuine check-in afterwards still works and keeps the flag.
    const ok = checkIn(k, { at: at(today(), '09:25'), point: { lat: 21.17, lng: 72.83 }, place: 'Surat', source: 'simulated' });
    expect(ok.mockLocation).toBe(true);
  });

  it('ATT-10 no exceptions for a future day', () => {
    expect(attendanceExceptions(admin(), addDays(today(), 3))).toEqual([]);
  });

  it('ATT-05 a visit can be linked to a lead / opportunity / ticket the user can see; others are refused', () => {
    const k = karan();
    const links = myVisits(k).links;
    expect(links.length).toBeGreaterThan(0);
    const l = links[0];
    const v = logVisit(k, { customerId: l.customerId, siteLabel: 'Site', purpose: 'follow_up', parentResource: l.resource, parentId: l.id, parentLabel: l.label, point: { lat: 21.2, lng: 72.8 }, source: 'simulated', at: at(today(), '11:00') });
    expect(v).toMatchObject({ parentResource: l.resource, parentId: l.id });
    const act = getDb().records.activities.find((a) => a.parentId === l.id && a.activityType === 'visit');
    expect(act).toBeTruthy();
    expect(() => logVisit(k, { customerId: l.customerId, siteLabel: 'Site', purpose: 'demo', parentResource: 'leads', parentId: 'LD-NOPE', point: { lat: 1, lng: 1 }, source: 'simulated', at: at(today(), '12:00') })).toThrow(E.linkUnavailable);
  });

  it('ATT-05 one site at a time; a planned visit cannot be dated in the past; visits only for yourself', () => {
    const k = karan();
    expect(() => createRecord(k, 'fieldVisits', { siteLabel: 'Old', purpose: 'demo', plannedFor: addDays(today(), -2) })).toThrow();
    expect(() => createRecord(k, 'fieldVisits', { siteLabel: 'Theirs', purpose: 'demo', plannedFor: today(), employeeId: SNEHA })).toThrow();
    const a = createRecord(k, 'fieldVisits', { siteLabel: 'A', purpose: 'demo', plannedFor: today() }).record;
    const b = createRecord(k, 'fieldVisits', { siteLabel: 'B', purpose: 'demo', plannedFor: today() }).record;
    startVisit(k, a.id, at(today(), '10:00'), { lat: 1, lng: 1 }, 'simulated');
    expect(() => startVisit(k, b.id, at(today(), '10:05'), { lat: 1, lng: 1 }, 'simulated')).toThrow(E.alreadyAtSite('A'));
  });

  it('ATT-06 beat plan: no duplicates, no moving into the past, only your own', () => {
    const k = karan();
    const d = addDays(today(), 1);
    const b = createRecord(k, 'beatPlans', { siteLabel: 'Navkar Mills', date: d, purpose: 'demo' }).record;
    expect(() => createRecord(k, 'beatPlans', { siteLabel: ' navkar mills ', date: d, purpose: 'follow_up' })).toThrow(E.duplicatePlan(b.id));
    expect(() => updateRecord(k, 'beatPlans', b.id, { date: addDays(today(), -3) }, b.version)).toThrow(E.planPastDay);
    expect(() => createRecord(k, 'beatPlans', { siteLabel: 'X', date: d, purpose: 'demo', employeeId: SNEHA })).toThrow();
  });

  it('ATT-08 expense: amount must be > 0; one conveyance claim per day', () => {
    const k = karan();
    expect(() => createRecord(k, 'expenseClaims', { description: 'Lunch', claimDate: today(), expenseType: 'food', amount: 0, billFileName: 'bill.pdf' })).toThrow(E.amountPositive);
    expect(() => createRecord(k, 'expenseClaims', { description: '   ', claimDate: today(), expenseType: 'food', amount: 100, billFileName: 'bill.pdf' })).toThrow();
    const c = createRecord(k, 'expenseClaims', { description: 'Visits', claimDate: today(), expenseType: 'conveyance', vehicleType: 'car', km: 10 }).record;
    expect(c.amount).toBe(90); // BR-46: 10 km × ₹9 car
    expect(() => createRecord(k, 'expenseClaims', { description: 'Visits again', claimDate: today(), expenseType: 'conveyance', vehicleType: 'two_wheeler', km: 5 })).toThrow(E.duplicateConveyance(c.id));
  });

  it('ATT-09 leave: only pending applications can be edited, and edits are re-validated', () => {
    const k = karan();
    const d = addDays(today(), 5);
    const lv = createRecord(k, 'leaves', { leaveType: 'casual', fromDate: d, toDate: d, reason: 'Family function' }).record;
    expect(() => createRecord(k, 'leaves', { leaveType: 'casual', fromDate: addDays(d, 10), toDate: addDays(d, 10), reason: '   ' })).toThrow();
    expect(() => updateRecord(k, 'leaves', lv.id, { toDate: addDays(d, 40) }, lv.version)).toThrow(E.leaveTooLong);
    const moved = updateRecord(k, 'leaves', lv.id, { fromDate: addDays(d, 1), toDate: addDays(d, 1) }, lv.version).record;
    const apr = getDb().approvals.find((a) => a.recordId === lv.id && a.status === 'pending')!;
    expect(apr.summary).toContain(addDays(d, 1));
    decideApproval(rohan(), apr.id, 'approved', '', apr.version);
    expect(() => updateRecord(k, 'leaves', lv.id, { reason: 'changed' }, version('leaves', lv.id))).toThrow(E.leaveNotEditable);
    expect(moved.fromDate).toBe(addDays(d, 1));
  });

  it('ATT-04 regularisation: check-out strictly after check-in; locked once decided', () => {
    const k = karan();
    const y = addDays(today(), -1);
    expect(() => createRecord(k, 'regularisations', { date: addDays(y, -20), requestedCheckIn: at(addDays(y, -20), '09:30'), requestedCheckOut: at(addDays(y, -20), '09:30'), reason: 'Forgot' })).toThrow(E.checkOutAfterInStrict);
    getDb().records.regularisations = getDb().records.regularisations.filter((r) => !(r.employeeId === k.staffId && r.date === y));
    const rg = createRecord(k, 'regularisations', { date: y, requestedCheckIn: at(y, '09:30'), requestedCheckOut: at(y, '18:30'), reason: 'Forgot to check out' }).record;
    const apr = getDb().approvals.find((a) => a.recordId === rg.id)!;
    decideApproval(rohan(), apr.id, 'approved', '', apr.version);
    expect(getDb().records.attendance.find((a) => a.employeeId === k.staffId && a.date === y)).toMatchObject({ regularised: true, workMinutes: 540 });
    expect(() => updateRecord(k, 'regularisations', rg.id, { requestedCheckOut: at(y, '23:30') }, version('regularisations', rg.id))).toThrow(E.regularisationNotEditable);
  });

  it('TGT-01 permission matrix: sales manager views only; engineer sees own; division head stays in division', () => {
    expect(perm(rohan(), 'targets')).toMatchObject({ read: 'team', update: 'none', create: false });
    expect(perm(actorFor('u_ravi', 'tc'), 'targets').read).toBe('own');
    expect(() => createRecord(rohan(), 'targets', { scopeType: 'user', employeeId: rohan().staffId, periodType: 'month', periodStart: today(), metric: 'quantity', targetValue: 5 })).toThrow();
    expect(() => createRecord(neha(), 'targets', { scopeType: 'division', divisionId: 'TX', periodType: 'month', periodStart: today(), metric: 'quantity', targetValue: 5 })).toThrow(L.targets.errors.outOfScope);
    expect(createRecord(neha(), 'targets', { scopeType: 'division', divisionId: 'INK', periodType: 'month', periodStart: today(), metric: 'quantity', targetValue: 5 }).record.divisionId).toBe('INK');
  });

  it('TGT-02 order value: same basis with and without a product category, computed from booked orders', () => {
    const a = admin();
    const m = today().slice(0, 8) + '01';
    const all = getDb().records.targets.find((t) => t.scopeType === 'user' && t.employeeId === 'E-1011' && t.periodType === 'month' && t.periodStart === m && t.metric === 'order_value' && !t.productCategory)!;
    const types = [...new Set(getDb().records.products.map((p) => String(p.productType)))];
    const cats = types.map((t) => createRecord(a, 'targets', { scopeType: 'user', employeeId: 'E-1011', periodType: 'month', periodStart: m, metric: 'order_value', productCategory: t, targetValue: 1 }).record.id);
    const rows = achievement(a, 'month', m);
    const total = rows.find((r) => r.target.id === all.id)!.actual;
    const byCat = rows.filter((r) => cats.includes(r.target.id)).reduce((s, r) => s + r.actual, 0);
    expect(Math.abs(total - byCat)).toBeLessThanOrEqual(types.length); // rounding only
    const BOOKED = ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation', 'completed'];
    const expected = getDb()
      .records.salesOrders.filter((o) => o.ownerId === 'E-1011' && BOOKED.includes(String(o.status)) && String(o.orderDate) >= m && String(o.orderDate) < addDays(m, 40).slice(0, 8) + '01')
      .reduce((s, o) => s + orderNetValue(o), 0);
    expect(total).toBe(Math.round(expected));
  });

  it('TGT-03/04 scorecard and leaderboards follow the Targets permission; TGT-05 export is audit-logged', () => {
    const m = today().slice(0, 8) + '01';
    expect(() => leaderboard(actorFor('u_meera', 'tc'), null, m)).toThrow(L.targets.errors.noTargetsRead);
    expect(() => scorecard(actorFor('u_prakash', 'tc'), today())).toThrow(L.targets.errors.noTargetsRead);
    expect(leaderboard(karan(), 'INK', m).division).toBe('TX'); // own division only
    expect(scorecard(actorFor('u_ravi', 'tc'), today()).map((r) => r.employee.id)).toEqual(['E-1017']);
    const rows = achievement(admin(), 'month', m);
    const csv = exportAchievement(admin(), rows, 'Oct');
    expect(csv.split('\n').length).toBe(rows.length + 1);
    expect(getDb().audit.some((x) => x.action === 'export' && x.resource === 'targets')).toBe(true);
    expect(() => exportAchievement(karan(), rows, 'Oct')).toThrow(L.targets.errors.noExport);
  });

  it('ATT-08 submitted claim is locked; approval chain manager → Accounts', () => {
    const k = karan();
    const c = createRecord(k, 'expenseClaims', { description: 'Hotel', claimDate: today(), expenseType: 'lodging', amount: 3000, billFileName: 'hotel.pdf' }).record;
    const s = transitionRecord(k, 'expenseClaims', c.id, 'submitted', c.version).record;
    expect(() => updateRecord(k, 'expenseClaims', c.id, { amount: 10 }, s.version)).toThrow(E.claimNotEditable);
    const apr = getDb().approvals.find((a) => a.recordId === c.id)!;
    expect(() => decideApproval(actorFor('u_swati', 'tc'), apr.id, 'approved', '', apr.version)).toThrow();
    decideApproval(rohan(), apr.id, 'approved', '', apr.version);
    decideApproval(actorFor('u_swati', 'tc'), apr.id, 'approved', '', getDb().approvals.find((a) => a.id === apr.id)!.version);
    expect(getDb().records.expenseClaims.find((x) => x.id === c.id)!.status).toBe('approved');
  });
  it('ATT-06 logging a visit at a planned site marks the beat Visited (planned vs actual)', () => {
    const k = karan();
    const b = createRecord(k, 'beatPlans', { siteLabel: 'Om Sai Textiles', date: today(), purpose: 'follow_up' }).record;
    const before = beatPlanVsActual(rohan(), today()).team.find((r) => r.employee.id === k.staffId)!;
    logVisit(k, { siteLabel: 'Om Sai Textiles', purpose: 'follow_up', point: { lat: 21.2, lng: 72.8 }, source: 'simulated', at: at(today(), '11:00') });
    expect(getDb().records.beatPlans.find((x) => x.id === b.id)!.status).toBe('visited');
    const after = beatPlanVsActual(rohan(), today()).team.find((r) => r.employee.id === k.staffId)!;
    expect(after.visited).toBe(before.visited + 1);
  });

  it('NFR-15 offline check-in is queued with the tap time and replayed on reconnect', async () => {
    const k = karan();
    getDb().records.attendance = getDb().records.attendance.filter((a) => !(a.employeeId === k.staffId && a.date === today()));
    grantLocationConsent(k);
    setOffline(true);
    const r = await fieldApi.checkIn(k, { at: at(today(), '09:20'), point: { lat: 21.17, lng: 72.83 }, place: 'Surat', source: 'simulated' });
    expect(r.queued).toBe(true);
    expect(getDb().records.attendance.some((a) => a.employeeId === k.staffId && a.date === today())).toBe(false);
    const res = setOffline(false)!;
    expect(res.conflicts).toEqual([]);
    expect(getDb().records.attendance.find((a) => a.employeeId === k.staffId && a.date === today())!.checkInAt).toBe(at(today(), '09:20'));
  });
});

