import { SkeletonLine } from '../../components/primitives/Skeleton';
import { Sparkline } from '../../components/primitives/Sparkline';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Pie, PieChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { L } from '../../constants/labels';
import { ROUTES } from '../../constants/routes';
import { formatDate, relativeTime } from '../../lib/dates';
import { resourcePath } from '../../lib/routes';
import { cx, formatMoney, formatNumber } from '../../lib/format';
import { Button } from '../../components/primitives/Button';
import { Icon } from '../../components/primitives/Icon';
import { EmptyState, Skeleton } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { compactInr } from '../../services/reports/format';
import type { AlertItem, Board, FeedItem, Fmt, Kpi, Pipe, Share, Trend } from '../../services/reports/overview';
import type { PlanItem } from '../../services/reports/dashboard';
import { Table } from '../../components/primitives/Table';

const COLOR: Record<string, string> = {
  success: 'var(--s-success)',
  warning: 'var(--s-warning)',
  danger: 'var(--s-danger)',
  info: 'var(--s-info)',
  accent: 'var(--s-accent)',
  neutral: 'var(--s-text-muted)',
};
const colorOf = (t: string) => COLOR[t] ?? COLOR.neutral;
const CD = L.dashboard.card;
const EM = L.dashboard.empty;

export function formatValue(v: number | null, fmt: Fmt): string {
  if (v === null || Number.isNaN(v)) return '—';
  switch (fmt) {
    case 'money':
      return compactInr(v);
    case 'pct':
      return `${Math.round(v * 1000) / 10}%`;
    case 'hours':
      return CD.hours(Math.round(v * 10) / 10);
    case 'rating':
      return CD.rating(v.toFixed(1));
    default:
      return formatNumber(Math.round(v * 10) / 10);
  }
}

// ---------------------------------------------------------------- card frame

