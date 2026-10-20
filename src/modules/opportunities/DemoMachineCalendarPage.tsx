import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { DatesSetArg, EventClickArg, EventContentArg, EventInput } from '@fullcalendar/core';
import { L } from '../../constants/labels';
import { istNow } from '../../lib/clock';
import { addDays, formatTime } from '../../lib/dates';
import { cx } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { PHONE, useMedia } from '../../lib/useMedia';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { perm } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { demoMachineCalendar, type DemoBooking } from '../../services/opportunities';
import { activeMasterValues, masterLabel, masterValue } from '../../services/registry';
import { Button } from '../../components/primitives/Button';
import { EmptyState, ErrorState, NoAccess, Skeleton, StatusChip } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { FormDrawer } from '../../components/resource/RecordForm';
import { PageHeader } from '../../components/shell/PageHeader';
import { Checkbox } from '../../components/primitives/controls';
import { CalendarHead, CalendarToolbar, PeriodSummary } from '../calendar/CalendarChrome';
import { MiniMonth } from '../calendar/MiniMonth';
import { clock12, clockShort, wall, type ViewId } from '../calendar/calendarUtils';
import { countDays, dayLoadOptions } from '../calendar/dayLoad';
import { todaySummary } from '../calendar/TodayAgenda';
import { useCalendarShortcuts } from '../calendar/useCalendarShortcuts';
import '../calendar/calendar.css';
import './opportunities.css';

const T = L.opportunities.pages.demoMachineCalendar;
const PALETTE = 5;

/**
 * Demo Machine Calendar (OPP-04): the same calendar as Tasks & Calendar (left panel, Today strip, search, Month / Week / Day / Agenda,
 * a count of bookings on every day) for the demo-centre machines. Bookings the user cannot open (another team's demo)
 * still show as busy slots, so nobody double-books. Click a free day to book a demo on it.
 */
