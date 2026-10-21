/** Demo controls (admin only): simulated clock, network latency, failure injection, idle timeout. */
import { getClockOffset, nowIso, setClockOffset } from '../lib/clock';
import { uid } from '../lib/ids';
import { type Actor, can } from './authz';
import { commit, resetDb } from './db';
import { appendAudit } from './ledger';
import { type DemoSettings, ServiceError } from './types';
import { L } from '../constants/labels';

function requireDemo(actor: Actor) {
  if (!can(actor, 'demo.settings')) throw new ServiceError('forbidden', L.common.errors.demoOnly);
}

export function updateDemoSettings(actor: Actor, patch: Partial<DemoSettings>) {
  requireDemo(actor);
  commit((d) => {
    d.demo = { ...d.demo, ...patch };
    appendAudit(d, actor, { action: 'demo.settings', summary: L.common.audit.demoChanged(Object.keys(patch).join(', ')), correlationId: uid('cor') });
  });
}

/** Moves the simulated clock by `days` (0 = back to real time). Everything time-based re-evaluates. */
export function shiftClock(actor: Actor, days: number) {
  requireDemo(actor);
  setClockOffset(days === 0 ? 0 : getClockOffset() + days * 86_400_000);
  commit((d) => {
    d.session.lastActiveAt = nowIso();
    appendAudit(d, actor, { action: 'demo.clock', summary: days === 0 ? L.common.audit.clockReset : L.common.audit.clockMoved(days), correlationId: uid('cor') });
  });
}

/** "Reset demo data" (Demo Settings, account menu): System Administrator only; wipes every change in this browser. */
export function resetDemoData(actor: Actor) {
  requireDemo(actor);
  resetDb();
}