export function Card({ title, info, to, linkLabel = CD.viewAll, className, children, extra }: { title: string; info?: string; to?: string; linkLabel?: string; className?: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className={cx('panel dash-card', className)} aria-label={title}>
      <div className="panel-head">
        <h2 className="panel-title dialog-title-row">
          {title}
          {info && <InfoTip text={info} label={CD.about(title)} />}
        </h2>
        {extra}
        {to && (
          <Link to={to} className="link small">
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Same frame as a real card, so loading causes no layout shift. */
export function CardSkeleton({ className, rows = 6 }: { className?: string; rows?: number }) {
  return (
    <section className={cx('panel dash-card', className)} aria-busy="true" aria-label={CD.loading}>
      <div className="panel-head">
        <SkeletonLine size="title" />
      </div>
      <Skeleton rows={rows} />
    </section>
  );
}

export function KpiSkeleton() {
  return (
    <div className="kpi-card" aria-busy="true" aria-label={CD.loading}>
      <SkeletonLine size="title" />
      <SkeletonLine size="value" />
      <span className="skeleton-row" />
    </div>
  );
}

// ---------------------------------------------------------------- KPI card

function Spark({ data, tone }: { data: number[]; tone: string }) {
  if (data.length < 2) return <span className="kpi-snap">{CD.currentSnapshot}</span>;
  return <Sparkline data={data} tone={tone} label={CD.sparkAria(data.length, formatNumber(Math.round(data[0])), formatNumber(Math.round(data[data.length - 1])))} />;
}

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const d = kpi.delta;
  const good = d === null || d === 0 ? null : (d > 0) === (kpi.good === 'up');
  const body = (
    <>
      <div className="kpi-top">
        <span className="kpi-icon" aria-hidden="true">
          <Icon name={kpi.icon} size={16} />
        </span>
        <span className="kpi-label" data-tooltip={kpi.label}>
          {kpi.label}
        </span>
      </div>
      <div className="kpi-mid">
        <span className="kpi-value">{formatValue(kpi.value, kpi.fmt)}</span>
        {d !== null ? (
          <span className={cx('kpi-delta', good === null ? 'is-flat' : good ? 'is-good' : 'is-bad')} title={CD.changeTitle}>
            <Icon name={d >= 0 ? 'arrow-up' : 'arrow-down'} size={12} />
            {Math.abs(d)}%
            <span className="sr-only">{CD.vsPrevious(good === null ? CD.noChange : good ? CD.better : CD.worse)}</span>
          </span>
        ) : (
          <span className="kpi-delta is-flat" title={CD.noComparison}>
            —
          </span>
        )}
      </div>
      <span className="kpi-sub">{kpi.sub ?? ' '}</span>
      {kpi.radial ? (
        <div className="kpi-radial">
          <ResponsiveContainer width={44} height={44}>
            <RadialBarChart innerRadius="68%" outerRadius="100%" data={[{ v: Math.min(100, kpi.radial.pct), fill: kpi.radial.pct >= 100 ? COLOR.success : kpi.radial.pct >= 70 ? COLOR.warning : COLOR.danger }]} startAngle={90} endAngle={-270}>
              <RadialBar dataKey="v" background={{ fill: 'var(--s-sunken)' }} cornerRadius={4} isAnimationActive={false} />
            </RadialBarChart>
          </ResponsiveContainer>
          <span className="kpi-snap">
            {kpi.radial.actual} / {kpi.radial.target}
          </span>
        </div>
      ) : (
        <Spark data={kpi.spark} tone={good === false ? COLOR.danger : COLOR.accent} />
      )}
    </>
  );
  return kpi.to ? (
    <Link to={kpi.to} className="kpi-card" aria-label={CD.openTheList(kpi.label, formatValue(kpi.value, kpi.fmt))}>
      {body}
    </Link>
  ) : (
    <div className="kpi-card">{body}</div>
  );
}

/** Chart click handlers receive the data row merged into the mark; navigate to its `to`. */
const go = (nav: (to: string) => void, d: unknown) => {
  const to = (d as { to?: string } | null)?.to;
  if (to) nav(to);
};

// ---------------------------------------------------------------- tooltips

interface TipProps {
  active?: boolean;
  payload?: readonly { name?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> }[];
}
function ChartTip({ active, payload, head, money, unit }: TipProps & { head?: (p: Record<string, unknown>) => string; money: boolean; unit: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload ?? {};
  return (
    <div className="dc-tip">
      {head && <div className="dc-tip-head">{head(p)}</div>}
      {payload.map((r) => (
        <div key={r.name} className="dc-tip-row">
          <span className="dc-dot" style={{ background: r.color }} />
          <span>{r.name}</span>
          <strong>{money ? formatMoney(Number(r.value ?? 0)) : `${formatNumber(Number(r.value ?? 0))}${unit ? ` ${unit}` : ''}`}</strong>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- trend (area)

export function TrendCard({ trend }: { trend: Trend }) {
  const nav = useNavigate();
  const empty = trend.points.every((p) => trend.series.every((s) => !p[s.key]));
  return (
    <Card title={trend.title} info={trend.info} to={trend.to} linkLabel={CD.openList} className="dash-trend span-8">
      {empty ? (
        <EmptyState icon="bar-chart" title={EM.trendTitle}>
          {EM.trendBody}
        </EmptyState>
      ) : (
        <>
          <ul className="dc-legend" aria-label={CD.series}>
            {trend.series.map((s) => (
              <li key={s.key}>
                <span className="dc-dot" style={{ background: colorOf(s.tone) }} />
                {s.label}
              </li>
            ))}
          </ul>
          <div className="dash-chart" role="img" aria-label={CD.trendAria(trend.title, trend.series.map((s) => s.label).join(CD.and), trend.points.length)}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend.points} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} onClick={() => trend.to && nav(trend.to)} style={{ cursor: trend.to ? 'pointer' : undefined }}>
                <defs>
                  {trend.series.map((s) => (
                    <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colorOf(s.tone)} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={colorOf(s.tone)} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="var(--s-chart-grid)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--s-text-muted)' }} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} width={trend.money ? 52 : 36} tick={{ fontSize: 11, fill: 'var(--s-text-muted)' }} tickFormatter={(v: number) => (trend.money ? compactInr(v) : formatNumber(v))} />
                <Tooltip content={<ChartTip head={(p) => String(p.tip ?? '')} money={trend.money} unit={trend.money ? '' : trend.unit} />} />
                {trend.series.map((s) => (
                  <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorOf(s.tone)} strokeWidth={2} fill={`url(#g-${s.key})`} isAnimationActive={false} activeDot={{ r: 4 }} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {trend.note && <p className="muted small dash-note">{trend.note}</p>}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- share (donut)

export function ShareCard({ share, className = 'span-4' }: { share: Share; className?: string }) {
  const nav = useNavigate();
  const total = share.slices.reduce((t, x) => t + x.value, 0);
  return (
    <Card title={share.title} info={share.info} className={`dash-share ${className}`}>
      {!total ? (
        <EmptyState icon="empty" title={EM.shareTitle}>
          {EM.shareBody}
        </EmptyState>
      ) : (
        <div className="dash-share-body">
          <div className="dash-donut" role="img" aria-label={`${share.title}: ${share.slices.map((x) => `${x.label} ${x.value}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={share.slices.map((x) => ({ ...x, fill: colorOf(x.tone) }))} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="94%" paddingAngle={share.slices.length > 1 ? 2 : 0} stroke="var(--s-panel)" strokeWidth={2} isAnimationActive={false} onClick={(d: unknown) => go(nav, d)} style={{ cursor: 'pointer' }} />
                <Tooltip content={<ChartTip money={false} unit="" />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="dash-donut-center" aria-hidden="true">
              <strong>{share.center?.value ?? formatNumber(total)}</strong>
              <span>{share.center?.label ?? share.totalLabel}</span>
            </div>
          </div>
          <ul className="share-legend">
            {share.slices.map((x) => (
              <li key={x.key}>
                <Link to={x.to ?? '#'} className="share-row">
                  <span className="dc-dot" style={{ background: colorOf(x.tone) }} />
                  <span className="share-name">{x.label}</span>
                  <span className="share-val">{formatNumber(x.value)}</span>
                  <span className="muted small share-pct">{Math.round((x.value / total) * 100)}%</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- funnel

/**
 * Stage funnel: one centred band per stage, each tapering into the next. When every stage is smaller than the
 * one before (a conversion funnel) band width ∝ value, so drop-off reads at a glance; otherwise (e.g. ₹ per
 * current stage) bands narrow by a fixed step in stage order and the value is read from the label.
 * Label left, value + step % right (ink colours; the band carries the stage colour). Click a band to open its list.
 */
export function PipeCard({ pipe, className = 'span-6' }: { pipe: Pipe; className?: string }) {
  const nav = useNavigate();
  const total = pipe.steps.reduce((t, x) => t + x.value, 0);
  const max = Math.max(...pipe.steps.map((x) => x.value), 0);
  const fmtVal = (v: number) => (pipe.money ? compactInr(v) : formatNumber(v));
  const n = pipe.steps.length;
  const narrowing = pipe.steps.every((x, i) => i === 0 || x.value <= pipe.steps[i - 1].value);
  const STEP = n > 1 ? 50 / n : 0;
  const widthAt = (i: number) => (narrowing ? (max ? Math.max(6, (pipe.steps[i].value / max) * 100) : 0) : 100 - i * STEP);
  const tip = (x: Pipe['steps'][number]) =>
    [x.label, `${pipe.unit}: ${pipe.money ? formatMoney(x.value) : formatNumber(x.value)}`, x.amount !== undefined ? `${CD.value}: ${formatMoney(x.amount)}` : '', x.conv != null ? `${CD.fromPrevious}: ${Math.round(x.conv * 100)}%` : '']
      .filter(Boolean)
      .join(' · ');
  return (
    <Card title={pipe.title} info={pipe.info} to={pipe.to} linkLabel={CD.openList} className={`dash-pipe ${className}`}>
      {!total ? (
        <EmptyState icon="bar-chart" title={EM.pipeTitle}>
          {EM.pipeBody}
        </EmptyState>
      ) : (
        <ol className="dash-funnel" aria-label={`${pipe.title}: ${pipe.steps.map((x) => `${x.label} ${fmtVal(x.value)}`).join(', ')}`}>
          {pipe.steps.map((x, i) => {
            const top = widthAt(i);
            const bottom = i < n - 1 ? Math.min(top, widthAt(i + 1)) : narrowing ? top * 0.8 : top - STEP;
            const clip = `polygon(${50 - top / 2}% 0, ${50 + top / 2}% 0, ${50 + bottom / 2}% 100%, ${50 - bottom / 2}% 100%)`;
            return (
              <li key={x.key}>
                <button type="button" className="dash-funnel-row" data-tooltip={tip(x)} onClick={() => go(nav, x)} disabled={!x.to}>
                  <span className="dash-funnel-label">{x.label}</span>
                  <span className="dash-funnel-track">
                    <span className="dash-funnel-band" style={{ clipPath: clip, background: colorOf(x.tone) }} />
                  </span>
                  <span className="dash-funnel-value">
                    <strong>{fmtVal(x.value)}</strong>
                    {x.conv != null && <span className="muted">{Math.round(x.conv * 100)}%</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- board (top performers)

export function BoardCard({ board }: { board: Board }) {
  const nav = useNavigate();
  return (
    <Card title={board.title} info={board.info} to={board.to} className="dash-board span-6">
      {!board.rows.length ? (
        <EmptyState icon="users" title={EM.boardTitle}>
          {board.empty}
        </EmptyState>
      ) : (
        
          <Table className="dash-table">
            <caption className="sr-only">{board.title}</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                {board.columns.map((c) => (
                  <th key={c.key} scope="col" className={cx(c.num && 'num')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r, i) => (
                <tr key={r.id} className={cx(r.to && 'is-click')} onClick={() => r.to && nav(r.to)}>
                  <td className="muted">{i + 1}</td>
                  {board.columns.map((c, j) => (
                    <td key={c.key} className={cx(c.num && 'num')}>
                      {j === 0 && r.to ? (
                        <Link to={r.to} onClick={(e) => e.stopPropagation()}>
                          {r.cells[c.key]}
                        </Link>
                      ) : (
                        r.cells[c.key]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- row 4 lists

export function AgendaCard({ items, onComplete }: { items: PlanItem[]; onComplete: (i: PlanItem) => void }) {
  return (
    <Card title={L.dashboard.agenda.title} info={L.dashboard.agenda.info} to={ROUTES.calendar} linkLabel={L.nav.pages.calendar.title} className="dash-list span-4">
      {!items.length ? (
        <EmptyState icon="check-square" title={L.dashboard.agenda.emptyTitle}>
          {L.dashboard.agenda.emptyBody}
        </EmptyState>
      ) : (
        <ul className="flow-list">
          {items.slice(0, 6).map((it) => (
            <li key={it.id} className="flow-item">
              <span className={`tag tone-${it.tone}`}>{it.tag}</span>
              <Link to={it.to} className="flow-main">
                <span className="flow-title">{it.title}</span>
                <span className="muted small">{it.sub}</span>
              </Link>
              {it.taskId && <Button onClick={() => onComplete(it)}>{L.dashboard.agenda.complete}</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function FeedCard({ items }: { items: FeedItem[] }) {
  return (
    <Card title={L.dashboard.feed.title} info={L.dashboard.feed.info} to={resourcePath('tc', 'activities')} className="dash-list span-4">
      {!items.length ? (
        <EmptyState icon="message" title={L.dashboard.feed.emptyTitle}>
          {L.dashboard.feed.emptyBody}
        </EmptyState>
      ) : (
        <ul className="flow-list">
          {items.slice(0, 6).map((it) => (
            <li key={it.id} className="flow-item">
              <span className="tag tone-accent">{it.kind}</span>
              <Link to={it.to} className="flow-main">
                <span className="flow-title">{it.title}</span>
                <span className="muted small">{it.sub}</span>
              </Link>
              <time className="muted small feed-time" dateTime={it.at} title={formatDate(it.at.slice(0, 10))}>
                {relativeTime(it.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function AlertsCard({ items }: { items: AlertItem[] }) {
  return (
    <Card title={L.dashboard.alerts.title} info={L.dashboard.alerts.info} className="dash-list span-4">
      {!items.length ? (
        <EmptyState icon="check-square" title={L.dashboard.alerts.emptyTitle}>
          {L.dashboard.alerts.emptyBody}
        </EmptyState>
      ) : (
        <ul className="flow-list">
          {items.slice(0, 6).map((a) => (
            <li key={a.id} className="flow-item">
              <span className={`tag tone-${a.tone} alert-count`}>{formatNumber(a.count)}</span>
              <Link to={a.to} className="flow-main">
                <span className="flow-title">{a.label}</span>
                <span className="muted small">{a.sub}</span>
              </Link>
              <Icon name="chevron-right" size={14} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
