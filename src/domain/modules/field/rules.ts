/**
 * Field-force and target rules (BR-42 … BR-47). Pure functions over plain values so they can be
 * unit-tested and reused by hooks, services and seed data.
 */
import type { ApprovalLevel } from '../../../services/types';

// ---------------------------------------------------------------- shift (BR-43)

export interface Shift {
  start: string;
  end: string;
  graceMin: number;
  halfDayHours: number;
}

const minuteOfDay = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const timeOf = (localDateTime: string) => localDateTime.slice(11, 16);
const diffMin = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);

export interface AttendanceMetrics {
  workMinutes: number | null;
  lateByMin: number;
  earlyByMin: number;
  status: string;
}

/**
 * Late = check-in after shift start + grace (counted from shift start). Early exit = check-out
 * before shift end. Half-day = checked out having worked less than the half-day threshold.
 * On tour and leave keep their status.
 */
export function attendanceMetrics(a: { checkInAt?: string | null; checkOutAt?: string | null; status?: string | null }, shift: Shift): AttendanceMetrics {
  const keep = a.status === 'on_tour' || a.status === 'leave';
  if (!a.checkInAt) return { workMinutes: null, lateByMin: 0, earlyByMin: 0, status: keep ? String(a.status) : a.status === 'leave' ? 'leave' : 'absent' };
  const inMin = minuteOfDay(timeOf(a.checkInAt));
  const late = inMin - minuteOfDay(shift.start);
  const lateByMin = late > shift.graceMin ? late : 0;
  if (!a.checkOutAt) return { workMinutes: null, lateByMin, earlyByMin: 0, status: keep ? String(a.status) : 'present' };
  const workMinutes = Math.max(0, diffMin(a.checkInAt, a.checkOutAt));
  const early = minuteOfDay(shift.end) - minuteOfDay(timeOf(a.checkOutAt));
  const earlyByMin = early > 0 ? early : 0;
  const status = keep ? String(a.status) : workMinutes < shift.halfDayHours * 60 ? 'half_day' : 'present';
  return { workMinutes, lateByMin, earlyByMin, status };
}

// ---------------------------------------------------------------- location (BR-42, ATT-07)

export interface Point {
  lat: number;
  lng: number;
  at?: string;
}

export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const routeDistanceKm = (points: Point[]) => Math.round(points.slice(1).reduce((s, p, i) => s + haversineKm(points[i], p), 0) * 10) / 10;

/** Head office (Assumption: Andheri East, Mumbai) — geofence centre for office-based staff. */
export const OFFICE: Point & { label: string } = { lat: 19.1136, lng: 72.8697, label: 'Head office, Andheri (E), Mumbai' };

/** Office-based roles are geo-fenced (ATT-02); field roles check in anywhere. */
export const OFFICE_ROLES = ['admin', 'coordinator', 'scm', 'store', 'accounts', 'profiling'];
export const isOfficeRole = (roleId: string) => OFFICE_ROLES.includes(roleId);

export const TERRITORY_CENTRES: Record<string, Point & { label: string }> = {
  mumbai: { lat: 19.076, lng: 72.8777, label: 'Mumbai' },
  pune: { lat: 18.5204, lng: 73.8567, label: 'Pune' },
  surat: { lat: 21.1702, lng: 72.8311, label: 'Surat' },
  ahmedabad: { lat: 23.0225, lng: 72.5714, label: 'Ahmedabad' },
  delhi_ncr: { lat: 28.6139, lng: 77.209, label: 'Delhi NCR' },
  ludhiana: { lat: 30.901, lng: 75.8573, label: 'Ludhiana' },
  jaipur: { lat: 26.9124, lng: 75.7873, label: 'Jaipur' },
  tiruppur: { lat: 11.1085, lng: 77.3411, label: 'Tiruppur' },
  chennai: { lat: 13.0827, lng: 80.2707, label: 'Chennai' },
  bengaluru: { lat: 12.9716, lng: 77.5946, label: 'Bengaluru' },
  hyderabad: { lat: 17.385, lng: 78.4867, label: 'Hyderabad' },
  kolkata: { lat: 22.5726, lng: 88.3639, label: 'Kolkata' },
};

export function geofenceCheck(point: Point, radiusM: number) {
  const distanceM = Math.round(haversineKm(point, OFFICE) * 1000);
  return { inside: distanceM <= radiusM, distanceM };
}

// ---------------------------------------------------------------- expenses (BR-46)

/** Per-claim policy limits (Assumption — not given in the BRD). Conveyance limit is in km per day. */
export const EXPENSE_LIMITS: Record<string, number> = { conveyance_km: 150, travel: 5000, food: 600, lodging: 3500, other: 2000 };

export function conveyanceAmount(km: number, vehicle: string, rates: { twoWheeler: number; car: number }) {
  return Math.round(km * (vehicle === 'car' ? rates.car : rates.twoWheeler) * 100) / 100;
}

/** Limit in ₹ for a claim (conveyance: limit km × rate). */
export function expenseLimit(expenseType: string, vehicle: string, rates: { twoWheeler: number; car: number }) {
  return expenseType === 'conveyance' ? conveyanceAmount(EXPENSE_LIMITS.conveyance_km, vehicle, rates) : EXPENSE_LIMITS[expenseType] ?? EXPENSE_LIMITS.other;
}

// ---------------------------------------------------------------- approvals

