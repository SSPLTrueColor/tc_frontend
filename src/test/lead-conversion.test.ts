/** Plan 1.6 / 1.9 / 1.10 / 2.3: lead → opportunity carries the lead's data, needs the first contact; stages follow the master. */
import { actorFor } from '../services/authz';
import { commit, createDb, getDb, __setDb } from '../services/db';
import { logActivity } from '../services/activities';
import { availableTransitions, createRecord } from '../services/runtime';
import { convertWithFirstContact, createLeadWithParty, logLeadContact, nurtureLead, oppTypeForLead, qualifyLead } from '../services/leads/rules';
import { convertContactToLead } from '../services/customers/operations';
import { getPolicies } from '../services/policies';
import { getResource } from '../services/registry';
import { OPEN_STAGES, openStages } from '../domain/modules/opportunities';
import { addDays, nowLocal, todayKey } from '../lib/dates';
import { appPack } from '../domain/pack';
import '../domain/extensions/index';

const admin = () => actorFor('u_rahul', 'tc');
const karan = () => actorFor('u_karan', 'tc');
const bant = { requirement: 'Needs a 3.2 m printer', budget: 4_500_000, decisionMaker: 'MD', timeline: '1_3m', opportunityName: 'Test deal', value: 4_500_000, expectedCloseDate: addDays(todayKey(), 60) };
const leadById = (id: string) => getDb().records.leads.find((l) => l.id === id)!;

function newTextileLead() {
  const base = getDb().records.leads.find((l) => l.divisionId === 'TX')!;
  const out = createRecord(admin(), 'leads', {
    customerId: base.customerId,
    contactId: base.contactId,
    divisionId: 'TX',
    ownerId: base.ownerId,
    sourceId: 'exhibition',
    eventName: 'Gartex Mumbai 2026',
    campaign: 'Winter push',
    productType: 'machine',
    subType: 'textile',
    specPrintWidth: 3200,
    specFabricType: 'polyester',
    budget: 4_000_000,
    timeline: '3_6m',
    city: 'Surat',
    segment: getDb().records.leads.find((l) => l.segment)?.segment,
    nextFollowUpAt: addDays(todayKey(), 1),
  });
  return out.record;
}
const contact = (id: string) => {
  const l = leadById(id);
  logActivity(admin(), { parentResource: 'leads', parentId: l.id, parentLabel: l.id, customerId: String(l.customerId), activityType: 'call', subject: 'First call', at: nowLocal(), nextFollowUpAt: addDays(todayKey(), 2) });
  return leadById(id);
};

