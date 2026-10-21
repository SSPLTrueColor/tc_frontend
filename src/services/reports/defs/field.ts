/** ATT-10 field force reports: attendance (daily · by employee · exceptions) and field visits. */
import { L } from '../../../constants/labels';
import { ROUTES } from '../../../constants/routes';
import { addDays } from '../../../lib/dates';
import { attendanceExceptions } from '../../field/field';
import { dayOf } from '../kpis';
import { applyFilters, empName, groupBy, n, row, s } from '../helpers';
import { count, countIf, ratio, sum as sumOf } from '../metrics';
import type { ReportDef } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const R = L.reports.rep;
const M = L.reports.more;
const X = D.attendanceExceptions;
/** Exception names exactly as on the Exception Dashboard. */
const XK = L.field.pages.exceptionDashboard.kinds;

export const fieldReports: ReportDef[] = [
  {
    id: 'attendance',
    title: R.attendance.title,
    group: 'field-force',
    icon: 'calendar-check',
    fr: ['FR-113'],
    description: R.attendance.description,
    needs: ['attendance'],
    views: [
      {
        id: 'daily',
        label: R.attendance.views.daily,
        filters: { date: 'past', owner: true },
        dateLabel: D.attendanceDaily.dateLabel,
        compute: (ds, f) => {
          const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
          const rows = [...groupBy(at, (a) => dayOf(a.date)).entries()]
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([d, v]) => row(d, { date: d, present: v.filter((a) => a.status === 'present').length, halfDay: v.filter((a) => a.status === 'half_day').length, onTour: v.filter((a) => a.status === 'on_tour').length, leave: v.filter((a) => a.status === 'leave').length, absent: v.filter((a) => a.status === 'absent').length, late: v.filter((a) => n(a.lateByMin) > 0).length }));
          return {
            columns: [
              { key: 'date', label: C.date, type: 'date', link: () => ROUTES.teamAttendance },
              { key: 'present', label: D.attendanceDaily.cols.present, type: 'number', total: 'sum' },
              { key: 'halfDay', label: D.attendanceDaily.cols.halfDay, type: 'number', total: 'sum' },
              { key: 'onTour', label: D.attendanceDaily.cols.onTour, type: 'number', total: 'sum' },
              { key: 'leave', label: D.attendanceDaily.cols.leave, type: 'number', total: 'sum' },
              { key: 'absent', label: D.attendanceDaily.cols.absent, type: 'number', total: 'sum' },
              { key: 'late', label: D.attendanceDaily.cols.late, type: 'number', total: 'sum' },
            ],
            rows,
            // Charts read left to right in time order; the table lists the newest day first.
            points: [...rows].reverse().map((r) => ({ key: r._key, label: s(r.date).slice(5), value: n(r.present) })),
          };
        },
        kpis: [
          { label: R.attendance.kpis.present, fmt: 'number', value: sumOf('present') },
          { label: R.attendance.kpis.onTour, fmt: 'number', value: sumOf('onTour'), better: 'none' },
          { label: D.attendanceDaily.cols.absent, fmt: 'number', value: sumOf('absent'), better: 'down' },
          { label: D.attendanceDaily.cols.late, fmt: 'number', value: sumOf('late'), better: 'down' },
        ],
        chart: { type: 'area', title: R.attendance.chartPresent, x: 'date', y: 'present', fmt: 'number', unit: R.attendance.unit },
      },
      {
        id: 'employee',
        label: R.attendance.views.employee,
        filters: { date: 'past', owner: true },
        dateLabel: D.attendanceMonthly.dateLabel,
        compute: (ds, f) => {
          const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
          return {
            columns: [
              { key: 'employee', label: C.user },
              { key: 'present', label: D.attendanceMonthly.cols.present, type: 'number', total: 'sum' },
              { key: 'halfDay', label: D.attendanceMonthly.cols.halfDay, type: 'number', total: 'sum' },
              { key: 'leave', label: D.attendanceMonthly.cols.leave, type: 'number', total: 'sum' },
              { key: 'lateDays', label: D.attendanceMonthly.cols.lateDays, type: 'number', total: 'sum' },
              { key: 'hours', label: D.attendanceMonthly.cols.hours, type: 'number', total: 'sum' },
              { key: 'km', label: D.attendanceMonthly.cols.km, type: 'number', total: 'sum' },
            ],
            rows: [...groupBy(at, (a) => s(a.employeeId)).entries()]
              .map(([e, v]) => row(e, { employee: empName(ds, e), present: v.filter((a) => a.status === 'present' || a.status === 'on_tour').length, halfDay: v.filter((a) => a.status === 'half_day').length, leave: v.filter((a) => a.status === 'leave').length, lateDays: v.filter((a) => n(a.lateByMin) > 0).length, hours: Math.round(v.reduce((t, a) => t + n(a.workMinutes), 0) / 6) / 10, km: Math.round(v.reduce((t, a) => t + n(a.distanceKm), 0)) }))
              .sort((a, b) => s(a.employee).localeCompare(s(b.employee))),
          };
        },
        kpis: [
          { label: R.attendance.kpis.people, fmt: 'number', value: count, better: 'none' },
          { label: D.attendanceMonthly.cols.present, fmt: 'number', value: sumOf('present') },
          { label: D.attendanceMonthly.cols.lateDays, fmt: 'number', value: sumOf('lateDays'), better: 'down' },
          { label: D.attendanceMonthly.cols.km, fmt: 'number', value: sumOf('km'), better: 'none' },
        ],
        chart: { type: 'hbar', title: D.attendanceMonthly.chart, x: 'employee', y: 'lateDays', fmt: 'number', unit: D.attendanceMonthly.unit },
      },
      {
        id: 'exceptions',
        label: R.attendance.views.exceptions,
        filters: { date: 'past', owner: true },
        dateLabel: X.dateLabel,
        compute: (ds, f, ctx) => {
          // ATT-10: the same rules as the live Exception Dashboard (field.attendanceExceptions), day by day,
          // so the history includes "no check-in" and "no visits logged".
          const to = f.to && f.to < ctx.today ? f.to : ctx.today;
          const from = f.from ?? addDays(to, -29);
          const days: string[] = [];
          for (let d = from; d <= to && days.length < 370; d = addDays(d, 1)) days.push(d);
          const rows = days.flatMap((day) => {
            let found: ReturnType<typeof attendanceExceptions> = [];
            try {
              found = attendanceExceptions(ctx.actor, day);
            } catch {
              found = [];
            }
            return found
              .filter((e) => !f.owner || e.employee.id === f.owner)
              .map((e) => row(`${day}:${e.employee.id}:${e.kind}`, { id: `${day}:${e.employee.id}`, date: day, employee: s(e.employee.fullName) || empName(ds, e.employee.id), exception: XK[e.kind], detail: e.detail }));
          });
          return {
            columns: [
              { key: 'date', label: C.date, type: 'date', link: () => ROUTES.exceptionDashboard },
              { key: 'employee', label: C.user },
              { key: 'exception', label: X.cols.exception },
              { key: 'detail', label: X.cols.detail },
            ],
            rows: rows.sort((a, b) => s(b.date).localeCompare(s(a.date))),
            points: [...groupBy(rows, (r) => s(r.exception)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })),
          };
        },
        kpis: [
          { label: R.attendance.kpis.exceptions, fmt: 'number', value: count, better: 'down' },
          { label: XK.no_check_in, fmt: 'number', value: countIf((r) => r.exception === XK.no_check_in), better: 'down' },
          { label: XK.late, fmt: 'number', value: countIf((r) => r.exception === XK.late), better: 'down' },
          { label: XK.no_visits, fmt: 'number', value: countIf((r) => r.exception === XK.no_visits), better: 'down' },
          { label: XK.not_checked_out, fmt: 'number', value: countIf((r) => r.exception === XK.not_checked_out), better: 'down' },
        ],
        chart: { type: 'donut', title: X.chart, x: 'exception', y: 'id', fmt: 'number', unit: X.unit },
      },
    ],
  },
  {
    id: 'field-visits',
    title: D.fieldVisits.title,
    group: 'field-force',
    icon: 'map-pin',
    fr: ['FR-113', 'FR-108'],
    description: R.visits.description,
    needs: ['fieldVisits'],
    views: [
      {
        id: 'visits',
        label: D.fieldVisits.title,
        filters: { date: 'past', owner: true },
        dateLabel: D.fieldVisits.dateLabel,
        compute: (ds, f) => {
          const vs = applyFilters(ds.get('fieldVisits'), f, { date: 'plannedFor', owner: 'employeeId' });
          return {
            columns: [
              { key: 'employee', label: C.user, link: () => ROUTES.fieldVisits },
              { key: 'planned', label: D.fieldVisits.cols.planned, type: 'number', total: 'sum' },
              { key: 'completed', label: D.fieldVisits.cols.completed, type: 'number', total: 'sum' },
              { key: 'adherence', label: D.fieldVisits.cols.adherence, type: 'pct', total: ratio('completed', 'planned') },
              { key: 'prospecting', label: D.fieldVisits.cols.prospecting, type: 'number', total: 'sum' },
              { key: 'followUp', label: D.fieldVisits.cols.followUp, type: 'number', total: 'sum' },
              { key: 'demo', label: D.fieldVisits.cols.demo, type: 'number', total: 'sum' },
              { key: 'service', label: D.fieldVisits.cols.service, type: 'number', total: 'sum', optional: true },
              { key: 'collection', label: D.fieldVisits.cols.collection, type: 'number', total: 'sum', optional: true },
            ],
            rows: [...groupBy(vs, (v) => s(v.employeeId)).entries()]
              .map(([e, v]) => {
                const done = v.filter((x) => x.status === 'completed');
                return row(e, { employee: empName(ds, e), planned: v.length, completed: done.length, adherence: v.length ? done.length / v.length : null, prospecting: done.filter((x) => x.purpose === 'prospecting').length, followUp: done.filter((x) => x.purpose === 'follow_up').length, demo: done.filter((x) => x.purpose === 'demo').length, service: done.filter((x) => x.purpose === 'service').length, collection: done.filter((x) => x.purpose === 'collection').length });
              })
              .sort((a, b) => n(b.completed) - n(a.completed)),
          };
        },
        kpis: [
          { label: D.fieldVisits.cols.planned, fmt: 'number', value: sumOf('planned'), better: 'none' },
          { label: D.fieldVisits.cols.completed, fmt: 'number', value: sumOf('completed') },
          { label: D.fieldVisits.cols.adherence, fmt: 'pct', value: ratio('completed', 'planned'), hint: R.visits.adherenceHint },
          { label: D.fieldVisits.cols.demo, fmt: 'number', value: sumOf('demo') },
        ],
        chart: { type: 'hbar', title: D.fieldVisits.chart, x: 'employee', y: 'completed', fmt: 'number', unit: D.fieldVisits.unit },
      },
      {
        id: 'hours',
        label: M.hours.view,
        filters: { date: 'past', owner: true },
        dateLabel: D.fieldVisits.dateLabel,
        compute: (ds, f) => {
          // Completed visits by weekday (rows) and hour of check-in (columns): when the field team is out.
          const done = applyFilters(ds.get('fieldVisits'), f, { date: 'plannedFor', owner: 'employeeId' }).filter((v) => v.status === 'completed' && v.checkInAt);
          const slot = (v: Record<string, unknown>) => ({ day: (new Date(`${String(v.checkInAt).slice(0, 10)}T00:00:00`).getDay() + 6) % 7, hour: Number(String(v.checkInAt).slice(11, 13)) });
          const hours = [...new Set(done.map((v) => slot(v).hour))].sort((a, b) => a - b);
          const span = hours.length ? Array.from({ length: hours[hours.length - 1] - hours[0] + 1 }, (_, i) => hours[0] + i) : [];
          const key = (h: number) => `h${String(h).padStart(2, '0')}`;
          const grid = M.hours.days.map((d, di) => {
            const mine = done.filter((v) => slot(v).day === di);
            return row(d, { weekday: d, total: mine.length, ...Object.fromEntries(span.map((h) => [key(h), mine.filter((v) => slot(v).hour === h).length])) });
          });
          return {
            columns: [
              { key: 'weekday', label: M.hours.weekday },
              ...span.map((h) => ({ key: key(h), label: `${String(h).padStart(2, '0')}:00`, type: 'number' as const, total: 'sum' as const })),
              { key: 'total', label: M.hours.total, type: 'number', total: 'sum' },
            ],
            // The table lists only weekdays that had visits; the chart always shows all seven so gaps are visible.
            rows: grid.filter((r) => n(r.total) > 0),
            points: !done.length ? [] : grid.flatMap((r) => span.map((h) => ({ key: `${r._key}-${h}`, label: `${r.weekday} ${String(h).padStart(2, '0')}:00`, value: Number(r[key(h)]), row: String(r.weekday), col: String(h).padStart(2, '0') }))),
          };
        },
        kpis: [
          { label: M.hours.visits, fmt: 'number', value: sumOf('total') },
          { label: M.hours.peakDay, fmt: 'number', value: (rows) => Math.max(0, ...rows.map((r) => Number(r.total) || 0)), better: 'none' },
          { label: M.hours.peakHour, fmt: 'number', value: (rows) => Math.max(0, ...Object.keys(rows[0] ?? {}).filter((k) => /^h\d\d$/.test(k)).map((k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0))), better: 'none' },
        ],
        chart: { type: 'heatmap', title: M.hours.chart, x: 'weekday', y: 'total', fmt: 'number', unit: D.fieldVisits.unit },
      },
    ],
  },
];
