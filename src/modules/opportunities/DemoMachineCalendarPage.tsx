import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import type { DatesSetArg, EventClickArg, EventInput } from '@fullcalendar/core';
import { L } from '../../constants/labels';
import { istNow } from '../../lib/clock';
import { formatTime } from '../../lib/dates';
import { cx } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { PHONE, useMedia } from '../../lib/useMedia';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { perm } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { demoMachineCalendar, type DemoBooking } from '../../services/opportunities';
import { activeMasterValues, masterLabel, masterValue } from '../../services/registry';
import { Button, IconButton } from '../../components/primitives/Button';
import { EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, StatusChip } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import '../calendar/calendar.css';
import './opportunities.css';
import { Checkbox } from '../../components/primitives/controls';
import { SegmentedControl } from '../../components/primitives/controls';

const T = L.opportunities.pages.demoMachineCalendar;
type ViewId = 'dayGridMonth' | 'timeGridWeek' | 'listMonth';
const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'dayGridMonth', label: T.month },
  { id: 'timeGridWeek', label: T.week },
  { id: 'listMonth', label: T.list },
];
const PALETTE = 5;
/** Template time format "02:30 PM" (FullCalendar hands over IST wall-clock parts). */
const clock12 = (a: { date: { hour: number; minute: number } }) => `${String(a.date.hour % 12 || 12).padStart(2, '0')}:${String(a.date.minute).padStart(2, '0')} ${a.date.hour < 12 ? 'AM' : 'PM'}`;

/**
 * Demo Machine Calendar (OPP-04): demo-centre machines against their demo bookings, by month, week or list.
 * Bookings the user cannot open (another team's demo) still show as busy slots, so nobody double-books.
 */
