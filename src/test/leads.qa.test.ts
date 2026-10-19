/** QA probes for BRD 4.2 Lead Management (LEAD-01…13) — workflow, validation, roles and hand-offs. */
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { appPack } from '../domain/pack';
import { logActivity } from '../services/activities';
import { createRecord, getRecord, queryRecords, transitionRecord, updateRecord } from '../services/runtime';
import { createLeadWithParty, disqualifyLead, importLeads, nurtureLead, previewImport, qualifyLead, toImportRows, parseCsv } from '../services/leads/rules';
import { addDays, nowLocal, todayKey } from '../lib/dates';
import '../domain/extensions/index';

const has = (k: string) => appPack.resources.some((r) => r.key === k);
const WS = 'tc';
const admin = () => actorFor('u_rahul', WS);
const karan = () => actorFor('u_karan', WS);
const rohan = () => actorFor('u_rohan', WS);
const lead = (status: string, owner?: string) => getDb().records.leads.find((l) => l.status === status && (!owner || l.ownerId === owner))!;

describe('leads QA probes', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('LEAD-09: Log Follow-up links the activity to the lead and moves New → Contacted', () => {
    if (!has('customers')) return;
    const l = lead('new', karan().staffId) ?? lead('new');
    const actor = l.ownerId === karan().staffId ? karan() : admin();
    const out = logActivity(actor, { parentResource: 'leads', parentId: l.id, parentLabel: l.id, activityType: 'call', subject: 'Intro call', at: nowLocal(), nextFollowUpAt: addDays(todayKey(), 2) });
    expect(out.record.parentId).toBe(l.id);
    const after = getDb().records.leads.find((x) => x.id === l.id)!;
    expect(after.status).toBe('contacted');
    expect(after.nextFollowUpAt).toBe(addDays(todayKey(), 2));
  });

  it('Appendix A: New → Contacted only by logging the first contact (no manual "Mark Contacted")', () => {
    if (!has('customers')) return;
    const l = lead('new');
    expect(() => transitionRecord(admin(), 'leads', l.id, 'contacted', l.version)).toThrow();
  });

  it('LEAD-11: a disqualified lead can be reactivated by a manager (gets a follow-up date)', () => {
    if (!has('customers')) return;
    const l = lead('contacted');
    const dq = disqualifyLead(admin(), l.id, l.version, 'no_budget', '');
    const back = transitionRecord(admin(), 'leads', l.id, 'contacted', dq.version).record;
    expect(back.status).toBe('contacted');
    expect(String(back.nextFollowUpAt) >= todayKey()).toBe(true);
    expect(back.disqualifyReason ?? null).toBeNull();
  });

  it('LEAD-11: sales executive cannot reactivate a disqualified lead', () => {
    if (!has('customers')) return;
    const l = lead('contacted', karan().staffId);
    if (!l) return;
    const dq = disqualifyLead(karan(), l.id, l.version, 'not_reachable', '');
    expect(() => transitionRecord(karan(), 'leads', l.id, 'contacted', dq.version)).toThrow();
  });

  it('LEAD-11: a nurture lead whose re-contact date has passed can be reactivated', () => {
    if (!has('customers')) return;
    const l = lead('contacted');
    const n = nurtureLead(admin(), l.id, l.version, addDays(todayKey(), 10), '');
    getDb().records.leads.find((x) => x.id === l.id)!.nextFollowUpAt = addDays(todayKey(), -3);
    getDb().records.leads.find((x) => x.id === l.id)!.nurtureUntil = addDays(todayKey(), -3);
    const back = transitionRecord(admin(), 'leads', l.id, 'contacted', n.version).record;
    expect(back.status).toBe('contacted');
    expect(String(back.nextFollowUpAt) >= todayKey()).toBe(true);
  });

  it('LEAD-11: nurture / qualify blocked from disallowed states; disqualify reason "other" needs a note', () => {
    if (!has('customers')) return;
    const l = lead('contacted');
    expect(() => disqualifyLead(admin(), l.id, l.version, 'other', '  ')).toThrow();
    const n = nurtureLead(admin(), l.id, l.version, addDays(todayKey(), 10), '');
    expect(() => nurtureLead(admin(), l.id, n.version, addDays(todayKey(), 20), '')).toThrow();
    const q = { requirement: 'x', budget: 1, decisionMaker: 'y', timeline: '1_3m', opportunityName: 'z', value: 1, expectedCloseDate: addDays(todayKey(), 5) };
    expect(() => qualifyLead(admin(), l.id, n.version, q)).toThrow();
  });

  it('LEAD-10: conversion validates BANT and carries product + requirement to the opportunity', () => {
    if (!has('customers') || !has('opportunities')) return;
    const l = lead('contacted');
    const bad = { requirement: '  ', budget: 0, decisionMaker: '', timeline: '', opportunityName: ' ', value: -1, expectedCloseDate: addDays(todayKey(), -1) };
    try {
      qualifyLead(admin(), l.id, l.version, bad);
      throw new Error('should fail');
    } catch (e) {
      const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {};
      expect(Object.keys(fe).sort()).toEqual(['budget', 'decisionMaker', 'expectedCloseDate', 'opportunityName', 'requirement', 'timeline', 'value']);
    }
    const out = qualifyLead(admin(), l.id, l.version, { requirement: 'Needs 3.2 m printer', budget: 2_500_000, decisionMaker: 'Owner', timeline: '1_3m', opportunityName: 'Opp', value: 2_500_000, expectedCloseDate: addDays(todayKey(), 60) });
    const opp = getDb().records.opportunities.find((o) => o.id === out.opportunityId)!;
    expect(opp.productType).toBe(l.productType);
    expect(String(opp.notes ?? '')).toContain('Needs 3.2 m printer');
    expect(opp.contactId).toBe(l.contactId);
    // Double submit with the stale version is rejected — no duplicate opportunity.
    expect(() => qualifyLead(admin(), l.id, l.version, { requirement: 'r', budget: 1, decisionMaker: 'd', timeline: '1_3m', opportunityName: 'Opp', value: 1, expectedCloseDate: addDays(todayKey(), 60) })).toThrow();
    expect(getDb().records.opportunities.filter((o) => o.leadId === l.id).length).toBe(1);
  });

  it('BR-05/BR-06: required fields, referral needs referrer, follow-up cannot be in the past', () => {
    if (!has('customers')) return;
    const base = getDb().records.leads[0];
    const ok = { customerId: base.customerId, contactId: base.contactId, divisionId: base.divisionId, sourceId: 'website', productType: 'ink', nextFollowUpAt: addDays(todayKey(), 1) };
    expect(() => createRecord(admin(), 'leads', { ...ok, customerId: undefined })).toThrow();
    expect(() => createRecord(admin(), 'leads', { ...ok, contactId: undefined })).toThrow();
    expect(() => createRecord(admin(), 'leads', { ...ok, productType: undefined })).toThrow();
    expect(() => createRecord(admin(), 'leads', { ...ok, sourceId: 'referral' })).toThrow();
    expect(() => createRecord(admin(), 'leads', { ...ok, nextFollowUpAt: addDays(todayKey(), -1) })).toThrow();
    expect(() => createRecord(admin(), 'leads', { ...ok, specPrintWidth: 99999, subType: 'textile' })).toThrow();
  });

  it('LEAD-01: inline company / contact validation and no orphan company when the lead fails', () => {
    if (!has('customers') || !has('contacts')) return;
    const before = getDb().records.customers.length;
    expect(() => createLeadWithParty(karan(), { divisionId: 'TX', sourceId: 'website', productType: 'machine', nextFollowUpAt: addDays(todayKey(), 1) }, { name: ' ', city: '', state: '', territoryId: '' }, { name: '', mobile: '123' })).toThrow();
    expect(() => createLeadWithParty(karan(), { divisionId: 'TX', sourceId: 'exhibition', productType: 'machine', nextFollowUpAt: addDays(todayKey(), 1) }, { name: 'Zeta QA Prints', city: 'Surat', state: '24', territoryId: 'surat' }, { name: 'Ravi QA', mobile: '9876501234' })).toThrow();
    expect(getDb().records.customers.length).toBe(before);
    const out = createLeadWithParty(karan(), { divisionId: 'TX', sourceId: 'website', productType: 'machine', nextFollowUpAt: addDays(todayKey(), 1) }, { name: 'Zeta QA Prints', city: 'Surat', state: '24', territoryId: 'surat' }, { name: 'Ravi QA', mobile: '9876501234' });
    expect(out.record.id).toMatch(/^LD-/);
    expect(out.record.ownerId).toBe(karan().staffId);
  });

  it('LEAD-07: sales executive cannot reassign; another division owner is rejected', () => {
    if (!has('customers')) return;
    const l = lead('contacted', karan().staffId);
    if (!l) return;
    const r = updateRecord(karan(), 'leads', l.id, { ownerId: rohan().staffId, nextFollowUpAt: addDays(todayKey(), 1) }, l.version).record;
    expect(r.ownerId).toBe(karan().staffId);
    const sneha = actorFor('u_sneha', WS).staffId;
    const fresh = getDb().records.leads.find((x) => x.id === l.id)!;
    expect(() => updateRecord(admin(), 'leads', l.id, { ownerId: sneha, nextFollowUpAt: addDays(todayKey(), 1) }, fresh.version)).toThrow();
  });

  it('§2.2 scope: exec sees own only, manager sees team, out-of-scope direct read is not found; store has no access', () => {
    if (!has('customers')) return;
    const all = getDb().records.leads;
    expect(queryRecords(karan(), 'leads').rows.every((r) => r.ownerId === karan().staffId)).toBe(true);
    const other = all.find((l) => l.ownerId !== karan().staffId)!;
    expect(() => getRecord(karan(), 'leads', other.id)).toThrow();
    expect(queryRecords(rohan(), 'leads').rows.some((r) => r.ownerId === karan().staffId)).toBe(true);
    expect(() => queryRecords(actorFor('u_prakash', WS), 'leads')).toThrow();
    const sneha = all.find((l) => l.ownerId === actorFor('u_sneha', WS).staffId && l.status === 'contacted');
    if (sneha) expect(() => disqualifyLead(karan(), sneha.id, sneha.version, 'no_budget', '')).toThrow();
  });

  it('LEAD-05: import re-validates rows on the service (tampered preview cannot import invalid rows)', () => {
    if (!has('customers')) return;
    const rows = previewImport(admin(), toImportRows(parseCsv('company,contact_name,mobile,email,division\nGood Co QA,Ravi,9820012345,,Textile\nBad Co QA,,123,,Nope\n')));
    const tampered = rows.map((r) => ({ ...r, errors: [] }));
    const out = importLeads(admin(), tampered, 'Gartex 2026');
    expect(out.created.length).toBe(1);
    expect(out.skipped).toBe(1);
    expect(() => importLeads(karan(), rows, 'Gartex 2026')).toThrow();
    expect(() => importLeads(admin(), rows, '   ')).toThrow();
  });
});
