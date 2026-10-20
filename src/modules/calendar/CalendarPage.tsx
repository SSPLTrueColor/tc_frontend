import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { L } from '../../constants/labels';
import { istNow } from '../../lib/clock';
import { addDays, formatDate, formatDateTime, formatTime } from '../../lib/dates';
import { cx } from '../../lib/format';
import { PHONE, useMedia } from '../../lib/useMedia';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { calendarService } from '../../services/api/calendar';
import { perm } from '../../services/authz';
import { findOverlaps, listCalendarItems, occurrences, validateEvent, type CalItem, type EventType } from '../../services/calendar/events';
import { useActor } from '../../services/hooks';
import { activeMasterValues } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { Button } from '../../components/primitives/Button';
import { EmptyState, ErrorState, InlineAlert, Skeleton, useToast } from '../../components/primitives/feedback';
import { confirmDelete, Dialog, Popover } from '../../components/primitives/overlay';
import { PageHeader } from '../../components/shell/PageHeader';
import { CalendarSidebar } from './CalendarSidebar';
import { CalendarHead, CalendarToolbar } from './CalendarChrome';
import { countDays, dayLoadOptions } from './dayLoad';
import { clock12, clockShort, fullText, hhmm, matches, minutes, toFc, wall, type ViewId } from './calendarUtils';
import { EventDetail, type Detail } from './EventDetail';
import { EventDialog, type DialogMode } from './EventDialog';
import { QuickCreate, type Slot } from './QuickCreate';
import { todaySummary } from './TodayAgenda';
import { useCalendarShortcuts } from './useCalendarShortcuts';
import './calendar.css';

const C = L.calendar;
type Scope = 'this' | 'following' | 'all';

type Prompt =
  | { kind: 'scope'; title: string; verb: 'move' | 'edit' | 'delete'; resolve: (v: Scope | null) => void }
  | { kind: 'overlap'; lines: string[]; resolve: (keep: boolean) => void };

interface QuickState {
  slot: Slot;
  /** Element to anchor the popover to; null → a point (x, y) in the viewport. */
  el: HTMLElement | null;
  x: number;
  y: number;
}

const nextHour = (nowWall: string) => {
  const h = Math.min(22, +nowWall.slice(11, 13) + 1);
  return `${String(h).padStart(2, '0')}:00`;
};

/** Default one-hour slot for a day: 10:00, or the next full hour when the day is today. Null for a past day. */
function slotFor(day: string, nowWall: string): Slot | null {
  const today = nowWall.slice(0, 10);
  if (day < today) return null;
  const at = day === today ? (nextHour(nowWall) > '10:00' ? nextHour(nowWall) : '10:00') : '10:00';
  return { start: `${day}T${at}`, end: `${day}T${hhmm(Math.min(23 * 60 + 59, +at.slice(0, 2) * 60 + 60))}`, allDay: false };
}

/**
 * Calendar (Google Calendar / Outlook style) on FullCalendar, themed with the template tokens.
 * Own events are fully editable (drag, resize with Undo, recurrence with "this / this and following / all");
 * items from other modules (tasks, demos, PM visits, installations, follow-ups) are shown read-only.
 */
