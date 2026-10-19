/** Demo controls (admin only): simulated clock, network latency, failure injection, idle timeout. */
import { getClockOffset, nowIso, setClockOffset } from '../lib/clock';
import { uid } from '../lib/ids';
import { type Actor, can } from './authz';
import { commit } from './db';
import { appendAudit } from './ledger';
import { type DemoSettings, ServiceError } from './types';

function requireDemo(actor: Actor) {
  if (!can(actor, 'demo.settings')) throw new ServiceError('forbidden', 'Only administrators can change demo controls.');
}

export function updateDemoSettings(actor: Actor, patch: Partial<DemoSettings>) {
  requireDemo(actor);
  commit((d) => {
    d.demo = { ...d.demo, ...patch };
    appendAudit(d, actor, { action: 'demo.settings', summary: `Demo controls changed: ${Object.keys(patch).join(', ')}`, correlationId: uid('cor') });
  });
}

/** Moves the simulated clock by `days` (0 = back to real time). Everything time-based re-evaluates. */
export function shiftClock(actor: Actor, days: number) {
  requireDemo(actor);
  setClockOffset(days === 0 ? 0 : getClockOffset() + days * 86_400_000);
  commit((d) => {
    d.session.lastActiveAt = nowIso();
    appendAudit(d, actor, { action: 'demo.clock', summary: days === 0 ? 'Simulated clock reset to real time' : `Simulated clock moved ${days > 0 ? 'forward' : 'back'} ${Math.abs(days)} day(s)`, correlationId: uid('cor') });
  });
}
