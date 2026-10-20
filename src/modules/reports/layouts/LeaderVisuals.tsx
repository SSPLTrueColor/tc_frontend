import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { L } from '../../../constants/labels';
import type { Fmt, ReportRow } from '../../../services/reports/types';
import { colOf, fmtOf, num, text, type LayoutProps } from './shared';

const W = L.reports.layouts;
const AXIS = { fontSize: 12, fill: 'var(--s-text-muted)' };
const GOOD = 'var(--rp-good)';
const MAIN = 'var(--rp-s1)';
const PALE = 'color-mix(in srgb, var(--rp-s1) 28%, var(--s-panel))';
const REST = 'var(--rp-others)';

/** Each ranked screen gets the picture its own question calls for; the list below keeps the detail. */
export type LeaderVisual =
  /** Part of each person's total that is realistic (dark) next to the rest (pale): total = `part` + remainder. */
  | { kind: 'paired'; total: string; part: string }
  /** Outcome split per row: converted / open / the rest of `total`. */
  | { kind: 'outcomes'; total: string; good: string; open: string }
  /** Share of people with a "good" status (Active) against the rest. */
  | { kind: 'status'; statusKey: string; good: string }
  /** Columns for the ranking figure with a line for a rate on a second axis. */
  | { kind: 'rate'; rate: string }
  /** Target beside what was achieved, per person. */
  | { kind: 'columns' };

interface VisualProps extends Pick<LayoutProps, 'out'> {
  rows: ReportRow[];
  name: string;
  value: string;
  fmt: Fmt;
  target?: string;
  visual: LeaderVisual;
}

const first = (s: string) => s.split(' ')[0];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const colLabel = (out: LayoutProps['out'], key: string) => colOf(out, key)?.label ?? key;
const colFmt = (out: LayoutProps['out'], key: string): Fmt => {
  const t = colOf(out, key)?.type;
  return t === 'pct' ? 'pct' : t === 'money' ? 'money' : 'number';
};

