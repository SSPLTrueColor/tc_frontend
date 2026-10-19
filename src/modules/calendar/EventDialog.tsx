import { useEffect, useMemo, useState } from 'react';
import { addDays, formatDateTime, formatDate } from '../../lib/dates';
import { errorMessage } from '../../services/api/client';
import { calendarService } from '../../services/api/calendar';
import { type Actor, perm } from '../../services/authz';
import { findOverlaps, linkCandidates, validateEvent, type CalItem } from '../../services/calendar/events';
import { activeMasterValues } from '../../services/registry';
import { queryRecords } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { MultiSelectMenu } from '../../components/primitives/MultiSelectMenu';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { VoiceButton } from '../../components/crm/VoiceButton';

export type DialogMode =
  | { kind: 'create'; start: string; end: string; allDay: boolean }
  /** `scope`: whole event / series ("all") or one occurrence of a series ("this"). */
  | { kind: 'edit'; item: CalItem; scope: 'all' | 'this'; occurrence?: { start: string; end: string } };

interface Values {
  title: string;
  eventType: string;
  allDay: boolean;
  start: string;
  end: string;
  recurrence: string;
  recurrenceUntil: string;
  assigneeId: string;
  attendeeIds: string[];
  linkResource: string;
  linkId: string;
  location: string;
  status: string;
  notes: string;
}

/** Employees the actor may put events on, following their calendar update scope. */
function assignable(actor: Actor): { value: string; label: string }[] {
  const scope = perm(actor, 'calendarEvents').update;
  const all = queryRecords(actor, 'employees', { sort: [{ field: 'fullName', dir: 'asc' }] }).rows.filter((e) => e.status !== 'inactive');
  const ok = (e: (typeof all)[number]) =>
    scope === 'all' || (scope === 'team' && actor.teamStaffIds.includes(e.id)) || (scope === 'division' && ((e.divisionIds as string[]) ?? []).some((d) => actor.divisionIds.includes(d))) || e.id === actor.staffId;
  return all.filter(ok).map((e) => ({ value: e.id, label: String(e.fullName) }));
}

const LINK_TYPES = () => [{ value: '', label: 'No linked record' }, ...activeMasterValues('calLinkType').map((v) => ({ value: v.key, label: v.label }))];

function initialValues(actor: Actor, mode: DialogMode): Values {
  if (mode.kind === 'create')
    return { title: '', eventType: 'meeting', allDay: mode.allDay, start: mode.start, end: mode.end, recurrence: 'none', recurrenceUntil: '', assigneeId: actor.staffId, attendeeIds: [], linkResource: '', linkId: '', location: '', status: 'scheduled', notes: '' };
  const i = mode.item;
  const occ = mode.scope === 'this' && mode.occurrence ? mode.occurrence : { start: i.start, end: i.end };
  return {
    title: i.title,
    eventType: i.type,
    allDay: i.allDay,
    start: occ.start,
    end: occ.end,
    recurrence: mode.scope === 'this' ? 'none' : i.recurrence,
    recurrenceUntil: i.recurrenceUntil ?? '',
    assigneeId: i.assigneeId,
    attendeeIds: i.attendeeIds,
    linkResource: i.linkResource ?? '',
    linkId: i.linkId ?? '',
    location: i.location ?? '',
    status: i.status,
    notes: i.notes ?? '',
  };
}

/**
 * Create / edit an event. Validation runs as you type (end after start, no past scheduling, repeat
 * until after start) and again in the service. Overlaps for the assigned person are a warning only.
 */