describe('lead → opportunity conversion (1.6)', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('refuses a New lead until the first contact is logged', () => {
    const l = newTextileLead();
    expect(() => qualifyLead(admin(), l.id, l.version, bant)).toThrow(/first contact/i);
    expect(leadById(l.id).status).toBe('new');
  });

  it('carries source, campaign, event, sub-type, specs, budget, timeline and location to the opportunity', () => {
    const l = contact(newTextileLead().id);
    expect(l.status).toBe('contacted');
    const out = qualifyLead(admin(), l.id, l.version, bant);
    const opp = getDb().records.opportunities.find((o) => o.id === out.opportunityId)!;
    expect(opp).toMatchObject({ leadId: l.id, leadSourceId: 'exhibition', leadEventName: 'Gartex Mumbai 2026', leadCampaign: 'Winter push', subType: 'textile', specPrintWidth: 3200, specFabricType: 'polyester', leadCity: 'Surat', leadTimeline: '1_3m', leadBudget: 4_500_000 });
    expect(leadById(l.id).firstContactAt).toBeTruthy();
    // Shown read-only in the "From Lead" section.
    const res = getResource('opportunities');
    expect(res.form.sections.find((s) => s.id === 'fromLead')?.fields).toEqual(expect.arrayContaining(['leadSourceId', 'specPrintWidth', 'leadBudget']));
    expect(res.fields.find((f) => f.key === 'leadSourceId')?.readOnly).toBe(true);
  });

  it('stamps the first-contact time when a contacted lead has none', () => {
    const l = newTextileLead();
    commit((d) => {
      const i = d.records.leads.findIndex((x) => x.id === l.id);
      d.records.leads[i] = { ...d.records.leads[i], status: 'contacted', firstContactAt: null };
    });
    qualifyLead(admin(), l.id, leadById(l.id).version, bant);
    expect(leadById(l.id).firstContactAt).toBeTruthy();
  });

  it('maps the opportunity type: service → AMC / CMC, spares → Spares, never Consumables', () => {
    const d = getDb();
    const base = { id: 'x', version: 1, customerId: 'none' } as never;
    expect(oppTypeForLead(d, { ...(base as object), productType: 'service' } as never)).toBe('amc');
    expect(oppTypeForLead(d, { ...(base as object), productType: 'spares' } as never)).toBe('spares');
    expect(oppTypeForLead(d, { ...(base as object), productType: 'ink' } as never)).toBe('consumables');
    expect(oppTypeForLead(d, { ...(base as object), productType: 'machine' } as never)).toBe('new_machine');
    const owner = d.records.machines?.find((m) => m.customerId)?.customerId;
    if (owner) expect(oppTypeForLead(d, { ...(base as object), productType: 'machine', customerId: owner } as never)).toBe('additional_machine');
  });

  it('Convert to Lead stores the chosen lead source and refuses an empty one', () => {
    const pool = getDb().records.contacts.filter((c) => !c.customerId && c.poolStatus !== 'converted' && c.source !== 'exhibition');
    const c = pool[0];
    commit((d) => {
      const i = d.records.contacts.findIndex((x) => x.id === c.id);
      d.records.contacts[i] = { ...d.records.contacts[i], source: null };
    });
    const input = { contactId: c.id, companyName: 'Source Check Prints', territoryId: 'surat', billingState: '24', divisionId: 'TX', productType: 'machine', ownerId: karan().staffId, nextFollowUpAt: addDays(todayKey(), 1) };
    expect(() => convertContactToLead(admin(), input)).toThrow();
    const out = convertContactToLead(admin(), { ...input, sourceId: 'website' });
    expect(leadById(out.leadId).sourceId).toBe('website');
  });

  it('records the reason when a lead is created next to open duplicates', () => {
    const l = getDb().records.leads.find((x) => ['new', 'contacted'].includes(String(x.status)))!;
    const lead = { customerId: l.customerId, contactId: l.contactId, divisionId: l.divisionId, sourceId: 'website', productType: 'ink', ownerId: l.ownerId, nextFollowUpAt: addDays(todayKey(), 1) };
    expect(() => createLeadWithParty(admin(), lead, null, null, { duplicateReason: 'x' })).toThrow(/reason/i);
    const out = createLeadWithParty(admin(), lead, null, null, { duplicateReason: 'Separate ink requirement for plant 2' });
    expect(getDb().audit.some((a) => a.recordId === out.record.id && a.action === 'leads.duplicate_override')).toBe(true);
  });
});

