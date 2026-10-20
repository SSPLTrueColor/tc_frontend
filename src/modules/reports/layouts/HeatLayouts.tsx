import { L } from '../../../constants/labels';
import { addDays } from '../../../lib/dates';
import { cx } from '../../../lib/format';
import { formatReportDate } from '../../../services/reports/format';
import { Headline, KpiInline, num, text, type LayoutProps } from './shared';

const W = L.reports.layouts;
const level = (v: number, max: number) => (!v || !max ? 0 : Math.min(4, Math.ceil((v / max) * 4)));

function Legend() {
  return (
    <div className="rl-legend muted" aria-hidden="true">
      {W.less}
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} className={`rl-cell l${l}`} />
      ))}
      {W.moreLabel}
    </div>
  );
}

/** "When": rows × columns (weekday × hour) as a grid shaded by volume. */
export function HeatGrid({ out }: LayoutProps) {
  const pts = out.chart?.points ?? [];
  if (!pts.length) return <p className="rl-empty muted">{W.noData}</p>;
  const rows = [...new Set(pts.map((p) => text(p.row)))];
  const cols = [...new Set(pts.map((p) => text(p.col)))];
  const at = new Map(pts.map((p) => [`${p.row}|${p.col}`, p.value]));
  const max = Math.max(...pts.map((p) => p.value), 0);
  const peak = pts.find((p) => p.value === max);
  return (
    <div className="rl-board">
      {peak && max > 0 && <Headline>{W.heatHead(`${peak.row} ${peak.col}:00`, max)}</Headline>}
      <KpiInline kpis={out.kpis} />
      <div className="rl-heat" style={{ ['--cols' as string]: cols.length }} role="table" aria-label={out.chart?.spec.title}>
        <span />
        {cols.map((c) => (
          <span key={c} className="rl-heat-col muted" role="columnheader">
            {c}
          </span>
        ))}
        {rows.map((r) => (
          <div key={r} className="rl-heat-row" role="row">
            <span className="rl-heat-label muted" role="rowheader">
              {r}
            </span>
            {cols.map((c) => {
              const v = at.get(`${r}|${c}`) ?? 0;
              return <span key={c} role="cell" className={`rl-cell l${level(v, max)}`} data-tooltip={`${r} ${c}:00 — ${v}`} />;
            })}
          </div>
        ))}
      </div>
      <Legend />
    </div>
  );
}

/** Daily attendance as a month calendar: each day shaded by how many people were present, with the count inside. */
export function AttendanceCalendar({ out }: LayoutProps) {
  const days = out.rows.map((r) => ({ day: text(r.date), present: num(r.present), total: num(r.present) + num(r.halfDay) + num(r.onTour) + num(r.leave) + num(r.absent), late: num(r.late), r }));
  if (!days.length) return <p className="rl-empty muted">{W.noData}</p>;
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const lo = Math.min(...sorted.map((d) => d.present));
  const hi = Math.max(...sorted.map((d) => d.present));
  // Shade by where a day sits between the quietest and the busiest day, so small differences are visible.
  const shade = (v: number) => (hi === lo ? 2 : 1 + Math.round(((v - lo) / (hi - lo)) * 3));
  const avg = Math.round(sorted.reduce((t, d) => t + d.present, 0) / sorted.length);
  const worst = [...sorted].sort((a, b) => a.present - b.present)[0];
  const byDay = new Map(sorted.map((d) => [d.day, d]));
  const start = addDays(sorted[0].day, -((new Date(`${sorted[0].day}T00:00:00Z`).getUTCDay() + 6) % 7));
  const end = sorted[sorted.length - 1].day;
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  const monthName = (d: string) => L.calendar.miniMonth.months[+d.slice(5, 7) - 1].slice(0, 3);
  return (
    <div className="rl-board">
      <Headline>{W.attendHead(avg, formatReportDate(worst.day))}</Headline>
      <KpiInline kpis={out.kpis} />
      <div className="rl-cal">
        {L.calendar.miniMonth.weekdays.map((d) => (
          <span key={d} className="rl-cal-dow muted">
            {d}
          </span>
        ))}
        {dates.map((day) => {
          const d = byDay.get(day);
          const label = day.slice(8, 10) === '01' || day === dates[0] ? `${+day.slice(8, 10)} ${monthName(day)}` : `${+day.slice(8, 10)}`;
          return d ? (
            <span
              key={day}
              className={cx('rl-cal-day', `l${shade(d.present)}`)}
              data-tooltip={`${formatReportDate(day)} — ${W.present} ${d.present}, ${W.halfDay} ${num(d.r.halfDay)}, ${W.onTour} ${num(d.r.onTour)}, ${W.leave} ${num(d.r.leave)}, ${W.absent} ${num(d.r.absent)}, ${W.late} ${d.late}`}
            >
              <small>{label}</small>
              <b>{d.present}</b>
            </span>
          ) : (
            <span key={day} className="rl-cal-day is-off">
              <small>{label}</small>
            </span>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}
