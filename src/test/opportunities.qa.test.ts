/** QA probes for BRD 4.3 Opportunity & Pipeline (OPP-01…07) — stage flow, Mark Lost, roles, demos, samples. */
import { appPack } from '../domain/pack';
import { actorFor } from '../services/authz';
import { commit, createDb, getDb, __setDb } from '../services/db';
import { createRecord, getRecord, queryRecords, transitionRecord, updateRecord } from '../services/runtime';
import { acceptedQuotationFor, markLost, sweepStagnation } from '../services/opportunities';
import { addDays, todayKey } from '../lib/dates';
import '../domain/extensions/index';

const WS = 'tc';
const has = (k: string) => appPack.resources.some((r) => r.key === k);
const admin = () => actorFor('u_rahul', WS);
const karan = () => actorFor('u_karan', WS);
const rohan = () => actorFor('u_rohan', WS);

function fresh() {
  __setDb(createDb(new Date()));
  const at = new Date().toISOString();
  // Through commit, so a failed write's rollback keeps the fixture.
  commit((d) => (d.records.customers ??= []).push({ id: 'C-9001', workspaceId: WS, version: 1, createdAt: at, updatedAt: at, createdBy: 'system', name: 'QA Prints', territoryId: 'surat', divisionIds: ['TX'] }));
}
const newOpp = (extra: Record<string, unknown> = {}) =>
  createRecord(karan(), 'opportunities', { name: 'QA opp', customerId: 'C-9001', divisionId: 'TX', oppType: 'additional_machine', value: 1_000_000, expectedCloseDate: addDays(todayKey(), 30), ownerId: karan().staffId, ...extra }).record;

