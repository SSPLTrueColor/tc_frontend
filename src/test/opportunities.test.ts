import { appPack } from '../domain/pack';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { createRecord, queryRecords, transitionRecord } from '../services/runtime';
import { computeForecast, markLost, periodOf } from '../services/opportunities';
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

  it('defaults stage, probability and hub on create (BR-11)', () => {
    const o = newOpp();
    expect(o.stage).toBe('needs_assessment');
    expect(o.probability).toBe(10);
    expect(getDb().records.opportunities.find((x) => x.id === o.id)!.territoryId).toBe('surat');
    expect(o.id).toMatch(/^OPP-\d{4}-\d{5}$/);
    expect(o.weightedValue).toBe(250_000);
  });

  it('enforces stage entry criteria and updates probability', () => {
    const o = newOpp(0);
    expect(() => transitionRecord(karan(), 'opportunities', o.id, 'proposal', o.version)).toThrow(/value/i);
    const ok = newOpp();
    const moved = transitionRecord(karan(), 'opportunities', ok.id, 'demo', ok.version).record;
    expect(moved.probability).toBe(25);
    if (hasQuotes) {
      const p = transitionRecord(karan(), 'opportunities', ok.id, 'proposal', moved.version).record;
      expect(() => transitionRecord(karan(), 'opportunities', ok.id, 'won', p.version)).toThrow(/accepted quotation/);
    }
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

  it('scopes: the executive sees own deals, the manager sees the team', () => {
    const o = newOpp();
    expect(queryRecords(karan(), 'opportunities').rows.every((r) => r.ownerId === karan().staffId)).toBe(true);
    expect(queryRecords(rohan(), 'opportunities').rows.some((r) => r.id === o.id)).toBe(true);
    expect(queryRecords(actorFor('u_kavita', WS), 'opportunities').rows.some((r) => r.id === o.id)).toBe(false);
  });

  it('forecast totals equal the sum of weighted open deals in range (FR-033)', () => {
    const o = newOpp(1_000_000);
    const f = computeForecast(rohan(), { period: 'month', groupBy: 'owner', horizon: 6 });
    const inRange = queryRecords(rohan(), 'opportunities').rows.filter((r) => ['needs_assessment', 'demo', 'proposal', 'negotiation'].includes(String(r.stage)) && f.periods.some((p) => p.key === periodOf(String(r.expectedCloseDate), 'month')));
    const expected = inRange.reduce((s, r) => s + (Number(r.value) * Number(r.probability)) / 100, 0);
    expect(Math.round(f.grand.weighted)).toBe(Math.round(expected));
    expect(inRange.some((r) => r.id === o.id)).toBe(true);
    expect(periodOf('2026-05-10', 'quarter')).toBe('2026-Q1');
    expect(periodOf('2027-02-10', 'quarter')).toBe('2026-Q4');
  });
});