describe('combined Create Opportunity flow for New / Nurture leads', () => {
  beforeEach(() => __setDb(createDb(new Date())));
  const fc = { activityType: 'call', subject: 'First call — needs a 3.2 m printer', nextFollowUpAt: addDays(todayKey(), 2) };

  it('New lead: refuses conversion without a first-contact payload', () => {
    const l = newTextileLead();
    expect(() => convertWithFirstContact(admin(), l.id, l.version, bant)).toThrow(/first contact/i);
    expect(leadById(l.id).status).toBe('new');
  });

  it('New lead: logs the first contact, moves to Contacted and converts in one write', () => {
    const l = newTextileLead();
    const out = convertWithFirstContact(admin(), l.id, l.version, bant, fc);
    const lead = leadById(l.id);
    expect(lead.status).toBe('qualified');
    expect(lead.opportunityId).toBe(out.opportunityId);
    expect(lead.firstContactAt).toBeTruthy();
    const act = getDb().records.activities.find((a) => a.id === out.activityId)!;
    expect(act).toMatchObject({ parentResource: 'leads', parentId: l.id, subject: fc.subject });
    const trail = getDb().audit.filter((a) => a.recordId === l.id).map((a) => a.summary);
    expect(trail.some((t) => /New → Contacted/.test(String(t)))).toBe(true);
  });

  it('New lead: an invalid opportunity step logs nothing (atomic)', () => {
    const l = newTextileLead();
    const before = getDb().records.activities.length;
    expect(() => convertWithFirstContact(admin(), l.id, l.version, { ...bant, decisionMaker: '' }, fc)).toThrow();
    expect(() => convertWithFirstContact(admin(), l.id, l.version, bant, { ...fc, nextFollowUpAt: addDays(todayKey(), -1) })).toThrow();
    expect(getDb().records.activities.length).toBe(before);
    expect(leadById(l.id).status).toBe('new');
  });

  it('step 1 on its own: logging the first contact moves the lead to Contacted, then it converts', () => {
    const l = newTextileLead();
    const contacted = logLeadContact(admin(), l.id, fc);
    expect(contacted.status).toBe('contacted');
    const out = convertWithFirstContact(admin(), l.id, contacted.version, bant);
    expect(leadById(l.id).opportunityId).toBe(out.opportunityId);
  });

  it('Nurture lead: reactivates to Contacted (audited) and converts', () => {
    const l = contact(newTextileLead().id);
    const n = nurtureLead(admin(), l.id, l.version, addDays(todayKey(), 30), 'Next quarter');
    expect(() => qualifyLead(admin(), l.id, n.version, bant)).toThrow();
    const out = convertWithFirstContact(admin(), l.id, n.version, bant);
    const lead = leadById(l.id);
    expect(lead.status).toBe('qualified');
    expect(lead.opportunityId).toBe(out.opportunityId);
    const trail = getDb().audit.filter((a) => a.recordId === l.id).map((a) => String(a.summary));
    expect(trail.some((t) => t.includes('Reactivate') && t.includes('Nurture') && t.includes('Contacted'))).toBe(true);
  });

  it('Nurture lead never contacted: needs the first contact before conversion', () => {
    const l = newTextileLead();
    const n = nurtureLead(admin(), l.id, l.version, addDays(todayKey(), 30), '');
    expect(() => convertWithFirstContact(admin(), l.id, n.version, bant)).toThrow(/first contact/i);
    convertWithFirstContact(admin(), l.id, n.version, bant, fc);
    expect(leadById(l.id).status).toBe('qualified');
  });

  it('logging a follow-up on a Nurture lead moves it back to Contacted and clears the re-contact date', () => {
    const l = contact(newTextileLead().id);
    nurtureLead(admin(), l.id, l.version, addDays(todayKey(), 30), '');
    expect(leadById(l.id).status).toBe('nurture');
    logActivity(admin(), { parentResource: 'leads', parentId: l.id, parentLabel: l.id, customerId: String(l.customerId), activityType: 'call', subject: 'Customer called back', at: nowLocal(), nextFollowUpAt: addDays(todayKey(), 3) });
    const back = leadById(l.id);
    expect(back.status).toBe('contacted');
    expect(back.nurtureUntil).toBeNull();
    expect(back.nextFollowUpAt).toBe(addDays(todayKey(), 3));
  });
});

describe('opportunity stages from the master (2.3)', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('a new Opportunity Stage value gets transitions, a board place and a probability', () => {
    commit((d) => {
      const m = structuredClone(getDb().config.masters.oppStage ?? getResourceMaster());
      const proposal = m.values.find((v) => v.key === 'proposal')!;
      m.values = m.values.map((v) => (v.order > proposal.order ? { ...v, order: v.order + 1 } : v));
      m.values.push({ key: 'technical_review', label: 'Technical Review', tone: 'info', active: true, order: proposal.order + 1 });
      d.config.masters.oppStage = m;
    });
    openStages();
    expect(OPEN_STAGES).toEqual(['needs_assessment', 'demo', 'proposal', 'technical_review', 'negotiation']);
    const p = getPolicies().stageProbability.technical_review;
    expect(p).toBeGreaterThan(50);
    expect(p).toBeLessThan(75);
    const opp = getDb().records.opportunities.find((o) => o.stage === 'proposal')!;
    const res = getResource('opportunities');
    expect(availableTransitions(admin(), res, opp).map((t) => t.to)).toContain('technical_review');
    expect(res.lifecycle!.transitions.find((t) => t.to === 'won')!.from).toContain('technical_review');
  });

  it('a new Ticket Priority gets an SLA row copied from Medium', () => {
    commit((d) => {
      const m = structuredClone(getDb().config.masters.ticketPriority ?? ticketPriorityMaster());
      m.values.push({ key: 'vip', label: 'VIP', tone: 'danger', active: true, order: m.values.length });
      d.config.masters.ticketPriority = m;
    });
    expect(getPolicies().sla.vip).toEqual(getPolicies().sla.medium);
  });
});

function getResourceMaster() {
  return appPack.masters.find((m) => m.key === 'oppStage')!;
}
function ticketPriorityMaster() {
  return appPack.masters.find((m) => m.key === 'ticketPriority')!;
}
