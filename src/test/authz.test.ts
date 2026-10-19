import { actorFor, canReadRecord } from '../services/authz';
import { createDb, __setDb } from '../services/db';
import { getResource } from '../services/registry';
import { queryRecords } from '../services/runtime';

describe('hierarchy row scopes', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('derives the team from reporting lines (transitively)', () => {
    const suresh = actorFor('u_suresh', 'tc'); // GM Textile → Rohan → Karan; Pooja; Nisha; Tanvi
    const ids = ['u_rohan', 'u_karan', 'u_pooja'].map((u) => actorFor(u, 'tc').staffId);
    ids.forEach((id) => expect(suresh.teamStaffIds).toContain(id));
    expect(suresh.teamStaffIds).not.toContain(actorFor('u_neha', 'tc').staffId);
  });

  it('sales executive sees only own tasks; manager sees the team; division head the division', () => {
    const res = getResource('tasks');
    const karan = actorFor('u_karan', 'tc');
    const rohan = actorFor('u_rohan', 'tc');
    const kavita = actorFor('u_kavita', 'tc'); // Paper division head
    const mine = queryRecords(karan, 'tasks').rows;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t) => t.assigneeId === karan.staffId)).toBe(true);
    const team = queryRecords(rohan, 'tasks').rows;
    expect(team.some((t) => t.assigneeId === karan.staffId)).toBe(true);
    const karanTask = mine[0];
    expect(canReadRecord(kavita, res, karanTask)).toBe(false); // Textile task, Paper head
    expect(canReadRecord(actorFor('u_suresh', 'tc'), res, karanTask)).toBe(true);
  });
});

describe('QA: global search (COM-06) and editable scopes (ADM-02) end to end', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('finds customer, contact, mobile, GSTIN, serial no. and quotation / order / ticket IDs', async () => {
    const { searchRecords } = await import('../services/search');
    const { getDb } = await import('../services/db');
    const admin = actorFor('u_rahul', 'tc');
    const r = getDb().records;
    const cust = r.customers[0];
    const contact = r.contacts.find((c) => c.mobile)!;
    const machine = r.machines[0];
    const probes: [string, string, string][] = [
      [String(cust.name), 'customers', String(cust.id)],
      [String(contact.fullName ?? contact.name), 'contacts', String(contact.id)],
      [String(contact.mobile), 'contacts', String(contact.id)],
      [String(r.customers.find((c) => c.gstin)!.gstin), 'customers', String(r.customers.find((c) => c.gstin)!.id)],
      [String(machine.serialNo), 'machines', String(machine.id)],
      [String(r.quotations[0].id), 'quotations', String(r.quotations[0].id)],
      [String(r.salesOrders[0].id), 'salesOrders', String(r.salesOrders[0].id)],
      [String(r.tickets[0].id), 'tickets', String(r.tickets[0].id)],
      [String(r.quotations[0].quoteNo), 'quotations', String(r.quotations[0].id)],
      [String(r.salesOrders[0].orderNo), 'salesOrders', String(r.salesOrders[0].id)],
    ];
    for (const [q, res, id] of probes) expect(searchRecords(admin, q, 50).some((h) => h.resource === res && h.id === id), `${res} by "${q}"`).toBe(true);
  });

  it('search respects row scope: a Sales Executive never finds another executive’s lead or quotation', async () => {
    const { searchRecords } = await import('../services/search');
    const { getDb } = await import('../services/db');
    const karan = actorFor('u_karan', 'tc');
    const other = getDb().records.quotations.find((q) => q.ownerId !== karan.staffId)!;
    expect(searchRecords(karan, String(other.id), 50).some((h) => h.id === other.id)).toBe(false);
    const lead = getDb().records.leads.find((l) => l.ownerId !== karan.staffId)!;
    expect(searchRecords(karan, String(lead.id), 50).some((h) => h.id === lead.id)).toBe(false);
  });

  it('widening a role scope in Roles & Permissions changes the list, search and dashboard; reset restores it', async () => {
    const { saveRolePermissions, resetRolePermissions } = await import('../services/catalog/access');
    const { dashboardFor, resolveRange } = await import('../services/reports/overview');
    const { getDb } = await import('../services/db');
    const admin = actorFor('u_rahul', 'tc');
    const before = queryRecords(actorFor('u_karan', 'tc'), 'leads').rows.length;
    const range = resolveRange('custom', { from: '2025-10-20', to: '2026-10-19' });
    const dashBefore = dashboardFor(actorFor('u_karan', 'tc'), range).kpis.find((k) => k.id === 'leads')!.value!;
    const role = actorFor('u_karan', 'tc').role;
    saveRolePermissions(admin, 'sales_exec', { resources: { leads: { ...role.resources.leads, read: 'division' } }, fieldOverrides: {} });
    const karan = actorFor('u_karan', 'tc');
    const divLeads = getDb().records.leads.filter((l) => l.divisionId === 'TX');
    expect(queryRecords(karan, 'leads').rows.length).toBe(divLeads.length);
    expect(divLeads.length).toBeGreaterThan(before);
    const teammate = divLeads.find((l) => l.ownerId !== karan.staffId)!;
    const { searchRecords } = await import('../services/search');
    expect(searchRecords(karan, String(teammate.id), 50).some((h) => h.id === teammate.id)).toBe(true);
    expect(dashboardFor(karan, range).kpis.find((k) => k.id === 'leads')!.value!).toBeGreaterThan(dashBefore);
    resetRolePermissions(admin, 'sales_exec');
    expect(queryRecords(actorFor('u_karan', 'tc'), 'leads').rows.length).toBe(before);
  });
});