export function DemoMachineCalendarPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const phone = useMedia(PHONE);
  const cal = useRef<FullCalendar>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const today = istNow().slice(0, 10);
  const [view, setView] = useState<ViewId>(phone ? 'agenda' : 'dayGridMonth');
  const [title, setTitle] = useState('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [cursor, setCursor] = useState(today);
  const [division, setDivision] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [withCancelled, setWithCancelled] = useState(false);
  const [search, setSearch] = useState('');
  const [sideOpen, setSideOpen] = useState(() => !phone && window.innerWidth >= 1180);
  const [booking, setBooking] = useState<{ demoMachineId?: string; scheduledAt?: string } | null>(null);
  const [nowWall, setNowWall] = useState(() => istNow().slice(0, 16));
  const readable = perm(actor, 'demoMachines').read !== 'none';
  const canBook = !!perm(actor, 'demos').create;
  const query = useServiceQuery(() => (readable ? demoMachineCalendar(actor, { divisionId: division || undefined, includeCancelled: withCancelled }) : { machines: [], bookings: [] }), [actor.user.id, division, withCancelled]);

  useEffect(() => {
    const t = setInterval(() => setNowWall(istNow().slice(0, 16)), 60_000);
    return () => clearInterval(t);
  }, []);

  const machines = useMemo(() => query.data?.machines ?? [], [query.data]);
  const colour = useMemo(() => new Map(machines.map((m, i) => [m.id, `dm-c${i % PALETTE}`])), [machines]);
  const nameOf = useMemo(() => new Map(machines.map((m) => [m.id, String(m.name)])), [machines]);
  const titleOf = useCallback((b: DemoBooking) => T.bookingTitle(nameOf.get(b.machineId) ?? b.machineId, b.visible ? b.opportunityName || b.id : T.busy), [nameOf]);
  const needle = search.trim().toLowerCase();
  const bookings = useMemo(
    () => (query.data?.bookings ?? []).filter((b) => !hidden.has(b.machineId) && (!needle || `${titleOf(b)} ${b.visible ? b.customerName ?? '' : ''} ${b.id}`.toLowerCase().includes(needle))),
    [query.data, hidden, needle, titleOf],
  );
  const inRange = useMemo(() => (range ? bookings.filter((b) => b.start.slice(0, 10) < range.to && b.end.slice(0, 10) >= range.from).length : 1), [bookings, range]);
  const perMachine = useMemo(() => {
    const counts = new Map<string, number>();
    (query.data?.bookings ?? []).forEach((b) => {
      if (range && b.start.slice(0, 10) >= range.from && b.start.slice(0, 10) < range.to) counts.set(b.machineId, (counts.get(b.machineId) ?? 0) + 1);
    });
    return counts;
  }, [query.data, range]);

  // Bookings per day around the month in view, for the cell badges, the mini month and the month summary.
  const counts = useMemo(() => {
    const monthStart = addDays(`${cursor.slice(0, 7)}-01`, -7);
    const from = range && range.from < monthStart ? range.from : monthStart;
    let to = addDays(monthStart, 50);
    if (range && range.to > to) to = range.to;
    return countDays(bookings.filter((b) => b.status !== 'cancelled').map((b) => ({ start: b.start, end: b.end })), from, to);
  }, [bookings, cursor, range]);

  const todayInfo = useMemo(() => {
    const rows = bookings.filter((b) => b.status !== 'cancelled' && b.start.slice(0, 10) <= today && b.end.slice(0, 10) >= today);
    const upcoming = rows.filter((b) => b.start >= nowWall).sort((a, b) => a.start.localeCompare(b.start))[0];
    const base = todaySummary([], nowWall);
    return { ...base, count: rows.length, next: upcoming ? { title: titleOf(upcoming), when: formatTime(upcoming.start), id: upcoming.id } : null, over: rows.length > 0 && !upcoming && rows.every((b) => b.end < nowWall) };
  }, [bookings, nowWall, today, titleOf]);

  const events = useMemo<EventInput[]>(
    () =>
      bookings.map((b) => ({
        id: b.id,
        title: titleOf(b),
        start: b.start,
        end: b.end,
        classNames: [b.visible ? colour.get(b.machineId) ?? 'dm-c0' : 'dm-busy', b.status === 'done' ? 'is-completed' : '', b.status === 'cancelled' ? 'is-cancelled' : '', b.visible ? 'is-editable' : 'is-readonly'].filter(Boolean),
        extendedProps: { booking: b },
      })),
    [bookings, colour, titleOf],
  );

  const api = () => cal.current?.getApi();
  const go = (fn: 'today' | 'prev' | 'next') => api()?.[fn]();
  const changeView = (v: ViewId) => {
    setView(v);
    api()?.changeView(v);
  };
  const book = (day?: string, machineId?: string) => {
    if (!canBook) return;
    const d = day && day >= today ? day : today;
    setBooking({ demoMachineId: machineId, scheduledAt: `${d}T10:00` });
  };
  const onEventClick = (c: EventClickArg) => {
    c.jsEvent.preventDefault();
    const b = c.event.extendedProps.booking as DemoBooking | undefined;
    if (b?.visible) navigate(recordPeekPath(actor.workspaceId, 'demos', b.id));
  };
  const onDateClick = (d: DateClickArg) => {
    if (view !== 'dayGridMonth') return;
    const day = wall(d.date, true);
    if (day >= today) book(day);
  };

  useCalendarShortcuts({
    today: () => go('today'),
    prev: () => go('prev'),
    next: () => go('next'),
    view: changeView,
    create: () => book(cursor),
    search: () => searchRef.current?.focus(),
  });

  const renderEvent = (arg: EventContentArg) => {
    if (arg.view.type === 'list') return undefined;
    if (arg.view.type === 'dayGridMonth')
      return (
        <span className="ev-line">
          <span className="ev-title">{arg.event.title}</span>
        </span>
      );
    return (
      <div className="ev-stack">
        <div className="ev-title">{arg.event.title}</div>
        <div className="ev-meta">{arg.timeText}</div>
      </div>
    );
  };

  const header = <PageHeader title={L.nav.pages.demoMachineCalendar.title} description={T.description} />;
  if (!readable) return <NoAccess what={L.opportunities.messages.noAccessDemoMachines} />;
  if (query.error)
    return (
      <div className="page">
        {header}
        <ErrorState title={T.errorTitle} onRetry={query.retry}>
          {query.error}
        </ErrorState>
      </div>
    );

  const noMachinesAtAll = !!query.data && !machines.length && !division;
  const bookButton = (
    <Button variant="primary" icon="plus" onClick={() => book(cursor)} disabledReason={canBook ? undefined : T.cannotBook(actor.role.label)} title={L.calendar.page.shortcutHint(T.book, 'C')}>
      {T.book}
    </Button>
  );
  return (
    <div className="page cal-page">
      {header}
      {noMachinesAtAll ? (
        <EmptyState icon="calendar" title={T.emptyTitle}>
          {T.emptyBody}
        </EmptyState>
      ) : (
        <div className={cx('cal-layout', !sideOpen && 'is-side-closed')}>
          {sideOpen && (
            <div className="cal-side panel">
              <aside className="cal-side-inner" aria-label={T.filters}>
                {bookButton}
                <MiniMonth selected={cursor} today={today} counts={counts} onPick={(d) => api()?.gotoDate(d)} />
                <PeriodSummary counts={counts} month={cursor.slice(0, 7)} noun={T.noun} onPick={(d) => api()?.gotoDate(d)} />
                <section className="cal-filter">
                  <h3 className="cal-filter-title">{T.division}</h3>
                  <SelectMenu
                    block
                    label={T.division}
                    value={division}
                    options={[{ value: '', label: T.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]}
                    onChange={(v) => {
                      setDivision(v);
                      setHidden(new Set());
                    }}
                  />
                </section>
                <section className="cal-filter">
                  <h3 className="cal-filter-title">{T.machines}</h3>
                  {!query.data ? (
                    <Skeleton rows={4} />
                  ) : !machines.length ? (
                    <p className="muted small">{T.noMachines}</p>
                  ) : (
                    <ul className="cal-legend">
                      {machines.map((m) => {
                        const status = masterValue('demoMachineStatus', m.status);
                        return (
                          <li key={m.id}>
                            <label className={cx('cal-check dm-machine', colour.get(m.id))}>
                              <Checkbox
                                checked={!hidden.has(m.id)}
                                onChange={(e) => {
                                  const n = new Set(hidden);
                                  if (e.target.checked) n.delete(m.id);
                                  else n.add(m.id);
                                  setHidden(n);
                                }}
                              />
                              <span className="cal-swatch" aria-hidden="true" />
                              <span className="dm-machine-text">
                                <span className="dm-machine-name">{String(m.name)}</span>
                                <span className="dm-machine-meta small">
                                  {String(m.location)} · {T.bookings(perMachine.get(m.id) ?? 0)}
                                </span>
                                {m.status !== 'active' && <StatusChip label={masterLabel('demoMachineStatus', m.status)} tone={status?.tone} />}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
                <section className="cal-filter">
                  <h3 className="cal-filter-title">{L.calendar.page.show}</h3>
                  <label className="cal-check">
                    <Checkbox checked={withCancelled} onChange={(e) => setWithCancelled(e.target.checked)} />
                    {T.showCancelled}
                  </label>
                </section>
              </aside>
            </div>
          )}
          <section className="cal-main panel" aria-label={T.calendar}>
            <CalendarHead ref={searchRef} info={todayInfo} countText={T.todayCount(todayInfo.count)} onToday={() => go('today')} search={search} onSearch={setSearch} searchLabel={T.searchLabel} placeholder={T.searchPlaceholder} />
            <CalendarToolbar sideOpen={sideOpen} onSide={() => setSideOpen((o) => !o)} title={title} onToday={() => go('today')} onPrev={() => go('prev')} onNext={() => go('next')} view={view} onView={changeView} action={!sideOpen && bookButton} />
            <div className="tc-cal" data-view={view}>
              {!query.data ? (
                <Skeleton rows={10} />
              ) : (
                <>
                  <FullCalendar
                    ref={cal}
                    plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
                    initialView={view}
                    initialDate={cursor}
                    headerToolbar={false}
                    timeZone="Asia/Kolkata"
                    now={istNow}
                    firstDay={1}
                    height="100%"
                    events={events}
                    editable={false}
                    eventDisplay="block"
                    eventContent={renderEvent}
                    eventClick={onEventClick}
                    dateClick={onDateClick}
                    {...dayLoadOptions(counts)}
                    navLinkDayClick={(d) => {
                      setView('timeGridDay');
                      api()?.changeView('timeGridDay', d);
                    }}
                    datesSet={(d: DatesSetArg) => {
                      setTitle(d.view.title);
                      setRange({ from: wall(d.view.activeStart, true), to: wall(d.view.activeEnd, true) });
                      const mid = new Date((d.start.getTime() + d.end.getTime()) / 2);
                      setCursor(d.view.type === 'dayGridMonth' || d.view.type === 'agenda' ? (wall(d.view.currentStart, true) <= today && today < wall(d.view.currentEnd, true) ? today : wall(d.view.currentStart, true)) : wall(mid, true));
                    }}
                    dayMaxEvents={2}
                    fixedWeekCount={false}
                    moreLinkText={(n) => T.more(n)}
                    moreLinkClick="popover"
                    nowIndicator
                    businessHours={{ daysOfWeek: [1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00' }}
                    slotMinTime="07:00:00"
                    slotMaxTime="21:00:00"
                    scrollTime="08:30:00"
                    slotDuration="00:30:00"
                    slotLabelInterval="01:00"
                    allDayText={T.allDay}
                    eventTimeFormat={clockShort}
                    slotLabelFormat={clock12}
                    eventMinHeight={22}
                    views={{
                      dayGridMonth: { dayHeaderFormat: { weekday: 'short' }, displayEventEnd: false },
                      timeGridWeek: { dayHeaderFormat: { weekday: 'short', day: 'numeric' } },
                      timeGridDay: { dayHeaderFormat: { weekday: 'long', day: 'numeric', month: 'long' } },
                      agenda: { type: 'list', duration: { weeks: 4 }, dateAlignment: 'day', listDayFormat: { weekday: 'long', day: 'numeric', month: 'short' }, listDaySideFormat: false, noEventsContent: '' },
                    }}
                    eventDidMount={(arg) => {
                      const b = arg.event.extendedProps.booking as DemoBooking | undefined;
                      if (!b) return;
                      arg.el.setAttribute('data-tooltip', b.visible ? T.bookingTip(arg.event.title, b.customerName ?? '', masterLabel('demoStatus', b.status), `${formatTime(b.start)}–${formatTime(b.end)}`) : T.busyTip);
                    }}
                  />
                  {!!range && inRange === 0 && (
                    <div className="cal-empty">
                      <EmptyState icon="calendar" title={needle ? T.noMatch : T.noBookings} action={needle ? <Button onClick={() => setSearch('')}>{L.calendar.empty.clear}</Button> : canBook ? bookButton : undefined} />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}
      <FormDrawer resKey="demos" open={!!booking} onClose={() => setBooking(null)} initial={booking ? { location: 'centre', ...booking } : undefined} />
    </div>
  );
}