/**
 * Who approves a field request first, by the requester's role. The engine routes by capability
 * and division (not a named person), so "reporting manager" is the requester's manager level.
 */
export function managerLevel(roleId: string): ApprovalLevel {
  if (['sales_exec', 'engineer', 'coordinator', 'profiling'].includes(roleId)) return { capability: 'approve.l1', label: 'Reporting manager' };
  if (['sales_manager', 'service_head', 'scm', 'store', 'accounts'].includes(roleId)) return { capability: 'approve.l2', label: 'Division head' };
  return { capability: 'approve.l3', label: 'Management' };
}

// ---------------------------------------------------------------- periods (TGT-01)

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d = 1) => `${y}-${pad(m)}-${pad(d)}`;

/** [from, to) date keys for a target period starting at `start`. */
export function periodRange(periodType: string, start: string): { from: string; to: string } {
  const [y, m] = start.split('-').map(Number);
  const months = periodType === 'year' ? 12 : periodType === 'quarter' ? 3 : 1;
  const endM = m - 1 + months;
  return { from: key(y, m), to: key(y + Math.floor(endM / 12), (endM % 12) + 1) };
}

/** Normalised period start for a date: month → 1st; quarter → Apr/Jul/Oct/Jan; year → 1 April. */
export function periodStartFor(periodType: string, dateKey: string): string {
  const [y, m] = dateKey.split('-').map(Number);
  if (periodType === 'month') return key(y, m);
  if (periodType === 'year') return m >= 4 ? key(y, 4) : key(y - 1, 4);
  const q = [1, 4, 7, 10].filter((x) => x <= m).pop()!;
  return key(y, q);
}

export const periodLabel = (periodType: string, start: string) => {
  const [y, m] = start.split('-').map(Number);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (periodType === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (periodType === 'year') return `FY ${y}-${String(y + 1).slice(2)}`;
  const fq = m >= 4 ? (m - 4) / 3 + 1 : 4;
  const fy = m >= 4 ? y : y - 1;
  return `Q${fq} FY ${fy}-${String(fy + 1).slice(2)}`;
};

// ---------------------------------------------------------------- achievement (BR-47)

type Rec = Record<string, unknown> & { id: string };
export interface AchievementData {
  salesOrders: Rec[];
  paymentMilestones: Rec[];
  activities: Rec[];
  products: Rec[];
}

/** Order statuses that count as booked business (confirmed or later; not on hold / cancelled). */
export const BOOKED = ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'dispatched', 'delivered', 'installation', 'completed'];

const lineNet = (l: Record<string, unknown>) => {
  const gross = (Number(l.qty) || 0) * (Number(l.listPrice) || 0);
  const disc = Number(l.discountAmt) || (gross * (Number(l.discountPct) || 0)) / 100;
  return Math.max(0, gross - disc);
};

export interface TargetLike {
  metric: string;
  periodType: string;
  periodStart: string;
  productCategory?: string | null;
  divisionId?: string | null;
}

/**
 * Actual value for a target. `inScope(ownerStaffId, divisionId)` decides whose business counts
 * (a person, a manager's reporting team, or a whole division).
 */
export function achievementFor(t: TargetLike, data: AchievementData, inScope: (ownerId: unknown, divisionId: unknown) => boolean): number {
  const { from, to } = periodRange(t.periodType, t.periodStart);
  const within = (d: unknown) => typeof d === 'string' && d.slice(0, 10) >= from && d.slice(0, 10) < to;
  const typeOf = new Map(data.products.map((x) => [x.id, String(x.productType)]));
  const catOk = (l: Record<string, unknown>) => !t.productCategory || typeOf.get(String(l.productId)) === t.productCategory;
  const booked = data.salesOrders.filter((o) => BOOKED.includes(String(o.status)) && inScope(o.ownerId, o.divisionId));
  switch (t.metric) {
    case 'order_value':
      return Math.round(
        booked
          .filter((o) => within(o.orderDate))
          .reduce((s, o) => {
            const lines = (o.lines as Record<string, unknown>[] | undefined) ?? [];
            return s + (t.productCategory ? lines.filter(catOk).reduce((x, l) => x + lineNet(l), 0) : Number(o.grandTotal) || lines.reduce((x, l) => x + lineNet(l), 0));
          }, 0),
      );
    case 'quantity':
      return booked.filter((o) => within(o.orderDate)).reduce((s, o) => s + ((o.lines as Record<string, unknown>[] | undefined) ?? []).filter(catOk).reduce((x, l) => x + (Number(l.qty) || 0), 0), 0);
    case 'collections': {
      const orders = new Map(data.salesOrders.filter((o) => inScope(o.ownerId, o.divisionId)).map((o) => [o.id, o]));
      return Math.round(data.paymentMilestones.filter((m) => orders.has(String(m.salesOrderId)) && within(m.receivedAt)).reduce((s, m) => s + (Number(m.receivedAmount) || 0), 0));
    }
    case 'new_customers': {
      const first = new Map<string, Rec>();
      [...data.salesOrders.filter((o) => BOOKED.includes(String(o.status)))]
        .sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)))
        .forEach((o) => !first.has(String(o.customerId)) && first.set(String(o.customerId), o));
      return [...first.values()].filter((o) => within(o.orderDate) && inScope(o.ownerId, o.divisionId)).length;
    }
    case 'activities':
      return data.activities.filter((a) => within(a.at) && inScope(a.byId, undefined)).length;
    default:
      return 0;
  }
}