export function EventDialog({ actor, mode, onClose }: { actor: Actor; mode: DialogMode | null; onClose: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<Values | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode) {
      setV(initialValues(actor, mode));
      setErrors({});
      setTried(false);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => (mode ? assignable(actor) : []), [mode, actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const everyone = useMemo(() => (mode ? queryRecords(actor, 'employees', { sort: [{ field: 'fullName', dir: 'asc' }] }).rows.filter((e) => e.status !== 'inactive').map((e) => ({ value: e.id, label: String(e.fullName) })) : []), [mode, actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const records = useMemo(() => (v?.linkResource ? linkCandidates(actor, v.linkResource) : []), [v?.linkResource, actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mode || !v) return null;
  const isEdit = mode.kind === 'edit';
  const original = isEdit ? initialValues(actor, mode) : null;
  const timeChanged = !original || original.start !== v.start || original.end !== v.end || original.allDay !== v.allDay;
  const liveErrors = validateEvent(v, { checkPast: timeChanged && !(isEdit && mode.scope === 'all' && mode.item.recurrence !== 'none') });
  const shown = tried ? { ...liveErrors, ...errors } : errors;
  const overlaps = v.status === 'scheduled' ? findOverlaps(actor, { id: isEdit ? mode.item.id : undefined, start: v.start, end: v.end, allDay: v.allDay, assigneeId: v.assigneeId }, isEdit && mode.scope === 'this' ? mode.item.id : undefined) : [];
  const set = (patch: Partial<Values>) => setV({ ...v, ...patch });

  const toggleAllDay = (allDay: boolean) => {
    if (allDay) set({ allDay, start: v.start.slice(0, 10), end: v.end.slice(0, 10) });
    else set({ allDay, start: `${v.start.slice(0, 10)}T10:00`, end: `${v.end.slice(0, 10)}T11:00` });
  };

  const save = async () => {
    setTried(true);
    if (Object.keys(liveErrors).length) return;
    const link = records.find((r) => r.value === v.linkId);
    const payload: Record<string, unknown> = {
      title: v.title.trim(),
      eventType: v.eventType,
      allDay: v.allDay,
      start: v.start,
      end: v.end,
      recurrence: v.recurrence,
      recurrenceUntil: v.recurrence !== 'none' ? v.recurrenceUntil || null : null,
      assigneeId: v.assigneeId,
      attendeeIds: v.attendeeIds,
      linkResource: v.linkResource || null,
      linkId: v.linkResource ? v.linkId || null : null,
      linkLabel: link?.label ?? null,
      customerId: link?.customerId ?? null,
      location: v.location.trim() || null,
      status: v.status,
      notes: v.notes.trim() || null,
    };
    setBusy(true);
    try {
      if (mode.kind === 'create') {
        await calendarService.create(actor, payload);
        toast(`“${payload.title}” added to the calendar`);
      } else if (mode.scope === 'this' && mode.occurrence) {
        await calendarService.updateOccurrence(actor, mode.item.recordId, mode.occurrence.start, payload, mode.item.version);
        toast('This occurrence was updated; the rest of the series is unchanged');
      } else {
        await calendarService.update(actor, mode.item.recordId, payload, mode.item.version);
        toast(mode.item.recurrence !== 'none' ? 'All events in the series were updated' : 'Event updated');
      }
      onClose();
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
      else setErrors({ form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const fmt = (x: string) => (x.length > 10 ? formatDateTime(x) : formatDate(x));
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={mode.kind === 'create' ? 'New event' : mode.scope === 'this' ? 'Edit this occurrence' : mode.item.recurrence !== 'none' ? 'Edit all events in the series' : 'Edit event'}
      description="Times are India Standard Time (IST). The assigned person and attendees see it in their calendar."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {overlaps.length ? 'Save anyway' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2 cal-form">
        <div className="form-field span-all">
          <label className="field-label" htmlFor="ev-title">
            Title <span className="req">*</span>
          </label>
          <input id="ev-title" className="input" maxLength={120} value={v.title} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!shown.title || undefined} data-autofocus />
          {shown.title && <p className="field-error">{shown.title}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="ev-type">
            Type <span className="req">*</span>
          </label>
          <SelectMenu id="ev-type" block label="Event type" value={v.eventType} options={activeMasterValues('calEventType').map((x) => ({ value: x.key, label: x.label }))} onChange={(x) => set({ eventType: x })} />
        </div>
        <div className="form-field">
          <span className="field-label">All day</span>
          <label className="switch">
            <input type="checkbox" checked={v.allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span>{v.allDay ? 'Yes' : 'No'}</span>
          </label>
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="ev-start">
            Starts <span className="req">*</span>
          </label>
          <DatePicker id="ev-start" block withTime={!v.allDay} value={v.start} clearable={false} label="Starts" invalid={!!shown.start} onChange={(x) => x && set({ start: x, end: x >= v.end ? (v.allDay ? x : `${x.slice(0, 10)}T${String(Math.min(23, +x.slice(11, 13) + 1)).padStart(2, '0')}${x.slice(13, 16)}`) : v.end })} />
          {shown.start && <p className="field-error">{shown.start}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="ev-end">
            Ends <span className="req">*</span>
          </label>
          <DatePicker id="ev-end" block withTime={!v.allDay} value={v.end} clearable={false} label="Ends" invalid={!!shown.end} onChange={(x) => x && set({ end: x })} />
          {shown.end && <p className="field-error">{shown.end}</p>}
        </div>
        {!(mode.kind === 'edit' && mode.scope === 'this') && (
          <>
            <div className="form-field">
              <label className="field-label" htmlFor="ev-rec">
                Repeats
              </label>
              <SelectMenu id="ev-rec" block label="Repeats" value={v.recurrence} options={activeMasterValues('calRecurrence').map((x) => ({ value: x.key, label: x.label }))} onChange={(x) => set({ recurrence: x, recurrenceUntil: x === 'none' ? '' : v.recurrenceUntil || addDays(v.start.slice(0, 10), x === 'daily' ? 30 : x === 'weekly' ? 84 : 365) })} />
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="ev-until">
                Repeat until
              </label>
              <DatePicker id="ev-until" block value={v.recurrenceUntil} label="Repeat until" disabled={v.recurrence === 'none'} invalid={!!shown.recurrenceUntil} onChange={(x) => set({ recurrenceUntil: x ?? '' })} />
              {shown.recurrenceUntil && <p className="field-error">{shown.recurrenceUntil}</p>}
            </div>
          </>
        )}
        <div className="form-field">
          <label className="field-label" htmlFor="ev-who">
            Assigned to <span className="req">*</span>
          </label>
          <SelectMenu id="ev-who" block searchable label="Assigned to" value={v.assigneeId} options={people} onChange={(x) => set({ assigneeId: x })} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="ev-att">
            Attendees
          </label>
          <MultiSelectMenu id="ev-att" block label="Attendees" values={v.attendeeIds} options={everyone.filter((e) => e.value !== v.assigneeId)} onChange={(x) => set({ attendeeIds: x })} emptyLabel="No attendees" />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="ev-lt">
            Linked record
          </label>
          <SelectMenu id="ev-lt" block label="Linked record type" value={v.linkResource} options={LINK_TYPES()} onChange={(x) => set({ linkResource: x, linkId: '' })} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="ev-lr">
            {v.linkResource ? 'Record' : ' '}
          </label>
          <SelectMenu id="ev-lr" block searchable label="Linked record" value={v.linkId} options={records} disabled={!v.linkResource} placeholder={v.linkResource ? 'Search…' : 'Pick a type first'} onChange={(x) => set({ linkId: x })} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="ev-loc">
            Location
          </label>
          <input id="ev-loc" className="input" maxLength={160} value={v.location} onChange={(e) => set({ location: e.target.value })} />
        </div>
        {isEdit && (
          <div className="form-field">
            <label className="field-label" htmlFor="ev-status">
              Status
            </label>
            <SelectMenu id="ev-status" block label="Status" value={v.status} options={activeMasterValues('calEventStatus').map((x) => ({ value: x.key, label: x.label }))} onChange={(x) => set({ status: x })} />
          </div>
        )}
        <div className="form-field span-all">
          <span className="field-label-row">
            <label className="field-label" htmlFor="ev-notes">
              Notes
            </label>
            <VoiceButton onText={(t) => set({ notes: v.notes ? `${v.notes} ${t}` : t })} label="Dictate notes" />
          </span>
          <textarea id="ev-notes" className="input textarea" rows={2} maxLength={2000} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        {overlaps.length > 0 && (
          <div className="span-all">
            <InlineAlert tone="warning" title={`Overlaps ${overlaps.length} other ${overlaps.length === 1 ? 'event' : 'events'} for this person`}>
              {overlaps
                .slice(0, 3)
                .map((o) => `${o.title} (${fmt(o.start)}–${o.end.slice(11, 16)})`)
                .join(' · ')}
              {overlaps.length > 3 ? ` · +${overlaps.length - 3} more` : ''}
            </InlineAlert>
          </div>
        )}
        {shown.form && (
          <p className="field-error span-all" role="alert">
            {shown.form}
          </p>
        )}
      </div>
    </Dialog>
  );
}
