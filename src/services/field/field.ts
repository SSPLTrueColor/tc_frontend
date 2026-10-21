/**
 * Field Force and Targets & Recognition domain service (engine side, synchronous). Check-in/out and visit check-in/out are
 * dedicated operations — GPS and times are captured here, never typed into a form — so the
 * attendance fields stay read-only everywhere else. Pages call these through services/api/field.ts.
 */
import type { RecordData } from '../../metadata/types';
import { addDays, nowLocal, startOfWeek, todayKey } from '../../lib/dates';
import { nowIso } from '../../lib/clock';
import { uid } from '../../lib/ids';
import { type Actor, can, perm } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit } from '../ledger';
import { getPolicies } from '../policies';
import { masterLabel } from '../registry';
import type { HookContext } from '../resourceHooks';
import { insertRecordIn, patchRecordIn, queryRecords } from '../runtime';
import { ServiceError } from '../types';
import { L } from '../../constants/labels';
import { activityScorecard, scoreTotal } from '../reports/kpis';
import { achievementFor, attendanceMetrics, BOOKED, geofenceCheck, isOfficeRole, OFFICE, orderNetValue, periodLabel, periodRange, type Point, routeDistanceKm, TERRITORY_CENTRES } from './rules';

const E = L.field.errors;
const AU = L.field.audit;
const EX = L.field.pages.exceptionDashboard.details;
const recs = (key: string): RecordData[] => getDb().records[key] ?? [];
const ctxOf = (d: ReturnType<typeof getDb>, actor: Actor): HookContext => ({ d, actor, correlationId: uid('cor') });

// ---------------------------------------------------------------- people in scope

export const employeeOf = (staffId: unknown) => recs('employees').find((e) => e.id === staffId);

/** Employees whose field records the actor may see (role scope on attendance). */
export function employeesInScope(actor: Actor): RecordData[] {
  const scope = perm(actor, 'attendance').read;
  const active = recs('employees').filter((e) => e.workspaceId === actor.workspaceId && e.status !== 'inactive');
  if (scope === 'all') return active;
  if (scope === 'division') return active.filter((e) => ((e.divisionIds as string[]) ?? []).some((d) => actor.divisionIds.includes(d)));
  if (scope === 'team') return active.filter((e) => actor.teamStaffIds.includes(e.id));
  if (scope === 'own') return active.filter((e) => e.id === actor.staffId);
  return [];
}

const FIELD_ROLES = ['sales_exec', 'sales_manager', 'engineer'];
export const isFieldRole = (roleId: unknown) => FIELD_ROLES.includes(String(roleId));

// ---------------------------------------------------------------- location

export type LocationSource = 'simulated' | 'device' | 'mock_app';

/** Simulated position: office staff near the head office, field staff near their first territory. */
export function simulatedPoint(staffId: string): Point & { label: string } {
  const e = employeeOf(staffId);
  if (!e || isOfficeRole(String(e.roleId))) return { lat: OFFICE.lat + 0.0004, lng: OFFICE.lng - 0.0003, label: OFFICE.label };
  const t = ((e.territoryIds as string[]) ?? [])[0];
  const c = TERRITORY_CENTRES[t] ?? TERRITORY_CENTRES.mumbai;
  return { lat: Math.round((c.lat + 0.01) * 1e5) / 1e5, lng: Math.round((c.lng - 0.008) * 1e5) / 1e5, label: L.field.location.simulatedPlace(c.label) };
}

const CONSENT_KEY = (userId: string) => `tc.field.locationConsent.${userId}`;

/** NFR-11 / BR-45: consent before location is captured. Seeded users with history already consented. */
export function hasLocationConsent(actor: Actor): boolean {
  try {
    if (localStorage.getItem(CONSENT_KEY(actor.user.id))) return true;
  } catch {
    /* storage blocked: fall back to history */
  }
  // Anyone with an earlier location-verified check-in consented on their first check-in.
  return recs('attendance').some((a) => a.employeeId === actor.staffId && a.checkInAt && a.locationSource === 'device');
}

export function grantLocationConsent(actor: Actor) {
  try {
    localStorage.setItem(CONSENT_KEY(actor.user.id), nowIso());
  } catch {
    /* consent still audited below */
  }
  commit((d) => appendAudit(d, actor, { action: 'consent.location', summary: AU.consent, correlationId: uid('cor') }));
}

// ---------------------------------------------------------------- attendance (ATT-01 … ATT-04)

export const attendanceOn = (staffId: string, date: string) => recs('attendance').find((a) => a.employeeId === staffId && a.date === date);

export interface CheckInput {
  at: string;
  point: Point;
  place: string;
  source: LocationSource;
  selfie?: boolean;
  onTour?: boolean;
}

