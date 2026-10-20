import { Link, useNavigate } from 'react-router-dom';
import { SkeletonBlock, SkeletonLine } from '../../components/primitives/Skeleton';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
type LinkFor = (key: string) => string | undefined;
/** A mark's name: a link to the filtered records behind it when the report offers one. */
function MarkLabel({ point, linkFor, className }: { point: ChartPoint; linkFor?: LinkFor; className?: string }) {
  const to = linkFor?.(point.key);
  return to && !point.others ? (
    <Link to={to} className={cx(className, 'rp-mark-link')}>
      {point.label}
    </Link>
  ) : (
    <span className={className}>{point.label}</span>
  );
}

function RankBars({ spec, points, linkFor }: { spec: ChartSpec; points: ChartPoint[]; linkFor?: LinkFor }) {
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 0);
  return (
    <ul className="rp-rank">
      {points.map((p) => (
        <li key={p.key} className="rp-rank-row" tabIndex={0} data-tooltip={`${p.label}: ${full(spec, p.value)}`}>
          <MarkLabel point={p} linkFor={linkFor} className="rp-rank-label" />
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
function Funnel({ spec, points, linkFor }: { spec: ChartSpec; points: ChartPoint[]; linkFor?: LinkFor }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  return (
    <ol className="rp-funnel">
      {points.map((p, i) => {
        const prev = i > 0 ? points[i - 1].value : null;
        const carry = spec.carry !== false && prev ? p.value / prev : null;
        return (
          <li key={p.key} className="rp-funnel-row" tabIndex={0} data-tooltip={`${p.label}: ${full(spec, p.value)}${carry !== null && carry <= 1 ? ` · ${C.carried(Math.round(carry * 100))}` : ''}`}>
            <MarkLabel point={p} linkFor={linkFor} className="rp-rank-label" />
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

function Donut({ spec, points, linkFor }: { spec: ChartSpec; points: ChartPoint[]; linkFor?: LinkFor }) {
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
            <MarkLabel point={d} linkFor={linkFor} className="rp-legend-name" />
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

function Columns({ spec, points, linkFor }: { spec: ChartSpec; points: ChartPoint[]; linkFor?: LinkFor }) {
  const nav = useNavigate();
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
        <Bar dataKey="value" name={spec.title} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} cursor={linkFor ? 'pointer' : undefined} onClick={(d) => { const to = linkFor?.(String((d as unknown as { payload?: ChartPoint }).payload?.key ?? '')); if (to) nav(to); }}>
          {points.map((p) => (
            <Cell key={p.key} fill={p.others ? OTHERS : p.value < 0 ? 'var(--rp-neg)' : 'var(--rp-s1)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** What each colour or line means, shown only when a chart has more than one measure. */
function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="rp-key" aria-label={C.legend}>
      {items.map((i) => (
        <li key={i.label}>
          <span className={cx('rp-key-mark', i.line && 'is-line')} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function MultiTip({ active, payload, rows }: TipProps & { rows: (p: ChartPoint) => { label: string; value: string }[] }) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const p = payload[0].payload;
  return (
    <div className="dc-tip">
      <div className="dc-tip-head">{p.label}</div>
      {rows(p).map((r) => (
        <div key={r.label} className="dc-tip-row">
          <span>{r.label}</span>
          <strong>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

const xTick = (n: number) => ({ tickLine: false as const, axisLine: false as const, tick: AXIS, minTickGap: n, tickMargin: 6 });

/** Two measures over time: bars for the volume (left axis), a line for the rate (right axis). */
function Combo({ spec, points }: { spec: ChartSpec; points: ChartPoint[] }) {
  const fmt2 = spec.fmt2 ?? 'pct';
  const f2 = (v: number) => formatMetric(v, fmt2, { compact: true, unit: spec.unit2 });
  const yW = Math.max(40, Math.max(...points.map((p) => short(spec, p.value).length), 3) * 7 + 8);
  const y2W = Math.max(40, Math.max(...points.map((p) => (p.value2 === null || p.value2 === undefined ? 1 : f2(p.value2).length)), 3) * 7 + 8);
  return (
    <>
      <Legend items={[{ label: spec.label ?? spec.title, color: 'var(--rp-s1)' }, { label: spec.label2 ?? '', color: 'var(--rp-s2)', line: true }]} />
      <div className="rp-plot">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--s-chart-grid)" />
          <XAxis dataKey="label" {...xTick(24)} />
          <YAxis yAxisId="l" tickLine={false} axisLine={false} width={yW} tick={AXIS} tickFormatter={(v: number) => short(spec, v)} domain={[0, 'auto']} allowDecimals={spec.fmt !== 'number'} />
          <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={y2W} tick={AXIS} tickFormatter={(v: number) => f2(v)} domain={[0, 'auto']} />
          <Tooltip
            cursor={{ fill: 'var(--s-hover)' }}
            content={<MultiTip rows={(p) => [{ label: spec.label ?? spec.title, value: full(spec, p.value) }, { label: spec.label2 ?? '', value: p.value2 === null || p.value2 === undefined ? '—' : formatMetric(p.value2, fmt2, { unit: spec.unit2 }) }]} />}
          />
          <Bar yAxisId="l" dataKey="value" name={spec.label ?? spec.title} fill="var(--rp-s1)" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
          <Line yAxisId="r" type="monotone" dataKey="value2" name={spec.label2} stroke="var(--rp-s2)" strokeWidth={2} dot={{ r: 3, fill: 'var(--rp-s2)', stroke: 'var(--s-panel)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </>
  );
}

const SERIES_COLOR = { success: 'var(--rp-good)', danger: 'var(--rp-neg)' } as const;

/** Two or three outcomes stacked on each month (won / lost): the height is the total, the colours are the split. */
function Stacked({ spec, points }: { spec: ChartSpec; points: ChartPoint[] }) {
  const series = spec.series ?? [];
  const colour = (i: number) => (series[i].tone ? SERIES_COLOR[series[i].tone!] : SERIES[i % SERIES.length]);
  const yW = Math.max(40, Math.max(...points.map((p) => short(spec, p.value).length), 3) * 7 + 8);
  return (
    <>
      <Legend items={series.map((s, i) => ({ label: s.label, color: colour(i) }))} />
      <div className="rp-plot">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--s-chart-grid)" />
          <XAxis dataKey="label" {...xTick(24)} />
          <YAxis tickLine={false} axisLine={false} width={yW} tick={AXIS} tickFormatter={(v: number) => short(spec, v)} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'var(--s-hover)' }} content={<MultiTip rows={(p) => [...series.map((s) => ({ label: s.label, value: full(spec, p.values?.[s.key] ?? 0) })), { label: C.total, value: full(spec, p.value) }]} />} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={`values.${s.key}`} name={s.label} stackId="a" fill={colour(i)} maxBarSize={44} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      </div>
    </>
  );
}

/** When does it happen: weekday rows × hour columns, darker = more. Every cell has a number in its tooltip. */
function Heatmap({ spec, points }: { spec: ChartSpec; points: ChartPoint[] }) {
  const rows = [...new Set(points.map((p) => p.row ?? ''))];
  const cols = [...new Set(points.map((p) => p.col ?? ''))];
  const max = Math.max(...points.map((p) => p.value), 1);
  const at = new Map(points.map((p) => [`${p.row}|${p.col}`, p.value]));
  const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
  return (
    <div className="rp-heat" style={{ ['--cols' as string]: cols.length }}>
      <div className="rp-heat-grid">
        <span />
        {cols.map((c) => (
          <span key={c} className="rp-heat-col">
            {c}
          </span>
        ))}
        {rows.map((r) => (
          <HeatRow key={r} row={r} cols={cols} at={at} level={level} spec={spec} />
        ))}
      </div>
      <div className="rp-heat-key" aria-hidden="true">
        <span>{C.heatFewer}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={cx('rp-heat-cell', `is-l${l}`)} />
        ))}
        <span>{C.heatMore}</span>
      </div>
      <p className="sr-only">{C.heatPeak(peak?.row ?? '', peak?.col ?? '', peak?.value ?? 0)}</p>
    </div>
  );
}
function HeatRow({ row, cols, at, level, spec }: { row: string; cols: string[]; at: Map<string, number>; level: (v: number) => number; spec: ChartSpec }) {
  return (
    <>
      <span className="rp-heat-row">{row}</span>
      {cols.map((c) => {
        const v = at.get(`${row}|${c}`) ?? 0;
        return <span key={c} className={cx('rp-heat-cell', `is-l${level(v)}`)} data-tooltip={`${row} ${c}: ${full(spec, v)}`} />;
      })}
    </>
  );
}

/** Target vs achieved: a bar for the actual, a tick for the target, the percentage in words (never colour alone). */
function Bullet({ spec, points, linkFor }: { spec: ChartSpec; points: ChartPoint[]; linkFor?: LinkFor }) {
  const max = Math.max(...points.flatMap((p) => [p.value, p.target ?? 0]), 1) * 1.08;
  return (
    <ul className="rp-bullets">
      {points.map((p) => {
        const pct = p.target ? Math.round((p.value / p.target) * 100) : null;
        const tone = pct === null ? 'is-none' : pct >= 100 ? 'is-good' : pct >= 70 ? 'is-mid' : 'is-low';
        return (
          <li key={p.key} className="rp-bullet" tabIndex={0} data-tooltip={`${p.label}: ${full(spec, p.value)} ${C.of} ${full(spec, p.target ?? 0)}${pct === null ? '' : ` (${pct}%)`}`}>
            <MarkLabel point={p} linkFor={linkFor} className="rp-rank-label" />
            <span className="rp-bullet-track">
              <span className={cx('rp-bullet-bar', tone)} style={{ width: `${Math.min(100, (p.value / max) * 100)}%` }} />
              {!!p.target && <span className="rp-bullet-target" style={{ left: `${Math.min(100, (p.target / max) * 100)}%` }} aria-hidden="true" />}
            </span>
            <span className="rp-bullet-text">
              {short(spec, p.value)} <span className="muted">{C.of} {short(spec, p.target ?? 0)}</span>
            </span>
            <span className={cx('rp-bullet-pct', tone)}>{pct === null ? '—' : `${pct}%`}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One sentence that says what the chart shows, worked out from the same marks the chart draws:
 * "Latest: Oct 2026 7.7%, down from 45% in Sep 2026" · "Highest: Rohan Desai ₹3 Cr (45% of the total)".
 */
export function insightOf(spec: ChartSpec, points: ChartPoint[]): string {
  const I = C.insight;
  if (!points.length) return '';
  const total = points.reduce((t, p) => t + p.value, 0);
  const additive = spec.fmt === 'money' || spec.fmt === 'number';
  const top = points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
  switch (spec.type) {
    case 'line':
    case 'area':
    case 'combo': {
      const last = points[points.length - 1];
      const prev = points.length > 1 ? points[points.length - 2] : null;
      const trend = !prev ? '' : last.value > prev.value ? I.up(prev.label, short(spec, prev.value)) : last.value < prev.value ? I.down(prev.label, short(spec, prev.value)) : I.flat(prev.label);
      return `${I.latest(last.label, short(spec, last.value))}${trend}`;
    }
    case 'stacked': {
      const a = spec.series?.[0];
      const part = a ? points.reduce((t, p) => t + (p.values?.[a.key] ?? 0), 0) : 0;
      return a && total ? I.split(a.label, Math.round((part / total) * 100), short(spec, total)) : '';
    }
    case 'donut':
      return total ? I.largestShare(top.label, Math.round((top.value / total) * 100)) : '';
    case 'funnel': {
      const first = points[0];
      const last = points[points.length - 1];
      return spec.carry !== false && first.value ? I.reach(first.label, last.label, Math.round((last.value / first.value) * 100)) : I.highest(top.label, short(spec, top.value), additive && total ? Math.round((top.value / total) * 100) : null);
    }
    case 'heatmap': {
      const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
      return I.busiest(peak.label, short(spec, peak.value));
    }
    case 'bullet': {
      const met = points.filter((p) => p.target && p.value >= p.target).length;
      return I.onTarget(met, points.length);
    }
    default:
      return I.highest(top.label, short(spec, top.value), additive && total ? Math.round((top.value / total) * 100) : null);
  }
}

/** The ONE primary chart of a report, in the form its data calls for. */
export function ReportChart({ chart, busy, linkFor }: { chart: ChartOut; busy?: boolean; linkFor?: (key: string) => string | undefined }) {
  const { spec, points } = chart;
  const insight = insightOf(spec, points);
  const summary = `${spec.title}: ${points.slice(0, 6).map((p) => `${p.label} ${full(spec, p.value)}`).join(', ')}${points.length > 6 ? ', …' : ''}`;
  const html = spec.type === 'hbar' || spec.type === 'funnel' || spec.type === 'bullet' || spec.type === 'heatmap';
  // Lines may legitimately sit at zero; bars, slices and stages with nothing in them say so instead of drawing air.
  const empty = points.length === 0 || (spec.type !== 'line' && spec.type !== 'area' && spec.type !== 'combo' && points.every((p) => p.value === 0 && !(p.value2 ?? 0)));
  return (
    <section className={cx('panel rp-chart', busy && 'is-busy')} aria-label={spec.title} aria-busy={busy || undefined}>
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{spec.title}</h2>
          {insight && <p className="rp-insight">{insight}</p>}
        </div>
        {chart.hiddenCount > 0 && <span className="muted small">{C.cutNote(points.length, points.length + chart.hiddenCount)}</span>}
      </div>
      {empty ? (
        <div className="rp-chart-body">
          <EmptyState icon="bar-chart" title={C.emptyTitle}>
            {C.emptyBody}
          </EmptyState>
        </div>
      ) : (
        <div className={cx('rp-chart-body', html && 'is-html', spec.type === 'donut' && 'is-donut', (spec.type === 'combo' || spec.type === 'stacked') && 'has-key')} role={html ? 'group' : 'img'} aria-label={summary}>
          {spec.type === 'hbar' ? <RankBars spec={spec} points={points} linkFor={linkFor} /> : spec.type === 'funnel' ? <Funnel spec={spec} points={points} linkFor={linkFor} /> : spec.type === 'donut' ? <Donut spec={spec} points={points} linkFor={linkFor} /> : spec.type === 'bar' ? <Columns spec={spec} points={points} linkFor={linkFor} /> : spec.type === 'combo' ? <Combo spec={spec} points={points} /> : spec.type === 'stacked' ? <Stacked spec={spec} points={points} /> : spec.type === 'heatmap' ? <Heatmap spec={spec} points={points} /> : spec.type === 'bullet' ? <Bullet spec={spec} points={points} linkFor={linkFor} /> : <Trend spec={spec} points={points} />}
        </div>
      )}
    </section>
  );
}

export function ChartSkeleton() {
  return (
    <section className="panel rp-chart" aria-busy="true" aria-label={L.common.states.loading}>
      <div className="panel-head">
        <SkeletonLine size="title" />
      </div>
      <SkeletonBlock className="rp-chart-body" />
    </section>
  );
}
