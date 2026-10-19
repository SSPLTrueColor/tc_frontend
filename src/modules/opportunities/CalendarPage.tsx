import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, formatWeekdayFull, startOfWeek, todayKey } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { useActor } from '../../services/hooks';
import { calendarItems, type CalendarItem } from '../../services/opportunities';
import { Button, IconButton } from '../../components/primitives/Button';
import { EmptyState, ErrorState, Skeleton } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { PageHeader } from '../../components/shell/PageHeader';

type Span = 7 | 14 | 31;
const KIND: Record<CalendarItem['kind'], { label: string; tone: string }> = {
  task: { label: 'Task', tone: 'info' },
  demo: { label: 'Demo', tone: 'accent' },
  close: { label: 'Close', tone: 'warning' },
  follow_up: { label: 'Follow-up', tone: 'neutral' },
};

/** FR-034: tasks, demos, expected close dates and follow-ups in one agenda for the actor's scope. */
export function CalendarPage() {
  const actor = useActor();
  const today = todayKey();
  const [from, setFrom] = useState(startOfWeek(today));
  const [span, setSpan] = useState<Span>(7);
  const [mine, setMine] = useState(true);
  const to = addDays(from, span - 1);
  const includesToday = from <= today && today <= to;
  // When the range includes today, also show what is overdue (up to 60 days back).
  const queryFrom = includesToday ? addDays(today, -60) : from;
  const q = useServiceQuery(() => calendarItems(actor, queryFrom, to, mine), [actor.user.id, queryFrom, to, mine]);

  const overdue = (q.data ?? []).filter((i) => i.date < from || (i.date < today && includesToday));
  const upcoming = (q.data ?? []).filter((i) => !overdue.includes(i));
  const days = Array.from({ length: span }, (_, i) => addDays(from, i)).filter((d) => !includesToday || d >= today);

  const item = (i: CalendarItem) => (
    <li key={i.id} className="flow-item">
      <span className={`tag tone-${i.overdue ? 'danger' : KIND[i.kind].tone}`}>{i.time ? `${KIND[i.kind].label} ${i.time}` : KIND[i.kind].label}</span>
      <Link to={recordPeekPath(actor.workspaceId, i.resource, i.recordId)} className="flow-main">
        <span className="flow-title">{i.title}</span>
        <span className="muted small">
          {i.overdue ? `Was due ${formatDate(i.date)} · ` : ''}
          {i.sub}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="page">
      <PageHeader title="Calendar" description="Your tasks, demos, expected close dates and follow-ups in one place. Switch off “Only mine” to see everything your role can see." />
      <div className="toolbar">
        <IconButton icon="chevron-left" label="Previous period" onClick={() => setFrom(addDays(from, -span))} />
        <Button onClick={() => setFrom(span === 7 ? startOfWeek(today) : today)} disabledReason={includesToday ? 'Already showing today' : undefined}>
          Today
        </Button>
        <IconButton icon="chevron-right" label="Next period" onClick={() => setFrom(addDays(from, span))} />
        <strong>
          {formatDate(from)} – {formatDate(to)}
        </strong>
        <div className="segmented" role="radiogroup" aria-label="Range">
          {([7, 14, 31] as Span[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={span === s} className={`seg-btn${span === s ? ' is-on' : ''}`} onClick={() => setSpan(s)}>
              {s === 7 ? 'Week' : s === 14 ? '2 weeks' : 'Month'}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine
        </label>
        <span className="spacer" />
        <Button icon="calendar" disabledReason="Google / Outlook calendar sync needs a server-side OAuth connection (not part of this prototype)">
          Sync calendar
        </Button>
      </div>
      {q.error ? (
        <ErrorState title="Could not load the calendar" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={8} />
      ) : !q.data.length ? (
        <EmptyState icon="calendar" title="Nothing scheduled">
          {mine ? 'Nothing assigned to you in this period. Turn off “Only mine” to see your scope.' : 'No tasks, demos, closes or follow-ups in this period.'}
        </EmptyState>
      ) : (
        <div className="dash-grid">
          {overdue.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title dialog-title-row">
                  Overdue
                  <InfoTip text="Open items whose date has passed (last 60 days)." label="About overdue items" />
                </h2>
                <span className="muted small">{overdue.length}</span>
              </div>
              <ul className="flow-list">{overdue.map(item)}</ul>
            </section>
          )}
          {days.map((d) => {
            const list = upcoming.filter((i) => i.date === d);
            if (!list.length) return null;
            return (
              <section key={d} className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">{d === today ? `Today · ${formatWeekdayFull(d)}` : formatWeekdayFull(d)}</h2>
                  <span className="muted small">{list.length}</span>
                </div>
                <ul className="flow-list">{list.map(item)}</ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