function requireOwnWrite(actor: Actor, resKey: string) {
  if (!perm(actor, resKey).create) throw new ServiceError('forbidden', E.noAttendanceRole);
}

/**
 * ATT-02: a mock/fake GPS location is refused, and the attempt is recorded — audit entry plus a
 * "mock location" flag on the day's attendance — so it shows on the Exception Dashboard.
 */
function recordMockAttempt(actor: Actor, at: string, what: string) {
  const date = at.slice(0, 10);
  commit((d) => {
    const ctx = ctxOf(d, actor);
    const rec = attendanceOn(actor.staffId, date);
    const id = rec ? patchRecordIn(ctx, 'attendance', rec.id, { mockLocation: true }, AU.mockBlocked(what)).id : insertRecordIn(ctx, 'attendance', { employeeId: actor.staffId, date, status: 'absent', mockLocation: true, lateByMin: 0, earlyByMin: 0 }, { validate: false }).id;
    appendAudit(d, actor, { action: 'attendance.mock_location', resource: 'attendance', recordId: id, summary: AU.mockBlocked(what), correlationId: ctx.correlationId });
  });
}

export function checkIn(actor: Actor, input: CheckInput): RecordData {
  requireOwnWrite(actor, 'attendance');
  if (!hasLocationConsent(actor)) throw new ServiceError('invalid_state', E.consentFirst);
  const date = input.at.slice(0, 10);
  const prior = attendanceOn(actor.staffId, date);
  if (input.source === 'mock_app') {
    if (!prior?.checkInAt) recordMockAttempt(actor, input.at, AU.mockWhat.checkIn);
    throw new ServiceError('validation', E.mockCheckIn);
  }
  const existing = attendanceOn(actor.staffId, date);
  if (existing?.checkInAt && !existing.checkOutAt) throw new ServiceError('invalid_state', E.alreadyCheckedIn);
  if (existing?.checkInAt) throw new ServiceError('invalid_state', E.alreadyDone);
  if (existing?.status === 'leave') throw new ServiceError('invalid_state', E.onLeaveToday);
  const role = String(employeeOf(actor.staffId)?.roleId ?? actor.user.roleId);
  const office = isOfficeRole(role) && !input.onTour;
  const fence = geofenceCheck(input.point, getPolicies().geofenceRadiusM);
  if (office && !fence.inside) throw new ServiceError('validation', E.outsideGeofence(fence.distanceM.toLocaleString('en-IN'), getPolicies().geofenceRadiusM));
  return commit((d) => {
    const ctx = ctxOf(d, actor);
    const status = input.onTour ? 'on_tour' : 'present';
    const m = attendanceMetrics({ checkInAt: input.at, status }, getPolicies().shift);
    const values = {
      employeeId: actor.staffId,
      date,
      status: m.status,
      checkInAt: input.at,
      checkInLat: input.point.lat,
      checkInLng: input.point.lng,
      checkInPlace: input.place,
      locationSource: input.source,
      insideGeofence: fence.inside,
      mockLocation: !!existing?.mockLocation,
      selfie: !!input.selfie,
      lateByMin: m.lateByMin,
      earlyByMin: 0,
      workMinutes: null,
      routePoints: [{ ...input.point, at: input.at }],
    };
    const rec = existing ? patchRecordIn(ctx, 'attendance', existing.id, values, AU.checkedIn) : insertRecordIn(ctx, 'attendance', values);
    appendAudit(d, actor, { action: 'attendance.check_in', resource: 'attendance', recordId: rec.id, summary: AU.checkInSummary(input.at.slice(11), input.place, m.lateByMin), correlationId: ctx.correlationId });
    return rec;
  });
}