export function DemoMachineCalendarPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const phone = useMedia(PHONE);
  const cal = useRef<FullCalendar>(null);
  const [view, setView] = useState<ViewId>(phone ? 'listMonth' : 'dayGridMonth');
  const [title, setTitle] = useState('');
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [division, setDivision] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [withCancelled, setWithCancelled] = useState(false);
  const [sideOpen, setSideOpen] = useState(!phone);
  const readable = perm(actor, 'demoMachines').read !== 'none';
  const query = useServiceQuery(() => (readable ? demoMachineCalendar(actor, { divisionId: division || undefined, includeCancelled: withCancelled }) : { machines: [], bookings: [] }), [actor.user.id, division, withCancelled]);

  const machines = useMemo(() => query.data?.machines ?? [], [query.data]);
  const colour = useMemo(() => new Map(machines.map((m, i) => [m.id, `dm-c${i % PALETTE}`])), [machines]);
  const nameOf = useMemo(() => new Map(machines.map((m) => [m.id, String(m.name)])), [machines]);
  const bookings = useMemo(() => (query.data?.bookings ?? []).filter((b) => !hidden.has(b.machineId)), [query.data, hidden]);
  const inView = useMemo(() => {
    const counts = new Map<string, number>();
    (query.data?.bookings ?? []).forEach((b) => {
      if (range.from && b.start.slice(0, 10) >= range.from && b.start.slice(0, 10) < range.to) counts.set(b.machineId, (counts.get(b.machineId) ?? 0) + 1);
    });
    return counts;
  }, [query.data, range]);

  const events = useMemo<EventInput[]>(
    () =>
      bookings.map((b) => ({
        id: b.id,
        title: T.bookingTitle(nameOf.get(b.machineId) ?? b.machineId, b.visible ? b.opportunityName || b.id : T.busy),
        start: b.start,
        end: b.end,
        classNames: [b.visible ? colour.get(b.machineId) ?? 'dm-c0' : 'dm-busy', b.status === 'done' ? 'is-completed' : '', b.status === 'cancelled' ? 'is-cancelled' : '', b.visible ? 'is-editable' : 'is-readonly'].filter(Boolean),
        extendedProps: { booking: b },
      })),
    [bookings, colour, nameOf],
  );

  const api = () => cal.current?.getApi();
  const changeView = (v: ViewId) => {
    setView(v);
    api()?.changeView(v);
  };
  const onEventClick = (c: EventClickArg) => {
    c.jsEvent.preventDefault();
    const b = c.event.extendedProps.booking as DemoBooking | undefined;
    if (b?.visible) navigate(recordPeekPath(actor.workspaceId, 'demos', b.id));
  };

  const header = <PageHeader title={L.nav.pages.demoMachineCalendar.title} description={T.description} />;
  if (!readable)
    return <NoAccess what={L.opportunities.messages.noAccessDemoMachines} />;
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
            <aside className="cal-side panel" aria-label={T.filters}>
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
                                {String(m.location)} · {T.bookings(inView.get(m.id) ?? 0)}
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
                <label className="cal-check">
                  <Checkbox checked={withCancelled} onChange={(e) => setWithCancelled(e.target.checked)} />
                  {T.showCancelled}
                </label>
              </section>
            </aside>
          )}
          <section className="cal-main panel" aria-label={T.calendar}>
            <div className="cal-toolbar">
              <IconButton icon="panel-left" label={T.togglePanel(sideOpen)} aria-pressed={sideOpen} onClick={() => setSideOpen((o) => !o)} />
              <Button onClick={() => api()?.today()}>{L.opportunities.actions.today}</Button>
              <IconButton icon="chevron-left" label={L.opportunities.actions.previous} onClick={() => api()?.prev()} />
              <IconButton icon="chevron-right" label={L.opportunities.actions.next} onClick={() => api()?.next()} />
              <h2 className="cal-title" aria-live="polite">
                {title}
              </h2>
              <span className="spacer" />
              <SegmentedControl
                label={T.viewLabel}
                value={view}
                onChange={(next) => changeView(next)}
                options={VIEWS.map((v) => ({ value: v.id, label: v.label }))}
              />
            </div>
            {!query.data ? (
              <Skeleton rows={10} />
            ) : (
              <>
                {view !== 'listMonth' && range.from && !bookings.some((b) => b.start.slice(0, 10) >= range.from && b.start.slice(0, 10) < range.to) && <InlineAlert tone="info">{T.noBookings}</InlineAlert>}
                <div className="tc-cal">
                  <FullCalendar
                    ref={cal}
                    plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
                    initialView={view}
                    initialDate={cursor}
                    headerToolbar={false}
                    timeZone="Asia/Kolkata"
                    now={istNow}
                    firstDay={1}
                    height={phone ? 'auto' : 'calc(100vh - 230px)'}
                    events={events}
                    editable={false}
                    eventClick={onEventClick}
                    datesSet={(d: DatesSetArg) => {
                      setTitle(d.view.title);
                      const from = d.view.currentStart.toISOString().slice(0, 10);
                      setRange({ from, to: d.view.currentEnd.toISOString().slice(0, 10) });
                      setCursor(from);
                    }}
                    dayMaxEvents={3}
                    moreLinkText={(n) => T.more(n)}
                    nowIndicator
                    businessHours={{ daysOfWeek: [1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00' }}
                    slotMinTime="07:00:00"
                    slotMaxTime="21:00:00"
                    scrollTime="08:30:00"
                    slotDuration="00:30:00"
                    allDayText={T.allDay}
                    eventTimeFormat={clock12}
                    slotLabelFormat={clock12}
                    eventMinHeight={22}
                    views={{
                      dayGridMonth: { dayHeaderFormat: { weekday: 'short' } },
                      timeGridWeek: { dayHeaderFormat: { weekday: 'short', day: 'numeric' } },
                      listMonth: { listDayFormat: { weekday: 'long', day: 'numeric', month: 'short' }, listDaySideFormat: false, noEventsContent: T.noBookings },
                    }}
                    eventDidMount={(arg) => {
                      const b = arg.event.extendedProps.booking as DemoBooking | undefined;
                      if (!b) return;
                      arg.el.setAttribute(
                        'data-tooltip',
                        b.visible ? T.bookingTip(arg.event.title, b.customerName ?? '', masterLabel('demoStatus', b.status), `${formatTime(b.start)}–${formatTime(b.end)}`) : T.busyTip,
                      );
                    }}
                  />
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
