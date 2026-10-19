import '../domain/extensions/index';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { createRecord, transitionRecord, updateRecord } from '../services/runtime';
import { feedbackLookup, submitFeedback, waiveCharges } from '../services/service/tickets';
import { ServiceError } from '../services/types';

const coordinator = () => actorFor('u_meera', 'tc');
const head = () => actorFor('u_manoj', 'tc');

describe('service ticket rules', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  const txMachine = () => getDb().records.machines.find((m) => m.divisionId === 'TX' && m.status !== 'scrapped')!;

  it('requires a machine for machine divisions (Q-13) and fills coverage + SLA dues (BR-29/30)', () => {
    const m = txMachine();
    expect(() => createRecord(coordinator(), 'tickets', { customerId: m.customerId, divisionId: 'TX', channel: 'phone', description: 'Head error', category: 'print_head', ticketType: 'breakdown', priority: 'critical' })).toThrow(ServiceError);
    const t = createRecord(coordinator(), 'tickets', { customerId: m.customerId, machineId: m.id, channel: 'phone', description: 'Head error after power cut', category: 'print_head', ticketType: 'breakdown', priority: 'critical' }).record;
    expect(t.status).toBe('open');
    expect(['cmc', 'amc', 'warranty', 'none']).toContain(t.coverage);
    expect(t.responseDueAt).toBeTruthy();
    expect(String(t.resolutionDueAt) > String(t.responseDueAt)).toBe(true);
    // Second complaint on the same machine + category is a repeat (BR-33).
    const t2 = createRecord(coordinator(), 'tickets', { customerId: m.customerId, machineId: m.id, channel: 'whatsapp', description: 'Head error again', category: 'print_head', ticketType: 'breakdown', priority: 'high' }).record;
    expect(t2.repeatOfId).toBe(t.id);
  });

  it('guards resolve (work done, chargeable) and pauses SLA only while waiting for the customer', () => {
    const m = txMachine();
    const engineer = getDb().records.employees.find((e) => e.roleId === 'engineer' && (e.divisionIds as string[]).includes('TX'))!;
    let t = createRecord(coordinator(), 'tickets', { customerId: m.customerId, machineId: m.id, channel: 'phone', description: 'Banding on prints', category: 'print_quality', ticketType: 'breakdown', priority: 'medium', assigneeId: engineer.id }).record;
    expect(t.status).toBe('assigned');
    expect(t.respondedAt).toBeTruthy();
    const ws = 'tc';
    const eng = actorFor(getDb().session.userId, ws); // admin can act as desk
    const id = t.id;
    const v = () => getDb().records.tickets.find((x) => x.id === id)!.version;
    transitionRecord(eng, 'tickets', id, 'accepted', v());
    transitionRecord(eng, 'tickets', id, 'in_progress', v());
    expect(() => transitionRecord(eng, 'tickets', id, 'resolved', v())).toThrow(/work done/i);
    transitionRecord(eng, 'tickets', id, 'waiting_customer', v());
    t = getDb().records.tickets.find((x) => x.id === id)!;
    expect(t.pausedSince).toBeTruthy();
    transitionRecord(eng, 'tickets', id, 'in_progress', v());
    t = getDb().records.tickets.find((x) => x.id === id)!;
    expect(t.pausedSince).toBeNull();
    updateRecord(eng, 'tickets', id, { resolution: 'Recalibrated feed' }, v());
    t = getDb().records.tickets.find((x) => x.id === id)!;
    if (t.coverage === 'none') {
      expect(() => transitionRecord(eng, 'tickets', id, 'resolved', v())).toThrow(/chargeable/i);
      waiveCharges(head(), id, 'Goodwill visit');
    }
    transitionRecord(eng, 'tickets', id, 'resolved', v());
    t = getDb().records.tickets.find((x) => x.id === id)!;
    expect(t.status).toBe('customer_confirmation');
    expect(getDb().outbox.some((m) => m.related?.recordId === id)).toBe(true);
    // Customer confirms with a low rating → closed + service head alerted (BR-35).
    expect(feedbackLookup(String(t.feedbackToken))?.canRespond).toBe(true);
    submitFeedback(String(t.feedbackToken), { rating: 1, comment: 'Took too long', resolved: true });
    t = getDb().records.tickets.find((x) => x.id === id)!;
    expect(t.status).toBe('closed');
    expect(getDb().notifications.some((n) => /Low rating 1\/5/.test(n.title))).toBe(true);
  });
});