export function checkOut(actor: Actor, input: Omit<CheckInput, 'selfie' | 'onTour'>): RecordData {
  requireOwnWrite(actor, 'attendance');
  const date = input.at.slice(0, 10);
  const rec = attendanceOn(actor.staffId, date);
  if (!rec?.checkInAt) throw new ServiceError('invalid_state', E.notCheckedIn);
  if (rec.checkOutAt) throw new ServiceError('invalid_state', E.alreadyCheckedOut);
  if (input.source === 'mock_app') {
    recordMockAttempt(actor, input.at, AU.mockWhat.checkOut);
    throw new ServiceError('validation', E.mockCheckOut);
  }
  if (input.at < String(rec.checkInAt)) throw new ServiceError('validation', E.outBeforeIn);
  return commit((d) => {
    const ctx = ctxOf(d, actor);
    // ATT-07: route = check-in, the day's visit locations, check-out (simulated tracking pings).
    const visitPoints = recs('fieldVisits')
      .filter((v) => v.employeeId === actor.staffId && String(v.checkInAt ?? '').startsWith(date) && v.checkInLat)
      .sort((a, b) => String(a.checkInAt).localeCompare(String(b.checkInAt)))
      .map((v) => ({ lat: Number(v.checkInLat), lng: Number(v.checkInLng), at: String(v.checkInAt) }));
    const points = [...((rec.routePoints as Point[]) ?? []), ...visitPoints, { ...input.point, at: input.at }];
    const m = attendanceMetrics({ checkInAt: String(rec.checkInAt), checkOutAt: input.at, status: String(rec.status) }, getPolicies().shift);
    const next = patchRecordIn(ctx, 'attendance', rec.id, { checkOutAt: input.at, checkOutLat: input.point.lat, checkOutLng: input.point.lng, workMinutes: m.workMinutes, earlyByMin: m.earlyByMin, lateByMin: m.lateByMin, status: m.status, routePoints: points, distanceKm: routeDistanceKm(points) }, AU.checkedOut);
    appendAudit(d, actor, { action: 'attendance.check_out', resource: 'attendance', recordId: rec.id, summary: AU.checkOutSummary(Math.floor((m.workMinutes ?? 0) / 60), (m.workMinutes ?? 0) % 60, input.at.slice(11)), correlationId: ctx.correlationId });
    return next;
  });
}

export interface MyDay {
  today: string;
  record: RecordData | undefined;
  office: boolean;
  consent: boolean;
  recent: RecordData[];
  visitsToday: number;
  pendingRegularisations: number;
  shift: ReturnType<typeof getPolicies>['shift'];
  radiusM: number;
}

export function myDay(actor: Actor): MyDay {
  const today = todayKey();
  const role = String(employeeOf(actor.staffId)?.roleId ?? actor.user.roleId);
  return {
    today,
    record: attendanceOn(actor.staffId, today),
    office: isOfficeRole(role),
    consent: hasLocationConsent(actor),
    recent: recs('attendance')
      .filter((a) => a.employeeId === actor.staffId && String(a.date) < today)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 7),
    visitsToday: recs('fieldVisits').filter((v) => v.employeeId === actor.staffId && String(v.checkInAt ?? '').startsWith(today)).length,
    pendingRegularisations: recs('regularisations').filter((r) => r.employeeId === actor.staffId && r.status === 'pending').length,
    shift: getPolicies().shift,
    radiusM: getPolicies().geofenceRadiusM,
  };
}

export interface TeamRow {
  employee: RecordData;
  record: RecordData | undefined;
  visits: number;
}

/** ATT-03: one row per person in scope for a date. */
export function teamAttendance(actor: Actor, date: string): TeamRow[] {
  if (perm(actor, 'attendance').read === 'none') throw new ServiceError('forbidden', E.noAttendanceRead);
  return employeesInScope(actor)
    .filter((e) => !['admin', 'management'].includes(String(e.roleId)) || e.id === actor.staffId)
    .map((employee) => ({
      employee,
      record: attendanceOn(employee.id, date),
      visits: recs('fieldVisits').filter((v) => v.employeeId === employee.id && v.status === 'completed' && String(v.checkInAt ?? v.plannedFor).startsWith(date)).length,
    }))
    .sort((a, b) => String(a.employee.fullName).localeCompare(String(b.employee.fullName)));
}

export interface ExceptionRow {
  employee: RecordData;
  kind: 'no_check_in' | 'late' | 'early_exit' | 'no_visits' | 'mock_location' | 'not_checked_out';
  detail: string;
}

/** ATT-10 exception dashboard: no check-in, late, early exit, no visits logged. Sundays are off. */
export function attendanceExceptions(actor: Actor, date: string): ExceptionRow[] {
  const rows = teamAttendance(actor, date);
  const today = todayKey();
  // Nothing can be an exception yet on a future day; today, "no check-in" starts once the grace period is over.
  if (date > today) return [];
  const sunday = new Date(`${date}T12:00:00`).getDay() === 0;
  const { start, graceMin } = getPolicies().shift;
  const [sh, sm] = start.split(':').map(Number);
  const pastGrace = date < today || nowLocal().slice(11, 16) > `${String(Math.floor((sh * 60 + sm + graceMin) / 60)).padStart(2, '0')}:${String((sh * 60 + sm + graceMin) % 60).padStart(2, '0')}`;
  const out: ExceptionRow[] = [];
  for (const { employee, record, visits } of rows) {
    if (sunday) continue;
    if (record?.mockLocation) out.push({ employee, kind: 'mock_location', detail: EX.mock_location });
    if (!record || (!record.checkInAt && record.status !== 'leave')) {
      if (pastGrace) out.push({ employee, kind: 'no_check_in', detail: EX.no_check_in });
      continue;
    }
    if (record.status === 'leave') continue;
    if (Number(record.lateByMin) > 0) out.push({ employee, kind: 'late', detail: EX.late(record.lateByMin, String(record.checkInAt).slice(11)) });
    if (Number(record.earlyByMin) > 0) out.push({ employee, kind: 'early_exit', detail: EX.early_exit(record.earlyByMin, String(record.checkOutAt).slice(11)) });
    if (date < todayKey() && record.checkInAt && !record.checkOutAt) out.push({ employee, kind: 'not_checked_out', detail: EX.not_checked_out });
    if (isFieldRole(employee.roleId) && visits === 0 && (date < todayKey() || String(record.checkOutAt ?? ''))) out.push({ employee, kind: 'no_visits', detail: EX.no_visits });
  }
  return out;
}

