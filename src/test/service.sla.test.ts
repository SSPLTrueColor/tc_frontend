import { clockStates, computeDues, formatMinutes, isBreached, resumePatch } from '../services/service/sla';

// Same values as DEFAULT_POLICIES.sla; kept local so this pure test does not load the store.
const h = (response: number, arrival: number, resolution: number) => ({ response, arrival, resolution });
const DEFAULT_POLICIES = {
  sla: {
    critical: { cmc: h(1, 4, 8), amc: h(1, 4, 8), warranty: h(1, 4, 8), none: h(2, 8, 24) },
    medium: { cmc: h(4, 24, 48), amc: h(4, 24, 48), warranty: h(4, 24, 48), none: h(8, 48, 72) },
  },
};

describe('service SLA clocks (BR-30/31)', () => {
  const reported = '2026-10-19T10:00';

  it('computes due times from priority × coverage', () => {
    expect(computeDues(DEFAULT_POLICIES, reported, 'critical', 'cmc')).toEqual({ responseDueAt: '2026-10-19T11:00', arrivalDueAt: '2026-10-19T14:00', resolutionDueAt: '2026-10-19T18:00' });
    expect(computeDues(DEFAULT_POLICIES, reported, 'medium', 'none').resolutionDueAt).toBe('2026-10-22T10:00');
  });

  it('reports met, met late, running, at risk and breached clocks', () => {
    const t = { ...computeDues(DEFAULT_POLICIES, reported, 'critical', 'warranty'), respondedAt: '2026-10-19T10:30', arrivedAt: '2026-10-19T15:00', status: 'in_progress' };
    const [resp, arr, res] = clockStates(t, '2026-10-19T17:30');
    expect(resp.status).toBe('met');
    expect(arr.status).toBe('breached_met');
    expect(arr.minutes).toBe(60);
    expect(res.status).toBe('at_risk');
    expect(clockStates(t, '2026-10-19T19:00')[2].status).toBe('breached');
    expect(isBreached(clockStates(t, '2026-10-19T12:00'))).toBe(true);
  });

  it('pauses only while waiting for the customer and shifts unmet due times on resume', () => {
    const dues = computeDues(DEFAULT_POLICIES, reported, 'critical', 'cmc');
    const t = { ...dues, respondedAt: '2026-10-19T10:20', status: 'waiting_customer', pausedSince: '2026-10-19T12:00', pausedMinutes: 15 };
    const states = clockStates(t, '2026-10-19T20:00');
    expect(states[2].status).toBe('paused');
    expect(states[0].status).toBe('met');
    const patch = resumePatch(t, '2026-10-19T13:30');
    expect(patch.pausedMinutes).toBe(105);
    expect(patch.resolutionDueAt).toBe('2026-10-19T19:30');
    expect(patch.arrivalDueAt).toBe('2026-10-19T15:30');
    expect(patch.responseDueAt).toBeUndefined();
    expect(patch.pausedSince).toBeNull();
    // Waiting for parts does not pause.
    expect(clockStates({ ...t, status: 'waiting_parts' }, '2026-10-19T20:00')[2].status).toBe('breached');
  });

  it('formats durations compactly', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(135)).toBe('2h 15m');
    expect(formatMinutes(-1500)).toBe('1d 1h');
  });
});
