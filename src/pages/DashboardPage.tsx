import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { L } from '../constants/labels';
import { addDays, todayKey } from '../lib/dates';
import { cx } from '../lib/format';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { call, errorMessage } from '../services/api/client';
import { useActor } from '../services/hooks';
import type { PlanItem } from '../services/reports/dashboard';
import { dashboardFor, MAX_RANGE_DAYS, resolveRange, type RangeKey } from '../services/reports/overview';
import { transitionRecord } from '../services/runtime';
import { DateRangePicker } from '../components/primitives/DateRangePicker';
import { ErrorState, useToast } from '../components/primitives/feedback';
import { PageHeader } from '../components/shell/PageHeader';
import { AgendaCard, AlertsCard, BoardCard, CardSkeleton, FeedCard, KpiCard, KpiSkeleton, PipeCard, ShareCard, TrendCard } from '../modules/dashboard/widgets';
import '../modules/reports/reports.css';
import '../modules/dashboard/dashboard.css';

const D = L.dashboard;
const PRESETS: { id: RangeKey; label: string }[] = (['today', '7d', '30d', 'month', 'custom'] as const).map((id) => ({ id, label: D.range.presets[id] }));
const isRangeKey = (v: string | null): v is RangeKey => PRESETS.some((p) => p.id === v);

/**
 * Role dashboard (FR-149, NFR-22): one global date range drives every widget.
 * Row 1 KPI cards · Row 2 trend + status share · Row 3 pipeline + top performers · Row 4 agenda, activity, alerts.
 * The range lives in the URL (?range=30d or ?range=custom&from=…&to=…) so it survives refresh and can be shared.
 */
export function DashboardPage() {
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const today = todayKey();

  const key: RangeKey = isRangeKey(params.get('range')) ? (params.get('range') as RangeKey) : '30d';
  const custom = useMemo(() => {
    const from = params.get('from') ?? addDays(today, -29);
    const to = params.get('to') ?? today;
    return { from, to };
  }, [params, today]);
  const range = useMemo(() => {
    const r = resolveRange(key, custom, today);
    // Keep custom ranges to a year so charts stay readable.
    return r.days > MAX_RANGE_DAYS ? resolveRange('custom', { from: addDays(r.to, -(MAX_RANGE_DAYS - 1)), to: r.to }, today) : r;
  }, [key, custom, today]);

  const q = useServiceQuery(() => dashboardFor(actor, range), [actor.user.id, range.key, range.from, range.to, today]);
  const first = actor.user.name.split(' ')[0];

  const setRange = (id: RangeKey) => {
    const next = new URLSearchParams(params);
    next.set('range', id);
    if (id === 'custom') {
      next.set('from', custom.from);
      next.set('to', custom.to);
    } else {
      next.delete('from');
      next.delete('to');
    }
    setParams(next, { replace: true });
  };
  const setCustom = (v: { from?: string; to?: string }) => {
    if (!v.from || !v.to) return;
    const next = new URLSearchParams(params);
    next.set('range', 'custom');
    next.set('from', v.from);
    next.set('to', v.to);
    setParams(next, { replace: true });
  };

  const complete = async (item: PlanItem) => {
    if (!item.taskId) return;
    try {
      await call(() => transitionRecord(actor, 'tasks', item.taskId!, 'done', item.taskVersion ?? 1));
      toast(D.page.taskCompleted(item.taskId));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };

  const header = <PageHeader title={L.nav.pages.dashboard.title} description={D.page.description(D.page.greeting(first), actor.role.label, q.data?.headline)} />;

  const bar = (
    <div className="dash2-bar" role="group" aria-label={D.range.group}>
      <div className="segmented" role="radiogroup" aria-label={D.range.presetsGroup}>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={key === p.id} className={cx('seg-btn', key === p.id && 'is-on')} onClick={() => setRange(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {key === 'custom' && (
        <span className="rep-date">
          <DateRangePicker label={D.range.custom} value={{ from: range.from, to: range.to }} onChange={setCustom} />
        </span>
      )}
      <span className="dash2-bar-note">
        {D.range.compared(range.label, range.days)}
      </span>
    </div>
  );

  if (q.error)
    return (
      <div className="page dash2">
        {header}
        {bar}
        <ErrorState title={D.page.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );

  const d = q.data;
  if (!d)
    return (
      <div className="page dash2">
        {header}
        {bar}
        <div className="dash2-kpis" style={{ ['--n' as string]: 5 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <KpiSkeleton key={i} />
          ))}
        </div>
        <div className="dash2-grid">
          <CardSkeleton className="span-8" rows={8} />
          <CardSkeleton className="span-4" rows={8} />
          <CardSkeleton className="span-6" rows={7} />
          <CardSkeleton className="span-6" rows={7} />
          <CardSkeleton className="span-4" rows={5} />
          <CardSkeleton className="span-4" rows={5} />
          <CardSkeleton className="span-4" rows={5} />
        </div>
      </div>
    );

  return (
    <div className="page dash2">
      {header}
      {bar}
      <section className="dash2-kpis" style={{ ['--n' as string]: d.kpis.length }} aria-label={D.page.keyFigures}>
        {d.kpis.map((k) => (
          <KpiCard key={k.id} kpi={k} />
        ))}
      </section>
      <div className="dash2-grid">
        <TrendCard trend={d.trend} />
        <ShareCard share={d.share} />
        <PipeCard pipe={d.pipe} />
        <BoardCard board={d.board} />
        <AgendaCard items={d.agenda} onComplete={complete} />
        <FeedCard items={d.feed} />
        <AlertsCard items={d.alerts} />
      </div>
    </div>
  );
}
