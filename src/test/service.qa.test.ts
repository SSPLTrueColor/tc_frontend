/** QA regression tests for BRD 4.8 Service Ticket Management (defects found in the QA pass). */
import '../domain/extensions/index';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { setClockOffset } from '../lib/clock';
import { createRecord, queryRecords, transitionRecord, updateRecord } from '../services/runtime';
import { checkIn, checkOut, requestSignOffOtp, startTravel } from '../services/service/jobs';
import { opportunitySpotted, submitFeedback, sweepService } from '../services/service/tickets';
import { completePm, pmChecklist, raisePmTicket } from '../services/service/pm';
import { unassignedTickets } from '../services/service/board';
import { clockStates, hoursSinceBreach } from '../services/service/sla';
import { byId } from '../services/lookups';
import { ServiceError } from '../services/types';
import { getResource } from '../services/registry';

const coordinator = () => actorFor('u_meera', 'tc');
const ravi = () => actorFor('u_ravi', 'tc');
const tk = (id: string) => getDb().records.tickets.find((x) => x.id === id)!;
const ver = (id: string) => tk(id).version;
const txMachine = () => getDb().records.machines.find((m) => m.divisionId === 'TX' && m.status !== 'scrapped')!;

function onSiteTicket(over: Record<string, unknown> = {}) {
  const m = txMachine();
  const t = createRecord(coordinator(), 'tickets', { customerId: m.customerId, machineId: m.id, channel: 'phone', description: 'Carriage belt slipping', category: 'mechanical', ticketType: 'pm', priority: 'medium', assigneeId: ravi().staffId, ...over }).record;
  transitionRecord(ravi(), 'tickets', t.id, 'accepted', ver(t.id));
  startTravel(ravi(), t.id);
  checkIn(ravi(), t.id, { lat: 21.17, lng: 72.83, mock: true });
  return t.id;
}

