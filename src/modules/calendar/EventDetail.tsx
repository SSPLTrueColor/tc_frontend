import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { formatDate, formatDateTime, formatTime } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { type CalItem } from '../../services/calendar/events';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { Button, IconButton } from '../../components/primitives/Button';
import { StatusChip } from '../../components/primitives/feedback';

const C = L.calendar;
const SOURCE_LABEL: Record<string, string> = C.sources;

export interface Detail {
  item: CalItem;
  start: string;
  end: string;
}

export function whenText(i: CalItem, start: string, end: string) {
  if (i.allDay) return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
  return start.slice(0, 10) === end.slice(0, 10) ? `${formatDateTime(start)} – ${formatTime(end)}` : `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/**
 * Event detail popover: title, time, type, linked record, attendees, status. Edit / Delete are shown
 * only to people who may change the event; read-only roles and items from other modules see none.
 */
export function EventDetail({ detail, onEdit, onDelete, onClose }: { detail: Detail; onEdit: () => void; onDelete: () => void; onClose: () => void }) {
  const actor = useActor();
  const { item: i, start, end } = detail;
  const type = activeMasterValues('calEventType').find((t) => t.key === i.type);
  const canChange = i.source === 'event' && i.editable;
  return (
    <div className="cal-detail">
      <div className={`cal-detail-head ev-${i.type}`}>
        <span className="cal-swatch" aria-hidden="true" />
        <strong className="cal-detail-title">{i.title}</strong>
        <IconButton icon="x" label={C.detail.close} onClick={onClose} />
      </div>
      <dl className="detail-list">
        <div className="detail-row">
          <dt>{C.detail.when}</dt>
          <dd>
            {whenText(i, start, end)}
            {i.recurrence !== 'none' && <span className="muted small">{C.detail.repeats(masterLabel('calRecurrence', i.recurrence), i.recurrenceUntil ? formatDate(i.recurrenceUntil) : undefined)}</span>}
          </dd>
        </div>
        <div className="detail-row">
          <dt>{C.detail.type}</dt>
          <dd>{type?.label ?? i.type}</dd>
        </div>
        <div className="detail-row">
          <dt>{C.detail.status}</dt>
          <dd>
            <StatusChip label={masterLabel('calEventStatus', i.status)} tone={i.status === 'completed' ? 'success' : i.status === 'cancelled' ? 'neutral' : 'info'} />
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
              <Link className="rel-link" to={recordPeekPath(actor.workspaceId, i.source === 'event' ? i.linkResource! : i.source, i.source === 'event' ? i.linkId! : i.recordId)}>
                {i.source === 'event' ? i.linkLabel ?? i.linkId : `${SOURCE_LABEL[i.source]} · ${i.recordId}`}
              </Link>
            </dd>
          </div>
        )}
        {i.location && (
          <div className="detail-row">
            <dt>{C.detail.where}</dt>
            <dd className="clamp-2" data-tooltip={i.location}>
              {i.location}
            </dd>
          </div>
        )}
        {i.reminder !== 'none' && (
          <div className="detail-row">
            <dt>{C.detail.reminder}</dt>
            <dd>{masterLabel('calReminder', i.reminder)}</dd>
          </div>
        )}
        {i.notes && (
          <div className="detail-row">
            <dt>{C.detail.notes}</dt>
            <dd className="clamp-2" data-tooltip={i.notes}>
              {i.notes}
            </dd>
          </div>
        )}
      </dl>
      {canChange ? (
        <div className="cal-detail-actions">
          <Button icon="trash" variant="ghost" onClick={onDelete}>
            {C.detail.delete}
          </Button>
          <Button icon="pencil" variant="primary" onClick={onEdit} data-autofocus>
            {C.detail.edit}
          </Button>
        </div>
      ) : (
        <p className="muted small">{i.source === 'event' ? C.detail.cannotEdit : C.detail.fromModule(SOURCE_LABEL[i.source])}</p>
      )}
    </div>
  );
}
