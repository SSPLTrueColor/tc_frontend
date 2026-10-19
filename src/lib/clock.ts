/**
 * Simulated clock. Every time-based rule (SLA, expiry, renewals, reminders, stagnation)
 * reads "now" from here so a demo can move time forward without waiting.
 * The offset is a demo setting stored in localStorage; real time keeps running.
 */
const KEY = 'tc.clock.offsetMs';

let offsetMs = (() => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
})();

export const nowMs = () => Date.now() + offsetMs;
export const now = () => new Date(nowMs());
export const nowIso = () => now().toISOString();
export const getClockOffset = () => offsetMs;

export function setClockOffset(ms: number) {
  offsetMs = Math.round(ms);
  try {
    localStorage.setItem(KEY, String(offsetMs));
  } catch {
    /* storage unavailable: offset lasts for this tab only */
  }
}