export function CalendarPage() {
  const actor = useActor();
  const toast = useToast();
  const phone = useMedia(PHONE);
  const cal = useRef<FullCalendar>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const virtual = useRef<HTMLDivElement>(null);
  const today = istNow().slice(0, 10);
  const query = useServiceQuery(() => listCalendarItems(actor), [actor.user.id]);
  const canCreate = perm(actor, 'calendarEvents').create;

  const [nowWall, setNowWall] = useState(() => istNow().slice(0, 16));
  const [view, setView] = useState<ViewId>(phone ? 'agenda' : 'dayGridMonth');
  const [title, setTitle] = useState('');
  const [cursor, setCursor] = useState(today);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [types, setTypes] = useState<Set<EventType>>(new Set(activeMasterValues('calEventType').map((v) => v.key as EventType)));
  const [statuses, setStatuses] = useState<Set<string>>(new Set(['scheduled', 'completed']));
  const [person, setPerson] = useState<string>('all');
  const [withModules, setWithModules] = useState(false);
  const [search, setSearch] = useState('');
  const [sideOpen, setSideOpen] = useState(() => !phone && window.innerWidth >= 1180);
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [quick, setQuick] = useState<QuickState | null>(null);
  const anchor = useRef<HTMLElement | null>(null) as MutableRefObject<HTMLElement | null>;

  useEffect(() => {
    const t = setInterval(() => setNowWall(istNow().slice(0, 16)), 60_000);
    return () => clearInterval(t);
  }, []);

  const items = useMemo(() => query.data ?? [], [query.data]);
  const people = useMemo(() => {
    const ids = [...new Set(items.map((i) => i.assigneeId).filter(Boolean))];
    return ids.map((id) => ({ value: id, label: recordTitle('employees', id, actor) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [items, actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const passes = useCallback(
    (i: CalItem) =>
      types.has(i.type) &&
      statuses.has(i.status) &&
      (withModules || i.source === 'event') &&
      (person === 'all' || (person === 'me' ? i.assigneeId === actor.staffId || i.attendeeIds.includes(actor.staffId) : i.assigneeId === person || i.attendeeIds.includes(person))),
    [types, statuses, withModules, person, actor.staffId],
  );
  const visible = useMemo(() => items.filter((i) => passes(i) && matches(i, search)), [items, passes, search]);
  const events = useMemo(() => visible.map(toFc), [visible]);
  const filtering = search.trim() !== '' || visible.length !== items.length;

  const counts = useMemo(() => {
    const monthStart = addDays(`${cursor.slice(0, 7)}-01`, -7);
    const from = range && range.from < monthStart ? range.from : monthStart;
    let to = addDays(monthStart, 50);
    if (range && range.to > to) to = range.to;
    const spans: { start: string; end: string }[] = [];
    visible.forEach((i) => occurrences(i, from, `${to}T23:59`).forEach((o) => spans.push({ start: o.start, end: o.end })));
    return countDays(spans, from, to);
  }, [visible, cursor, range]);

  const countIn = useCallback((rows: CalItem[]) => (range ? rows.reduce((n, i) => n + occurrences(i, `${range.from}T00:00`, `${addDays(range.to, -1)}T23:59`).length, 0) : 1), [range]);
  const inRange = useMemo(() => countIn(visible), [countIn, visible]);
  const hiddenInRange = useMemo(() => (inRange === 0 && filtering ? countIn(items) : 0), [countIn, inRange, filtering, items]);
  const todayInfo = useMemo(() => todaySummary(visible, nowWall), [visible, nowWall]);

  const api = () => cal.current?.getApi();
  const go = (fn: 'today' | 'prev' | 'next') => api()?.[fn]();
  const changeView = (v: ViewId) => {
    setView(v);
    api()?.changeView(v);
  };

  const ask = <T,>(p: (resolve: (v: T) => void) => Prompt) => new Promise<T>((resolve) => setPrompt(p(resolve as never)));
  const overlapOk = async (draft: { id?: string; start: string; end: string; allDay: boolean; assigneeId: string }, occurrenceOf?: string) => {
    const o = findOverlaps(actor, draft, occurrenceOf);
    if (!o.length) return true;
    return ask<boolean>((resolve) => ({ kind: 'overlap', lines: o.slice(0, 4).map((x) => `${x.title} · ${formatTime(x.start)}–${formatTime(x.end)}`), resolve }));
  };

  // ---------------------------------------------------------------- reschedule (drag / resize) with Undo and Retry

  const undoable = (item: CalItem, scope: Scope, oldStart: string, res: { id: string }) => async () => {
    try {
      if (item.recurrence !== 'none' && scope === 'this') await calendarService.undoOccurrence(actor, item.recordId, res.id, oldStart);
      else {
        if (res.id !== item.recordId) await calendarService.remove(actor, res.id);
        await calendarService.restore(actor, item.recordId, { start: item.start, end: item.end, allDay: item.allDay, exdates: item.exdates.join(','), recurrenceUntil: item.recurrenceUntil ?? null });
      }
      toast(C.toasts.undone, 'info');
    } catch (e) {
      toast(`${C.toasts.undoFailed}: ${errorMessage(e)}`, 'danger');
    }
  };

  const applyMove = async (item: CalItem, scope: Scope, next: { start: string; end: string; allDay: boolean }, oldStart: string, oldEnd: string): Promise<boolean> => {
    try {
      let res: { id: string };
      if (item.recurrence === 'none') res = await calendarService.move(actor, item.recordId, next, item.version);
      else if (scope === 'all') res = await calendarService.shiftSeries(actor, item.recordId, { start: oldStart, end: item.allDay ? addDays(oldEnd, -1) : oldEnd }, next, item.version);
      else if (scope === 'following') res = await calendarService.updateFollowing(actor, item.recordId, oldStart, next, item.version);
      else res = await calendarService.updateOccurrence(actor, item.recordId, oldStart, next, item.version);
      const when = next.allDay ? formatDate(next.start) : `${formatDateTime(next.start)}–${formatTime(next.end)}`;
      toast(C.toasts.moved(item.title, when, scope === 'this' && item.recurrence !== 'none'), 'success', { label: C.toasts.undo, onClick: undoable(item, scope, oldStart, res) });
      return true;
    } catch (e) {
      toast(C.toasts.moveFailed(errorMessage(e)), 'danger', { label: C.toasts.retry, onClick: () => void applyMove(item, scope, next, oldStart, oldEnd) });
      return false;
    }
  };

  /** Drag or resize: past check, "this / this and following / all" for a series, overlap warning, then the service. */
  const reschedule = async (info: EventDropArg | EventResizeDoneArg) => {
    const item = info.event.extendedProps.item as CalItem | undefined;
    if (!item || !item.editable) return info.revert();
    const allDay = info.event.allDay;
    const start = wall(info.event.start, allDay);
    const endRaw = info.event.end ? wall(info.event.end, allDay) : allDay ? addDays(start, 1) : `${start.slice(0, 11)}${String(Math.min(23, +start.slice(11, 13) + 1)).padStart(2, '0')}${start.slice(13)}`;
    const end = allDay ? addDays(endRaw, -1) : endRaw;
    const next = { start, end, allDay };
    const oldStart = wall(info.oldEvent.start, info.oldEvent.allDay);
    const oldEnd = info.oldEvent.end ? wall(info.oldEvent.end, info.oldEvent.allDay) : oldStart;
    const moved = oldStart !== start;
    if (item.status === 'scheduled' && moved && validateEvent({ title: item.title, ...next, status: 'scheduled' }, { checkPast: true }).start) {
      info.revert();
      toast(C.validation.pastDrop, 'danger');
      return;
    }
    let scope: Scope | null = 'all';
    if (item.recurrence !== 'none') scope = await ask<Scope | null>((resolve) => ({ kind: 'scope', title: C.dialogs.rescheduleTitle, verb: 'move', resolve }));
    if (!scope) return info.revert();
    if (!(await overlapOk({ id: item.id, ...next, assigneeId: item.assigneeId }, scope === 'this' ? item.id : undefined))) return info.revert();
    // The calendar already shows the new position; if the save fails it is put back (Retry re-applies it).
    const ok = await applyMove(item, scope, next, oldStart, info.oldEvent.allDay ? oldEnd : oldEnd);
    if (!ok) info.revert();
  };

  // ---------------------------------------------------------------- create

  const openQuick = (slot: Slot, at: { el?: HTMLElement | null; x?: number; y?: number } = {}) => {
    if (!canCreate) return;
    const box = stage.current?.getBoundingClientRect();
    setDetail(null);
    setQuick({ slot, el: at.el ?? null, x: at.x ?? (box ? box.left + box.width / 2 - 170 : 200), y: at.y ?? (box ? box.top + 120 : 160) });
  };
  const createFromCursor = (el?: HTMLElement | null) => {
    const slot = slotFor(cursor < today ? today : cursor, istNow().slice(0, 16)) ?? slotFor(today, istNow().slice(0, 16))!;
    openQuick(slot, { el });
  };

  const onSelect = (s: DateSelectArg) => {
    const mouse = s.jsEvent as MouseEvent | null | undefined;
    if (!canCreate) return api()?.unselect();
    const allDay = s.allDay;
    const start = wall(s.start, allDay);
    let end = allDay ? addDays(wall(s.end, true), -1) : wall(s.end, false);
    const now = istNow().slice(0, 16);
    let slot: Slot;
    if (allDay && view === 'dayGridMonth' && start === end) {
      // A single click on a month day becomes a 1-hour slot rather than an all-day block.
      const one = slotFor(start, now);
      if (!one) {
        api()?.unselect();
        return toast(C.validation.noPast, 'info');
      }
      slot = one;
    } else {
      if (!allDay && minutes(start, end) <= 30) end = `${start.slice(0, 11)}${hhmm(Math.min(23 * 60 + 59, +start.slice(11, 13) * 60 + +start.slice(14, 16) + 60))}`;
      if (allDay ? start < now.slice(0, 10) : start < now) {
        api()?.unselect();
        return toast(C.validation.noPast, 'info');
      }
      slot = { start, end, allDay };
    }
    openQuick(slot, mouse && 'clientX' in mouse ? { x: mouse.clientX + 8, y: mouse.clientY + 8 } : {});
  };

  const closeQuick = () => {
    setQuick(null);
    api()?.unselect();
  };
  const quickAnchor = useMemo<RefObject<HTMLElement>>(() => ({ get current() { return quick?.el ?? virtual.current; } }) as RefObject<HTMLElement>, [quick]);

  // ---------------------------------------------------------------- open / edit / delete

  const onEventClick = (c: EventClickArg) => {
    c.jsEvent.preventDefault();
    const item = c.event.extendedProps.item as CalItem | undefined;
    if (!item) return;
    setQuick(null);
    anchor.current = c.el;
    const allDay = c.event.allDay;
    const start = wall(c.event.start, allDay);
    const endRaw = c.event.end ? wall(c.event.end, allDay) : start;
    setDetail({ item, start, end: allDay && c.event.end ? addDays(endRaw, -1) : endRaw });
  };

  const editDetail = async () => {
    if (!detail) return;
    const { item, start, end } = detail;
    setDetail(null);
    if (item.recurrence === 'none') return setDialog({ kind: 'edit', item, scope: 'all' });
    const scope = await ask<Scope | null>((resolve) => ({ kind: 'scope', title: C.dialogs.editTitle, verb: 'edit', resolve }));
    if (scope) setDialog({ kind: 'edit', item, scope, occurrence: { start, end } });
  };

  const runDelete = async (item: CalItem, scope: Scope | 'single', start: string): Promise<void> => {
    try {
      if (scope === 'this') await calendarService.deleteOccurrence(actor, item.recordId, start, item.version);
      else if (scope === 'following') await calendarService.deleteFollowing(actor, item.recordId, start, item.version);
      else await calendarService.remove(actor, item.recordId);
      toast(scope === 'this' ? C.toasts.occurrenceRemoved : scope === 'following' ? C.toasts.followingDeleted : item.recurrence !== 'none' ? C.toasts.seriesDeleted : C.toasts.deleted);
    } catch (e) {
      toast(errorMessage(e), 'danger', { label: C.toasts.retry, onClick: () => void runDelete(item, scope, start) });
    }
  };

  const deleteDetail = async () => {
    if (!detail) return;
    const { item, start } = detail;
    setDetail(null);
    if (item.recurrence !== 'none') {
      const scope = await ask<Scope | null>((resolve) => ({ kind: 'scope', title: C.dialogs.deleteTitle, verb: 'delete', resolve }));
      if (scope) await runDelete(item, scope, start);
      return;
    }
    confirmDelete({ title: C.dialogs.deleteConfirmTitle(item.title), message: C.dialogs.deleteConfirmMessage, onConfirm: () => runDelete(item, 'single', start) });
  };

  // ---------------------------------------------------------------- keyboard

  useCalendarShortcuts({
    today: () => go('today'),
    prev: () => go('prev'),
    next: () => go('next'),
    view: changeView,
    create: () => createFromCursor(),
    search: () => searchRef.current?.focus(),
  });

  // ---------------------------------------------------------------- rendering

  const eventClassNames = useCallback(
    (arg: { event: { start: Date | null; end: Date | null; allDay: boolean } }) => {
      const end = arg.event.end ?? arg.event.start;
      const over = arg.event.allDay ? wall(end, true) <= nowWall.slice(0, 10) && (arg.event.end ? true : wall(end, true) < nowWall.slice(0, 10)) : wall(end, false) < nowWall;
      return over ? ['is-past'] : [];
    },
    [nowWall],
  );

  const renderEvent = (arg: EventContentArg) => {
    const i = arg.event.extendedProps.item as CalItem | undefined;
    if (!i) return undefined;
    const link = i.linkLabel && !i.title.includes(i.linkLabel.split(' · ').pop() ?? '') ? i.linkLabel : '';
    if (arg.view.type === 'list')
      return (
        <span className="ev-line">
          <span className="ev-title">{i.title}</span>
          {link && <span className="ev-link">{link}</span>}
        </span>
      );
    if (arg.view.type === 'dayGridMonth')
      return (
        <span className="ev-line">
          <span className="ev-title">{i.title}</span>
        </span>
      );
    const dur = arg.event.allDay || !arg.event.start || !arg.event.end ? 0 : (arg.event.end.getTime() - arg.event.start.getTime()) / 60_000;
    if (arg.event.allDay) return <span className="ev-line"><span className="ev-title">{i.title}</span></span>;
    return (
      <div className="ev-stack">
        <div className="ev-title">{i.title}</div>
        {dur > 30 && <div className="ev-meta">{arg.timeText}</div>}
        {dur >= 60 && link && <div className="ev-link">{link}</div>}
      </div>
    );
  };

  const header = <PageHeader title={L.nav.pages.calendar.title} description={C.page.description} />;
  if (query.error && !query.data)
    return (
      <div className="page">
        {header}
        <ErrorState title={C.page.loadError} onRetry={query.retry}>
          {query.error}
        </ErrorState>
      </div>
    );

  const clearFilters = () => {
    setSearch('');
    setTypes(new Set(activeMasterValues('calEventType').map((v) => v.key as EventType)));
    setStatuses(new Set(['scheduled', 'completed']));
    setPerson('all');
    setWithModules(false);
  };
  const emptyKey = view === 'dayGridMonth' ? 'month' : view === 'timeGridWeek' ? 'week' : view === 'timeGridDay' ? 'day' : 'agenda';
  const showEmpty = !!query.data && !!range && inRange === 0;

  return (
    <div className="page cal-page">
      {header}
      <div className={cx('cal-layout', !sideOpen && 'is-side-closed')}>
        {sideOpen && (
          <div className="cal-side panel">
            <CalendarSidebar
              canCreate={canCreate}
              roleLabel={actor.role.label}
              onCreate={(el) => createFromCursor(el)}
              cursor={cursor}
              today={today}
              counts={counts}
              onPick={(d) => api()?.gotoDate(d)}
              types={types}
              onTypes={setTypes}
              statuses={statuses}
              onStatuses={setStatuses}
              withModules={withModules}
              onWithModules={setWithModules}
              person={person}
              people={people}
              onPerson={setPerson}
            />
          </div>
        )}

        <section className="cal-main panel" aria-label={C.page.region}>
          <CalendarHead ref={searchRef} info={todayInfo} onToday={() => go('today')} search={search} onSearch={setSearch} />
          <CalendarToolbar
            sideOpen={sideOpen}
            onSide={() => setSideOpen((o) => !o)}
            title={title}
            onToday={() => go('today')}
            onPrev={() => go('prev')}
            onNext={() => go('next')}
            view={view}
            onView={changeView}
            action={
              !sideOpen && <Button icon="plus" aria-label={C.page.createEvent} variant="primary" onClick={(e) => createFromCursor(e.currentTarget)} disabledReason={canCreate ? undefined : C.page.cannotCreate(actor.role.label)} title={C.page.shortcutHint(C.page.createEvent, 'C')} />
            }
          />
          {query.error && query.data && (
            <InlineAlert tone="danger" title={C.page.loadError}>
              {query.error}{' '}
              <Button onClick={query.retry}>{C.page.reload}</Button>
            </InlineAlert>
          )}
          <div className="tc-cal" ref={stage} data-view={view}>
            {!query.data ? (
              <Skeleton rows={10} />
            ) : (
              <>
                <FullCalendar
                  ref={cal}
                  plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, rrulePlugin]}
                  initialView={view}
                  initialDate={cursor}
                  headerToolbar={false}
                  timeZone="Asia/Kolkata"
                  now={istNow}
                  firstDay={1}
                  height="100%"
                  events={events}
                  editable
                  eventStartEditable
                  eventDurationEditable
                  eventInteractive
                  eventDisplay="block"
                  selectable={canCreate}
                  selectMirror
                  longPressDelay={350}
                  select={onSelect}
                  eventClick={onEventClick}
                  eventDrop={reschedule}
                  eventResize={reschedule}
                  eventClassNames={eventClassNames}
                  eventContent={renderEvent}
                  datesSet={(d: DatesSetArg) => {
                    setTitle(d.view.title);
                    setRange({ from: wall(d.view.activeStart, true), to: wall(d.view.activeEnd, true) });
                    const mid = new Date((d.start.getTime() + d.end.getTime()) / 2);
                    setCursor(d.view.type === 'dayGridMonth' || d.view.type === 'agenda' ? (wall(d.view.currentStart, true) <= today && today < wall(d.view.currentEnd, true) ? today : wall(d.view.currentStart, true)) : wall(mid, true));
                  }}
                  {...dayLoadOptions(counts)}
                  navLinkDayClick={(d) => {
                    setView('timeGridDay');
                    api()?.changeView('timeGridDay', d);
                  }}
                  dayMaxEvents={2}
                  eventOrder="rank,start,-duration,allDay,title"
                  fixedWeekCount={false}
                  moreLinkText={(n) => C.page.more(n)}
                  moreLinkClick="popover"
                  nowIndicator
                  businessHours={{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }}
                  slotMinTime="00:00:00"
                  slotMaxTime="24:00:00"
                  scrollTime="08:00:00"
                  slotDuration="00:30:00"
                  slotLabelInterval="01:00"
                  slotEventOverlap={false}
                  eventMaxStack={2}
                  allDayText={C.page.allDay}
                  eventTimeFormat={clockShort}
                  slotLabelFormat={clock12}
                  eventMinHeight={22}
                  eventShortHeight={30}
                  views={{
                    dayGridMonth: { dayHeaderFormat: { weekday: 'short' }, displayEventEnd: false },
                    timeGridWeek: { dayHeaderFormat: { weekday: 'short', day: 'numeric' } },
                    timeGridDay: { dayHeaderFormat: { weekday: 'long', day: 'numeric', month: 'long' } },
                    // Agenda: like Google's Schedule — from the shown day, four weeks, grouped by date.
                    agenda: { type: 'list', duration: { weeks: 4 }, dateAlignment: 'day', listDayFormat: { weekday: 'long', day: 'numeric', month: 'short' }, listDaySideFormat: false, noEventsContent: '' },
                  }}
                  eventDidMount={(arg) => {
                    // The drag/selection mirror has no item; only real events get the full-text tooltip.
                    const i = arg.event.extendedProps.item as CalItem | undefined;
                    if (i) {
                      arg.el.setAttribute('data-tooltip', fullText(i));
                      arg.el.setAttribute('aria-label', `${fullText(i)}, ${arg.timeText || C.page.allDay}`);
                    }
                  }}
                />
                {showEmpty && (
                  <div className="cal-empty">
                    <EmptyState
                      icon="calendar"
                      title={hiddenInRange > 0 ? C.empty.filtered : C.empty[emptyKey]}
                      action={
                        hiddenInRange > 0 ? (
                          <Button onClick={clearFilters}>{C.empty.clear}</Button>
                        ) : canCreate ? (
                          <Button variant="primary" icon="plus" onClick={(e) => createFromCursor(e.currentTarget)}>
                            {C.empty.create}
                          </Button>
                        ) : undefined
                      }
                    >
                      {hiddenInRange > 0 ? C.empty.filteredHint : C.empty.hint}
                    </EmptyState>
                  </div>
                )}
              </>
            )}
          </div>
          {search.trim() && query.data && (
            <p className="cal-search-count muted small" role="status">
              {C.page.searchResults(visible.length)}
            </p>
          )}
        </section>
      </div>

      {quick && !quick.el && <div ref={virtual} className="cal-virtual-anchor" style={{ left: quick.x, top: quick.y }} aria-hidden="true" />}
      {quick && <QuickCreate actor={actor} anchor={quickAnchor} slot={quick.slot} onClose={closeQuick} onMore={(draft, slot) => (closeQuick(), setDialog({ kind: 'create', ...slot, draft }))} />}
      {detail && (
        <Popover open onClose={() => setDetail(null)} anchor={anchor as MutableRefObject<HTMLElement>} label={detail.item.title} width={340}>
          <EventDetail detail={detail} onEdit={editDetail} onDelete={deleteDetail} onClose={() => setDetail(null)} />
        </Popover>
      )}
      <EventDialog actor={actor} mode={dialog} onClose={() => setDialog(null)} />
      {prompt?.kind === 'scope' && (
        <Dialog
          open
          size="sm"
          title={prompt.title}
          description={C.dialogs.scopeDescription}
          onClose={() => (prompt.resolve(null), setPrompt(null))}
          footer={
            <>
              <Button onClick={() => (prompt.resolve(null), setPrompt(null))} data-autofocus>
                {C.dialogs.cancel}
              </Button>
              <Button onClick={() => (prompt.resolve('this'), setPrompt(null))}>{C.dialogs.thisEvent(C.dialogs.verbs[prompt.verb])}</Button>
              <Button onClick={() => (prompt.resolve('following'), setPrompt(null))}>{C.dialogs.thisAndFollowing(C.dialogs.verbs[prompt.verb])}</Button>
              <Button variant={prompt.verb === 'delete' ? 'danger' : 'primary'} onClick={() => (prompt.resolve('all'), setPrompt(null))}>
                {C.dialogs.allEvents(C.dialogs.verbs[prompt.verb])}
              </Button>
            </>
          }
        >
          <p className="muted">{C.dialogs.scopeHelp}</p>
        </Dialog>
      )}
      {prompt?.kind === 'overlap' && (
        <Dialog
          open
          size="sm"
          title={C.dialogs.overlapTitle}
          description={C.dialogs.overlapDescription}
          onClose={() => (prompt.resolve(false), setPrompt(null))}
          footer={
            <>
              <Button onClick={() => (prompt.resolve(false), setPrompt(null))} data-autofocus>
                {C.dialogs.undoMove}
              </Button>
              <Button variant="primary" onClick={() => (prompt.resolve(true), setPrompt(null))}>
                {C.dialogs.keepAnyway}
              </Button>
            </>
          }
        >
          <ul className="plain-list bullets">
            {prompt.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  );
}
