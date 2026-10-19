import { actorFor, perm } from '../services/authz';
import { createDb, __setDb, getDb } from '../services/db';
import { achievement, beatPlanVsActual, checkIn, checkOut, completeVisit, grantLocationConsent, leaderboard, logVisit, scorecard, startVisit, teamAttendance, attendanceExceptions } from '../services/field/field';
import { attendanceMetrics } from '../services/field/rules';
import { createRecord, updateRecord, transitionRecord, queryRecords } from '../services/runtime';
import { decideApproval } from '../services/workflow';
import '../domain/extensions/index';

const today = () => new Date().toISOString().slice(0, 10);
const local = (hhmm: string) => `${today()}T${hhmm}`;
const log: string[] = [];
const tryIt = (name: string, fn: () => unknown) => {
  try {
    const r = fn();
    log.push(`OK   ${name} -> ${JSON.stringify(r)?.slice(0, 200)}`);
  } catch (e) {
    log.push(`ERR  ${name} -> ${(e as Error).message}`);
  }
};

describe('probe', () => {
  beforeEach(() => __setDb(createDb()));
  afterAll(() => console.log(log.join('\n')));

  it('shift boundaries', () => {
    const S = { start: '09:30', end: '18:30', graceMin: 15, halfDayHours: 4.5 };
    const d = '2026-10-19';
    for (const t of ['09:30', '09:45', '09:46', '08:00']) log.push(`in ${t} ${JSON.stringify(attendanceMetrics({ checkInAt: `${d}T${t}`, status: 'present' }, S))}`);
    for (const [i, o] of [['09:30', '18:30'], ['09:30', '18:29'], ['09:30', '14:00'], ['09:30', '13:59'], ['10:00', '14:30'], ['09:30', '23:00']]) log.push(`in ${i} out ${o} ${JSON.stringify(attendanceMetrics({ checkInAt: `${d}T${i}`, checkOutAt: `${d}T${o}`, status: 'present' }, S))}`);
  });

  it('attendance flows', () => {
    const karan = actorFor('u_karan', 'tc');
    getDb().records.attendance = getDb().records.attendance.filter((a) => !(a.employeeId === karan.staffId && a.date === today()));
    grantLocationConsent(karan);
    const p = { lat: 21.17, lng: 72.83 };
    tryIt('checkout before checkin', () => checkOut(karan, { at: local('09:00'), point: p, place: 'x', source: 'simulated' }));
    tryIt('checkin', () => checkIn(karan, { at: local('09:46'), point: p, place: 'x', source: 'simulated' }).lateByMin);
    tryIt('double checkin', () => checkIn(karan, { at: local('09:50'), point: p, place: 'x', source: 'simulated' }));
    tryIt('checkout earlier than checkin', () => checkOut(karan, { at: local('09:40'), point: p, place: 'x', source: 'simulated' }));
    tryIt('checkout', () => checkOut(karan, { at: local('13:00'), point: p, place: 'x', source: 'simulated' }).status);
    tryIt('checkout twice', () => checkOut(karan, { at: local('14:00'), point: p, place: 'x', source: 'simulated' }));
    tryIt('checkin again after out', () => checkIn(karan, { at: local('15:00'), point: p, place: 'x', source: 'simulated' }));
    const swati = actorFor('u_swati', 'tc');
    getDb().records.attendance = getDb().records.attendance.filter((a) => !(a.employeeId === swati.staffId && a.date === today()));
    grantLocationConsent(swati);
    tryIt('office 150m', () => checkIn(swati, { at: local('09:30'), point: { lat: 19.1136 + 0.00135, lng: 72.8697 }, place: 'x', source: 'device' }).insideGeofence);
  });

  it('visits', () => {
    const karan = actorFor('u_karan', 'tc');
    tryIt('logVisit blank site', () => logVisit(karan, { siteLabel: '   ', purpose: 'demo', point: { lat: 1, lng: 1 }, source: 'simulated', at: local('11:00') }));
    tryIt('logVisit no purpose', () => logVisit(karan, { siteLabel: 'X', purpose: '', point: { lat: 1, lng: 1 }, source: 'simulated', at: local('11:00') }).purpose);
    tryIt('logVisit bad purpose', () => logVisit(karan, { siteLabel: 'X', purpose: 'party', point: { lat: 1, lng: 1 }, source: 'simulated', at: local('11:00') }).purpose);
    tryIt('logVisit past next date', () => logVisit(karan, { siteLabel: 'X', purpose: 'demo', nextActionDate: '2020-01-01', point: { lat: 1, lng: 1 }, source: 'simulated', at: local('11:00') }).nextActionDate);
    tryIt('logVisit long site', () => logVisit(karan, { siteLabel: 'X'.repeat(500), purpose: 'demo', point: { lat: 1, lng: 1 }, source: 'simulated', at: local('11:00') }).id);
    tryIt('create visit for other employee', () => createRecord(karan, 'fieldVisits', { siteLabel: 'Y', purpose: 'demo', plannedFor: today(), employeeId: 'u_sneha' }).record.employeeId);
    const v = createRecord(karan, 'fieldVisits', { siteLabel: 'Z', purpose: 'demo', plannedFor: '2020-01-01' }).record;
    log.push(`planned visit in past allowed: ${v.plannedFor}`);
    tryIt('start', () => startVisit(karan, v.id, local('10:00'), { lat: 1, lng: 1 }, 'simulated').status);
    const v2 = createRecord(karan, 'fieldVisits', { siteLabel: 'Z2', purpose: 'demo', plannedFor: today() }).record;
    tryIt('start second while one at site', () => startVisit(karan, v2.id, local('10:05'), { lat: 1, lng: 1 }, 'simulated').status);
    tryIt('complete no remarks', () => completeVisit(karan, v.id, { at: local('11:00'), remarks: ' ' }));
    tryIt('complete', () => completeVisit(karan, v.id, { at: local('11:00'), remarks: 'ok' }).status);
    tryIt('edit completed visit', () => updateRecord(karan, 'fieldVisits', v.id, { remarks: 'changed' }, getDb().records.fieldVisits.find((x) => x.id === v.id)!.version).record.remarks);
    tryIt('edit completed visit status via update', () => updateRecord(karan, 'fieldVisits', v.id, { checkInAt: local('01:00') }, getDb().records.fieldVisits.find((x) => x.id === v.id)!.version).record.checkInAt);
  });

  it('beat plan', () => {
    const karan = actorFor('u_karan', 'tc');
    tryIt('beat for other', () => createRecord(karan, 'beatPlans', { siteLabel: 'A', date: today(), purpose: 'demo', employeeId: 'u_sneha' }).record.employeeId);
    tryIt('beat past', () => createRecord(karan, 'beatPlans', { siteLabel: 'A', date: '2020-01-01', purpose: 'demo' }).record.id);
    const b = createRecord(karan, 'beatPlans', { siteLabel: 'A', date: today(), purpose: 'demo' }).record;
    tryIt('beat dup', () => createRecord(karan, 'beatPlans', { siteLabel: 'A', date: today(), purpose: 'demo' }).record.id);
    tryIt('beat move to past', () => updateRecord(karan, 'beatPlans', b.id, { date: '2020-01-01' }, b.version).record.date);
    const rohan = actorFor('u_rohan', 'tc');
    tryIt('mgr beat team', () => beatPlanVsActual(rohan, today()).team.map((r) => [r.employee.fullName, r.planned.length, r.visited, r.missed, r.pending, r.unplanned]));
  });

  it('expenses', () => {
    const karan = actorFor('u_karan', 'tc');
    tryIt('zero amount food', () => createRecord(karan, 'expenseClaims', { description: 'Lunch', claimDate: today(), expenseType: 'food', amount: 0, billFileName: 'a.pdf' }).record.amount);
    tryIt('negative', () => createRecord(karan, 'expenseClaims', { description: 'Lunch', claimDate: today(), expenseType: 'food', amount: -5, billFileName: 'a.pdf' }).record.amount);
    tryIt('no bill', () => createRecord(karan, 'expenseClaims', { description: 'Lunch', claimDate: today(), expenseType: 'food', amount: 100 }).record.amount);
    tryIt('future', () => createRecord(karan, 'expenseClaims', { description: 'Lunch', claimDate: '2099-01-01', expenseType: 'food', amount: 100, billFileName: 'a.pdf' }).record.amount);
    tryIt('over limit no just', () => createRecord(karan, 'expenseClaims', { description: 'Lunch', claimDate: today(), expenseType: 'food', amount: 900, billFileName: 'a.pdf' }).record.amount);
    tryIt('conv km 0', () => createRecord(karan, 'expenseClaims', { description: 'c', claimDate: today(), expenseType: 'conveyance', vehicleType: 'car', km: 0 }).record.amount);
    tryIt('conv km 2500', () => createRecord(karan, 'expenseClaims', { description: 'c', claimDate: today(), expenseType: 'conveyance', vehicleType: 'car', km: 2500 }).record.amount);
    const c1 = createRecord(karan, 'expenseClaims', { description: 'c', claimDate: today(), expenseType: 'conveyance', vehicleType: 'car', km: 10 }).record;
    log.push(`car 10km = ${c1.amount}, limit ${c1.policyLimit}`);
    tryIt('conv dup same day', () => createRecord(karan, 'expenseClaims', { description: 'c', claimDate: today(), expenseType: 'conveyance', vehicleType: 'car', km: 10 }).record.amount);
    const sub = transitionRecord(karan, 'expenseClaims', c1.id, 'submitted', c1.version).record;
    tryIt('edit submitted', () => updateRecord(karan, 'expenseClaims', c1.id, { km: 50 }, sub.version).record.km);
    const apr = getDb().approvals.find((a) => a.recordId === c1.id)!;
    tryIt('accounts approves level 1 first', () => decideApproval(actorFor('u_swati', 'tc'), apr.id, 'approved', '', apr.version));
    tryIt('karan approves own', () => decideApproval(karan, apr.id, 'approved', '', getDb().approvals.find((a) => a.id === apr.id)!.version));
    tryIt('other division mgr approves', () => decideApproval(actorFor('u_priya', 'tc'), apr.id, 'approved', '', getDb().approvals.find((a) => a.id === apr.id)!.version));
    tryIt('reject without note', () => decideApproval(actorFor('u_rohan', 'tc'), apr.id, 'rejected', '', getDb().approvals.find((a) => a.id === apr.id)!.version));
    log.push(`status after reject: ${getDb().records.expenseClaims.find((c) => c.id === c1.id)!.status}`);
    tryIt('rohan sees karan claims', () => queryRecords(actorFor('u_rohan', 'tc'), 'expenseClaims', {}).rows.map((r) => r.employeeId).filter((x, i, a) => a.indexOf(x) === i));
    tryIt('priya sees karan claims', () => queryRecords(actorFor('u_priya', 'tc'), 'expenseClaims', {}).rows.some((r) => r.employeeId === karan.staffId));
    tryIt('sales exec transition to exported', () => transitionRecord(karan, 'expenseClaims', c1.id, 'exported', getDb().records.expenseClaims.find((c) => c.id === c1.id)!.version).record.status);
  });

  it('leave & regularisation', () => {
    const karan = actorFor('u_karan', 'tc');
    const d = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const lv = createRecord(karan, 'leaves', { leaveType: 'casual', fromDate: d, toDate: d, reason: 'x' }).record;
    tryIt('leave overlap', () => createRecord(karan, 'leaves', { leaveType: 'casual', fromDate: d, toDate: d, reason: 'y' }).record.id);
    tryIt('leave end<start', () => createRecord(karan, 'leaves', { leaveType: 'casual', fromDate: d, toDate: '2020-01-01', reason: 'y' }).record.id);
    tryIt('leave whitespace reason', () => createRecord(karan, 'leaves', { leaveType: 'casual', fromDate: '2027-02-01', toDate: '2027-02-01', reason: '   ' }).record.id);
    tryIt('edit pending leave dates', () => updateRecord(karan, 'leaves', lv.id, { toDate: addD(d, 40) }, lv.version).record.toDate);
    const apr = getDb().approvals.find((a) => a.recordId === lv.id)!;
    decideApproval(actorFor('u_rohan', 'tc'), apr.id, 'approved', '', apr.version);
    const cur = getDb().records.leaves.find((x) => x.id === lv.id)!;
    tryIt('edit approved leave', () => updateRecord(karan, 'leaves', lv.id, { fromDate: addD(d, 1), toDate: addD(d, 1) }, cur.version).record.fromDate);
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const rg = createRecord(karan, 'regularisations', { date: y, requestedCheckIn: `${y}T09:30`, requestedCheckOut: `${y}T18:30`, reason: 'forgot' }).record;
    const ra = getDb().approvals.find((a) => a.recordId === rg.id)!;
    tryIt('approve reg', () => decideApproval(actorFor('u_rohan', 'tc'), ra.id, 'approved', '', ra.version).status);
    const rcur = getDb().records.regularisations.find((x) => x.id === rg.id)!;
    tryIt('edit approved reg', () => updateRecord(karan, 'regularisations', rg.id, { reason: 'changed', requestedCheckOut: `${y}T23:30` }, rcur.version).record.requestedCheckOut);
    tryIt('reg out<in', () => createRecord(karan, 'regularisations', { date: addD(y, -1), requestedCheckIn: `${addD(y, -1)}T18:30`, requestedCheckOut: `${addD(y, -1)}T09:30`, reason: 'x' }).record.id);
    tryIt('reg equal', () => createRecord(karan, 'regularisations', { date: addD(y, -2), requestedCheckIn: `${addD(y, -2)}T09:30`, requestedCheckOut: `${addD(y, -2)}T09:30`, reason: 'x' }).record.id);
  });

  it('targets & achievement', () => {
    const admin = actorFor('u_rahul', 'tc');
    const rohan = actorFor('u_rohan', 'tc');
    const neha = actorFor('u_neha', 'tc');
    log.push(`perm sales_manager targets ${JSON.stringify(perm(rohan, 'targets'))}`);
    log.push(`perm engineer targets ${JSON.stringify(perm(actorFor('u_ravi', 'tc'), 'targets'))}`);
    tryIt('neha creates TX target', () => createRecord(neha, 'targets', { scopeType: 'division', divisionId: 'TX', periodType: 'month', periodStart: today(), metric: 'quantity', targetValue: 5 }).record.name);
    tryIt('rohan self target', () => createRecord(rohan, 'targets', { scopeType: 'user', employeeId: rohan.staffId, periodType: 'month', periodStart: today(), metric: 'quantity', targetValue: 5 }).record.name);
    tryIt('target 0', () => createRecord(admin, 'targets', { scopeType: 'user', employeeId: 'u_karan', periodType: 'month', periodStart: today(), metric: 'quantity', targetValue: 0 }).record.name);
    const m = today().slice(0, 8) + '01';
    const rows = achievement(admin, 'month', m);
    log.push(`targets this month: ${rows.length}`);
    rows.slice(0, 6).forEach((r) => log.push(`  ${r.target.name} target=${r.target.targetValue} actual=${r.actual} pct=${r.pct} members=${r.members.map((x) => x.actual).reduce((a, b) => a + b, 0)}`));
    tryIt('coordinator leaderboard', () => leaderboard(actorFor('u_meera', 'tc'), null, m).ranking.length);
    tryIt('sales exec leaderboard other div', () => leaderboard(actorFor('u_karan', 'tc'), 'INK', m).division);
    tryIt('store scorecard', () => scorecard(actorFor('u_prakash', 'tc'), today()).length);
    tryIt('engineer achievement', () => achievement(actorFor('u_ravi', 'tc'), 'month', m).length);
    tryIt('coordinator team attendance', () => teamAttendance(actorFor('u_meera', 'tc'), today()).length);
    tryIt('exceptions karan', () => attendanceExceptions(actorFor('u_karan', 'tc'), today()).length);
  });
});

function addD(d: string, n: number) {
  return new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
}
