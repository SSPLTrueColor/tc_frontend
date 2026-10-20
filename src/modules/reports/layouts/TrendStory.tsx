import { Area, AreaChart, CartesianGrid, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { L } from '../../../constants/labels';
import { formatMetric } from '../../../services/reports/format';
import type { ChartPoint, ChartSpec } from '../../../services/reports/types';
import { ShareRings } from './ShareRings';
import { Headline, KpiInline, type LayoutProps } from './shared';

const W = L.reports.layouts;
const AXIS = { fontSize: 12, fill: 'var(--s-text-muted)' };

function Tip({ active, payload, spec }: { active?: boolean; payload?: readonly { payload?: ChartPoint }[]; spec: ChartSpec }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="dc-tip">
      <div className="dc-tip-head">{p.label}</div>
      <div className="dc-tip-row">
        <span>{spec.label ?? spec.title}</span>
        <strong>{formatMetric(p.value, spec.fmt, { unit: spec.unit })}</strong>
      </div>
      {p.value2 !== undefined && p.value2 !== null && (
        <div className="dc-tip-row">
          <span>{spec.label2 ?? ''}</span>
          <strong>{formatMetric(p.value2, spec.fmt2 ?? 'number', { unit: spec.unit2 })}</strong>
        </div>
      )}
    </div>
  );
}

/**
 * A figure over time told as a story: one sentence with the latest value and its change, one calm area chart with the
 * highest and lowest points marked, and three numbers (highest, lowest, average). When the report is grouped by something
 * other than time it becomes a ranked list instead.
 */
export function TrendStory(props: LayoutProps) {
  const chart = props.out.chart;
  if (!chart || !chart.points.length) return <p className="rl-empty muted">{W.noData}</p>;
  const { spec, points } = chart;
  if (!['line', 'area', 'combo'].includes(spec.type)) return <ShareRings {...props} donut={false} />;
  const vals = points.map((p) => p.value);
  const hi = points[vals.indexOf(Math.max(...vals))];
  const lo = points[vals.indexOf(Math.min(...vals))];
  const avg = vals.reduce((t, v) => t + v, 0) / vals.length;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const pct = prev && prev.value ? Math.round(((last.value - prev.value) / Math.abs(prev.value)) * 100) : null;
  const dir = pct === null || pct === 0 ? 'flat' : pct > 0 ? 'up' : 'down';
  const f = (v: number) => formatMetric(v, spec.fmt, { compact: true, unit: spec.unit });
  const hasSecond = spec.type === 'combo' && points.some((p) => p.value2 !== undefined && p.value2 !== null);
  return (
    <div className="rl-board">
      <Headline>{W.trendHead(spec.label ?? spec.title, f(last.value), dir, pct, prev?.label ?? '')}</Headline>
      <KpiInline kpis={props.out.kpis} />
      <div className="rl-trend" role="img" aria-label={`${spec.title}: ${points.map((p) => `${p.label} ${f(p.value)}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: 12 }}>
            <defs>
              <linearGradient id="rl-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--rp-s1)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--rp-s1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--s-border)" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis yAxisId="a" hide domain={[0, 'auto']} />
            {hasSecond && <YAxis yAxisId="b" hide orientation="right" domain={[0, 'auto']} />}
            <Tooltip content={<Tip spec={spec} />} cursor={{ stroke: 'var(--s-border-strong)' }} />
            <Area yAxisId="a" type="monotone" dataKey="value" stroke="var(--rp-s1)" strokeWidth={2} fill="url(#rl-trend-fill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            {hasSecond && <Line yAxisId="b" type="monotone" dataKey="value2" stroke="var(--rp-s2)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
            <ReferenceDot yAxisId="a" x={hi.label} y={hi.value} r={5} fill="var(--rp-good)" stroke="var(--s-panel)" strokeWidth={2} />
            {lo.key !== hi.key && <ReferenceDot yAxisId="a" x={lo.label} y={lo.value} r={5} fill="var(--s-danger)" stroke="var(--s-panel)" strokeWidth={2} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <dl className="rl-callouts">
        <div>
          <dt>
            <span className="rl-pip is-good" />
            {W.best}
          </dt>
          <dd>{f(hi.value)}</dd>
          <dd className="muted">{hi.label}</dd>
        </div>
        <div>
          <dt>
            <span className="rl-pip is-bad" />
            {W.lowest}
          </dt>
          <dd>{f(lo.value)}</dd>
          <dd className="muted">{lo.label}</dd>
        </div>
        <div>
          <dt>{W.average}</dt>
          <dd>{f(avg)}</dd>
          <dd className="muted">{points.length} periods</dd>
        </div>
        {hasSecond && spec.label2 && (
          <div>
            <dt>
              <span className="rl-pip is-two" />
              {spec.label2}
            </dt>
            <dd>{formatMetric(last.value2 ?? null, spec.fmt2 ?? 'number', { compact: true })}</dd>
            <dd className="muted">{last.label}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
