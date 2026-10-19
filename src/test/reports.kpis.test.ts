import type { RecordData } from '../metadata/types';
import { ageingBuckets, amcRenewalRate, attachRate, collections, csat, firstTimeFix, leadConversion, leadResponseHours, mttrHours, pipeline, pmCompliance, quoteToOrder, repeatRate, slaCompliance, winRate } from '../services/reports/kpis';

const r = (o: Record<string, unknown>): RecordData => ({ id: String(o.id ?? Math.random()), workspaceId: 'tc', version: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '', createdBy: 'x', ...o });

describe('Appendix C KPI formulas', () => {
  it('win rate = won ÷ (won + lost); open deals ignored', () => {
    expect(winRate([r({ stage: 'won' }), r({ stage: 'won' }), r({ stage: 'lost' }), r({ stage: 'proposal' })])).toBeCloseTo(2 / 3);
    expect(winRate([r({ stage: 'demo' })])).toBeNull();
  });

  it('pipeline value and weighted forecast use open stages only', () => {
    const p = pipeline([r({ stage: 'proposal', value: 100, probability: 50 }), r({ stage: 'negotiation', value: 200, weightedValue: 150 }), r({ stage: 'won', value: 999 })]);
    expect(p).toEqual({ count: 2, value: 300, weighted: 200 });
  });

  it('lead conversion and response time', () => {
    const leads = [r({ status: 'qualified', createdAt: '2026-10-01T10:00', firstContactAt: '2026-10-01T16:00' }), r({ status: 'new' }), r({ status: 'contacted', createdAt: '2026-10-01T10:00', firstContactAt: '2026-10-02T04:00' }), r({ status: 'disqualified' })];
    expect(leadConversion(leads)).toBe(0.25);
    expect(leadResponseHours(leads)).toBe(12);
  });

  it('quote-to-order counts sent quotations that became orders', () => {
    const quotes = [r({ id: 'q1', status: 'accepted' }), r({ id: 'q2', status: 'sent' }), r({ id: 'q3', status: 'draft' }), r({ id: 'q4', status: 'expired' })];
    expect(quoteToOrder(quotes, [r({ quotationId: 'q1', status: 'confirmed' }), r({ quotationId: 'q2', status: 'cancelled' })])).toBeCloseTo(1 / 3);
  });

  it('SLA compliance needs response and resolution on time', () => {
    const t = (o: Record<string, unknown>) => r({ status: 'closed', responseDueAt: '2026-10-01T11:00', resolutionDueAt: '2026-10-01T18:00', respondedAt: '2026-10-01T10:30', resolvedAt: '2026-10-01T17:00', ...o });
    expect(slaCompliance([t({}), t({ resolvedAt: '2026-10-01T19:00' }), t({ respondedAt: '2026-10-01T12:00' }), t({ status: 'open', resolvedAt: '' })])).toBeCloseTo(1 / 3);
  });

  it('MTTR subtracts customer-pause time', () => {
    expect(mttrHours([r({ status: 'resolved', reportedAt: '2026-10-01T08:00', resolvedAt: '2026-10-01T20:00', pausedMinutes: 120 }), r({ status: 'closed', reportedAt: '2026-10-01T08:00', resolvedAt: '2026-10-01T12:00' })])).toBe(7);
  });

  it('first-time fix counts single-visit, never re-opened site tickets', () => {
    const tickets = [r({ id: 't1', status: 'closed', resolvedAt: '2026-10-02' }), r({ id: 't2', status: 'closed', resolvedAt: '2026-10-02' }), r({ id: 't3', status: 'closed', resolvedAt: '2026-10-02', reopenCount: 1 }), r({ id: 't4', status: 'closed', resolvedAt: '2026-10-02' })];
    const visits = [r({ ticketId: 't1' }), r({ ticketId: 't2' }), r({ ticketId: 't2' }), r({ ticketId: 't3' })];
    expect(firstTimeFix(tickets, visits)).toBeCloseTo(1 / 3); // t4 had no site visit (remote) → excluded
  });

  it('repeat %, PM compliance, AMC renewal %, CSAT', () => {
    expect(repeatRate([r({ repeatOfId: 'x' }), r({}), r({}), r({})])).toBe(0.25);
    expect(pmCompliance([r({ dueDate: '2026-10-01', status: 'done', completedAt: '2026-09-30' }), r({ dueDate: '2026-10-05', status: 'done', completedAt: '2026-10-09' }), r({ dueDate: '2026-10-10', status: 'overdue' }), r({ dueDate: '2026-11-01', status: 'due' })], '2026-10-19')).toBeCloseTo(1 / 3);
    expect(amcRenewalRate([r({ status: 'renewed' }), r({ status: 'renewed' }), r({ status: 'lost' }), r({ status: 'expired' }), r({ status: 'active' })])).toBe(0.5);
    expect(csat([r({ rating: 5 }), r({ rating: 4 }), r({ rating: 2 }), r({})])).toEqual({ avg: 11 / 3, share4plus: 2 / 3, count: 3 });
  });

  it('consumables attach rate over machine customers', () => {
    const machines = [r({ customerId: 'A' }), r({ customerId: 'A' }), r({ customerId: 'B' }), r({ customerId: 'C', status: 'scrapped' })];
    const orders = [r({ customerId: 'A', orderKind: 'consumables', status: 'completed', orderDate: '2026-09-01' }), r({ customerId: 'B', orderKind: 'consumables', status: 'cancelled', orderDate: '2026-09-01' }), r({ customerId: 'B', orderKind: 'machine', status: 'completed', orderDate: '2026-09-01' })];
    expect(attachRate(machines, orders, '2026-01-01')).toEqual({ rate: 0.5, machineCustomers: 2 });
  });

  it('collections ageing buckets and open-item ageing', () => {
    const c = collections([r({ amount: 100, receivedAmount: 0, dueDate: '2026-10-09' }), r({ amount: 200, receivedAmount: 50, dueDate: '2026-08-01' }), r({ amount: 300, receivedAmount: 300, dueDate: '2026-07-01' }), r({ amount: 400, dueDate: '2026-11-01' })], '2026-10-19');
    expect(c.overdueAmount).toBe(250);
    expect(c.ageing.find((b) => b.key === '0-30')!.amount).toBe(100);
    expect(c.ageing.find((b) => b.key === '61-90')!.amount).toBe(150);
    const now = new Date('2026-10-19T12:00:00').getTime();
    const b = ageingBuckets([r({ reportedAt: '2026-10-19T08:00' }), r({ reportedAt: '2026-10-14T08:00' }), r({ reportedAt: '2026-09-01T08:00' })], 'reportedAt', now);
    expect(b.map((x) => x.count)).toEqual([1, 1, 0, 0, 1]);
  });
});
