import { appPack } from '../domain/pack';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { createRecord, queryRecords, transitionRecord, updateRecord } from '../services/runtime';
import { computeForecast, demoMachineCalendar, markLost, periodOf, pipelineFacets, pipelineRows, pipelineTotals } from '../services/opportunities';
import { masterLabel } from '../services/registry';
import { L } from '../constants/labels';
import { ROUTES } from '../constants/routes';
import { routes } from '../modules/opportunities/routes';
import { ServiceError } from '../services/types';
import '../domain/extensions/core';
import '../domain/extensions/opportunities';

const WS = 'tc';
const hasQuotes = appPack.resources.some((r) => r.key === 'quotations');

function freshDb() {
  __setDb(createDb(new Date('2026-10-19T10:00:00')));
  const d = getDb();
  const at = '2026-10-01T00:00:00.000Z';
  d.records.customers ??= [];
  d.records.customers.push({ id: 'C-9001', workspaceId: WS, version: 1, createdAt: at, updatedAt: at, createdBy: 'system', name: 'Test Prints', territoryId: 'surat', divisionIds: ['TX'] });
}

const rohan = () => actorFor('u_rohan', WS); // Sales manager, Textile
const karan = () => actorFor('u_karan', WS); // Sales executive reporting to Rohan

function newOpp(value = 2_500_000) {
  return createRecord(karan(), 'opportunities', { name: 'Sublimation printer — Test Prints', customerId: 'C-9001', divisionId: 'TX', oppType: 'new_machine', value, expectedCloseDate: '2026-12-15', ownerId: karan().staffId }).record;
}