describe('service QA regressions', () => {
  beforeEach(() => {
    setClockOffset(0);
    __setDb(createDb(new Date()));
  });
  afterEach(() => setClockOffset(0));

  it('SRV-06: check-out with resolve is refused before anything changes while Waiting for Parts', () => {
    const id = onSiteTicket();
    expect(tk(id).status).toBe('in_progress');
    transitionRecord(ravi(), 'tickets', id, 'waiting_parts', ver(id));
    updateRecord(ravi(), 'tickets', id, { resolution: 'Belt replaced' }, ver(id));
    const code = requestSignOffOtp(id);
    expect(() => checkOut(ravi(), id, { method: 'otp', otp: code, resolve: true })).toThrow(/Resume work before resolving/);
    // Nothing was half-done: the site visit is still open and the ticket unchanged.
    expect(getDb().records.serviceVisits.filter((v) => v.ticketId === id).map((v) => v.status)).toEqual(['on_site']);
    expect(tk(id).status).toBe('waiting_parts');
    // Checking out without resolving is still possible (engineer leaves to fetch parts).
    checkOut(ravi(), id, { method: 'otp', otp: requestSignOffOtp(id), resolve: false });
    expect(getDb().records.serviceVisits.filter((v) => v.ticketId === id).map((v) => v.status)).toEqual(['completed']);
  });

  it('SRV-06: arriving on site with the parts resumes the work; closed tickets cannot be checked in', () => {
    const id = onSiteTicket();
    transitionRecord(ravi(), 'tickets', id, 'waiting_parts', ver(id));
    checkOut(ravi(), id, { method: 'signature', signed: true, resolve: false });
    expect(() => startTravel(ravi(), id)).not.toThrow();
    checkIn(ravi(), id, { lat: 1, lng: 1, mock: true });
    expect(tk(id).status).toBe('in_progress');
    const closed = getDb().records.tickets.find((x) => x.status === 'closed' && x.assigneeId === ravi().staffId)!;
    expect(() => checkIn(ravi(), closed.id, { lat: 1, lng: 1, mock: true })).toThrow(/check-in is not possible/);
  });

  it('SRV-11: resolving a PM service ticket completes its PM visit', () => {
    const pm = getDb().records.pmVisits.find((p) => ['due', 'overdue'].includes(String(p.status)) && !p.ticketId)!;
    const t = raisePmTicket(coordinator(), pm.id);
    const desk = actorFor('u_manoj', 'tc');
    if (!t.assigneeId) {
      updateRecord(desk, 'tickets', t.id, { assigneeId: ravi().staffId }, ver(t.id));
    }
    transitionRecord(desk, 'tickets', t.id, 'accepted', ver(t.id));
    transitionRecord(desk, 'tickets', t.id, 'in_progress', ver(t.id));
    updateRecord(desk, 'tickets', t.id, { resolution: 'PM done, heads cleaned' }, ver(t.id));
    transitionRecord(desk, 'tickets', t.id, 'resolved', ver(t.id));
    const after = getDb().records.pmVisits.find((p) => p.id === pm.id)!;
    expect(after.status).toBe('done');
    expect(after.completedAt).toBeTruthy();
    expect(String(after.checklist)).toContain(t.id);
  });

  it('SRV-11: a PM visit is completed only when every checklist item is answered', () => {
    const pm = getDb().records.pmVisits.find((p) => ['due', 'overdue'].includes(String(p.status)))!;
    expect(() => completePm(coordinator(), pm.id, { results: [], notes: '' })).toThrow(/Answer every checklist item/);
    const items = pmChecklist(byId('machines', pm.machineId));
    completePm(coordinator(), pm.id, { results: items.map((item) => ({ item, ok: true })), notes: '' });
    expect(getDb().records.pmVisits.find((p) => p.id === pm.id)!.status).toBe('done');
  });

  it('SRV-14: Opportunity Spotted creates one lead per service ticket', () => {
    const t = getDb().records.tickets.find((x) => x.status === 'in_progress')!;
    opportunitySpotted(coordinator(), t.id, { interest: 'amc', note: 'Customer asked about CMC' });
    expect(() => opportunitySpotted(coordinator(), t.id, { interest: 'amc', note: 'again' })).toThrow(ServiceError);
    expect(getDb().records.leads.filter((l) => String(l.requirement).includes(t.id)).length).toBe(1);
  });

  it('SRV-05: unassigned lists only tickets without a service engineer', () => {
    const rows = unassignedTickets(coordinator());
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((t) => expect(t.assigneeId).toBeFalsy());
    const view = getResource('tickets').views.find((v) => v.id === 'v_tkt_unassigned')!;
    expect(JSON.stringify(view.filter)).toContain('"field":"assigneeId","operator":"empty"');
  });

  it('BR-32: a clock met late alerts once but only still-overdue clocks climb the escalation matrix', () => {
    const t = { status: 'in_progress', responseDueAt: '2026-10-19T10:00', respondedAt: '2026-10-19T10:30', arrivalDueAt: '2026-10-19T14:00', resolutionDueAt: '2026-10-19T18:00' };
    // 13:00: response was late, arrival and resolution still on time → level 1 only (0 h).
    expect(hoursSinceBreach(clockStates(t, '2026-10-19T13:00'), '2026-10-19T13:00')).toBe(0);
    // 20:00: arrival overdue since 14:00 → 6 h.
    expect(hoursSinceBreach(clockStates(t, '2026-10-19T20:00'), '2026-10-19T20:00')).toBe(6);
    expect(hoursSinceBreach(clockStates({ ...t, respondedAt: '2026-10-19T09:00' }, '2026-10-19T13:00'), '2026-10-19T13:00')).toBeNull();
  });

  it('SRV-09: the SLA clock is paused and does not escalate while Waiting for Customer', () => {
    const t = getDb().records.tickets.find((x) => x.status === 'in_progress')!;
    transitionRecord(coordinator(), 'tickets', t.id, 'waiting_customer', t.version);
    const level = tk(t.id).escalationLevel;
    setClockOffset(3 * 86_400_000);
    sweepService(coordinator());
    expect(tk(t.id).escalationLevel).toBe(level);
    expect(tk(t.id).status).toBe('waiting_customer');
  });

  it('SRV-12: feedback ratings are whole numbers from 1 to 5', () => {
    const id = onSiteTicket({ ticketType: 'installation' });
    // A root cause is recorded so a repeat complaint on the same machine also closes on good feedback.
    updateRecord(ravi(), 'tickets', id, { resolution: 'Done', rootCause: 'Belt worn out' }, ver(id));
    transitionRecord(ravi(), 'tickets', id, 'resolved', ver(id));
    const token = String(tk(id).feedbackToken);
    expect(() => submitFeedback(token, { rating: 3.5, comment: '', resolved: true })).toThrow(/rating/);
    expect(() => submitFeedback(token, { rating: 0, comment: '', resolved: true })).toThrow(/rating/);
    submitFeedback(token, { rating: 4, comment: 'Good', resolved: true });
    expect(tk(id).status).toBe('closed');
  });

  it('roles: engineers see only their own tickets; Import / SCM and Profiling have no access', () => {
    const own = queryRecords(ravi(), 'tickets', {}).rows;
    own.forEach((t) => expect(t.assigneeId).toBe(ravi().staffId));
    expect(() => queryRecords(actorFor('u_rajesh', 'tc'), 'tickets', {})).toThrow();
    expect(() => queryRecords(actorFor('u_tanvi', 'tc'), 'tickets', {})).toThrow();
    expect(queryRecords(actorFor('u_nisha', 'tc'), 'tickets', {}).rows.every((t) => t.divisionId === 'FAB')).toBe(true);
    const m = txMachine();
    expect(() => createRecord(actorFor('u_karan', 'tc'), 'tickets', { customerId: m.customerId, machineId: m.id, channel: 'phone', description: 'Sales tries', category: 'other', ticketType: 'breakdown', priority: 'low' })).toThrow(/cannot create/);
  });
});
