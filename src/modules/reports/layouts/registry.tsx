import type { ComponentType } from 'react';
import { L } from '../../../constants/labels';
import { Leaderboard, type LeaderCfg } from './Leaderboard';
import { AttendanceCalendar, HeatGrid } from './HeatLayouts';
import { ScorecardLayout } from './ScorecardLayout';
import { ShareRings } from './ShareRings';
import { TrendStory } from './TrendStory';
import { StageBoard, type BoardColumn } from './StageBoard';
import { cellText, hrefOf, money, num, text, type LayoutProps } from './shared';

const W = L.reports.layouts;
const leader = (cfg: LeaderCfg): ComponentType<LayoutProps> => (p) => <Leaderboard {...p} cfg={cfg} />;

/** Pipeline by stage: one column per stage with its count, value, weighted value and average deal. */
const PipelineStages = (p: LayoutProps) => {
  const columns: BoardColumn[] = p.out.rows.map((r) => ({
    key: r._key,
    label: text(r.stage),
    count: num(r.opportunities),
    value: num(r.value),
    sub: `${W.weighted} ${money(num(r.weighted))} · ${W.avgDeal} ${money(num(r.avgDeal))}`,
  }));
  const top = [...columns].sort((a, b) => b.value - a.value)[0];
  return <StageBoard {...p} columns={columns} fmt="money" head={top ? W.boardHead(top.label, money(top.value)) : ''} />;
};

/** Backlog: orders grouped by status, the biggest first inside each column. */
const BacklogBoard = (p: LayoutProps) => {
  const by = new Map<string, typeof p.out.rows>();
  p.out.rows.forEach((r) => by.set(text(r.status), [...(by.get(text(r.status)) ?? []), r]));
  const order = (p.out.chart?.points ?? []).map((x) => x.label);
  const columns: BoardColumn[] = [...by.entries()]
    .map(([status, rows]) => ({
      key: status,
      label: cellText(p.out, 'status', status),
      count: rows.length,
      value: rows.reduce((t, r) => t + num(r.value), 0),
      sub: undefined,
      items: [...rows]
        .sort((a, b) => num(b.value) - num(a.value))
        .map((r) => ({ id: r._key, title: text(r.order), sub: text(r.customer), amount: money(num(r.value)), href: hrefOf(p.out, r) })),
    }))
    .sort((a, b) => (order.indexOf(a.label) + 1 || 99) - (order.indexOf(b.label) + 1 || 99) || b.value - a.value);
  const total = columns.reduce((t, c) => t + c.value, 0);
  const count = columns.reduce((t, c) => t + c.count, 0);
  return <StageBoard {...p} columns={columns} fmt="money" head={W.backlogHead(count, money(total))} />;
};

interface Band {
  key: string;
  label: string;
  /** Inclusive upper bound of the band (days). */
  max: number;
}
interface BandCfg {
  age: string;
  bands: Band[];
  /** Sum this money column in each band (otherwise the band's figure is its count). */
  amount?: string;
  title: string;
  sub: (r: LayoutProps['out']['rows'][number], out: LayoutProps['out']) => string;
  head: (out: LayoutProps['out']) => string;
  /** Bands from this position on are shown as late (amber, then red). */
  warnFrom: number;
  /** Rows that belong on the board (e.g. only payments still outstanding). */
  include?: (r: LayoutProps['out']['rows'][number]) => boolean;
}

/** Records grouped by how long they have waited (or been late): oldest first inside each band. */
const bandBoard = (cfg: BandCfg): ComponentType<LayoutProps> => (p) => {
  const use = cfg.include ? p.out.rows.filter(cfg.include) : p.out.rows;
  const columns: BoardColumn[] = cfg.bands.map((b, i) => {
    const min = i ? cfg.bands[i - 1].max : -Infinity;
    const rows = use.filter((r) => num(r[cfg.age]) > min && num(r[cfg.age]) <= b.max).sort((a, c) => num(c[cfg.age]) - num(a[cfg.age]));
    return {
      key: b.key,
      label: b.label,
      count: rows.length,
      value: cfg.amount ? rows.reduce((t, r) => t + num(r[cfg.amount!]), 0) : rows.length,
      tone: i > cfg.warnFrom ? 'bad' : i === cfg.warnFrom ? 'warn' : undefined,
      items: rows.map((r) => ({ id: r._key, title: text(r[cfg.title]), sub: cfg.sub(r, p.out), amount: cfg.amount ? money(num(r[cfg.amount])) : undefined, href: hrefOf(p.out, r) })),
    } satisfies BoardColumn;
  });
  return <StageBoard {...p} columns={columns.filter((c) => c.count > 0)} fmt={cfg.amount ? 'money' : 'number'} head={cfg.head({ ...p.out, rows: use })} />;
};

