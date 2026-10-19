/**
 * Field & performance demo data: 30 days of attendance (late, early, half-day, absent, on tour,
 * leave), tracked routes, ~150 field visits, beat plans, expense claims in every status, leave and
 * regularisation requests, and targets for the current month / quarter / financial year.
 * Labels are built locally — the registry is not available while the store is being seeded.
 */
import type { RecordData } from '../metadata/types';
import { addDays, startOfWeek } from '../lib/dates';
import type { Approval } from '../services/types'; // type-only: erased at runtime
import { attendanceMetrics, conveyanceAmount, expenseLimit, isOfficeRole, managerLevel, OFFICE, periodStartFor, type Point, routeDistanceKm, TERRITORY_CENTRES } from '../domain/modules/field/rules';
import type { SeedContext } from './context';

export const rev = 1;

/** Default shift and conveyance policy (same values as services/policies.ts defaults; seeds must not import services). */
const SHIFT = { start: '09:30', end: '18:30', graceMin: 15, halfDayHours: 4.5 };
const RATES = { twoWheeler: 4, car: 9 };
const pad = (n: number) => String(n).padStart(2, '0');
const at = (date: string, minutes: number) => `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const isSunday = (d: string) => new Date(`${d}T12:00:00`).getDay() === 0;
const PURPOSE = ['prospecting', 'follow_up', 'demo', 'collection'];
const SITES = ['Shree Balaji Prints', 'Navkar Textile Mills', 'Kalpana Creations', 'Ganpati Label House', 'Metro Paper Traders', 'Rajlaxmi Fabrics', 'Sai Krupa Digital', 'Vardhman Print Hub'];
const LABEL = {
  metric: { order_value: 'Order value (₹)', quantity: 'Quantity (units)', collections: 'Collections (₹)', new_customers: 'New customers', activities: 'Activities logged' } as Record<string, string>,
  division: { TX: 'Textile', INK: 'Ink', POD: 'Commercial – POD', LBL: 'Commercial – Label', PPR: 'Paper', FAB: 'Fabric' } as Record<string, string>,
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function periodText(type: string, start: string) {
  const [y, m] = start.split('-').map(Number);
  if (type === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (type === 'year') return `FY ${y}-${String(y + 1).slice(2)}`;
  const fy = m >= 4 ? y : y - 1;
  return `Q${m >= 4 ? (m - 4) / 3 + 1 : 4} FY ${fy}-${String(fy + 1).slice(2)}`;
}

export function seed(ctx: SeedContext): void {
  const { rnd, today, users } = ctx;
  const R = (k: string) => (ctx.records[k] ??= []);
  const employees = R('employees');
  const emp = (staffId: string) => employees.find((e) => e.id === staffId);
  const approvals = (ctx as SeedContext & { approvals?: Approval[] }).approvals;
  const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const jitter = (p: Point, d: number): Point => ({ lat: Math.round((p.lat + (rnd.next() - 0.5) * d) * 1e5) / 1e5, lng: Math.round((p.lng + (rnd.next() - 0.5) * d) * 1e5) / 1e5 });
  const homeOf = (staffId: string): Point & { label: string } => {
    const e = emp(staffId);
    if (!e || isOfficeRole(String(e.roleId))) return { ...OFFICE };
    return TERRITORY_CENTRES[((e.territoryIds as string[]) ?? [])[0]] ?? TERRITORY_CENTRES.mumbai;
  };
  const customers = ctx.records.customers ?? [];
  const customersFor = (staffId: string) => {
    const e = emp(staffId);
    const divs = (e?.divisionIds as string[]) ?? [];
    const own = customers.filter((c) => c.ownerId === staffId);
    const div = customers.filter((c) => ((c.divisionIds as string[]) ?? []).some((d) => divs.includes(d)));
    return own.length ? own : div.length ? div : customers;
  };
  const pickSite = (staffId: string) => {
    const list = customersFor(staffId);
    if (list.length) {
      const c = rnd.pick(list);
      return { customerId: c.id, siteLabel: String(c.name) };
    }
    return { customerId: null, siteLabel: rnd.pick(SITES) };
  };
  const addApproval = (a: Omit<Approval, 'id' | 'workspaceId' | 'currentLevel' | 'decisions' | 'status' | 'version'>) => {
    if (!approvals) return false;
    ctx.counters.approvals = (ctx.counters.approvals ?? 1000) + 1;
    approvals.push({ ...a, id: `APR-${ctx.counters.approvals}`, workspaceId: 'tc', currentLevel: 0, decisions: [], status: 'pending', version: 1 });
    return true;
  };

  const people = users.filter((u) => !['admin', 'management'].includes(u.roleId));
  const fieldPeople = people.filter((u) => ['sales_exec', 'sales_manager', 'engineer'].includes(u.roleId));

  // ---- leave (some approved in the past, one upcoming pending, one rejected)
  const leaves = R('leaves');
  const leaveDays = new Map<string, Set<string>>();
  const addLeave = (u: (typeof users)[number], from: string, to: string, status: string, type: string, reason: string) => {
    const id = ctx.nextId('leaves', 'LV');
    leaves.push({ ...ctx.base(Math.max(1, Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000) + 3), u.id), id, employeeId: ctx.staff(u.id), leaveType: type, fromDate: from, toDate: to, reason, status, decisionNote: status === 'rejected' ? 'Month-end closing — please reschedule' : '' });
    if (status === 'approved') for (let d = from; d <= to; d = addDays(d, 1)) leaveDays.set(`${ctx.staff(u.id)}:${d}`, new Set());
    if (status === 'pending') {
      const ok = addApproval({ type: 'leave.request', resource: 'leaves', recordId: id, requestedBy: u.id, requestedAt: ctx.base(1).createdAt, reason, summary: `Leave ${from} to ${to} · ${u.name}`, divisionIds: u.divisions, levels: [managerLevel(u.roleId)] });
      if (!ok) leaves[leaves.length - 1].status = 'approved';
    }
  };
  const lu = (id: string) => users.find((u) => u.id === id)!;
  addLeave(lu('u_karan'), addDays(today, -12), addDays(today, -11), 'approved', 'casual', 'Family function in Navsari');
  addLeave(lu('u_lakshmi'), addDays(today, -6), addDays(today, -6), 'approved', 'sick', 'Fever');
  addLeave(lu('u_deepak'), addDays(today, -20), addDays(today, -18), 'approved', 'earned', 'Annual vacation');
  addLeave(lu('u_sneha'), addDays(today, 8), addDays(today, 9), 'pending', 'casual', 'Sister’s wedding');
  addLeave(lu('u_ravi'), addDays(today, 4), addDays(today, 4), 'rejected', 'casual', 'Personal work');
  addLeave(lu('u_pooja'), addDays(today, 15), addDays(today, 19), 'pending', 'earned', 'Trip to Kerala');

  // ---- attendance (last 30 days + today) with tracked routes for field staff
  const attendance = R('attendance');
  const visits = R('fieldVisits');
  const activities = R('activities');
  const routeDays = new Map<string, number>(); // staff:date → km
  for (const u of people) {
    const staffId = ctx.staff(u.id);
    const home = homeOf(staffId);
    const field = ['sales_exec', 'sales_manager', 'engineer'].includes(u.roleId);
    for (let back = 30; back >= 0; back--) {
      const date = addDays(today, -back);
      if (isSunday(date)) continue;
      const base = ctx.base(back, u.id);
      if (leaveDays.has(`${staffId}:${date}`)) {
        attendance.push({ ...base, id: ctx.nextId('attendance', 'ATT'), employeeId: staffId, date, status: 'leave', lateByMin: 0, earlyByMin: 0 });
        continue;
      }
      const r = rnd.next();
      if (back > 0 && r < 0.04) continue; // absent, no record → exception
      if (back === 0 && (nowMin < 9 * 60 + 5 || rnd.chance(0.3))) continue; // not yet checked in today
      const onTour = u.roleId === 'engineer' && rnd.chance(0.1);
      const late = rnd.chance(0.15);
      const inMin = late ? rnd.int(9 * 60 + 50, 10 * 60 + 40) : rnd.int(9 * 60 + 5, 9 * 60 + 42);
      const kind = rnd.next();
      let outMin = kind < 0.04 ? rnd.int(13 * 60, 13 * 60 + 45) : kind < 0.12 ? rnd.int(16 * 60 + 30, 17 * 60 + 50) : rnd.int(18 * 60 + 30, 19 * 60 + 20);
      const todayOpen = back === 0;
      if (todayOpen) outMin = 0;
      const checkInAt = at(date, inMin);
      const checkOutAt = todayOpen ? null : at(date, outMin);
      const m = attendanceMetrics({ checkInAt, checkOutAt, status: onTour ? 'on_tour' : 'present' }, SHIFT);
      const start = field ? jitter(home, 0.03) : jitter(OFFICE, 0.0012);
      const points: (Point & { at: string })[] = [{ ...start, at: checkInAt }];
      // field staff: visits on most working days (≈ 150 completed visits overall)
      if (field && !todayOpen && back <= 28 && rnd.chance(0.55)) {
        const n = rnd.int(1, 2);
        for (let k = 0; k < n; k++) {
          const site = pickSite(staffId);
          const vIn = Math.min(inMin + 60 + k * 150 + rnd.int(0, 40), outMin - 40);
          const p = jitter(home, 0.12);
          const vid = ctx.nextId('fieldVisits', 'FV', 'fy', new Date(`${date}T12:00:00`));
          const purpose = u.roleId === 'engineer' ? 'service' : rnd.pick(PURPOSE);
          const remarks = u.roleId === 'engineer' ? rnd.pick(['Print-head alignment done, test print OK', 'Checked ink supply line, customer trained', 'PM checklist completed']) : rnd.pick(['Discussed upgrade to 8-head machine', 'Shared revised quotation', 'Customer asked for sample prints on polyester', 'Collected cheque for advance', 'Met purchase head, decision next month']);
          const nextAction = rnd.chance(0.6) ? rnd.pick(['Send quotation', 'Arrange demo at Surat demo centre', 'Follow up on PO', 'Share ink price list', 'Schedule PM visit']) : '';
          const visit: RecordData = {
            ...base,
            id: vid,
            ...site,
            employeeId: staffId,
            purpose,
            plannedFor: date,
            status: 'completed',
            checkInAt: at(date, vIn),
            checkOutAt: at(date, vIn + rnd.int(25, 70)),
            checkInLat: p.lat,
            checkInLng: p.lng,
            locationSource: 'device',
            remarks,
            nextAction,
            nextActionDate: nextAction ? addDays(date, rnd.int(3, 12)) : null,
            parentResource: site.customerId ? 'customers' : '',
            parentId: site.customerId ?? '',
            parentLabel: site.siteLabel,
          };
          visits.push(visit);
          points.push({ ...p, at: String(visit.checkInAt) });
          activities.push({
            ...base,
            id: ctx.nextId('activities', 'ACT'),
            subject: `${purpose === 'service' ? 'Service' : purpose === 'follow_up' ? 'Follow-up' : purpose[0].toUpperCase() + purpose.slice(1)} visit — ${site.siteLabel}`,
            activityType: 'visit',
            at: visit.checkOutAt,
            byId: staffId,
            parentLabel: site.siteLabel,
            nextFollowUpAt: visit.nextActionDate,
            notes: remarks,
            parentResource: visit.parentResource || 'fieldVisits',
            parentId: visit.parentId || vid,
            customerId: site.customerId ?? undefined,
          });
        }
      }
      if (checkOutAt) points.push({ ...(field ? jitter(home, 0.03) : jitter(OFFICE, 0.0012)), at: checkOutAt });
      const km = field && points.length > 1 ? routeDistanceKm(points) : null;
      if (km) routeDays.set(`${staffId}:${date}`, km);
      attendance.push({
        ...base,
        id: ctx.nextId('attendance', 'ATT'),
        employeeId: staffId,
        date,
        status: m.status,
        checkInAt,
        checkOutAt,
        workMinutes: m.workMinutes,
        lateByMin: m.lateByMin,
        earlyByMin: m.earlyByMin,
        checkInLat: start.lat,
        checkInLng: start.lng,
        checkInPlace: field ? `${home.label} (device GPS)` : OFFICE.label,
        locationSource: 'device',
        insideGeofence: !field,
        mockLocation: false,
        selfie: rnd.chance(0.5),
        distanceKm: km,
        routePoints: field ? points : [points[0]],
      });
    }
  }

  // ---- planned visits (next 7 days) and beat plans (this and next week)
  const beatPlans = R('beatPlans');
  for (const u of fieldPeople) {
    const staffId = ctx.staff(u.id);
    for (let k = 0; k < rnd.int(1, 2); k++) {
      const date = addDays(today, rnd.int(0, 6));
      if (isSunday(date)) continue;
      const site = pickSite(staffId);
      visits.push({ ...ctx.base(2, u.id), id: ctx.nextId('fieldVisits', 'FV', 'fy'), ...site, employeeId: staffId, purpose: u.roleId === 'engineer' ? 'service' : rnd.pick(PURPOSE), plannedFor: date, status: 'planned', parentResource: site.customerId ? 'customers' : '', parentId: site.customerId ?? '', parentLabel: site.siteLabel, remarks: '', nextAction: '' });
    }
    if (u.roleId === 'engineer') continue;
    for (const week of [startOfWeek(today), addDays(startOfWeek(today), 7)]) {
      for (let k = 0; k < rnd.int(3, 5); k++) {
        const date = addDays(week, rnd.int(0, 5));
        const site = pickSite(staffId);
        const visited = date < today && visits.some((v) => v.employeeId === staffId && v.status === 'completed' && String(v.checkInAt).startsWith(date) && v.siteLabel === site.siteLabel);
        beatPlans.push({ ...ctx.base(Math.max(1, Math.round((Date.parse(today) - Date.parse(week)) / 86_400_000) + 2), u.id), id: ctx.nextId('beatPlans', 'BP'), ...site, employeeId: staffId, date, weekStart: week, purpose: rnd.pick(PURPOSE), status: visited ? 'visited' : 'planned' });
      }
    }
  }

  // ---- regularisations
  const regs = R('regularisations');
  const addReg = (uid: string, back: number, status: string, reason: string) => {
    const u = lu(uid);
    const staffId = ctx.staff(uid);
    const date = isSunday(addDays(today, -back)) ? addDays(today, -back - 1) : addDays(today, -back);
    const id = ctx.nextId('regularisations', 'REG');
    const reqIn = at(date, 9 * 60 + 20);
    const reqOut = at(date, 18 * 60 + 40);
    regs.push({ ...ctx.base(back, uid), id, employeeId: staffId, date, requestedCheckIn: reqIn, requestedCheckOut: reqOut, reason, status, decisionNote: status === 'rejected' ? 'GPS shows check-in at 11:05 — not approved' : '' });
    if (status === 'approved') {
      const a = attendance.find((x) => x.employeeId === staffId && x.date === date);
      const m = attendanceMetrics({ checkInAt: reqIn, checkOutAt: reqOut, status: 'present' }, SHIFT);
      if (a) Object.assign(a, { checkInAt: reqIn, checkOutAt: reqOut, workMinutes: m.workMinutes, lateByMin: m.lateByMin, earlyByMin: m.earlyByMin, status: m.status, regularised: true });
      else attendance.push({ ...ctx.base(back, uid), id: ctx.nextId('attendance', 'ATT'), employeeId: staffId, date, checkInAt: reqIn, checkOutAt: reqOut, workMinutes: m.workMinutes, lateByMin: 0, earlyByMin: 0, status: m.status, regularised: true, checkInPlace: 'Regularised (no GPS)', locationSource: 'regularisation' });
    }
    if (status === 'pending' && !addApproval({ type: 'attendance.regularisation', resource: 'regularisations', recordId: id, requestedBy: uid, requestedAt: ctx.base(back).createdAt, reason, summary: `Attendance correction ${date} · ${u.name}`, divisionIds: u.divisions, levels: [managerLevel(u.roleId)] })) regs[regs.length - 1].status = 'approved';
  };
  addReg('u_farhan', 9, 'approved', 'Phone battery dead, could not check in at customer site');
  addReg('u_ajay', 5, 'approved', 'App did not open in low network area (Ludhiana industrial area)');
  addReg('u_imran', 7, 'rejected', 'Forgot to check in');
  addReg('u_karan', 2, 'pending', 'Checked in from customer site but GPS failed');
  addReg('u_meera', 3, 'pending', 'Network outage at office in the morning');

  // ---- expense claims (all statuses)
  const claims = R('expenseClaims');
  const STATUS_MIX = ['draft', 'submitted', 'submitted', 'approved', 'approved', 'exported', 'exported', 'exported', 'rejected', 'approved'];
  let n = 0;
  for (const [key, km] of [...routeDays.entries()].sort(() => rnd.next() - 0.5)) {
    if (n >= 30) break;
    const [staffId, date] = key.split(':');
    const u = users.find((x) => x.staffIds.tc === staffId)!;
    const vehicle = u.roleId === 'sales_manager' ? 'car' : rnd.pick(['two_wheeler', 'two_wheeler', 'car']);
    const amount = conveyanceAmount(km, vehicle, RATES);
    const limit = expenseLimit('conveyance', vehicle, RATES);
    claims.push(makeClaim(staffId, u.id, date, { description: `Local conveyance — customer visits`, expenseType: 'conveyance', vehicleType: vehicle, km, amount, policyLimit: limit, justification: amount > limit ? 'Visited three customers across the industrial belt on the same day' : '' }));
    n++;
  }
  const OTHER: [string, string, number, number][] = [
    ['food', 'Lunch with customer team', 350, 900],
    ['lodging', 'Hotel stay — outstation installation', 2200, 4200],
    ['travel', 'Train fare Mumbai–Surat', 650, 1400],
    ['other', 'Courier of sample prints', 250, 600],
  ];
  for (let k = 0; k < 12; k++) {
    const u = rnd.pick(fieldPeople);
    const [type, desc, lo, hi] = rnd.pick(OTHER);
    const amount = rnd.int(lo, hi);
    const limit = expenseLimit(type, 'two_wheeler', RATES);
    const date = addDays(today, -rnd.int(2, 26));
    claims.push(makeClaim(ctx.staff(u.id), u.id, isSunday(date) ? addDays(date, -1) : date, { description: desc, expenseType: type, amount, policyLimit: limit, billFileName: `bill-${type}-${k + 1}.pdf`, justification: amount > limit ? 'Only hotel available near the customer site' : '' }));
  }
  function makeClaim(staffId: string, userId: string, date: string, v: Record<string, unknown>): RecordData {
    const back = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
    let status = STATUS_MIX[claims.length % STATUS_MIX.length];
    if (back < 4 && ['exported'].includes(status)) status = 'approved';
    const id = ctx.nextId('expenseClaims', 'EXP', 'fy', new Date(`${date}T12:00:00`));
    if (status === 'submitted') {
      const u = users.find((x) => x.id === userId)!;
      const ok = addApproval({ type: 'expense.claim', resource: 'expenseClaims', recordId: id, requestedBy: userId, requestedAt: ctx.base(Math.max(0, back - 1)).createdAt, reason: String(v.justification ?? ''), summary: `${id} · ₹${Number(v.amount).toLocaleString('en-IN')} · ${u.name}`, amount: Number(v.amount), divisionIds: u.divisions, levels: [managerLevel(u.roleId), { capability: 'approve.finance', label: 'Accounts' }] });
      if (!ok) status = 'draft';
    }
    return { ...ctx.base(Math.max(0, back - 1), userId), id, employeeId: staffId, claimDate: date, status, exportedAt: status === 'exported' ? at(addDays(date, 3), 17 * 60) : null, ...v };
  }

  // ---- targets: current month, quarter and financial year
  const targets = R('targets');
  const month = periodStartFor('month', today);
  const quarter = periodStartFor('quarter', today);
  const year = periodStartFor('year', today);
  const addTarget = (scopeType: string, staffId: string | null, divisionId: string, periodType: string, periodStart: string, metric: string, targetValue: number, owner = 'u_rahul') => {
    const who = scopeType === 'division' ? LABEL.division[divisionId] : `${emp(staffId!)?.fullName ?? ''}${scopeType === 'team' ? ' (team)' : ''}`;
    targets.push({ ...ctx.base(25, owner), id: ctx.nextId('targets', 'TGT'), name: `${who} · ${LABEL.metric[metric]} · ${periodText(periodType, periodStart)}`, scopeType, employeeId: staffId, divisionId, periodType, periodStart, metric, targetValue, productCategory: null });
  };
  const lakh = (a: number, b: number) => rnd.int(a, b) * 100_000;
  for (const u of users.filter((x) => x.roleId === 'sales_exec')) {
    const s = ctx.staff(u.id);
    const div = u.divisions[0];
    addTarget('user', s, div, 'month', month, 'order_value', lakh(25, 60), 'u_rohan');
    addTarget('user', s, div, 'quarter', quarter, 'order_value', lakh(90, 170), 'u_rohan');
    addTarget('user', s, div, 'month', month, 'activities', rnd.int(50, 80), 'u_rohan');
    addTarget('user', s, div, 'quarter', quarter, 'new_customers', rnd.int(3, 6), 'u_rohan');
  }
  for (const u of users.filter((x) => x.roleId === 'sales_manager')) {
    const s = ctx.staff(u.id);
    const div = u.divisions[0];
    addTarget('user', s, div, 'month', month, 'order_value', lakh(80, 150));
    addTarget('team', s, div, 'quarter', quarter, 'order_value', lakh(300, 500));
    addTarget('team', s, div, 'quarter', quarter, 'collections', lakh(200, 350));
  }
  for (const u of users.filter((x) => x.roleId === 'division_head')) {
    for (const div of u.divisions) {
      addTarget('division', null, div, 'quarter', quarter, 'order_value', lakh(800, 1500), 'u_vikram');
      addTarget('division', null, div, 'quarter', quarter, 'collections', lakh(500, 1000), 'u_vikram');
      addTarget('division', null, div, 'year', year, 'order_value', lakh(3000, 5500), 'u_vikram');
    }
  }
}
