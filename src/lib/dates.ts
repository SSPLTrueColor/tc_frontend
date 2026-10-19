/**
 * Date helpers. Clinic times are stored as local wall-clock strings
 * ("YYYY-MM-DDTHH:mm") in the workspace's clinic time — no implicit UTC shifts.
 */
const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toLocalDateTime(d: Date): string {
  return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocal(s: string): Date {
  const [date, time = '00:00'] = s.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}

export function addMinutes(s: string, minutes: number): string {
  const d = parseLocal(s);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalDateTime(d);
}

export function addDays(dateKey: string, days: number): string {
  const d = parseLocal(dateKey);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function startOfWeek(dateKey: string): string {
  const d = parseLocal(dateKey);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return toDateKey(d);
}

// Project date format (owner rule): cells "16 Oct, 2026"; full/tooltip "Fri, 16 Oct 2026 08:30 AM".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local wall-clock strings ("YYYY-MM-DD[THH:mm]") stay local; full ISO timestamps (with seconds/zone) use the browser zone. */
export function toDate(s: string): Date {
  return /T\d{2}:\d{2}:\d{2}|Z$|[+-]\d{2}:\d{2}$/.test(s) ? new Date(s) : parseLocal(s);
}
export const hasTime = (s: string) => /T\d{2}:\d{2}/.test(s);

const dmy = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const hm = (d: Date) => {
  const h = d.getHours() % 12 || 12;
  return `${pad(h)}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

export const formatDate = (s: string) => {
  const d = toDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
};
export const formatDateTime = (s: string) => `${dmy(toDate(s))} ${hm(toDate(s))}`;
export const formatTime = (s: string) => hm(toDate(s));
/** Short weekday + day + month, for calendar headers: "Fri, 16 Oct". */
export const formatWeekday = (s: string) => {
  const d = toDate(s);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
/** Full tooltip text: "Fri, 16 Oct 2026" or "Fri, 16 Oct 2026 09:07 PM". */
export const formatWeekdayFull = (s: string) => {
  const d = toDate(s);
  return `${DAYS[d.getDay()]}, ${dmy(d)}${hasTime(s) ? ` ${hm(d)}` : ''}`;
};

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}
