import { useMemo, useState } from 'react';
import type { RecordData, ResourceDefinition } from '../../metadata/types';
import { addDays, addMinutes, formatTime, formatWeekday, parseLocal, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { PHONE, useMedia } from '../../lib/useMedia';
import { type Actor, canReadRecord } from '../../services/authz';
import { getDb } from '../../services/db';
import { getResource, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { evalCondition } from '../../services/validation';
import { Button, IconButton } from '../primitives/Button';
import { StatusChip } from '../primitives/feedback';
import { DatePicker } from '../primitives/DatePicker';
import { InfoTip } from '../primitives/InfoTip';

const DAY_START = 7;
const DAY_END = 19;
const HOUR_PX = 80;
const INACTIVE = ['cancelled', 'no_show'];

/**
 * Resource-timeline day calendar driven by `resource.calendar` metadata.
 * Lanes = related records (rooms / clinicians). Click an empty slot to book.
 */
export function CalendarView({
  res,
  actor,
  rows,
  onOpen,
  onCreateAt,
  activeId,
  date: controlledDate,
  onDateChange,
}: {
  res: ResourceDefinition;
  actor: Actor;
  rows: RecordData[];
  onOpen: (id: string) => void;
  onCreateAt?: (values: Record<string, unknown>) => void;
  activeId?: string;
  date?: string;
  onDateChange?: (d: string) => void;
}) {
  const cal = res.calendar!;
  const [laneIdx, setLaneIdx] = useState(0);
  const [localDate, setLocalDate] = useState(todayKey());
  const date = controlledDate ?? localDate;
  const setDate = onDateChange ?? setLocalDate;
  const [showInactive, setShowInactive] = useState(false);
  const phone = useMedia(PHONE);
  const lane = cal.lanes[laneIdx];
  const statusKey = res.lifecycle?.field ?? 'status';
  const statusMaster = res.fields.find((f) => f.key === statusKey)?.master;
  const sv = (r: RecordData) => (statusMaster ? masterValue(statusMaster, r[statusKey]) : undefined);
  const laneField = res.fields.find((f) => f.key === lane.field)!;
  const laneRes = getResource(laneField.relation!.resource);

  const lanes = useMemo(() => {
    let list = (getDb().records[laneRes.key] ?? []).filter((r) => canReadRecord(actor, laneRes, r));
    if (lane.laneFilter) list = list.filter((r) => evalCondition(lane.laneFilter, r));
    list = list.filter((r) => r.status !== 'inactive' && !(laneRes.key === 'rooms' && r.roomType === 'telehealth'));
    const out = list.map((r) => ({ id: r.id as string | null, label: recordTitle(laneRes.key, r.id, actor), note: r.status !== 'available' && r.status !== 'active' ? String(r.status).replace(/_/g, ' ') : '' }));
    if (lane.emptyLaneLabel) out.push({ id: null, label: lane.emptyLaneLabel, note: '' });
    return out;
  }, [laneRes, lane, actor]);

  const dayRows = rows.filter((r) => String(r[cal.startField]).startsWith(date) && (showInactive || !INACTIVE.includes(String(r.status))));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

  const top = (start: string) => {
    const d = parseLocal(start);
    return (d.getHours() + d.getMinutes() / 60 - DAY_START) * HOUR_PX;
  };

  const header = (
    <div className="cal-toolbar">
      <div className="cal-nav">
        <IconButton icon="chevron-left" label="Previous day" onClick={() => setDate(addDays(date, -1))} />
        <Button onClick={() => setDate(todayKey())} disabled={date === todayKey()}>
          Today
        </Button>
        <IconButton icon="chevron-right" label="Next day" onClick={() => setDate(addDays(date, 1))} />
        <DatePicker label="Go to date" value={date} onChange={(v) => v && setDate(v)} clearable={false} />
        <strong className="cal-date">{formatWeekday(date)}</strong>
        {onCreateAt && <InfoTip text="Click an empty slot to book it. Rooms under maintenance are not bookable." label="About the calendar" />}
      </div>
      <div className="cal-nav">
        <div className="segmented" role="radiogroup" aria-label="Group lanes by">
          {cal.lanes.map((l, i) => (
            <button key={l.field} type="button" role="radio" aria-checked={i === laneIdx} className={cx('seg-btn', i === laneIdx && 'is-on')} onClick={() => setLaneIdx(i)}>
              {l.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show cancelled
        </label>
      </div>
    </div>
  );

  if (phone) {
    // Agenda fallback on phones.
    const sorted = [...dayRows].sort((a, b) => String(a[cal.startField]).localeCompare(String(b[cal.startField])));
    return (
      <div className="calendar">
        {header}
        <ul className="agenda">
          {sorted.map((r) => (
            <li key={r.id}>
              <button type="button" className="agenda-item" onClick={() => onOpen(r.id)}>
                <span className="agenda-time">{formatTime(String(r[cal.startField]))}</span>
                <span>
                  <strong>{recordTitle(res.key, r.id, actor).split(' · ')[0]}</strong>
                  <span className="muted"> · {recordTitle(laneRes.key, r[lane.field], actor) || lane.emptyLaneLabel}</span>
                </span>
                <StatusChip label={sv(r)?.label ?? ''} tone={sv(r)?.tone} />
              </button>
            </li>
          ))}
          {!sorted.length && <li className="muted agenda-empty">No bookings on this day.</li>}
        </ul>
      </div>
    );
  }

  return (
    <div className="calendar">
      {header}
      <div className="cal-scroll">
        <div className="cal-grid" style={{ gridTemplateColumns: `76px repeat(${lanes.length}, minmax(150px, 1fr))` }}>
          <div className="cal-corner" />
          {lanes.map((l) => (
            <div key={l.id ?? 'none'} className={cx('cal-lane-head', l.note && 'has-note')} data-tooltip={l.note ? `${l.label} — ${l.note}` : l.label}>
              <span>{l.label}</span>
              {l.note && <span className="tag tone-warning">{l.note}</span>}
            </div>
          ))}
          <div className="cal-times" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h) => (
              <span key={h} className="cal-time" style={{ top: (h - DAY_START) * HOUR_PX }}>
                {formatTime(`${date}T${String(h).padStart(2, '0')}:00`)}
              </span>
            ))}
          </div>
          {lanes.map((l) => {
            const items = dayRows.filter((r) => (r[lane.field] ?? null) === l.id);
            return (
              <div key={l.id ?? 'none'} className="cal-lane" style={{ height: hours.length * HOUR_PX }}>
                {hours.flatMap((h) =>
                  [0, 30].map((m) => {
                    const start = `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                    return (
                      <button
                        key={start}
                        type="button"
                        className="cal-slot"
                        style={{ top: (h - DAY_START + m / 60) * HOUR_PX, height: HOUR_PX / 2 }}
                        aria-label={onCreateAt ? `Book ${l.label} at ${formatTime(start)}` : `${l.label} ${formatTime(start)}`}
                        disabled={!onCreateAt || l.note !== ''}
                        tabIndex={-1}
                        onClick={() => onCreateAt?.({ [cal.startField]: start, ...(l.id ? { [lane.field]: l.id } : lane.field === 'roomId' ? { visitMode: 'telehealth' } : {}) })}
                      />
                    );
                  }),
                )}
                {layoutEvents(items, cal.startField, cal.durationField).map(({ r, col, cols }) => {
                  const start = String(r[cal.startField]);
                  const dur = Number(r[cal.durationField]) || 30;
                  const overlapping = cols > 1;
                  const mv = sv(r);
                  const name = recordTitle(res.key, r.id, actor).split(' · ')[0];
                  const endT = formatTime(addMinutes(start, dur));
                  const startT = formatTime(start);
                  // "08:30–09:30 AM" when both share AM/PM — short enough to never be cut
                  const range = startT.slice(-2) === endT.slice(-2) ? `${startT.slice(0, -3)}–${endT}` : `${startT}–${endT}`;
                  const h = Math.max(22, (dur / 60) * HOUR_PX - 2);
                  // Content adapts to the block height so text is never cut: 1 line → 2 lines → 3 lines.
                  const size = h < 36 ? 'is-tiny' : h < 56 ? 'is-short' : '';
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={cx('cal-event', `tone-${mv?.tone ?? 'neutral'}`, activeId === r.id && 'is-active', size, INACTIVE.includes(String(r.status)) && 'is-inactive', overlapping && 'is-overlap')}
                      style={{ top: top(start), height: h, left: `calc(${(col / cols) * 100}% + 4px)`, width: `calc(${100 / cols}% - 8px)` }}
                      onClick={() => onOpen(r.id)}
                      data-tooltip={`${name}\n${range}${mv?.label ? ` · ${mv.label}` : ''}${overlapping ? '\nOverlaps another booking' : ''}`}
                      aria-label={`${recordTitle(res.key, r.id, actor)}, ${dur} minutes, ${mv?.label ?? ''}${overlapping ? ', overlaps another booking' : ''}`}
                    >
                      <span className="cal-event-title">{name}</span>
                      <span className="cal-event-time">{size === 'is-tiny' ? startT : range}</span>
                      {!size && <span className="cal-event-status">{mv?.label}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Overlapping bookings sit side by side (like Google/Outlook day view) instead of covering each other.
 * Greedy column assignment per overlap cluster.
 */
export function layoutEvents(items: RecordData[], startField: string, durField: string) {
  const end = (r: RecordData) => addMinutes(String(r[startField]), Number(r[durField]) || 30);
  const sorted = [...items].sort((a, b) => String(a[startField]).localeCompare(String(b[startField])) || end(b).localeCompare(end(a)));
  const out: { r: RecordData; col: number; cols: number }[] = [];
  let cluster: { r: RecordData; col: number; cols: number }[] = [];
  let colEnds: string[] = [];
  let clusterEnd = '';
  const flush = () => {
    cluster.forEach((c) => (c.cols = colEnds.length));
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const r of sorted) {
    const s = String(r[startField]);
    if (cluster.length && s >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end(r));
    } else colEnds[col] = end(r);
    cluster.push({ r, col, cols: 1 });
    if (cluster.length === 1 || end(r) > clusterEnd) clusterEnd = end(r);
  }
  if (cluster.length) flush();
  return out;
}