describe('opportunities', () => {
  beforeEach(freshDb);

  it('defaults stage, probability and territory / hub on create (BR-11)', () => {
    const o = newOpp();
    expect(o.stage).toBe('needs_assessment');
    expect(o.probability).toBe(10);
    expect(getDb().records.opportunities.find((x) => x.id === o.id)!.territoryId).toBe('surat');
    expect(o.id).toMatch(/^OPP-\d{4}-\d{5}$/);
    expect(o.weightedValue).toBe(250_000);
  });

  it('enforces stage entry criteria and updates probability', () => {
    // A legacy record without a value still cannot enter Proposal (new and edited ones need a value > 0, below).
    const o = newOpp();
    getDb().records.opportunities.find((x) => x.id === o.id)!.value = 0;
    expect(() => transitionRecord(karan(), 'opportunities', o.id, 'proposal', o.version)).toThrow(/value/i);
    const ok = newOpp();
    const moved = transitionRecord(karan(), 'opportunities', ok.id, 'demo', ok.version).record;
    expect(moved.probability).toBe(25);
    if (hasQuotes) {
      const p = transitionRecord(karan(), 'opportunities', ok.id, 'proposal', moved.version).record;
      expect(() => transitionRecord(karan(), 'opportunities', ok.id, 'won', p.version)).toThrow(/accepted quotation/);
    }
  });

  it('value must be more than ₹0 on create and on edit (same rule as the Create Opportunity dialog)', () => {
    const o = newOpp();
    try {
      updateRecord(karan(), 'opportunities', o.id, { value: 0 }, o.version);
      expect.unreachable('value 0 was saved');
    } catch (e) {
      expect((e as ServiceError).fieldErrors?.value).toBeTruthy();
    }
    expect(getDb().records.opportunities.find((x) => x.id === o.id)!.value).toBe(2_500_000);
  });

  it('requires a lost reason and competitor (FR-031)', () => {
    const o = newOpp();
    expect(() => markLost(karan(), o.id, { lostReason: '', lostToCompetitor: '' }, o.version)).toThrow(ServiceError);
    const lost = markLost(karan(), o.id, { lostReason: 'price', lostToCompetitor: 'Epson', lostToPrice: 2_100_000 }, o.version);
    expect(lost.stage).toBe('lost');
    expect(lost.probability).toBe(0);
    expect(() => markLost(karan(), o.id, { lostReason: 'price', lostToCompetitor: 'Epson' }, lost.version)).toThrow(/open/);
  });

  it('rejects double booking of a demo machine', () => {
    const o = newOpp();
    const machine = getDb().records.demoMachines[0].id;
    const base = { opportunityId: o.id, location: 'centre', demoMachineId: machine, scheduledAt: '2026-10-25T10:00', durationMin: 120, ownerId: karan().staffId };
    const first = createRecord(karan(), 'demos', base).record;
    expect(first.customerId).toBe('C-9001');
    expect(() => createRecord(karan(), 'demos', { ...base, scheduledAt: '2026-10-25T11:00' })).toThrow(/already booked|fix/);
    expect(createRecord(karan(), 'demos', { ...base, scheduledAt: '2026-10-25T12:00' }).record.id).toBeTruthy();
  });

  it('scopes: the executive sees own opportunities, the manager sees the team', () => {
    const o = newOpp();
    expect(queryRecords(karan(), 'opportunities').rows.every((r) => r.ownerId === karan().staffId)).toBe(true);
    expect(queryRecords(rohan(), 'opportunities').rows.some((r) => r.id === o.id)).toBe(true);
    expect(queryRecords(actorFor('u_kavita', WS), 'opportunities').rows.some((r) => r.id === o.id)).toBe(false);
  });

  it('forecast totals equal the sum of weighted open opportunities in range (FR-033)', () => {
    const o = newOpp(1_000_000);
    const f = computeForecast(rohan(), { period: 'month', groupBy: 'owner', horizon: 6 });
    const inRange = queryRecords(rohan(), 'opportunities').rows.filter((r) => ['needs_assessment', 'demo', 'proposal', 'negotiation'].includes(String(r.stage)) && f.periods.some((p) => p.key === periodOf(String(r.expectedCloseDate), 'month')));
    const expected = inRange.reduce((s, r) => s + (Number(r.value) * Number(r.probability)) / 100, 0);
    expect(Math.round(f.grand.weighted)).toBe(Math.round(expected));
    expect(inRange.some((r) => r.id === o.id)).toBe(true);
    expect(periodOf('2026-05-10', 'quarter')).toBe('2026-Q1');
    expect(periodOf('2027-02-10', 'quarter')).toBe('2026-Q4');
  });

  it('uses the GLOSSARY stage and type values (§3)', () => {
    expect(['needs_assessment', 'demo', 'proposal', 'negotiation', 'won', 'lost'].map((k) => masterLabel('oppStage', k))).toEqual(['Needs Assessment', 'Demo/Sample', 'Proposal/Quotation', 'Negotiation', 'Won', 'Lost']);
    expect(['new_machine', 'additional_machine', 'upgrade', 'consumables', 'amc', 'renewal'].map((k) => masterLabel('oppType', k))).toEqual(['New Machine', 'Additional Machine', 'Upgrade', 'Consumables Contract', 'AMC / CMC', 'AMC Renewal']);
    const res = appPack.resources.find((r) => r.key === 'sampleRequests')!;
    expect(res.labelPlural).toBe('Sample Print Requests');
    expect(res.form.primaryLabel).toBe(L.opportunities.actions.requestSamplePrint);
  });

  it('registers Pipeline, Sales Forecast and Demo Machine Calendar routes', () => {
    expect(routes.map((r) => r.path).sort()).toEqual([ROUTES.demoMachineCalendar, ROUTES.pipeline, ROUTES.salesForecast].sort());
  });

  it('pipeline filters by stage, division, owner and close month (OPP-03)', () => {
    const o = newOpp(1_500_000);
    const open = pipelineRows(rohan());
    expect(open.every((r) => ['needs_assessment', 'demo', 'proposal', 'negotiation'].includes(String(r.stage)))).toBe(true);
    expect(open.some((r) => r.id === o.id)).toBe(true);
    expect(pipelineRows(rohan(), { stage: 'all' }).length).toBeGreaterThanOrEqual(open.length);
    expect(pipelineRows(rohan(), { stage: 'won' }).every((r) => r.stage === 'won')).toBe(true);
    expect(pipelineRows(rohan(), { divisionId: 'TX', ownerId: karan().staffId, closeMonth: '2026-12' }).some((r) => r.id === o.id)).toBe(true);
    expect(pipelineRows(rohan(), { closeMonth: '2026-11' }).some((r) => r.id === o.id)).toBe(false);
    expect(pipelineRows(rohan(), { search: 'Test Prints' }).some((r) => r.id === o.id)).toBe(true);
    const t = pipelineTotals(open);
    expect(t.open).toBe(open.length);
    expect(Math.round(t.weighted)).toBe(Math.round(open.reduce((s, r) => s + (Number(r.value) * Number(r.probability)) / 100, 0)));
    const facets = pipelineFacets(rohan());
    expect(facets.closeMonths).toContain('2026-12');
    expect(facets.ownerIds).toContain(karan().staffId);
  });

  it('demo machine calendar lists bookings per machine and hides other teams\' details (OPP-04)', () => {
    const o = newOpp();
    const machine = getDb().records.demoMachines[0];
    const d = createRecord(karan(), 'demos', { opportunityId: o.id, location: 'centre', demoMachineId: machine.id, scheduledAt: '2027-03-03T07:00', durationMin: 90, ownerId: karan().staffId }).record;
    const mine = demoMachineCalendar(karan(), { machineId: machine.id });
    expect(mine.machines.map((m) => m.id)).toEqual([machine.id]);
    const b = mine.bookings.find((x) => x.id === d.id)!;
    expect(b).toMatchObject({ machineId: machine.id, start: '2027-03-03T07:00', end: '2027-03-03T08:30', visible: true, opportunityId: o.id });
    expect(demoMachineCalendar(karan(), { machineId: machine.id, from: '2027-04-01' }).bookings.some((x) => x.id === d.id)).toBe(false);
    expect(demoMachineCalendar(karan(), { divisionId: 'NONE' }).machines).toEqual([]);
    // Another sales executive (Ink): the slot shows as busy, the opportunity details stay hidden.
    const theirs = demoMachineCalendar(actorFor('u_sneha', WS), { machineId: machine.id }).bookings.find((x) => x.id === d.id);
    expect(theirs?.visible).toBe(false);
    expect(theirs?.opportunityName).toBeUndefined();
  });
});