interface TipData {
  full?: string;
  lines?: [string, string][];
}
function Tip({ active, payload }: { active?: boolean; payload?: readonly { payload?: TipData }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p?.full) return null;
  return (
    <div className="dc-tip">
      <div className="dc-tip-head">{p.full}</div>
      {p.lines?.map(([k, v]) => (
        <div key={k} className="dc-tip-row">
          <span>{k}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  );
}

function Key({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="rl-key">
      {items.map((i) => (
        <li key={i.label}>
          <span className={i.line ? 'rl-key-line' : 'dc-dot'} style={{ background: i.color }} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal bars with every person named on the axis. */
function Hbars({ data, fmt, children, height }: { data: TipData[]; fmt: Fmt; children: React.ReactNode; height: number }) {
  return (
    <div style={{ height }} className="rl-visual-body">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="24%">
          <CartesianGrid horizontal={false} stroke="var(--s-chart-grid)" />
          <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS} tickFormatter={(v: number) => fmtOf(v, fmt)} domain={[0, 'auto']} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={110} tick={AXIS} interval={0} />
          <Tooltip content={<Tip />} cursor={{ fill: 'var(--s-hover)' }} />
          {children}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PairedVisual({ out, rows, name, fmt, visual }: VisualProps & { visual: Extract<LeaderVisual, { kind: 'paired' }> }) {
  const data = rows.map((r) => {
    const t = num(r[visual.total]);
    const p = Math.min(t, num(r[visual.part]));
    return { name: clip(text(r[name]), 16), full: text(r[name]), part: p, rest: Math.max(0, t - p), lines: [[colLabel(out, visual.total), fmtOf(t, fmt)], [colLabel(out, visual.part), fmtOf(p, fmt)], [W.visual.realistic, t ? `${Math.round((p / t) * 100)}%` : '—']] as [string, string][] };
  });
  return (
    <>
      <Key items={[{ label: colLabel(out, visual.part), color: MAIN }, { label: W.visual.rest(colLabel(out, visual.total)), color: PALE }]} />
      <Hbars data={data} fmt={fmt} height={Math.max(180, data.length * 38 + 30)}>
        <Bar dataKey="part" stackId="a" fill={MAIN} maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="rest" stackId="a" fill={PALE} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
      </Hbars>
    </>
  );
}

function OutcomesVisual({ out, rows, name, visual }: VisualProps & { visual: Extract<LeaderVisual, { kind: 'outcomes' }> }) {
  const data = rows.slice(0, 8).map((r) => {
    const t = num(r[visual.total]);
    const g = num(r[visual.good]);
    const o = num(r[visual.open]);
    const x = Math.max(0, t - g - o);
    return { name: clip(text(r[name]), 16), full: text(r[name]), good: g, open: o, other: x, lines: [[colLabel(out, visual.good), String(g)], [colLabel(out, visual.open), String(o)], [W.visual.other, String(x)]] as [string, string][] };
  });
  return (
    <>
      <Key items={[{ label: colLabel(out, visual.good), color: GOOD }, { label: colLabel(out, visual.open), color: MAIN }, { label: W.visual.other, color: REST }]} />
      <Hbars data={data} fmt="number" height={Math.max(180, data.length * 38 + 30)}>
        <Bar dataKey="good" stackId="a" fill={GOOD} maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="open" stackId="a" fill={MAIN} maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="other" stackId="a" fill={REST} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
      </Hbars>
    </>
  );
}

function StatusVisual({ rows, visual }: VisualProps & { visual: Extract<LeaderVisual, { kind: 'status' }> }) {
  const good = rows.filter((r) => text(r[visual.statusKey]) === visual.good).length;
  const rest = rows.length - good;
  const data = [
    { full: W.active, value: good, fill: GOOD, lines: [[W.visual.people, String(good)], [W.visual.share, `${rows.length ? Math.round((good / rows.length) * 100) : 0}%`]] as [string, string][] },
    { full: W.inactive, value: rest, fill: REST, lines: [[W.visual.people, String(rest)], [W.visual.share, `${rows.length ? Math.round((rest / rows.length) * 100) : 0}%`]] as [string, string][] },
  ].filter((d) => d.value > 0);
  return (
    <div className="rl-status">
      <div className="rl-status-ring">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="full" innerRadius="64%" outerRadius="96%" paddingAngle={data.length > 1 ? 2 : 0} stroke="var(--s-panel)" strokeWidth={2} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.full} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip content={<Tip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="rl-status-centre" aria-hidden="true">
          <strong>{W.visual.ofPeople(good, rows.length)}</strong>
          <span>{W.active}</span>
        </div>
      </div>
      <Key items={data.map((d) => ({ label: `${d.full} · ${d.value}`, color: d.fill }))} />
    </div>
  );
}

function RateVisual({ out, rows, name, value, fmt, visual }: VisualProps & { visual: Extract<LeaderVisual, { kind: 'rate' }> }) {
  const rf = colFmt(out, visual.rate);
  const data = rows.map((r) => ({
    name: clip(first(text(r[name])), 12),
    full: text(r[name]),
    value: num(r[value]),
    rate: r[visual.rate] === null || r[visual.rate] === '' || r[visual.rate] === undefined ? null : num(r[visual.rate]),
    lines: [[colLabel(out, value), fmtOf(num(r[value]), fmt)], [colLabel(out, visual.rate), r[visual.rate] === null || r[visual.rate] === '' ? '—' : fmtOf(num(r[visual.rate]), rf)]] as [string, string][],
  }));
  return (
    <>
      <Key items={[{ label: colLabel(out, value), color: MAIN }, { label: colLabel(out, visual.rate), color: 'var(--rp-s2)', line: true }]} />
      <div className="rl-visual-body">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--s-chart-grid)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={AXIS} />
            <YAxis yAxisId="l" tickLine={false} axisLine={false} width={52} tick={AXIS} tickFormatter={(v: number) => fmtOf(v, fmt)} domain={[0, 'auto']} />
            <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={44} tick={AXIS} tickFormatter={(v: number) => fmtOf(v, rf)} domain={[0, 1]} />
            <Tooltip content={<Tip />} cursor={{ fill: 'var(--s-hover)' }} />
            <Bar yAxisId="l" dataKey="value" fill={MAIN} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
            <Line yAxisId="r" type="monotone" dataKey="rate" stroke="var(--rp-s2)" strokeWidth={2} dot={{ r: 3, fill: 'var(--rp-s2)', stroke: 'var(--s-panel)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function ColumnsVisual({ out, rows, name, value, fmt, target }: VisualProps) {
  const data = rows.map((r) => {
    const v = num(r[value]);
    const t = target ? num(r[target]) : 0;
    return { name: clip(first(text(r[name])), 12), full: text(r[name]), target: t, achieved: v, hit: t > 0 && v >= t, lines: [[colLabel(out, target ?? value), fmtOf(t, fmt)], [colLabel(out, value), fmtOf(v, fmt)]] as [string, string][] };
  });
  return (
    <>
      <Key items={[{ label: colLabel(out, target ?? value), color: REST }, { label: colLabel(out, value), color: MAIN }, { label: W.visual.met, color: GOOD }]} />
      <div className="rl-visual-body">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--s-chart-grid)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={AXIS} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={AXIS} tickFormatter={(v: number) => fmtOf(v, fmt)} domain={[0, 'auto']} />
            <Tooltip content={<Tip />} cursor={{ fill: 'var(--s-hover)' }} />
            <Bar dataKey="target" fill={REST} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            <Bar dataKey="achieved" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.full} fill={d.hit ? GOOD : MAIN} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export function LeaderVisualChart(p: VisualProps) {
  const { visual } = p;
  const body =
    visual.kind === 'paired' ? <PairedVisual {...p} visual={visual} /> : visual.kind === 'outcomes' ? <OutcomesVisual {...p} visual={visual} /> : visual.kind === 'status' ? <StatusVisual {...p} visual={visual} /> : visual.kind === 'rate' ? <RateVisual {...p} visual={visual} /> : <ColumnsVisual {...p} />;
  const label = W.visual.title[visual.kind];
  return (
    <section className="rl-visual" role="group" aria-label={label}>
      <h3 className="rl-visual-title">{label}</h3>
      {body}
    </section>
  );
}