const LEAD_BANDS: Band[] = [
  { key: 'd1', label: W.ageBands.d1, max: 1 },
  { key: 'd3', label: W.ageBands.d3, max: 3 },
  { key: 'd7', label: W.ageBands.d7, max: 7 },
  { key: 'd14', label: W.ageBands.d14, max: 14 },
  { key: 'd15', label: W.ageBands.d15, max: Infinity },
];
const AgeingBoard = bandBoard({
  age: 'age',
  bands: LEAD_BANDS,
  title: 'lead',
  warnFrom: 2,
  sub: (r, out) => `${text(r.owner)} · ${cellText(out, 'status', r.status)}`,
  head: (out) => W.ageHead(out.rows.length, out.rows.filter((r) => num(r.age) > 7).length),
});
const TicketBoard = bandBoard({
  age: 'ageDays',
  bands: [
    { key: 'd1', label: W.ticketBands.d1, max: 1 },
    { key: 'd3', label: W.ticketBands.d3, max: 3 },
    { key: 'd7', label: W.ticketBands.d7, max: 7 },
    { key: 'd14', label: W.ticketBands.d14, max: 14 },
    { key: 'd15', label: W.ticketBands.d15, max: Infinity },
  ],
  title: 'id',
  warnFrom: 2,
  sub: (r, out) => `${text(r.customer)} · ${cellText(out, 'priority', r.priority)}`,
  head: (out) => W.ticketHead(out.rows.length, out.rows.filter((r) => num(r.ageDays) > 7).length),
});
const PaymentBoard = bandBoard({
  age: 'overdueDays',
  amount: 'outstanding',
  bands: [
    { key: 'due', label: W.payBands.due, max: 0 },
    { key: 'd30', label: W.payBands.d30, max: 30 },
    { key: 'd60', label: W.payBands.d60, max: 60 },
    { key: 'd90', label: W.payBands.d90, max: 90 },
    { key: 'd91', label: W.payBands.d91, max: Infinity },
  ],
  title: 'order',
  warnFrom: 1,
  include: (r) => num(r.outstanding) > 0,
  sub: (r) => text(r.customer),
  head: (out) => W.payHead(out.rows.length, money(out.rows.reduce((t, r) => t + num(r.outstanding), 0)), out.rows.filter((r) => num(r.overdueDays) > 0).length),
});

const ring = (donut: boolean): ComponentType<LayoutProps> => (p) => <ShareRings {...p} donut={donut} />;

const REGISTRY: Record<string, ComponentType<LayoutProps>> = {
  'order-value:value': TrendStory,
  'lead-conversion:conversion': TrendStory,
  'sla-compliance:sla': TrendStory,
  'pm-compliance:pm': TrendStory,
  'payment-status:payments': PaymentBoard,
  'open-tickets:open': TicketBoard,
  'lost-leads:reasons': ring(true),
  'lost-quotations:lost': ring(true),
  'installed-base-by-model:base': ring(true),
  'machine-reliability:downtime': ring(true),
  'machine-reliability:repeats': ring(true),
  'machine-reliability:mtbf': leader({ name: 'model', value: 'mtbf', fmt: 'days', extras: [{ key: 'machines', label: 'Machines', fmt: 'number' }, { key: 'breakdowns', label: 'Breakdowns', fmt: 'number' }] }),
  'referrals:referrals': leader({ name: 'referrer', value: 'leads', fmt: 'number', extras: [{ key: 'converted', label: 'Converted', fmt: 'number' }, { key: 'open', label: 'Open', fmt: 'number' }, { key: 'conversion', label: 'Conversion', fmt: 'pct' }] }),
  'attendance:daily': AttendanceCalendar,
  'attendance:employee': leader({ name: 'employee', value: 'present', fmt: 'number', extras: [{ key: 'lateDays', label: 'Late days', fmt: 'number' }, { key: 'leave', label: 'Leave', fmt: 'number' }, { key: 'km', label: 'Km', fmt: 'number' }] }),
  'attendance:exceptions': ring(true),
  'field-visits:hours': HeatGrid,
  'business-scorecard:scorecard': ScorecardLayout,
  'pipeline-forecast:stage': PipelineStages,
  'pipeline-forecast:owner': leader({ name: 'owner', value: 'weighted', fmt: 'money', extras: [{ key: 'opportunities', label: 'Deals', fmt: 'number' }, { key: 'value', label: 'Pipeline', fmt: 'money' }] }),
  'order-backlog:backlog': BacklogBoard,
  'lead-speed:ageing': AgeingBoard,
  'exec-performance:performance': leader({ name: 'owner', value: 'booked', fmt: 'money', extras: [{ key: 'leads', label: 'Leads', fmt: 'number' }, { key: 'conversion', label: 'Conversion', fmt: 'pct' }, { key: 'winRate', label: 'Win rate', fmt: 'pct' }] }),
  'exec-performance:target': leader({ name: 'owner', value: 'booked', fmt: 'money', target: 'target' }),
  'quotation-value:value': leader({ name: 'group', value: 'value', fmt: 'money', extras: [{ key: 'quotes', label: 'Quotes', fmt: 'number' }, { key: 'rate', label: 'Ordered', fmt: 'pct' }, { key: 'avgDiscount', label: 'Avg discount', fmt: 'pct' }] }),
  'service-quality:engineer': leader({ name: 'engineer', value: 'resolved', fmt: 'number', extras: [{ key: 'mttr', label: 'Fix time', fmt: 'hours' }, { key: 'ftfr', label: 'First-time fix', fmt: 'pct' }, { key: 'csat', label: 'CSAT', fmt: 'rating' }] }),
  'field-visits:visits': leader({ name: 'employee', value: 'completed', fmt: 'number', extras: [{ key: 'planned', label: 'Planned', fmt: 'number' }, { key: 'adherence', label: 'Adherence', fmt: 'pct' }] }),
  'crm-adoption:adoption': leader({ name: 'user', value: 'activities', fmt: 'number', status: { key: 'active', good: L.reports.defs.crmAdoption.active }, extras: [{ key: 'created', label: 'Created', fmt: 'number' }, { key: 'updated', label: 'Updated', fmt: 'number' }, { key: 'overdue', label: 'Overdue', fmt: 'number' }] }),
};

export const getLayout = (reportId: string, viewId: string): ComponentType<LayoutProps> | undefined => REGISTRY[`${reportId}:${viewId}`];
export { ViewData } from './shared';
export type { LayoutProps };
