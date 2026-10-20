import { useRef, useState, type RefObject } from 'react';
import { L } from '../../constants/labels';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../services/api/client';
import { calendarService } from '../../services/api/calendar';
import type { Actor } from '../../services/authz';
import { findOverlaps, validateEvent } from '../../services/calendar/events';
import { activeMasterValues } from '../../services/registry';
import { Button, IconButton } from '../../components/primitives/Button';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { Popover } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { Checkbox, TextField } from '../../components/primitives/controls';

const Q = L.calendar.quick;
const C = L.calendar;

export interface Slot {
  start: string;
  end: string;
  allDay: boolean;
}

/**
 * Quick-create popover: title, type and time for the slot that was clicked or dragged. Saves straight
 * to the calendar; "More options" hands what was typed to the full dialog. A failed save keeps the
 * popover open with the text intact so nothing is lost.
 */
export function QuickCreate({ actor, anchor, slot, onClose, onMore }: { actor: Actor; anchor: RefObject<HTMLElement>; slot: Slot; onClose: () => void; onMore: (draft: { title: string; eventType: string }, slot: Slot) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState('meeting');
  const [allDay, setAllDay] = useState(slot.allDay);
  const [from, setFrom] = useState(slot.allDay ? '10:00' : slot.start.slice(11, 16));
  const [to, setTo] = useState(slot.allDay ? '11:00' : slot.end.slice(11, 16));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const saving = useRef(false);

  const sd = slot.start.slice(0, 10);
  const ed = slot.end.slice(0, 10);
  const start = allDay ? sd : `${sd}T${from}`;
  const end = allDay ? ed : `${ed}T${to}`;
  const draft = { title: title.trim(), start, end, allDay };
  const errors = validateEvent({ ...draft, status: 'scheduled' }, { checkPast: true });
  const overlaps = Object.keys(errors).length ? [] : findOverlaps(actor, { start, end, allDay, assigneeId: actor.staffId });
  const when = sd === ed ? formatDate(sd) : `${formatDate(sd)} – ${formatDate(ed)}`;

  const save = async () => {
    if (saving.current) return;
    setTried(true);
    if (Object.keys(errors).length) return;
    saving.current = true;
    setBusy(true);
    setFailure('');
    try {
      await calendarService.create(actor, { title: draft.title, eventType, allDay, start, end, recurrence: 'none', assigneeId: actor.staffId, attendeeIds: [], status: 'scheduled', reminder: 'none' });
      toast(C.toasts.created(draft.title));
      onClose();
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <Popover open onClose={onClose} anchor={anchor} label={Q.title} width={340} className="cal-quick-pop">
      <form
        className="cal-quick"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <div className="cal-quick-head">
          <TextField className="cal-quick-title" aria-label={Q.titleLabel} placeholder={Q.titlePlaceholder} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={(tried && !!errors.title) || undefined} data-autofocus />
          <IconButton icon="x" label={Q.close} onClick={onClose} />
        </div>
        {tried && errors.title && <p className="field-error">{errors.title}</p>}
        <div className="cal-quick-row">
          <span className="cal-quick-label">{Q.type}</span>
          <SelectMenu block label={Q.type} value={eventType} options={activeMasterValues('calEventType').map((x) => ({ value: x.key, label: x.label }))} onChange={setEventType} />
        </div>
        <div className="cal-quick-row">
          <span className="cal-quick-label">{Q.date}</span>
          <span className="cal-quick-when">{when}</span>
          <label className="cal-check">
            <Checkbox checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            {Q.allDay}
          </label>
        </div>
        {!allDay && (
          <div className="cal-quick-row">
            <span className="cal-quick-label">{Q.from}</span>
            <TextField type="time" className="cal-quick-time" aria-label={Q.from} value={from} step={300} onChange={(e) => setFrom(e.target.value)} aria-invalid={(tried && !!errors.start) || undefined} />
            <span className="cal-quick-label">{Q.to}</span>
            <TextField type="time" className="cal-quick-time" aria-label={Q.to} value={to} step={300} onChange={(e) => setTo(e.target.value)} aria-invalid={(tried && !!errors.end) || undefined} />
          </div>
        )}
        {tried && (errors.start || errors.end) && (
          <p className="field-error" role="alert">
            {errors.start ?? errors.end}
          </p>
        )}
        {overlaps.length > 0 && <InlineAlert tone="warning" title={Q.overlap(overlaps.length)}>{overlaps[0].title}</InlineAlert>}
        {failure && (
          <p className="field-error" role="alert">
            {C.toasts.saveFailed(failure)}
          </p>
        )}
        <div className="cal-quick-actions">
          <Button variant="ghost" onClick={() => onMore({ title: title.trim(), eventType }, { start, end, allDay })}>
            {Q.moreOptions}
          </Button>
          <Button variant="primary" type="submit" loading={busy}>
            {failure ? C.toasts.retry : Q.save}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
