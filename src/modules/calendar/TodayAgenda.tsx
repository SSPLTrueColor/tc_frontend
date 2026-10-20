import { L } from '../../constants/labels';
import { formatTime } from '../../lib/dates';
import { occurrences, type CalItem } from '../../services/calendar/events';

const T = L.calendar.today;

export interface TodayInfo {
  count: number;
  next: { title: string; when: string; id: string } | null;
  over: boolean;
}

/** Today's events (cancelled excluded), and the next timed one still ahead (IST wall clock). */
export function todaySummary(items: CalItem[], nowWall: string): TodayInfo {
  const day = nowWall.slice(0, 10);
  const rows = items
    .filter((i) => i.status !== 'cancelled')
    .flatMap((i) => occurrences(i, `${day}T00:00`, `${day}T23:59`).map((o) => ({ i, o })));
  const upcoming = rows.filter((r) => !r.i.allDay && r.o.start >= nowWall).sort((a, b) => a.o.start.localeCompare(b.o.start));
  const first = upcoming[0];
  return { count: rows.length, next: first ? { title: first.i.title, when: formatTime(first.o.start), id: first.i.id } : null, over: rows.length > 0 && !first && rows.every((r) => r.i.allDay || r.o.end < nowWall) };
}

export function TodayAgenda({ info, onOpen }: { info: TodayInfo; onOpen: () => void }) {
  return (
    <button type="button" className="cal-today-strip" onClick={onOpen} aria-label={T.open}>
      <span className="cal-today-badge">{T.heading}</span>
      <span className="cal-today-count">{T.count(info.count)}</span>
      {info.next ? <span className="cal-today-next">{T.next(info.next.when, info.next.title)}</span> : info.over ? <span className="cal-today-next">{T.allDone}</span> : null}
    </button>
  );
}
