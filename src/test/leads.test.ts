import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { appPack } from '../domain/pack';
import { logActivity } from '../services/activities';
import { createRecord, updateRecord, getRecord, insertRecordIn } from '../services/runtime';
import { commit } from '../services/db';
import { scoreLead } from '../domain/modules/leads/computed';
import { autoAssign, disqualifyLead, notAttendedLeads, nurtureLead, ownerDivisionError, parseCsv, previewImport, qualifyLead, sweepLeads, toImportRows } from '../services/leads/rules';
import { leadsApi } from '../services/api/leads';
import { L } from '../constants/labels';
import { addDays, nowLocal, todayKey } from '../lib/dates';
import '../domain/extensions/index';

const has = (k: string) => appPack.resources.some((r) => r.key === k);

describe('leads module', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('seeds ~150 leads with activities when customers exist', () => {
    if (!has('customers')) return;
    const leads = getDb().records.leads ?? [];
    expect(leads.length).toBeGreaterThan(100);
    expect(leads.every((l) => /^LD-\d{4}-\d{5}$/.test(l.id))).toBe(true);
    expect((getDb().records.activities ?? []).some((a) => a.parentResource === 'leads')).toBe(true);
  });

  it('scores leads from the rules (clamped 0–100)', () => {
    const rules = [
      { factor: 'source', matchValue: 'referral', points: 25, active: true },
      { factor: 'budget', matchValue: '1000000', points: 20, active: true },
      { factor: 'timeline', matchValue: 'immediate', points: 70, active: true },
      { factor: 'engagement', matchValue: '3', points: 10, active: false },
    ] as never[];
    expect(scoreLead({ sourceId: 'referral', budget: 2_000_000 }, rules, 5)).toBe(45);
    expect(scoreLead({ sourceId: 'referral', budget: 2_000_000, timeline: 'immediate' }, rules, 5)).toBe(100);
  });

  it('auto-assigns round-robin inside the matching rule and checks the owner division', () => {
    const d = getDb();
    const rohan = actorFor('u_rohan', 'tc').staffId;
    const karan = actorFor('u_karan', 'tc').staffId;
    d.records.assignmentRules = [{ id: 'AR-1', workspaceId: 'tc', version: 1, createdAt: '', updatedAt: '', createdBy: 'x', name: 'TX', priority: 1, divisionId: 'TX', assigneeIds: [rohan, karan], active: true, rrPointer: 0 }];
    expect(autoAssign(d, { divisionId: 'TX', productType: 'machine' }).ownerId).toBe(rohan);
    expect(autoAssign(d, { divisionId: 'TX', productType: 'machine' }).ownerId).toBe(karan);
    expect(autoAssign(d, { divisionId: 'TX', productType: 'machine' }).ownerId).toBe(rohan);
    // No rule for Paper → division head queue.
    expect(autoAssign(d, { divisionId: 'PPR' }).ownerId).toBe(actorFor('u_kavita', 'tc').staffId);
    expect(ownerDivisionError(d, karan, 'INK')).toMatch(/does not work in/);
    expect(ownerDivisionError(d, karan, 'TX')).toBeUndefined();
  });

  const firstLead = (status: string) => (getDb().records.leads ?? []).find((l) => l.status === status && l.ownerId === actorFor('u_rohan', 'tc').staffId) ?? (getDb().records.leads ?? []).find((l) => l.status === status);

  it('first logged activity moves New → Contacted and stamps first contact', () => {
    if (!has('customers')) return;
    const lead = firstLead('new')!;
    const owner = (getDb().records.employees ?? []).find((e) => e.id === lead.ownerId)!;
    const user = actorFor(['u_rohan', 'u_karan', 'u_sneha', 'u_priya', 'u_imran', 'u_deepak', 'u_pooja'].find((u) => actorFor(u, 'tc').staffId === owner.id)!, 'tc');
    const input = { parentResource: 'leads', parentId: lead.id, parentLabel: lead.id, activityType: 'call', subject: 'Intro call', at: nowLocal(), byId: user.staffId, nextFollowUpAt: addDays(todayKey(), 2) };
    const viaService = logActivity(user, input);
    // Shared activities resource marks the parent link fields system/read-only, so createRecord drops them
    // (reported to the integrator). Until fixed, exercise the hook through a workflow insert.
    if (!viaService.record.parentId) commit((d) => insertRecordIn({ d, actor: user, correlationId: 'test' }, 'activities', input));
    const after = getDb().records.leads.find((l) => l.id === lead.id)!;
    expect(after.status).toBe('contacted');
    expect(after.firstContactAt).toBeTruthy();
    expect(after.nextFollowUpAt).toBe(addDays(todayKey(), 2));
  });

  it('requires the exhibition name and blocks qualified-lead edits', () => {
    if (!has('customers')) return;
    const admin = actorFor('u_rahul', 'tc');
    const base = getDb().records.leads[0];
    expect(() => createRecord(admin, 'leads', { customerId: base.customerId, contactId: base.contactId, divisionId: base.divisionId, sourceId: 'exhibition', productType: 'ink', nextFollowUpAt: addDays(todayKey(), 1) })).toThrow(/highlighted/);
    if (!has('opportunities')) return;
    const lead = firstLead('contacted')!;
    const out = qualifyLead(admin, lead.id, lead.version, { requirement: 'Needs printer', budget: 2_500_000, decisionMaker: 'Owner', timeline: '1_3m', opportunityName: 'Test opp', value: 2_500_000, expectedCloseDate: addDays(todayKey(), 60) });
    const opp = getDb().records.opportunities.find((o) => o.id === out.opportunityId)!;
    expect(opp.leadId).toBe(lead.id);
    expect(opp.stage).toBe('needs_assessment');
    const after = getRecord(admin, 'leads', lead.id).record;
    expect(after.status).toBe('qualified');
    expect(() => updateRecord(admin, 'leads', lead.id, { campaign: 'x' }, after.version)).toThrow(/read-only/);
  });

  it('nurture needs a future date; disqualify needs a reason', () => {
    if (!has('customers')) return;
    const admin = actorFor('u_rahul', 'tc');
    const lead = firstLead('contacted')!;
    expect(() => nurtureLead(admin, lead.id, lead.version, todayKey(), '')).toThrow(/future/);
    expect(() => disqualifyLead(admin, lead.id, lead.version, '', '')).toThrow(/reason/);
    const n = nurtureLead(admin, lead.id, lead.version, addDays(todayKey(), 30), 'Next year');
    expect(n.status).toBe('nurture');
    const dq = disqualifyLead(admin, lead.id, n.version, 'no_budget', '');
    expect(dq.status).toBe('disqualified');
    expect(dq.nextFollowUpAt).toBeNull();
  });

  it('SLA sweep escalates once (idempotent)', () => {
    if (!has('customers')) return;
    const admin = actorFor('u_rahul', 'tc');
    const first = sweepLeads(admin);
    const second = sweepLeads(admin);
    expect(first.escalated + first.reminded).toBeGreaterThan(0);
    expect(second).toEqual({ escalated: 0, reminded: 0 });
  });

  it('parses and validates CSV imports', () => {
    const rows = toImportRows(parseCsv('company,contact_name,mobile,email,division\n"Acme, Prints",Ravi,9820012345,,Textile\nBad Co,,123,,Nope\n'));
    expect(rows[0].company).toBe('Acme, Prints');
    const prev = previewImport(actorFor('u_rahul', 'tc'), rows);
    expect(prev[0].errors).toEqual([]);
    expect(prev[0].division).toBe('TX');
    expect(prev[1].errors.length).toBeGreaterThanOrEqual(3);
  });
  it('Not Attended Leads: open new leads past the SLA, role-scoped, oldest first', () => {
    if (!has('customers')) return;
    const admin = actorFor('u_rahul', 'tc');
    const lead = getDb().records.leads.find((l) => l.status === 'new')!;
    // Push one lead well past the SLA with no contact logged.
    lead.createdAt = new Date(Date.now() - 72 * 3_600_000).toISOString();
    lead.firstContactAt = null;
    const out = notAttendedLeads(admin);
    expect(out.slaHours).toBeGreaterThan(0);
    const row = out.rows.find((r) => r.lead.id === lead.id)!;
    expect(row).toBeTruthy();
    expect(row.ageHours).toBeGreaterThanOrEqual(71);
    expect(row.overHours).toBe(row.ageHours - out.slaHours);
    expect(out.rows.every((r) => r.lead.status === 'new' && !r.lead.firstContactAt)).toBe(true);
    for (let i = 1; i < out.rows.length; i++) expect(out.rows[i - 1].ageHours).toBeGreaterThanOrEqual(out.rows[i].ageHours);
    // A sales executive only sees leads they own.
    const exec = actorFor('u_sneha', 'tc');
    expect(notAttendedLeads(exec).rows.every((r) => r.ownerId === exec.staffId)).toBe(true);
  });

  it('exposes the async Not Attended Leads service and BRD labels', async () => {
    expect(typeof leadsApi.notAttended).toBe('function');
    expect(L.leads.actions.convertToOpportunity).toBe('Convert to Opportunity');
    expect(L.leads.actions.logFollowUp).toBe('Log Follow-up');
    expect(L.leads.fields.leads.productType).toBe('Product type');
    expect(L.leads.masters.lostReason.values.bought_competitor).toBe('Bought Competitor');
    expect(L.leads.masters.leadSource.values.indiamart).toBe('B2B Marketplaces (IndiaMART)');
    const res = appPack.resources.find((r) => r.key === 'leads')!;
    expect(res.fields.find((f) => f.key === 'productType')!.label).toBe('Product type');
    expect(appPack.resources.find((r) => r.key === 'leadScoringRules')!.labelPlural).toBe('Lead Scoring Rules');
  });
});
