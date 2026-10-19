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

const IST_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** Simulated "now" as an Asia/Kolkata wall-clock string "YYYY-MM-DDTHH:mm:ss", whatever the browser's zone. */
export function istNow(): string {
  const p = Object.fromEntries(IST_PARTS.formatToParts(now()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
