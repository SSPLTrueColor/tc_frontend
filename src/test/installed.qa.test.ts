/** QA regression tests for BRD 4.6 installation and 4.7 Installed Base, Warranty & AMC (defects found in the QA pass). */
import '../domain/extensions/index';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { setClockOffset } from '../lib/clock';
import { addDays, todayKey } from '../lib/dates';
import { createRecord, transitionRecord, updateRecord } from '../services/runtime';
import { canFillHandover, generatePmVisits, handoverOwnerId, planRenewalSweep, renewContract, runRenewalSweep, saveHandover } from '../services/installed/logic';
import { coverageFor, userOfStaff } from '../services/lookups';
import { ServiceError } from '../services/types';

const svc = () => actorFor('u_manoj', 'tc');

describe('installed base QA regressions', () => {
  beforeEach(() => {
    setClockOffset(0);
    __setDb(createDb(new Date()));
  });

  it('INS-04 / BR-26: the sales owner fills the Sales-to-Service handover; other sales users cannot', () => {
    const d = getDb();
    const ins = d.records.installations.find((i) => i.status === 'site_ready' || i.status === 'scheduled')!;
    const ownerStaff = handoverOwnerId(ins);
    expect(ownerStaff).toBeTruthy();
    const owner = actorFor(userOfStaff(ownerStaff)!.id, 'tc');
    expect(owner.staffId).toBe(ownerStaff);
    expect(canFillHandover(owner, ins)).toBe(true);
    const other = ['u_karan', 'u_sneha', 'u_deepak', 'u_pooja', 'u_rohan', 'u_priya', 'u_imran'].map((u) => actorFor(u, 'tc')).find((a) => a.staffId !== ownerStaff && a.divisionIds.includes(String(ins.divisionId)));
    if (other) expect(() => saveHandover(other, ins.id, { hoExpectations: 'a', hoCommitments: 'b', hoKeyContacts: 'c' }, ins.version)).toThrow(ServiceError);
    // All three parts are required; whitespace does not count.
    expect(() => saveHandover(owner, ins.id, { hoExpectations: '  ', hoCommitments: 'Free RIP training', hoKeyContacts: 'Mr Shah' }, ins.version)).toThrow(/all three/);
    const saved = saveHandover(owner, ins.id, { hoExpectations: 'Production from day 2', hoCommitments: 'Free RIP training', hoKeyContacts: 'Mr Shah, +91 98250 11111' }, ins.version);
    expect(saved.handoverAt).toBeTruthy();
    expect(saved.hoCommitments).toBe('Free RIP training');
  });

  it('BR-26: a new installation job asks the sales owner for the handover and tells the customer the schedule', () => {
    const d = getDb();
    const so = d.records.salesOrders.find((s) => s.ownerId && !d.records.installations.some((i) => i.salesOrderId === s.id))!;
    const engineer = d.records.employees.find((e) => e.roleId === 'engineer')!;
    const outbox = d.outbox.length;
    const job = createRecord(svc(), 'installations', { salesOrderId: so.id, customerId: so.customerId, productId: so.productId, engineerId: engineer.id, scheduledAt: `${addDays(todayKey(), 3)}T10:00` }).record;
    const ownerUser = userOfStaff(String(so.ownerId));
    expect(getDb().notifications.some((n) => n.link && 'recordId' in n.link && n.link.recordId === job.id && /handover/i.test(n.title) && n.userId === ownerUser?.id)).toBe(true);
    expect(getDb().outbox.length).toBeGreaterThan(outbox);
  });

  it('AMC: a contract expires only after its end date (no early Mark Expired)', () => {
    const c = getDb().records.amcContracts.find((x) => x.status === 'active' && String(x.endDate) > addDays(todayKey(), 30))!;
    expect(() => transitionRecord(svc(), 'amcContracts', c.id, 'expired', c.version)).toThrow(/expires automatically/);
  });

  it('IB-05: a renewal cannot start before the current contract nor end in the past', () => {
    const c = getDb().records.amcContracts.find((x) => x.status === 'due_for_renewal')!;
    expect(() => renewContract(svc(), c.id, { contractType: 'amc', startDate: '2001-01-01', endDate: '2001-12-31', value: 1000, pmVisitsPerYear: 2 })).toThrow(ServiceError);
    const fresh = renewContract(svc(), c.id, { contractType: 'amc', startDate: addDays(String(c.endDate), 1), endDate: addDays(String(c.endDate), 365), value: 100000, pmVisitsPerYear: 2 });
    expect(fresh.renewalOfId).toBe(c.id);
  });

  it('IB-03: warranty status is derived on the ticket date (warranty → none after the end date)', () => {
    const w = getDb().records.warranties.find((x) => String(x.endDate) > todayKey() && !getDb().records.amcContracts.some((c) => c.machineId === x.machineId))!;
    expect(coverageFor(String(w.machineId))).toBe('warranty');
    expect(coverageFor(String(w.machineId), addDays(String(w.endDate), 1))).toBe('none');
  });

  it('IB-05: warranties ending with no AMC / CMC get 90/60/30 reminders and one AMC / CMC opportunity', () => {
    const d = getDb();
    const w = d.records.warranties.find((x) => String(x.endDate) > addDays(todayKey(), 100) && !d.records.amcContracts.some((c) => c.machineId === x.machineId))!;
    w.endDate = addDays(todayKey(), 45);
    w.remindersSent = '';
    expect(planRenewalSweep().warranty.some((x) => x.id === w.id)).toBe(true);
    runRenewalSweep(svc());
    const after = getDb().records.warranties.find((x) => x.id === w.id)!;
    expect(after.remindersSent).toBe('90,60');
    expect(after.renewalOpportunityId).toBeTruthy();
    expect(getDb().outbox.filter((m) => m.related?.recordId === w.id).length).toBe(1);
    expect(planRenewalSweep().warranty.some((x) => x.id === w.id)).toBe(false);
    setClockOffset(20 * 86_400_000); // 25 days left → 30-day reminder, same opportunity
    runRenewalSweep(svc());
    const later = getDb().records.warranties.find((x) => x.id === w.id)!;
    expect(later.remindersSent).toBe('90,60,30');
    expect(later.renewalOpportunityId).toBe(after.renewalOpportunityId);
    setClockOffset(0);
  });

  it('IB-04: a future-dated draft contract becomes Active on its start date with its PM visits', () => {
    const d = getDb();
    const m = d.records.machines.find((x) => x.status === 'active' && !d.records.amcContracts.some((c) => c.machineId === x.id && ['draft', 'active', 'due_for_renewal'].includes(String(c.status))))!;
    const owner = d.records.employees.find((e) => e.roleId === 'sales_exec')!;
    const c = createRecord(svc(), 'amcContracts', { customerId: m.customerId, machineId: m.id, contractType: 'amc', startDate: addDays(todayKey(), 5), endDate: addDays(todayKey(), 369), pmVisitsPerYear: 2, value: 60000, ownerId: owner.id }).record;
    expect(c.status).toBe('draft');
    runRenewalSweep(svc());
    expect(getDb().records.amcContracts.find((x) => x.id === c.id)!.status).toBe('draft');
    setClockOffset(6 * 86_400_000);
    runRenewalSweep(svc());
    expect(getDb().records.amcContracts.find((x) => x.id === c.id)!.status).toBe('active');
    expect(getDb().records.pmVisits.filter((p) => p.amcContractId === c.id).length).toBe(2);
    setClockOffset(0);
  });

  it('INS-07: 12 months with 2 PM visits a year gives 2 visits, the last on or before the end date', () => {
    const d = getDb();
    const m = d.records.machines[0];
    const ctx = { d, actor: svc(), correlationId: 'test' };
    d.records.pmVisits = d.records.pmVisits.filter((p) => p.machineId !== m.id);
    const start = todayKey();
    const end = addDays(addDays(start, 365), -1);
    expect(generatePmVisits(ctx, { machine: m, start, end, perYear: 2 })).toBe(2);
    const dues = d.records.pmVisits.filter((p) => p.machineId === m.id).map((p) => String(p.dueDate)).sort();
    expect(dues[1] <= end).toBe(true);
  });

  it('BR-02: an installation is scheduled only at a site with latitude / longitude; serials accept lower case', () => {
    const d = getDb();
    const ins = d.records.installations.find((i) => i.status === 'scheduled')!;
    const site = d.records.addresses.find((a) => a.id === ins.siteAddressId) ?? d.records.addresses.find((a) => a.customerId === ins.customerId)!;
    site.lat = null;
    expect(() => updateRecord(svc(), 'installations', ins.id, { siteAddressId: site.id, scheduledAt: `${addDays(todayKey(), 2)}T10:00` }, ins.version)).toThrow(/map location|installation site/i);
    site.lat = 21.17;
    site.lng = site.lng ?? 72.83;
    const next = updateRecord(svc(), 'installations', ins.id, { siteAddressId: site.id, scheduledAt: `${addDays(todayKey(), 2)}T10:00`, serialNo: 'tx-2026-abcd' }, getDb().records.installations.find((i) => i.id === ins.id)!.version).record;
    expect(next.serialNo).toBe('TX-2026-ABCD');
  });
});