/** ATT-07 route for a person and date (scope-checked). */
export function routeFor(actor: Actor, staffId: string, date: string) {
  const employee = employeeOf(staffId);
  if (!employee || !employeesInScope(actor).some((e) => e.id === staffId)) throw new ServiceError('not_found', E.routeUnavailable);
  const record = attendanceOn(staffId, date);
  const points = ((record?.routePoints as Point[] | undefined) ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const days = recs('attendance')
    .filter((a) => a.employeeId === staffId && ((a.routePoints as Point[] | undefined)?.length ?? 0) > 1)
    .map((a) => String(a.date))
    .sort()
    .reverse()
    .slice(0, 14);
  return { employee, record, points, distanceKm: routeDistanceKm(points), days };
}

export interface RoutePerson {
  employee: RecordData;
  checkedIn: boolean;
  distanceKm: number | null;
  positions: number;
}

/** ATT-07 Route Map landing: people whose attendance the actor can see, with the day's tracked distance. */
export function routePeople(actor: Actor, date: string): RoutePerson[] {
  if (perm(actor, 'attendance').read === 'none') throw new ServiceError('forbidden', E.noAttendanceRead);
  return employeesInScope(actor)
    .filter((e) => isFieldRole(e.roleId) || e.id === actor.staffId)
    .map((employee) => {
      const a = attendanceOn(employee.id, date);
      const positions = ((a?.routePoints as Point[] | undefined) ?? []).length;
      return { employee, checkedIn: !!a?.checkInAt, distanceKm: a?.distanceKm === undefined || a?.distanceKm === null ? null : Number(a.distanceKm), positions };
    })
    .sort((a, b) => String(a.employee.fullName).localeCompare(String(b.employee.fullName)));
}

// ---------------------------------------------------------------- field visits (ATT-05)

export interface VisitInput {
  customerId?: string | null;
  siteLabel: string;
  purpose: string;
  remarks?: string;
  nextAction?: string;
  nextActionDate?: string | null;
  parentResource?: string;
  parentId?: string;
  parentLabel?: string;
  point: Point;
  source: LocationSource;
  at: string;
}

function logVisitActivity(ctx: HookContext, v: RecordData) {
  if (!getDb().records.activities) return;
  const customerId = v.customerId ? String(v.customerId) : undefined;
  insertRecordIn(
    ctx,
    'activities',
    {
      activityType: 'visit',
      subject: AU.visitSubject(masterLabel('visitPurpose', v.purpose), String(v.siteLabel)),
      at: v.checkOutAt ?? v.checkInAt ?? nowLocal(),
      byId: v.employeeId,
      notes: [v.remarks, v.nextAction ? AU.next(String(v.nextAction)) : ''].filter(Boolean).join('\n'),
      nextFollowUpAt: v.nextActionDate || null,
      parentResource: v.parentResource || (customerId ? 'customers' : 'fieldVisits'),
      parentId: v.parentId || customerId || v.id,
      parentLabel: v.parentLabel || String(v.siteLabel),
      customerId,
    },
    { validate: false },
  );
}

function markBeat(ctx: HookContext, v: RecordData) {
  const date = String(v.checkInAt ?? v.plannedFor).slice(0, 10);
  (ctx.d.records.beatPlans ?? [])
    .filter((b) => b.employeeId === v.employeeId && b.date === date && b.status !== 'visited' && ((v.customerId && b.customerId === v.customerId) || b.siteLabel === v.siteLabel))
    .forEach((b) => patchRecordIn(ctx, 'beatPlans', b.id, { status: 'visited' }, L.field.approvals.visited(v.id)));
}

/** NFR-19 quick log: one completed visit at the current place and time (≤ 3 taps). */
export function logVisit(actor: Actor, input: VisitInput): RecordData {
  if (!perm(actor, 'fieldVisits').create) throw new ServiceError('forbidden', E.noVisitRole);
  if (!input.siteLabel.trim()) throw new ServiceError('validation', E.siteRequired, { fieldErrors: { siteLabel: E.required } });
  if (input.parentResource && input.parentResource !== 'customers') {
    const link = visitLinks(actor).find((l) => l.resource === input.parentResource && l.id === input.parentId);
    if (!link || (input.customerId && link.customerId !== input.customerId)) throw new ServiceError('validation', E.linkUnavailable, { fieldErrors: { parentId: E.linkUnavailable } });
  }
  if (input.source === 'mock_app') {
    recordMockAttempt(actor, input.at, AU.mockWhat.visit);
    throw new ServiceError('validation', E.mockVisit);
  }
  return commit((d) => {
    const ctx = ctxOf(d, actor);
    const v = insertRecordIn(ctx, 'fieldVisits', {
      siteLabel: input.siteLabel.trim(),
      customerId: input.customerId || null,
      employeeId: actor.staffId,
      purpose: input.purpose,
      plannedFor: input.at.slice(0, 10),
      status: 'completed',
      checkInAt: input.at,
      checkOutAt: input.at,
      checkInLat: input.point.lat,
      checkInLng: input.point.lng,
      locationSource: input.source,
      remarks: input.remarks ?? '',
      nextAction: input.nextAction ?? '',
      nextActionDate: input.nextActionDate || null,
      parentResource: input.parentResource ?? (input.customerId ? 'customers' : ''),
      parentId: input.parentId ?? input.customerId ?? '',
      parentLabel: input.parentLabel ?? input.siteLabel,
    });
    logVisitActivity(ctx, v);
    markBeat(ctx, v);
    return v;
  });
}

function ownVisit(actor: Actor, id: string) {
  const v = recs('fieldVisits').find((x) => x.id === id);
  if (!v || v.employeeId !== actor.staffId) throw new ServiceError('not_found', E.visitNotFound);
  return v;
}

export function startVisit(actor: Actor, id: string, at: string, point: Point, source: LocationSource) {
  const v = ownVisit(actor, id);
  if (v.status !== 'planned') throw new ServiceError('invalid_state', E.onlyPlanned);
  const atSite = recs('fieldVisits').find((x) => x.employeeId === actor.staffId && x.status === 'in_progress');
  if (atSite) throw new ServiceError('invalid_state', E.alreadyAtSite(String(atSite.siteLabel)));
  if (source === 'mock_app') {
    recordMockAttempt(actor, at, AU.mockWhat.visit);
    throw new ServiceError('validation', E.mockVisitCheckIn);
  }
  return commit((d) => patchRecordIn(ctxOf(d, actor), 'fieldVisits', id, { status: 'in_progress', checkInAt: at, checkInLat: point.lat, checkInLng: point.lng, locationSource: source }, AU.atSite));
}

export function completeVisit(actor: Actor, id: string, input: { at: string; remarks: string; nextAction?: string; nextActionDate?: string | null }) {
  const v = ownVisit(actor, id);
  if (v.status !== 'in_progress') throw new ServiceError('invalid_state', E.checkInFirst);
  if (!input.remarks.trim()) throw new ServiceError('validation', E.remarksFirst, { fieldErrors: { remarks: E.required } });
  if (input.nextActionDate && input.nextActionDate < todayKey()) throw new ServiceError('validation', E.nextDatePast, { fieldErrors: { nextActionDate: E.cannotBePast } });
  return commit((d) => {
    const ctx = ctxOf(d, actor);
    const next = patchRecordIn(ctx, 'fieldVisits', id, { status: 'completed', checkOutAt: input.at, remarks: input.remarks.trim(), nextAction: input.nextAction ?? '', nextActionDate: input.nextActionDate || null }, AU.leftSite);
    logVisitActivity(ctx, next);
    markBeat(ctx, next);
    return next;
  });
}

export interface VisitLink {
  resource: 'leads' | 'opportunities' | 'tickets';
  id: string;
  label: string;
  customerId: string;
}

/** Records a visit can be linked to (ATT-05): open leads, opportunities and tickets the actor can see. */
const LINKABLE: { resource: VisitLink['resource']; closed: string[]; status: string; title?: string }[] = [
  { resource: 'leads', closed: ['qualified', 'disqualified'], status: 'status' },
  { resource: 'opportunities', closed: ['won', 'lost'], status: 'stage', title: 'name' },
  { resource: 'tickets', closed: ['closed', 'cancelled'], status: 'status', title: 'description' },
];

export function visitLinks(actor: Actor): VisitLink[] {
  return LINKABLE.flatMap(({ resource, closed, status, title }) => {
    if (perm(actor, resource).read === 'none' || !getDb().records[resource]) return [];
    return queryRecords(actor, resource, {})
      .rows.filter((r) => r.customerId && !closed.includes(String(r[status])))
      .map((r) => {
        const t = title ? String(r[title] ?? '').trim() : '';
        return { resource, id: r.id, customerId: String(r.customerId), label: t ? `${r.id} · ${t.length > 60 ? `${t.slice(0, 59)}…` : t}` : r.id };
      });
  });
}

export function myVisits(actor: Actor) {
  const today = todayKey();
  const mine = recs('fieldVisits').filter((v) => v.employeeId === actor.staffId);
  return {
    links: visitLinks(actor),
    active: mine.filter((v) => v.status === 'in_progress'),
    planned: mine.filter((v) => v.status === 'planned' && String(v.plannedFor) <= addDays(today, 7)).sort((a, b) => String(a.plannedFor).localeCompare(String(b.plannedFor))),
    recent: mine
      .filter((v) => v.status === 'completed')
      .sort((a, b) => String(b.checkOutAt ?? b.plannedFor).localeCompare(String(a.checkOutAt ?? a.plannedFor)))
      .slice(0, 10),
    customers: (getDb().records.customers ?? [])
      .filter((c) => c.workspaceId === actor.workspaceId && c.status !== 'inactive')
      .map((c) => ({ id: c.id, name: String(c.name), mine: c.ownerId === actor.staffId }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------- beat plan (ATT-06)

export interface BeatRow {
  employee: RecordData;
  planned: RecordData[];
  visited: number;
  missed: number;
  pending: number;
  unplanned: number;
}

export function beatPlanVsActual(actor: Actor, weekStart: string): { mine: RecordData[]; team: BeatRow[] } {
  const ws = startOfWeek(weekStart);
  const we = addDays(ws, 7);
  const today = todayKey();
  const inWeek = (d: unknown) => typeof d === 'string' && d >= ws && d < we;
  const people = employeesInScope(actor).filter((e) => isFieldRole(e.roleId) || e.id === actor.staffId);
  const team = people.map((employee) => {
    const planned = recs('beatPlans').filter((b) => b.employeeId === employee.id && inWeek(b.date));
    const visits = recs('fieldVisits').filter((v) => v.employeeId === employee.id && v.status === 'completed' && inWeek(String(v.checkInAt ?? v.plannedFor).slice(0, 10)));
    const visited = planned.filter((b) => b.status === 'visited').length;
    const missed = planned.filter((b) => b.status !== 'visited' && String(b.date) < today).length;
    return { employee, planned, visited, missed, pending: planned.length - visited - missed, unplanned: Math.max(0, visits.length - visited) };
  });
  const mine = recs('beatPlans')
    .filter((b) => b.employeeId === actor.staffId && inWeek(b.date))
    .map((b): RecordData => ({ ...b, status: b.status !== 'visited' && String(b.date) < today ? 'missed' : b.status }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { mine, team: team.filter((r) => r.planned.length || r.unplanned || r.employee.id === actor.staffId) };
}

// ---------------------------------------------------------------- expenses (ATT-08)

/** Fills km from the tracked route of the claim date (BR-46 distance-based conveyance). */
export function trackedKmFor(staffId: string, date: string): number | null {
  const a = attendanceOn(staffId, date);
  return a?.distanceKm === undefined || a?.distanceKm === null ? null : Number(a.distanceKm);
}

/** Accounts: export approved claims as a payroll CSV and mark them exported. */
export function exportApprovedClaims(actor: Actor, ids: string[]): string {
  if (!can(actor, 'expense.export')) throw new ServiceError('forbidden', E.onlyAccounts);
  const claims = recs('expenseClaims').filter((c) => ids.includes(c.id) && c.status === 'approved');
  if (!claims.length) throw new ServiceError('validation', E.selectApproved);
  const at = nowIso();
  commit((d) => {
    const ctx = ctxOf(d, actor);
    claims.forEach((c) => patchRecordIn(ctx, 'expenseClaims', c.id, { status: 'exported', exportedAt: nowLocal() }, AU.exported));
    appendAudit(d, actor, { action: 'export', resource: 'expenseClaims', summary: AU.exportSummary(claims.length, at.slice(0, 10)), correlationId: ctx.correlationId });
  });
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const CSV = L.field.csv;
  const header = [CSV.claim, CSV.userId, CSV.user, CSV.date, CSV.type, CSV.km, CSV.amount, CSV.description];
  const lines = claims.map((c) => [c.id, c.employeeId, employeeOf(c.employeeId)?.fullName, c.claimDate, masterLabel('expenseType', c.expenseType), c.km ?? '', Number(c.amount).toFixed(2), c.description].map(esc).join(','));
  return [header.map(esc).join(','), ...lines].join('\n');
}

export function approvedClaims(actor: Actor): RecordData[] {
  if (!can(actor, 'expense.export')) throw new ServiceError('forbidden', E.onlyAccounts);
  return recs('expenseClaims')
    .filter((c) => c.workspaceId === actor.workspaceId && c.status === 'approved')
    .map((c): RecordData => ({ ...c, employeeName: employeeOf(c.employeeId)?.fullName ?? c.employeeId }))
    .sort((a, b) => String(a.claimDate).localeCompare(String(b.claimDate)));
}

// ---------------------------------------------------------------- targets & achievement (TGT-01 … TGT-05)

/** Owner ids counting towards a target (person, a manager's reporting team, or a division). */
export function targetScopeFn(t: RecordData): (ownerId: unknown, divisionId: unknown) => boolean {
  const emps = recs('employees');
  if (t.scopeType === 'user') return (o) => o === t.employeeId;
  if (t.scopeType === 'team') {
    const team = new Set<string>([String(t.employeeId)]);
    let grew = true;
    while (grew) {
      grew = false;
      emps.forEach((e) => {
        if (team.has(String(e.managerId)) && !team.has(e.id)) {
          team.add(e.id);
          grew = true;
        }
      });
    }
    return (o) => team.has(String(o));
  }
  return (o, div) => (div ? div === t.divisionId : ((employeeOf(o)?.divisionIds as string[] | undefined) ?? []).includes(String(t.divisionId)));
}

const achievementData = () => ({ salesOrders: recs('salesOrders'), paymentMilestones: recs('paymentMilestones'), activities: recs('activities'), products: recs('products') });

export interface AchievementRow {
  target: RecordData;
  actual: number;
  pct: number;
  label: string;
  members: { employee: RecordData; actual: number }[];
}

/** TGT-02: target vs actual for targets the actor can see in a period, with per-person drill-down. */
export function achievement(actor: Actor, periodType: string, periodStart: string): AchievementRow[] {
  if (perm(actor, 'targets').read === 'none') throw new ServiceError('forbidden', L.targets.errors.noTargetsRead);
  const data = achievementData();
  const visible = queryRecords(actor, 'targets', {}).rows.filter((t) => t.periodType === periodType && t.periodStart === periodStart);
  return visible.map((t) => {
    const actual = achievementFor(t as never, data, targetScopeFn(t));
    const inScope = targetScopeFn(t);
    const members = t.scopeType === 'user' ? [] : recs('employees').filter((e) => inScope(e.id, undefined) && FIELD_ROLES.concat(['division_head']).includes(String(e.roleId)));
    return {
      target: t,
      actual,
      pct: Number(t.targetValue) ? Math.round((actual / Number(t.targetValue)) * 100) : 0,
      label: periodLabel(periodType, periodStart),
      members: members.map((employee) => ({ employee, actual: achievementFor(t as never, data, (o, div) => o === employee.id && (t.scopeType !== 'division' || !div || div === t.divisionId)) })).sort((a, b) => b.actual - a.actual),
    };
  });
}

/** CSV of achievement rows (TGT-05 export for incentive processing). */
/** TGT-05 export, audit-logged like every export (ADM-07). */
export function exportAchievement(actor: Actor, rows: AchievementRow[], period: string): string {
  if (!perm(actor, 'targets').export) throw new ServiceError('forbidden', L.targets.errors.noExport);
  commit((d) => appendAudit(d, actor, { action: 'export', resource: 'targets', summary: L.targets.audit.achievementExported(rows.length, period), correlationId: uid('cor') }));
  return achievementCsv(rows);
}

export function achievementCsv(rows: AchievementRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const T = L.targets.csv;
  const head = [T.target, T.for, T.division, T.period, T.metric, T.productType, T.targetValue, T.actual, T.pct];
  const lines = rows.map((r) =>
    [r.target.name, r.target.scopeType === 'division' ? masterLabel('division', r.target.divisionId) : employeeOf(r.target.employeeId)?.fullName, masterLabel('division', r.target.divisionId), r.label, masterLabel('targetMetric', r.target.metric), r.target.productCategory ? masterLabel('productType', r.target.productCategory) : T.allProducts, r.target.targetValue, r.actual, r.pct]
      .map(esc)
      .join(','),
  );
  return [head.map(esc).join(','), ...lines].join('\n');
}

export interface ScoreRow {
  employee: RecordData;
  calls: number;
  visits: number;
  demos: number;
  quotations: number;
  referrals: number;
  total: number;
}

/** TGT-03: weekly activity scorecard per person in scope, generated from CRM data. */
export function scorecard(actor: Actor, weekStart: string): ScoreRow[] {
  if (perm(actor, 'targets').read === 'none') throw new ServiceError('forbidden', L.targets.errors.noTargetsRead);
  const ws = startOfWeek(weekStart);
  const people = employeesInScope(actor).filter((e) => isFieldRole(e.roleId) || ['service_head', 'division_head', 'coordinator'].includes(String(e.roleId)) || e.id === actor.staffId);
  // 3.1: one calculation shared with the Business Scorecard (services/reports/kpis.activityScorecard).
  const counts = activityScorecard({ activities: recs('activities'), fieldVisits: recs('fieldVisits'), demos: recs('demos'), quotations: recs('quotations'), leads: recs('leads'), from: ws, to: addDays(ws, 6) });
  return people
    .map((employee) => {
      const c = counts.get(String(employee.id)) ?? { calls: 0, visits: 0, demos: 0, quotations: 0, referrals: 0 };
      return { employee, ...c, total: scoreTotal(c) };
    })
    .sort((a, b) => b.total - a.total);
}

export type BadgeKey = keyof typeof L.targets.badges;

export interface Leaderboard {
  divisions: string[];
  division: string;
  month: string;
  ranking: { employee: RecordData; orderValue: number; orders: number; targetPct: number | null; badges: BadgeKey[] }[];
  dealOfTheMonth: { orderId: string; orderNo: string; customer: string; value: number; owner: RecordData | undefined } | null;
}

/** TGT-04: ranking within a division for a month, Deal of the Month and badges. Aggregates only. */
export function leaderboard(actor: Actor, divisionId: string | null, monthStart: string): Leaderboard {
  if (perm(actor, 'targets').read === 'none') throw new ServiceError('forbidden', L.targets.errors.noTargetsRead);
  const all = perm(actor, 'targets').read === 'all' || can(actor, 'field.team');
  const divisions = all && ['admin', 'management', 'accounts'].includes(actor.role.id) ? ['TX', 'INK', 'POD', 'LBL', 'PPR', 'FAB'] : actor.divisionIds;
  const division = divisionId && divisions.includes(divisionId) ? divisionId : divisions[0];
  const { from, to } = periodRange('month', monthStart);
  const inMonth = (d: unknown) => typeof d === 'string' && d.slice(0, 10) >= from && d.slice(0, 10) < to;
  const people = recs('employees').filter((e) => ((e.divisionIds as string[]) ?? []).includes(division) && FIELD_ROLES.includes(String(e.roleId)) && e.status !== 'inactive');
  const orders = recs('salesOrders').filter((o) => BOOKED.includes(String(o.status)) && o.divisionId === division && inMonth(o.orderDate));
  const acts = recs('activities').filter((a) => inMonth(a.at));
  const visits = recs('fieldVisits').filter((v) => v.status === 'completed' && inMonth(v.checkOutAt ?? v.checkInAt));
  const refs = recs('leads').filter((l) => inMonth(l.createdAt) && l.referrerEmployeeId);
  const data = achievementData();
  const ranking = people
    .map((employee) => {
      const mine = orders.filter((o) => o.ownerId === employee.id);
      const target = recs('targets').find((t) => t.scopeType === 'user' && t.employeeId === employee.id && t.periodType === 'month' && t.periodStart === from && t.metric === 'order_value');
      const orderValue = Math.round(mine.reduce((s, o) => s + orderNetValue(o), 0));
      const targetPct = target ? Math.round((achievementFor(target as never, data, (o) => o === employee.id) / Number(target.targetValue)) * 100) : null;
      return { employee, orderValue, orders: mine.length, targetPct, badges: [] as BadgeKey[], acts: acts.filter((a) => a.byId === employee.id).length, visits: visits.filter((v) => v.employeeId === employee.id).length, refs: refs.filter((l) => l.referrerEmployeeId === employee.id).length };
    })
    .sort((a, b) => b.orderValue - a.orderValue || (b.targetPct ?? 0) - (a.targetPct ?? 0));
  const award = (key: 'acts' | 'visits' | 'refs', badge: BadgeKey) => {
    const best = [...ranking].sort((a, b) => b[key] - a[key])[0];
    if (best && best[key] > 0) best.badges.push(badge);
  };
  if (ranking[0]?.orderValue > 0) ranking[0].badges.push('topPerformer');
  ranking.filter((r) => (r.targetPct ?? 0) >= 100).forEach((r) => r.badges.push('targetAchieved'));
  award('acts', 'activityChampion');
  award('visits', 'roadWarrior');
  award('refs', 'referralStar');
  const top = [...orders].sort((a, b) => orderNetValue(b) - orderNetValue(a))[0];
  return {
    divisions,
    division,
    month: from,
    ranking: ranking.map(({ employee, orderValue, orders: n, targetPct, badges }) => ({ employee, orderValue, orders: n, targetPct, badges })),
    dealOfTheMonth: top ? { orderId: top.id, orderNo: String(top.orderNo ?? top.id), customer: String(recs('customers').find((c) => c.id === top.customerId)?.name ?? top.customerId), value: Math.round(orderNetValue(top)), owner: employeeOf(top.ownerId) } : null,
  };
}
