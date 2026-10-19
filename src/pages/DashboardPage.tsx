import { Link } from 'react-router-dom';
import { todayKey } from '../lib/dates';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { call, errorMessage } from '../services/api/client';
import { useActor } from '../services/hooks';
import { overviewFor, type PlanItem } from '../services/reports/dashboard';
import { transitionRecord } from '../services/runtime';
import { Button } from '../components/primitives/Button';
import { EmptyState, ErrorState, Skeleton, useToast } from '../components/primitives/feedback';
import { InfoTip } from '../components/primitives/InfoTip';
import { PageHeader } from '../components/shell/PageHeader';
import { KpiTiles, RankBars } from '../modules/reports/components';
import '../modules/reports/reports.css';

/**
 * Role overview (FR-149, NFR-22). Sections adapt to the signed-in role; every number is computed
 * from records read through the scoped services and links to the list it summarises.
 */
export function DashboardPage() {
  const actor = useActor();
  const toast = useToast();
  const today = todayKey();
  const q = useServiceQuery(() => overviewFor(actor), [actor.user.id, today]);
  const first = actor.user.name.split(' ')[0];
  const header = <PageHeader title={`Good day, ${first}`} description={`${actor.role.label} overview${q.data ? ` · ${q.data.headline}` : ''}. Figures follow what your role can see and refresh on every change.`} />;

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
    <div className="page">
      {header}
      <KpiTiles tiles={todayTiles} label="Today" />
      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title dialog-title-row">
              Today’s plan
              <InfoTip text="Your overdue and due items first: tasks, lead and opportunity follow-ups, assigned jobs, PM visits and planned field visits." label="About today’s plan" />
            </h2>
            <Link to="/calendar" className="link small">
              Calendar
            </Link>
          </div>
          <PlanList items={plan} empty="Nothing due. New tasks, follow-ups and jobs assigned to you appear here." onComplete={complete} />
        </section>
        {sections[0]?.chart && (
          <section className="panel">
            <RankBars {...sections[0].chart} />
          </section>
        )}
      </div>

      {sections.map((sec, i) => (
        <section key={sec.id} className="dash-section" aria-labelledby={`sec-${sec.id}`}>
          <div className="dash-section-head">
            <h2 id={`sec-${sec.id}`} className="dash-section-title">
              {sec.title}
            </h2>
            <InfoTip text={sec.info} label={`About ${sec.title}`} />
          </div>
          <KpiTiles tiles={sec.tiles} label={sec.title} />
          {((sec.chart && i > 0) || sec.list) && (
            <div className="dash-grid">
              {sec.chart && i > 0 && (
                <section className="panel">
                  <RankBars {...sec.chart} />
                </section>
              )}
              {sec.list && (
                <section className="panel">
                  <div className="panel-head">
                    <h3 className="panel-title">{sec.list.title}</h3>
                    {sec.list.to && (
                      <Link to={sec.list.to} className="link small">
                        View all
                      </Link>
                    )}
                  </div>
                  <PlanList items={sec.list.items} empty={sec.list.empty} />
                </section>
              )}
            </div>
          )}
        </section>
      ))}
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
