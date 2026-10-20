import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { L } from '../../constants/labels';
import { EmptyState } from '../../components/primitives/feedback';
import { cx } from '../../lib/format';
import { formatMetric } from '../../services/reports/format';
import type { ChartOut, ChartPoint, ChartSpec } from '../../services/reports/types';

const C = L.reports.page.chart;
const SERIES = ['var(--rp-s1)', 'var(--rp-s2)', 'var(--rp-s3)', 'var(--rp-s4)', 'var(--rp-s5)', 'var(--rp-s6)', 'var(--rp-s7)', 'var(--rp-s8)'];
const OTHERS = 'var(--rp-others)';
const AXIS = { fontSize: 12, fill: 'var(--s-text-muted)' };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const full = (spec: ChartSpec, v: number) => formatMetric(v, spec.fmt, { unit: spec.unit });
const short = (spec: ChartSpec, v: number) => formatMetric(v, spec.fmt, { compact: true });

interface TipProps {
  active?: boolean;
  payload?: readonly { payload?: ChartPoint & { share?: number } }[];
}
function Tip({ active, payload, spec }: TipProps & { spec: ChartSpec }) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const p = payload[0].payload;
  return (
    <div className="dc-tip">
      <div className="dc-tip-head">{p.label}</div>
      <div className="dc-tip-row">
        <span>{spec.title}</span>
        <strong>{full(spec, p.value)}</strong>
      </div>
      {p.share !== undefined && (
        <div className="dc-tip-row">
          <span>{C.share}</span>
          <strong>{Math.round(p.share * 100)}%</strong>
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars (comparison with long names): HTML so names truncate and every bar has a keyboard-reachable tooltip. */
function RankBars({ spec, points }: { spec: ChartSpec; points: ChartPoint[] }) {
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 0);
  return (
    <ul className="rp-rank">
      {points.map((p) => (
        <li key={p.key} className="rp-rank-row" tabIndex={0} data-tooltip={`${p.label}: ${full(spec, p.value)}`}>
          <span className="rp-rank-label">{p.label}</span>
          <span className="rp-rank-track">
            <span className={cx('rp-rank-bar', p.others && 'is-others', p.value < 0 && 'is-negative')} style={{ width: `${max ? Math.max(1.5, (Math.abs(p.value) / max) * 100) : 0}%` }} />
          </span>
          <span className="rp-rank-value">{short(spec, p.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Stages (funnel): bars shrink with the stage, each shows how much carried over from the one before. */
function Funnel({ spec, points }: { spec: ChartSpec; points: ChartPoint[] }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  return (
    <ol className="rp-funnel">
      {points.map((p, i) => {
        const prev = i > 0 ? points[i - 1].value : null;
        const carry = prev ? p.value / prev : null;
        return (
          <li key={p.key} className="rp-funnel-row" tabIndex={0} data-tooltip={`${p.label}: ${full(spec, p.value)}${carry !== null && carry <= 1 ? ` · ${C.carried(Math.round(carry * 100))}` : ''}`}>
            <span className="rp-rank-label">{p.label}</span>
            <span className="rp-funnel-track">
              <span className="rp-funnel-bar" style={{ width: `${max ? Math.max(2, (p.value / max) * 100) : 0}%` }} />
            </span>
            <span className="rp-rank-value">{short(spec, p.value)}</span>
            <span className="rp-funnel-carry muted">{carry !== null && carry <= 1 ? `${Math.round(carry * 100)}%` : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Donut({ spec, points }: { spec: ChartSpec; points: ChartPoint[] }) {
  const total = points.reduce((t, p) => t + p.value, 0);
  const data = points.map((p, i) => ({ ...p, share: total ? p.value / total : 0, fill: p.others ? OTHERS : SERIES[i % SERIES.length] }));
  return (
    <div className="rp-donut-wrap">
      <div className="rp-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="96%" paddingAngle={data.length > 1 ? 2 : 0} stroke="var(--s-panel)" strokeWidth={2} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip content={<Tip spec={spec} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="rp-donut-center" aria-hidden="true">
          <strong>{short(spec, total)}</strong>
          <span>{C.total}</span>
        </div>
      </div>
      <ul className="rp-legend">
        {data.map((d) => (
          <li key={d.key} data-tooltip={`${d.label}: ${full(spec, d.value)}`}>
            <span className="dc-dot" style={{ background: d.fill }} />
            <span className="rp-legend-name">{d.label}</span>
            <span className="rp-legend-val">{short(spec, d.value)}</span>
            <span className="muted rp-legend-pct">{Math.round(d.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Trend({ spec, points }: { spec: ChartSpec; points: ChartPoint[] }) {
  const hasNeg = points.some((p) => p.value < 0);
  const yWidth = Math.max(40, Math.max(...points.map((p) => short(spec, p.value).length), 3) * 7 + 8);
  const common = {
    data: points,
    margin: { top: 8, right: 12, left: 0, bottom: 0 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--s-chart-grid)" />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} minTickGap={24} tickMargin={6} />
      <YAxis tickLine={false} axisLine={false} width={yWidth} tick={AXIS} tickFormatter={(v: number) => short(spec, v)} domain={hasNeg ? ['auto', 'auto'] : [0, 'auto']} allowDecimals={spec.fmt !== 'number'} />
      {hasNeg && <ReferenceLine y={0} stroke="var(--s-border-strong)" />}
      <Tooltip content={<Tip spec={spec} />} cursor={{ stroke: 'var(--s-border-strong)' }} />
    </>
  );
  const dot = points.length <= 31 ? { r: 3, fill: 'var(--rp-s1)', stroke: 'var(--s-panel)', strokeWidth: 2 } : false;
  return (
    <ResponsiveContainer width="100%" height="100%">
      {spec.type === 'area' ? (
        <AreaChart {...common}>
          <defs>
            <linearGradient id="rp-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--rp-s1)" stopOpacity={0.24} />
              <stop offset="100%" stopColor="var(--rp-s1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {axes}
          <Area type="monotone" dataKey="value" name={spec.title} stroke="var(--rp-s1)" strokeWidth={2} fill="url(#rp-area)" dot={dot} activeDot={{ r: 4 }} isAnimationActive={false} />
        </AreaChart>
      ) : (
        <LineChart {...common}>
          {axes}
          <Line type="monotone" dataKey="value" name={spec.title} stroke="var(--rp-s1)" strokeWidth={2} dot={dot} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

function Columns({ spec, points }: { spec: ChartSpec; points: ChartPoint[] }) {
  const hasNeg = points.some((p) => p.value < 0);
  const tilt = points.length > 6;
  const yWidth = Math.max(40, Math.max(...points.map((p) => short(spec, p.value).length), 3) * 7 + 8);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: tilt ? 16 : 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--s-chart-grid)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          tickMargin={6}
          height={tilt ? 56 : 28}
          tick={({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value: string } }) => (
            <g transform={`translate(${x ?? 0},${y ?? 0})`}>
              <title>{payload?.value}</title>
              <text {...AXIS} textAnchor={tilt ? 'end' : 'middle'} transform={tilt ? 'rotate(-35)' : undefined} dy={12}>
                {clip(String(payload?.value ?? ''), tilt ? 14 : 12)}
              </text>
            </g>
          )}
        />
        <YAxis tickLine={false} axisLine={false} width={yWidth} tick={AXIS} tickFormatter={(v: number) => short(spec, v)} domain={hasNeg ? ['auto', 'auto'] : [0, 'auto']} allowDecimals={spec.fmt !== 'number'} />
        {hasNeg && <ReferenceLine y={0} stroke="var(--s-border-strong)" />}
        <Tooltip content={<Tip spec={spec} />} cursor={{ fill: 'var(--s-hover)' }} />
        <Bar dataKey="value" name={spec.title} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
          {points.map((p) => (
            <Cell key={p.key} fill={p.others ? OTHERS : p.value < 0 ? 'var(--rp-neg)' : 'var(--rp-s1)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** The ONE primary chart of a report, in the form its data calls for. */
export function ReportChart({ chart, busy }: { chart: ChartOut; busy?: boolean }) {
  const { spec, points } = chart;
  const summary = `${spec.title}: ${points.slice(0, 6).map((p) => `${p.label} ${full(spec, p.value)}`).join(', ')}${points.length > 6 ? ', …' : ''}`;
  const html = spec.type === 'hbar' || spec.type === 'funnel';
  // Lines may legitimately sit at zero; bars, slices and stages with nothing in them say so instead of drawing air.
  const empty = points.length === 0 || (spec.type !== 'line' && spec.type !== 'area' && points.every((p) => p.value === 0));
  return (
    <section className={cx('panel rp-chart', busy && 'is-busy')} aria-label={spec.title} aria-busy={busy || undefined}>
      <div className="panel-head">
        <h2 className="panel-title">{spec.title}</h2>
        {chart.hiddenCount > 0 && <span className="muted small">{C.cutNote(points.length, points.length + chart.hiddenCount)}</span>}
      </div>
      {empty ? (
        <div className="rp-chart-body">
          <EmptyState icon="bar-chart" title={C.emptyTitle}>
            {C.emptyBody}
          </EmptyState>
        </div>
      ) : (
        <div className={cx('rp-chart-body', html && 'is-html', spec.type === 'donut' && 'is-donut')} role={html ? 'group' : 'img'} aria-label={summary}>
          {spec.type === 'hbar' ? <RankBars spec={spec} points={points} /> : spec.type === 'funnel' ? <Funnel spec={spec} points={points} /> : spec.type === 'donut' ? <Donut spec={spec} points={points} /> : spec.type === 'bar' ? <Columns spec={spec} points={points} /> : <Trend spec={spec} points={points} />}
        </div>
      )}
    </section>
  );
}

export function ChartSkeleton() {
  return (
    <section className="panel rp-chart" aria-busy="true" aria-label={L.common.states.loading}>
      <div className="panel-head">
        <span className="skeleton-row rp-skel-title" />
      </div>
      <div className="rp-chart-body rp-skel-chart" />
    </section>
  );
}
