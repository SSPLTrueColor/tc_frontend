/** ATT-10 field force reports: attendance (daily · by employee · exceptions) and field visits. */
import { L } from '../../../constants/labels';
import { ROUTES } from '../../../constants/routes';
import { dayOf } from '../kpis';
import { applyFilters, empName, groupBy, n, row, s } from '../helpers';
import { count, countIf, ratio, sum as sumOf } from '../metrics';
import type { ReportDef } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const R = L.reports.rep;
const X = D.attendanceExceptions;

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
          const at = applyFilters(ds.get('attendance'), f, { date: 'date', owner: 'employeeId' });
          const rows = at.flatMap((a) => {
            const add = (kind: string, detail: string) => row(`${a.id}:${kind}`, { id: a.id, date: a.date, employee: empName(ds, a.employeeId), exception: kind, detail });
            return [
              ...(n(a.lateByMin) > 0 ? [add(X.kinds.late, X.details.late(n(a.lateByMin)))] : []),
              ...(n(a.earlyByMin) > 0 ? [add(X.kinds.early, X.details.early(n(a.earlyByMin)))] : []),
              ...(s(a.checkInAt) && !s(a.checkOutAt) && dayOf(a.date) < ctx.today ? [add(X.kinds.noCheckOut, X.details.noCheckOut)] : []),
              ...(a.mockLocation ? [add(X.kinds.mock, X.details.mock)] : []),
              ...(a.status === 'absent' ? [add(X.kinds.absent, X.details.absent)] : []),
            ];
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
          { label: X.kinds.late, fmt: 'number', value: countIf((r) => r.exception === X.kinds.late), better: 'down' },
          { label: X.kinds.noCheckOut, fmt: 'number', value: countIf((r) => r.exception === X.kinds.noCheckOut), better: 'down' },
          { label: X.kinds.absent, fmt: 'number', value: countIf((r) => r.exception === X.kinds.absent), better: 'down' },
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
    ],
  },
];