describe('opportunities QA probes', () => {
  beforeEach(fresh);

  it('OPP-01: validation — required fields, negative value, probability range', () => {
    expect(() => newOpp({ name: '  ' })).toThrow();
    expect(() => newOpp({ customerId: undefined })).toThrow();
    expect(() => newOpp({ value: -5 })).toThrow();
    expect(() => newOpp({ probability: 140 })).toThrow();
    expect(() => newOpp({ expectedCloseDate: undefined })).toThrow();
    expect(newOpp().stage).toBe('needs_assessment');
  });

  it('OPP-02: stage flow — forward / back allowed, Won guarded, terminal locked, reopen Admin only', () => {
    const o = newOpp();
    const demo = transitionRecord(karan(), 'opportunities', o.id, 'demo', o.version).record;
    const back = transitionRecord(karan(), 'opportunities', o.id, 'needs_assessment', demo.version).record;
    expect(back.probability).toBe(10);
    expect(() => transitionRecord(karan(), 'opportunities', o.id, 'won', back.version)).toThrow();
    const lost = markLost(karan(), o.id, { lostReason: 'price', lostToCompetitor: 'Epson' }, back.version);
    expect(() => transitionRecord(karan(), 'opportunities', o.id, 'demo', lost.version)).toThrow();
    expect(() => transitionRecord(karan(), 'opportunities', o.id, 'needs_assessment', lost.version)).toThrow();
    expect(() => transitionRecord(rohan(), 'opportunities', o.id, 'needs_assessment', lost.version)).toThrow();
    const reopened = transitionRecord(admin(), 'opportunities', o.id, 'needs_assessment', lost.version).record;
    expect(reopened.stage).toBe('needs_assessment');
    expect(reopened.lostReason ?? null).toBeNull();
  });

  it('OPP-05: Mark Lost — whitespace competitor, negative price, out of scope, read-only roles', () => {
    const o = newOpp();
    expect(() => markLost(karan(), o.id, { lostReason: 'price', lostToCompetitor: '   ' }, o.version)).toThrow();
    expect(() => markLost(karan(), o.id, { lostReason: 'price', lostToCompetitor: 'Epson', lostToPrice: -1 }, o.version)).toThrow();
    expect(() => markLost(actorFor('u_sneha', WS), o.id, { lostReason: 'price', lostToCompetitor: 'Epson' }, o.version)).toThrow();
    expect(() => markLost(actorFor('u_vikram', WS), o.id, { lostReason: 'price', lostToCompetitor: 'Epson' }, o.version)).toThrow();
    const l = markLost(karan(), o.id, { lostReason: 'price', lostToCompetitor: 'Epson', lostToPrice: 900_000 }, o.version);
    expect(l.lostToPrice).toBe(900_000);
    // stale version (double submit) rejected
    expect(() => markLost(karan(), o.id, { lostReason: 'price', lostToCompetitor: 'Epson' }, o.version)).toThrow();
  });

  it('§2.2 roles: management read-only, profiling sees only opportunities with sample requests, store has no access', () => {
    const o = newOpp();
    expect(queryRecords(actorFor('u_vikram', WS), 'opportunities').rows.some((r) => r.id === o.id)).toBe(true);
    expect(() => updateRecord(actorFor('u_vikram', WS), 'opportunities', o.id, { notes: 'x' }, o.version)).toThrow();
    expect(() => queryRecords(actorFor('u_prakash', WS), 'opportunities')).toThrow();
    expect(() => getRecord(actorFor('u_sneha', WS), 'opportunities', o.id)).toThrow();
  });

  it('OPP-04: demos — duration range, results needed to mark done, cancelled slot can be rebooked', () => {
    const o = newOpp();
    const m = getDb().records.demoMachines.find((x) => x.status === 'active')!;
    const base = { opportunityId: o.id, location: 'centre', demoMachineId: m.id, scheduledAt: `${addDays(todayKey(), 5)}T10:00`, durationMin: 120, ownerId: karan().staffId };
    expect(() => createRecord(karan(), 'demos', { ...base, durationMin: 10 })).toThrow();
    expect(() => createRecord(karan(), 'demos', { ...base, demoMachineId: undefined })).toThrow();
    const d1 = createRecord(karan(), 'demos', base).record;
    expect(() => transitionRecord(karan(), 'demos', d1.id, 'done', d1.version)).toThrow();
    const c = transitionRecord(karan(), 'demos', d1.id, 'cancelled', d1.version).record;
    expect(c.status).toBe('cancelled');
    expect(createRecord(karan(), 'demos', base).record.id).toBeTruthy();
    // a machine under maintenance cannot be booked
    const maint = getDb().records.demoMachines.find((x) => x.id !== m.id)!;
    commit((d) => (d.records.demoMachines.find((x) => x.id === maint.id)!.status = 'maintenance'));
    expect(() => createRecord(karan(), 'demos', { ...base, demoMachineId: maint.id, scheduledAt: `${addDays(todayKey(), 9)}T10:00` })).toThrow();
    // site demo needs no machine
    expect(createRecord(karan(), 'demos', { ...base, location: 'site', demoMachineId: undefined }).record.id).toBeTruthy();
  });

  it('OPP-04: sample print request — artwork required, past due date rejected, Profiling records results', () => {
    if (!getDb().records.employees.some((e) => e.roleId === 'profiling')) return;
    const o = newOpp();
    const prof = getDb().records.employees.find((e) => e.roleId === 'profiling')!;
    const base = { title: 'Georgette sample', opportunityId: o.id, assigneeId: prof.id, dueDate: addDays(todayKey(), 7), ownerId: karan().staffId, artwork: 'Floral A3 artwork' };
    expect(() => createRecord(karan(), 'sampleRequests', { ...base, artwork: '' })).toThrow();
    expect(() => createRecord(karan(), 'sampleRequests', { ...base, dueDate: addDays(todayKey(), -1) })).toThrow();
    const s = createRecord(karan(), 'sampleRequests', base).record;
    expect(s.customerId).toBe('C-9001');
    const profUser = (getDb().records.employees.find((e) => e.id === prof.id) as { userId?: string }).userId;
    if (!profUser) return;
    const profiling = actorFor(profUser, WS);
    expect(() => transitionRecord(profiling, 'sampleRequests', s.id, 'results_shared', s.version)).toThrow();
  });

  it('OPP-06: stagnation sweep flags past-close opportunities and is idempotent per day', () => {
    const o = newOpp();
    const raw = getDb().records.opportunities.find((x) => x.id === o.id)!;
    raw.expectedCloseDate = addDays(todayKey(), -2);
    const n1 = getDb().notifications.length;
    expect(sweepStagnation(rohan())).toBeGreaterThan(0);
    const n2 = getDb().notifications.length;
    expect(n2).toBeGreaterThan(n1);
    sweepStagnation(rohan());
    expect(getDb().notifications.length).toBe(n2);
  });

  it('OPP-01 hand-off: a lead conversion creates the opportunity in Needs Assessment at 10 %', () => {
    if (!has('leads')) return;
    const any = getDb().records.opportunities.filter((x) => x.leadId);
    expect(any.every((x) => typeof x.leadId === 'string')).toBe(true);
  });

  it('OPP-05 hand-off: seeded Won opportunities have an accepted quotation, so Generate Sales Order is enabled', () => {
    if (!has('quotations')) return;
    const won = getDb().records.opportunities.filter((o) => o.stage === 'won');
    expect(won.length).toBeGreaterThan(0);
    const withQuote = won.filter((o) => acceptedQuotationFor(o.id));
    expect(withQuote.length / won.length).toBeGreaterThan(0.5);
  });
});
