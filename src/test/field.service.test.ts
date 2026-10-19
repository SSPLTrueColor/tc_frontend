import { actorFor } from '../services/authz';
import { createDb, __setDb, getDb } from '../services/db';
import { checkIn, checkOut, grantLocationConsent, logVisit, myDay } from '../services/field/field';
import { createRecord, transitionRecord } from '../services/runtime';
import { decideApproval } from '../services/workflow';
import '../domain/extensions/index';

const today = () => new Date().toISOString().slice(0, 10);
const local = (hhmm: string) => `${today()}T${hhmm}`;

describe('field service', () => {
  beforeEach(() => {
    __setDb(createDb());
    getDb().records.attendance = getDb().records.attendance.filter((a) => a.date !== today());
  });

  it('requires consent, blocks mock GPS, enforces one open check-in and computes metrics', () => {
    const karan = actorFor('u_karan', 'tc');
    const p = { lat: 21.17, lng: 72.83 };
    localStorage.clear();
    getDb().records.attendance = getDb().records.attendance.filter((a) => a.employeeId !== karan.staffId);
    expect(() => checkIn(karan, { at: local('09:20'), point: p, place: 'Surat', source: 'simulated' })).toThrow(/consent/);
    grantLocationConsent(karan);
    expect(() => checkIn(karan, { at: local('09:20'), point: p, place: 'Surat', source: 'mock_app' })).toThrow(/Mock/);
    const rec = checkIn(karan, { at: local('10:05'), point: p, place: 'Surat', source: 'simulated' });
    expect(rec.lateByMin).toBe(35);
    expect(() => checkIn(karan, { at: local('10:10'), point: p, place: 'Surat', source: 'simulated' })).toThrow(/already checked in/);
    logVisit(karan, { siteLabel: 'Om Sai Textiles', purpose: 'follow_up', point: { lat: 21.2, lng: 72.85 }, source: 'simulated', at: local('12:00') });
    const out = checkOut(karan, { at: local('18:45'), point: p, place: 'Surat', source: 'simulated' });
    expect(out.status).toBe('present');
    expect(Number(out.distanceKm)).toBeGreaterThan(0);
    expect(myDay(karan).visitsToday).toBe(1);
  });

  it('office staff must be inside the geofence unless on tour', () => {
    const swati = actorFor('u_swati', 'tc');
    grantLocationConsent(swati);
    expect(() => checkIn(swati, { at: local('09:20'), point: { lat: 19.076, lng: 72.8777 }, place: 'Dadar', source: 'device' })).toThrow(/from the office/);
    expect(checkIn(swati, { at: local('09:20'), point: { lat: 19.076, lng: 72.8777 }, place: 'Dadar', source: 'device', onTour: true }).status).toBe('on_tour');
  });

  it('expense claim: conveyance priced from km, then manager → accounts approval', () => {
    const karan = actorFor('u_karan', 'tc');
    const claim = createRecord(karan, 'expenseClaims', { description: 'Visits', claimDate: today(), expenseType: 'conveyance', vehicleType: 'two_wheeler', km: 50, amount: 1 }).record;
    expect(claim.amount).toBe(200);
    transitionRecord(karan, 'expenseClaims', claim.id, 'submitted', claim.version);
    const apr = getDb().approvals.find((a) => a.recordId === claim.id)!;
    expect(apr.levels.map((l) => l.label)).toEqual(['Reporting manager', 'Accounts']);
    decideApproval(actorFor('u_rohan', 'tc'), apr.id, 'approved', '', apr.version);
    const again = getDb().approvals.find((a) => a.id === apr.id)!;
    decideApproval(actorFor('u_swati', 'tc'), apr.id, 'approved', 'OK', again.version);
    expect(getDb().records.expenseClaims.find((c) => c.id === claim.id)!.status).toBe('approved');
  });

  it('approved leave marks attendance as leave', () => {
    const karan = actorFor('u_karan', 'tc');
    const d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const leave = createRecord(karan, 'leaves', { leaveType: 'casual', fromDate: d, toDate: d, reason: 'Family function' }).record;
    const apr = getDb().approvals.find((a) => a.recordId === leave.id)!;
    decideApproval(actorFor('u_rohan', 'tc'), apr.id, 'approved', '', apr.version);
    expect(getDb().records.attendance.find((a) => a.employeeId === karan.staffId && a.date === d)?.status).toBe('leave');
  });
});
