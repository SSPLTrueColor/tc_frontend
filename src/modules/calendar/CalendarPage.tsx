import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Link } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
import type { DateSelectArg, DatesSetArg, EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { L } from '../../constants/labels';
import { istNow } from '../../lib/clock';
import { addDays, formatDate, formatDateTime, formatTime } from '../../lib/dates';
import { cx } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { PHONE, useMedia } from '../../lib/useMedia';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { calendarService } from '../../services/api/calendar';
import { perm } from '../../services/authz';
import { findOverlaps, listCalendarItems, occurrences, type CalItem, type EventType } from '../../services/calendar/events';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { Button, IconButton } from '../../components/primitives/Button';
import { ErrorState, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { confirmDelete, Dialog, Popover } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { EventDialog, type DialogMode } from './EventDialog';
import { MiniMonth } from './MiniMonth';
import './calendar.css';

type ViewId = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'agenda';
const C = L.calendar;
const VIEWS: { id: ViewId; label: string }[] = (['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'agenda'] as const).map((id) => ({ id, label: C.page.views[id] }));
const STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
const SOURCE_LABEL: Record<string, string> = C.sources;
const FREQ = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' } as const;

/** With a named time zone and no zone plugin, FullCalendar Dates are "UTC-coerced": their UTC fields are the IST wall clock. */
const wall = (d: Date | null, allDay: boolean) => (d ? d.toISOString().slice(0, allDay ? 10 : 16) : '');
const minutes = (a: string, b: string) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60_000;
/** Template time format "02:30 PM" (FullCalendar hands over IST wall-clock parts). */
const clock12 = (a: { date: { hour: number; minute: number } }) => `${String(a.date.hour % 12 || 12).padStart(2, '0')}:${String(a.date.minute).padStart(2, '0')} ${a.date.hour < 12 ? 'AM' : 'PM'}`;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function toFc(i: CalItem): EventInput {
  const base: EventInput = {
    id: i.id,
    title: i.title,
    allDay: i.allDay,
    editable: i.editable && i.status !== 'cancelled',
    classNames: [`ev-${i.type}`, `is-${i.status}`, i.editable ? 'is-editable' : 'is-readonly'],
    extendedProps: { item: i },
  };
  if (i.recurrence === 'none') return { ...base, start: i.start, end: i.allDay ? addDays(i.end, 1) : i.end };
  const days = i.allDay ? minutes(`${i.start}T00:00`, `${i.end}T00:00`) / 1440 + 1 : 0;
  return {
    ...base,
    rrule: { freq: FREQ[i.recurrence], dtstart: i.allDay ? i.start : `${i.start}:00`, until: i.recurrenceUntil ?? undefined },
    duration: i.allDay ? { days } : hhmm(minutes(i.start, i.end)),
    exdate: i.exdates.map((x) => (i.allDay ? x.slice(0, 10) : `${x.slice(0, 16)}:00`)),
  };
}

type Prompt =
  | { kind: 'scope'; title: string; verb: 'move' | 'edit' | 'delete'; resolve: (v: 'this' | 'all' | null) => void }
  | { kind: 'overlap'; lines: string[]; resolve: (keep: boolean) => void };

/**
 * Calendar (Google Calendar / Outlook style) on FullCalendar, themed with the template tokens.
 * Own events are fully editable (drag, resize, recurrence with "this / all"); items from other
 * modules (tasks, demos, PM visits, installations, follow-ups) are shown read-only with a link.
 */
export function CalendarPage() {
  const actor = useActor();
  const toast = useToast();
  const phone = useMedia(PHONE);
  const cal = useRef<FullCalendar>(null);
  const today = istNow().slice(0, 10);
  const query = useServiceQuery(() => listCalendarItems(actor), [actor.user.id]);
  const canCreate = perm(actor, 'calendarEvents').create;

  const [view, setView] = useState<ViewId>(phone ? 'agenda' : 'dayGridMonth');
  const [title, setTitle] = useState('');
  const [cursor, setCursor] = useState(today);
  const [types, setTypes] = useState<Set<EventType>>(new Set(activeMasterValues('calEventType').map((v) => v.key as EventType)));
  const [statuses, setStatuses] = useState<Set<string>>(new Set(['scheduled', 'completed']));
  const [person, setPerson] = useState<string>('all');
  const [withModules, setWithModules] = useState(true);
  const [sideOpen, setSideOpen] = useState(!phone);
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [detail, setDetail] = useState<{ item: CalItem; start: string; end: string } | null>(null);
  const anchor = useRef<HTMLElement | null>(null) as MutableRefObject<HTMLElement | null>;

  const items = useMemo(() => query.data ?? [], [query.data]);
  const people = useMemo(() => {
    const ids = [...new Set(items.map((i) => i.assigneeId).filter(Boolean))];
    return ids.map((id) => ({ value: id, label: recordTitle('employees', id, actor) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [items, actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          types.has(i.type) &&
          statuses.has(i.status) &&
          (withModules || i.source === 'event') &&
          (person === 'all' || (person === 'me' ? i.assigneeId === actor.staffId || i.attendeeIds.includes(actor.staffId) : i.assigneeId === person || i.attendeeIds.includes(person))),
      ),
    [items, types, statuses, withModules, person, actor.staffId],
  );
  const events = useMemo(() => visible.map(toFc), [visible]);
  const marked = useMemo(() => {
    const from = addDays(`${cursor.slice(0, 7)}-01`, -7);
    const to = addDays(from, 50);
    const set = new Set<string>();
    visible.forEach((i) => occurrences(i, from, `${to}T23:59`).forEach((o) => {
      for (let d = o.start.slice(0, 10); d <= o.end.slice(0, 10) && d <= to; d = addDays(d, 1)) set.add(d);
    }));
    return set;
  }, [visible, cursor]);

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

  /** Drag or resize: whole event, or "this / all" for a series; overlap warning; persisted via the service. */
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
    let scope: 'this' | 'all' | null = 'all';
    if (item.recurrence !== 'none') scope = await ask<'this' | 'all' | null>((resolve) => ({ kind: 'scope', title: C.dialogs.rescheduleTitle, verb: 'move', resolve }));
    if (!scope) return info.revert();
    if (!(await overlapOk({ id: item.id, ...next, assigneeId: item.assigneeId }, scope === 'this' ? item.id : undefined))) return info.revert();
    try {
      if (item.recurrence === 'none') await calendarService.move(actor, item.recordId, next, item.version);
      else if (scope === 'all') await calendarService.shiftSeries(actor, item.recordId, { start: oldStart, end: info.oldEvent.allDay ? addDays(oldEnd, -1) : oldEnd }, next, item.version);
      else await calendarService.updateOccurrence(actor, item.recordId, oldStart, next, item.version);
      toast(C.toasts.moved(item.title, allDay ? formatDate(start) : `${formatDateTime(start)}–${formatTime(end)}`, scope === 'this' && item.recurrence !== 'none'));
    } catch (e) {
      info.revert();
      toast(errorMessage(e), 'danger');
    }
  };

  const onSelect = (s: DateSelectArg) => {
    api()?.unselect();
    if (!canCreate) return;
    const allDay = s.allDay;
    const start = wall(s.start, allDay);
    let end = allDay ? addDays(wall(s.end, true), -1) : wall(s.end, false);
    // A single click on a month day becomes a 1-hour slot at 10:00 rather than an all-day block.
    if (allDay && view === 'dayGridMonth' && start === end) return setDialog({ kind: 'create', start: `${start}T10:00`, end: `${start}T11:00`, allDay: false });
    if (!allDay && minutes(start, end) < 30) end = `${start.slice(0, 11)}${hhmm(Math.min(23 * 60 + 59, +start.slice(11, 13) * 60 + +start.slice(14, 16) + 60))}`;
    setDialog({ kind: 'create', start, end, allDay });
  };

  const onEventClick = (c: EventClickArg) => {
    c.jsEvent.preventDefault();
    const item = c.event.extendedProps.item as CalItem | undefined;
    if (!item) return;
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
    const scope = await ask<'this' | 'all' | null>((resolve) => ({ kind: 'scope', title: C.dialogs.editTitle, verb: 'edit', resolve }));
    if (scope) setDialog({ kind: 'edit', item, scope, occurrence: { start, end } });
  };

  const deleteDetail = async () => {
    if (!detail) return;
    const { item, start } = detail;
    setDetail(null);
    if (item.recurrence !== 'none') {
      const scope = await ask<'this' | 'all' | null>((resolve) => ({ kind: 'scope', title: C.dialogs.deleteTitle, verb: 'delete', resolve }));
      if (!scope) return;
      try {
        if (scope === 'this') await calendarService.deleteOccurrence(actor, item.recordId, start, item.version);
        else await calendarService.remove(actor, item.recordId);
        toast(scope === 'this' ? C.toasts.occurrenceRemoved : C.toasts.seriesDeleted);
      } catch (e) {
        toast(errorMessage(e), 'danger');
      }
      return;
    }
    confirmDelete({
      title: C.dialogs.deleteConfirmTitle(item.title),
      message: C.dialogs.deleteConfirmMessage,
      onConfirm: async () => {
        try {
          await calendarService.remove(actor, item.recordId);
          toast(C.toasts.deleted);
        } catch (e) {
          toast(errorMessage(e), 'danger');
        }
      },
    });
  };

  const header = <PageHeader title={L.nav.pages.calendar.title} description={C.page.description} />;
  if (query.error)
    return (
      <div className="page">
        {header}
        <ErrorState title={C.page.loadError} onRetry={query.retry}>
          {query.error}
        </ErrorState>
      </div>
    );

  const typeValues = activeMasterValues('calEventType');
  return (
    <div className="page cal-page">
      {header}
      <div className={cx('cal-layout', !sideOpen && 'is-side-closed')}>
        {sideOpen && (
          <aside className="cal-side panel" aria-label={C.page.filters}>
            <Button variant="primary" size="default" icon="plus" className="cal-create" onClick={() => setDialog({ kind: 'create', start: `${cursor < today ? today : cursor}T10:00`, end: `${cursor < today ? today : cursor}T11:00`, allDay: false })} disabledReason={canCreate ? undefined : C.page.cannotCreate(actor.role.label)}>
              {C.page.create}
            </Button>
            <MiniMonth selected={cursor} today={today} marked={marked} onPick={(d) => api()?.gotoDate(d)} />
            <section className="cal-filter">
              <h3 className="cal-filter-title">{C.page.eventTypes}</h3>
              <ul className="cal-legend">
                {typeValues.map((t) => (
                  <li key={t.key}>
                    <label className={`cal-check ev-${t.key}`}>
                      <input
                        type="checkbox"
                        checked={types.has(t.key as EventType)}
                        onChange={(e) => {
                          const n = new Set(types);
                          if (e.target.checked) n.add(t.key as EventType);
                          else n.delete(t.key as EventType);
                          setTypes(n);
                        }}
                      />
                      <span className="cal-swatch" aria-hidden="true" />
                      {t.label}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
            <section className="cal-filter">
              <h3 className="cal-filter-title">{C.page.assignedUser}</h3>
              <SelectMenu block searchable label={C.page.assignedUser} value={person} options={[{ value: 'all', label: C.page.everyone }, { value: 'me', label: C.page.onlyMe }, ...people]} onChange={setPerson} />
            </section>
            <section className="cal-filter">
              <h3 className="cal-filter-title">{C.page.status}</h3>
              <ul className="cal-legend">
                {STATUSES.map((st) => (
                  <li key={st}>
                    <label className="cal-check">
                      <input
                        type="checkbox"
                        checked={statuses.has(st)}
                        onChange={(e) => {
                          const n = new Set(statuses);
                          if (e.target.checked) n.add(st);
                          else n.delete(st);
                          setStatuses(n);
                        }}
                      />
                      {masterLabel('calEventStatus', st)}
                    </label>
                  </li>
                ))}
              </ul>
              <label className="cal-check">
                <input type="checkbox" checked={withModules} onChange={(e) => setWithModules(e.target.checked)} />
                {C.page.withModules}
              </label>
            </section>
          </aside>
        )}

        <section className="cal-main panel" aria-label={C.page.region}>
          <div className="cal-toolbar">
            <IconButton icon="panel-left" label={sideOpen ? C.page.hidePanel : C.page.showPanel} aria-pressed={sideOpen} onClick={() => setSideOpen((o) => !o)} />
            <Button onClick={() => go('today')}>{C.page.today}</Button>
            <IconButton icon="chevron-left" label={C.page.previous} onClick={() => go('prev')} />
            <IconButton icon="chevron-right" label={C.page.next} onClick={() => go('next')} />
            <h2 className="cal-title" aria-live="polite">
              {title}
            </h2>
            <span className="spacer" />
            {!sideOpen && (
              <Button
                icon="plus"
                aria-label={C.page.createEvent}
                variant="primary"
                onClick={() => setDialog({ kind: 'create', start: `${cursor < today ? today : cursor}T10:00`, end: `${cursor < today ? today : cursor}T11:00`, allDay: false })}
                disabledReason={canCreate ? undefined : C.page.cannotCreate(actor.role.label)}
              />
            )}
            <div className="segmented" role="radiogroup" aria-label={C.page.viewGroup}>
              {VIEWS.map((v) => (
                <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={cx('seg-btn', view === v.id && 'is-on')} onClick={() => changeView(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {!query.data ? (
            <Skeleton rows={10} />
          ) : (
            <div className="tc-cal">
              <FullCalendar
                ref={cal}
                plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, rrulePlugin]}
                initialView={view}
                initialDate={cursor}
                headerToolbar={false}
                timeZone="Asia/Kolkata"
                now={istNow}
                firstDay={1}
                height={phone ? 'auto' : 'calc(100vh - 190px)'}
                events={events}
                editable
                eventStartEditable
                eventDurationEditable
                selectable={canCreate}
                selectMirror
                select={onSelect}
                eventClick={onEventClick}
                eventDrop={reschedule}
                eventResize={reschedule}
                datesSet={(d: DatesSetArg) => {
                  setTitle(d.view.title);
                  const mid = new Date((d.start.getTime() + d.end.getTime()) / 2);
                  setCursor(d.view.type === 'dayGridMonth' || d.view.type === 'agenda' ? (wall(d.view.currentStart, true) <= today && today < wall(d.view.currentEnd, true) ? today : wall(d.view.currentStart, true)) : wall(mid, true));
                }}
                dayMaxEvents={3}
                moreLinkText={(n) => C.page.more(n)}
                nowIndicator
                businessHours={{ daysOfWeek: [1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00' }}
                slotMinTime="07:00:00"
                slotMaxTime="21:00:00"
                scrollTime="08:30:00"
                slotDuration="00:30:00"
                slotEventOverlap={false}
                allDayText={C.page.allDay}
                eventTimeFormat={clock12}
                slotLabelFormat={clock12}
                eventMinHeight={22}
                eventShortHeight={36}
                views={{
                  dayGridMonth: { dayHeaderFormat: { weekday: 'short' } },
                  timeGridWeek: { dayHeaderFormat: { weekday: 'short', day: 'numeric' } },
                  timeGridDay: { dayHeaderFormat: { weekday: 'long', day: 'numeric', month: 'long' } },
                  // Agenda: like Google's Schedule — from the shown day, four weeks, grouped by date.
                  agenda: { type: 'list', duration: { weeks: 4 }, dateAlignment: 'day', listDayFormat: { weekday: 'long', day: 'numeric', month: 'short' }, listDaySideFormat: false, noEventsContent: C.page.agendaEmpty },
                }}
                eventDidMount={(arg) => {
                  // The drag/selection mirror has no item; only real events get the full-text tooltip.
                  const i = arg.event.extendedProps.item as CalItem | undefined;
                  if (i) arg.el.setAttribute('data-tooltip', i.linkLabel && !i.title.includes(i.linkLabel.split(' · ').pop() ?? '') ? `${i.title} · ${i.linkLabel}` : i.title);
                }}
              />
            </div>
          )}
        </section>
      </div>

      {detail && (
        <Popover open onClose={() => setDetail(null)} anchor={anchor as MutableRefObject<HTMLElement>} label={detail.item.title} width={340}>
          <EventDetail detail={detail} onEdit={editDetail} onDelete={deleteDetail} />
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

/** Event detail popover: title, time, type, linked record, attendees; Edit / Delete when permitted. */
function EventDetail({ detail, onEdit, onDelete }: { detail: { item: CalItem; start: string; end: string }; onEdit: () => void; onDelete: () => void }) {
  const actor = useActor();
  const { item: i, start, end } = detail;
  const when = i.allDay ? (start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`) : start.slice(0, 10) === end.slice(0, 10) ? `${formatDateTime(start)} – ${formatTime(end)}` : `${formatDateTime(start)} – ${formatDateTime(end)}`;
  const type = activeMasterValues('calEventType').find((t) => t.key === i.type);
  return (
    <div className="cal-detail">
      <div className={`cal-detail-head ev-${i.type}`}>
        <span className="cal-swatch" aria-hidden="true" />
        <strong className="cal-detail-title">{i.title}</strong>
      </div>
      <dl className="detail-list">
        <div className="detail-row">
          <dt>{C.detail.when}</dt>
          <dd>
            {when}
            {i.recurrence !== 'none' && <span className="muted small">{C.detail.repeats(masterLabel('calRecurrence', i.recurrence), i.recurrenceUntil ? formatDate(i.recurrenceUntil) : undefined)}</span>}
          </dd>
        </div>
        <div className="detail-row">
          <dt>{C.detail.type}</dt>
          <dd>
            {type?.label ?? i.type} <StatusChip label={masterLabel('calEventStatus', i.status)} tone={i.status === 'completed' ? 'success' : i.status === 'cancelled' ? 'neutral' : 'info'} />
          </dd>
        </div>
        <div className="detail-row">
          <dt>{C.detail.assignedUser}</dt>
          <dd>{recordTitle('employees', i.assigneeId, actor) || '—'}</dd>
        </div>
        {i.attendeeIds.length > 0 && (
          <div className="detail-row">
            <dt>{C.detail.attendees}</dt>
            <dd>{i.attendeeIds.map((a) => recordTitle('employees', a, actor)).join(', ')}</dd>
          </div>
        )}
        {(i.linkResource || i.source !== 'event') && (
          <div className="detail-row">
            <dt>{C.detail.linkedRecord}</dt>
            <dd>
              <Link className="rel-link" to={recordPeekPath(actor.workspaceId, i.source === 'event' ? i.linkResource! : i.source === 'leads' || i.source === 'opportunities' ? i.source : i.source, i.source === 'event' ? i.linkId! : i.recordId)}>
                {i.source === 'event' ? i.linkLabel ?? i.linkId : `${SOURCE_LABEL[i.source]} · ${i.recordId}`}
              </Link>
            </dd>
          </div>
        )}
        {i.location && (
          <div className="detail-row">
            <dt>{C.detail.where}</dt>
            <dd>{i.location}</dd>
          </div>
        )}
        {i.notes && (
          <div className="detail-row">
            <dt>{C.detail.notes}</dt>
            <dd className="clamp-2">{i.notes}</dd>
          </div>
        )}
      </dl>
      {i.source === 'event' ? (
        <div className="cal-detail-actions">
          <Button icon="trash" variant="ghost" onClick={onDelete} disabledReason={i.editable ? undefined : C.detail.cannotDelete}>
            {C.detail.delete}
          </Button>
          <Button icon="pencil" variant="primary" onClick={onEdit} disabledReason={i.editable ? undefined : C.detail.cannotEdit}>
            {C.detail.edit}
          </Button>
        </div>
      ) : (
        <p className="muted small">{C.detail.fromModule(SOURCE_LABEL[i.source])}</p>
      )}
    </div>
  );
}
