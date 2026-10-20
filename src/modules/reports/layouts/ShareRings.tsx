import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { L } from '../../../constants/labels';
import { formatMetric } from '../../../services/reports/format';
import { Headline, KpiInline, type LayoutProps } from './shared';

const W = L.reports.layouts;
const SERIES = ['var(--rp-s1)', 'var(--rp-s2)', 'var(--rp-s3)', 'var(--rp-s4)', 'var(--rp-s5)', 'var(--rp-s6)', 'var(--rp-s7)', 'var(--rp-s8)'];

/** How a total splits: a ring with the total in the middle and a ranked list with each share beside it. */
export function ShareRings({ out, donut = true }: LayoutProps & { donut?: boolean }) {
  const chart = out.chart;
  if (!chart || !chart.points.length) return <p className="rl-empty muted">{W.noData}</p>;
  const { spec, points } = chart;
  const total = points.reduce((t, p) => t + Math.max(0, p.value), 0);
  const f = (v: number, compact = true) => formatMetric(v, spec.fmt, { compact, unit: spec.fmt === 'number' ? undefined : spec.unit });
  const rows = [...points].sort((a, b) => (a.others ? 1 : b.others ? -1 : spec.keepOrder ? 0 : b.value - a.value));
  const top = rows[0];
  const max = Math.max(...rows.map((p) => p.value), 1);
  const additive = ['number', 'money', 'hours', 'days'].includes(spec.fmt) && total > 0;
  return (
    <div className="rl-board">
      {top && additive && <Headline>{W.shareHead(top.label, Math.round((top.value / total) * 100), f(top.value))}</Headline>}
      <KpiInline kpis={out.kpis} />
      <div className={donut ? 'rl-share-layout' : 'rl-share-layout is-list'}>
        {donut && additive && (
          <div className="rl-ring" role="img" aria-label={`${spec.title}: ${rows.map((p) => `${p.label} ${f(p.value)}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={rows} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={1} stroke="var(--s-panel)" strokeWidth={2} isAnimationActive={false}>
                  {rows.map((p, i) => (
                    <Cell key={p.key} fill={p.others ? 'var(--rp-others)' : SERIES[i % SERIES.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => f(Number(v), false)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="rl-ring-center">
              <strong>{f(total)}</strong>
              <span className="muted">{W.total}</span>
            </div>
          </div>
        )}
        <ol className="rl-shares">
          {rows.map((p, i) => (
            <li key={p.key}>
              <span className="rl-swatch" style={{ background: p.others ? 'var(--rp-others)' : SERIES[i % SERIES.length] }} aria-hidden="true" />
              <span className="rl-share-name">{p.others ? W.others : p.label}</span>
              <span className="rl-share-bar" aria-hidden="true">
                <span style={{ width: `${(p.value / max) * 100}%`, background: p.others ? 'var(--rp-others)' : SERIES[i % SERIES.length] }} />
              </span>
              <strong>{f(p.value)}</strong>
              {additive && <span className="muted rl-share-pct">{Math.round((p.value / total) * 100)}%</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
