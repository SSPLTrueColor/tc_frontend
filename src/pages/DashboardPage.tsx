import { Link, useSearchParams } from 'react-router-dom';
import { todayKey } from '../lib/dates';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { call, errorMessage } from '../services/api/client';
import { useActor } from '../services/hooks';
import { overviewFor, type PlanItem, type Section, type Tile } from '../services/reports/dashboard';
import { transitionRecord } from '../services/runtime';
import { Button } from '../components/primitives/Button';
import { EmptyState, ErrorState, Skeleton, Tabs, useToast } from '../components/primitives/feedback';
import { InfoTip } from '../components/primitives/InfoTip';
import { PageHeader } from '../components/shell/PageHeader';
import { KpiTiles, RankBars } from '../modules/reports/components';
import '../modules/reports/reports.css';

const PLAN_LIMIT = 6;
const STRIP_LIMIT = 6;
const urgency = (t: Tile) => (t.tone === 'danger' ? 0 : t.tone === 'warning' ? 1 : 2);

/** The one figure per area that most needs the user's eye: the worst-coloured tile, else the first. */
function attentionStrip(today: Tile[], sections: Section[]): Tile[] {
  const picks = sections.map((s) => [...s.tiles].sort((a, b) => urgency(a) - urgency(b))[0]).filter(Boolean);
  return [...today.slice(0, 1), ...picks, ...today.slice(1)].slice(0, STRIP_LIMIT);
}

/**
 * Role overview (FR-149, NFR-22) — designed to fit one screen:
 * 1. Attention strip: one key figure per area, coloured by meaning (green good, amber needs attention, red act now).
 * 2. Today's plan (left) beside one tabbed panel per area (right) instead of long stacked sections.
 * Every number is computed from records the role can see and links to the list it summarises.
 */
export function DashboardPage() {
  const actor = useActor();
  const toast = useToast();
  const today = todayKey();
  const [params, setParams] = useSearchParams();
  const q = useServiceQuery(() => overviewFor(actor), [actor.user.id, today]);
  const first = actor.user.name.split(' ')[0];
  const header = <PageHeader title={`Good day, ${first}`} description={`${actor.role.label} overview${q.data ? ` · ${q.data.headline}` : ''}. Colours: green good, amber needs attention, red act now. Every figure opens the list behind it.`} />;

  if (q.error)
    return (
      <div className="page">
        {header}
        <ErrorState title="Could not load your overview" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        {header}
        <Skeleton rows={10} />
      </div>
    );

  const { plan, today: todayTiles, sections } = q.data;
  const tabId = sections.some((s) => s.id === params.get('area')) ? params.get('area')! : sections[0]?.id;
  const active = sections.find((s) => s.id === tabId);

  const complete = async (item: PlanItem) => {
    if (!item.taskId) return;
    try {
      await call(() => transitionRecord(actor, 'tasks', item.taskId!, 'done', item.taskVersion ?? 1));
      toast(`${item.taskId} completed`);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };

  return (
    <div className="page dash-page">
      {header}
      <KpiTiles tiles={attentionStrip(todayTiles, sections)} label="Needs your attention" />

      <div className="dash-main">
        <section className="panel dash-plan">
          <div className="panel-head">
            <h2 className="panel-title dialog-title-row">
              Today’s plan
              <InfoTip text="Your overdue and due items first: tasks, lead and opportunity follow-ups, assigned jobs, PM visits and planned field visits." label="About today’s plan" />
            </h2>
            <Link to="/calendar" className="link small">
              {plan.length > PLAN_LIMIT ? `View all ${plan.length}` : 'Calendar'}
            </Link>
          </div>
          <PlanList items={plan.slice(0, PLAN_LIMIT)} empty="Nothing due. New tasks, follow-ups and jobs assigned to you appear here." onComplete={complete} />
        </section>

        {active && (
          <section className="panel dash-area" aria-label={active.title}>
            {sections.length > 1 ? (
              <Tabs label="Overview areas" value={active.id} onChange={(id) => setParams({ area: id }, { replace: true })} tabs={sections.map((s) => ({ id: s.id, label: s.title }))} />
            ) : (
              <div className="panel-head">
                <h2 className="panel-title dialog-title-row">
                  {active.title}
                  <InfoTip text={active.info} label={`About ${active.title}`} />
                </h2>
              </div>
            )}
            <div className="dash-area-body" role={sections.length > 1 ? 'tabpanel' : undefined}>
              <KpiTiles tiles={active.tiles} label={active.title} />
              {(active.chart || active.list) && (
                <div className={active.chart && active.list ? 'dash-area-split' : undefined}>
                  {active.chart && <RankBars {...active.chart} compact />}
                  {active.list && (
                    <div>
                      <div className="panel-head">
                        <h3 className="chart-title">{active.list.title}</h3>
                        {active.list.to && (
                          <Link to={active.list.to} className="link small">
                            View all
                          </Link>
                        )}
                      </div>
                      <PlanList items={active.list.items.slice(0, 4)} empty={active.list.empty} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function PlanList({ items, empty, onComplete }: { items: PlanItem[]; empty: string; onComplete?: (i: PlanItem) => void }) {
  if (!items.length)
    return (
      <EmptyState icon="check-square" title="All clear">
        {empty}
      </EmptyState>
    );
  return (
    <ul className="flow-list">
      {items.map((it) => (
        <li key={it.id} className="flow-item">
          <span className={`tag tone-${it.tone}`}>{it.tag}</span>
          <Link to={it.to} className="flow-main">
            <span className="flow-title">{it.title}</span>
            <span className="muted small">{it.sub}</span>
          </Link>
          {onComplete && it.taskId && <Button onClick={() => onComplete(it)}>Complete</Button>}
        </li>
      ))}
    </ul>
  );
}
