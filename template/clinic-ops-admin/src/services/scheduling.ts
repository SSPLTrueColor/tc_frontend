/**
 * Scheduling Service: exclusive room and clinician bookings.
 * The check and the write happen inside one synchronous commit, which is atomic
 * within this browser tab only. A live system must enforce this server-side.
 */
import type { RecordData } from '../metadata/types';
import { addMinutes, formatTime, overlaps, parseLocal } from '../lib/dates';
import type { Db, ScheduleConflict } from './types';

const INACTIVE = ['cancelled', 'no_show'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function findConflicts(d: Db, candidate: Record<string, unknown>, workspaceId: string, selfId?: string): ScheduleConflict[] {
  if (INACTIVE.includes(String(candidate.status)) || !candidate.start || !candidate.durationMin) return [];
  const start = String(candidate.start);
  const end = addMinutes(start, Number(candidate.durationMin));
  const conflicts: ScheduleConflict[] = [];
  const inPerson = candidate.visitMode !== 'telehealth';

  const room = inPerson && candidate.roomId ? d.records.rooms.find((r) => r.id === candidate.roomId) : undefined;
  if (room && room.status !== 'available') {
    conflicts.push({ kind: 'room_status', message: `${room.name} is marked "${String(room.status).replace(/_/g, ' ')}" and cannot be booked.`, overridable: false });
  }

  const clinician = d.records.staff.find((s) => s.id === candidate.clinicianId);
  if (clinician) {
    const dayKey = DAY_KEYS[parseLocal(start).getDay()];
    const days = (clinician.workingDays as string[] | undefined) ?? [];
    if (days.length && !days.includes(dayKey)) {
      conflicts.push({ kind: 'working_day', message: `${clinician.fullName} does not normally work on ${dayKey.toUpperCase()}.`, overridable: true });
    }
    if (clinician.status !== 'active') {
      conflicts.push({ kind: 'working_day', message: `${clinician.fullName} is currently ${String(clinician.status).replace(/_/g, ' ')}.`, overridable: true });
    }
  }

  const others = d.records.appointments.filter((a: RecordData) => a.workspaceId === workspaceId && a.id !== selfId && !INACTIVE.includes(String(a.status)));
  for (const a of others) {
    const aStart = String(a.start);
    const aEnd = addMinutes(aStart, Number(a.durationMin));
    if (!overlaps(start, end, aStart, aEnd)) continue;
    const when = `${formatTime(aStart)}–${formatTime(aEnd)}`;
    if (inPerson && candidate.roomId && a.visitMode !== 'telehealth' && a.roomId === candidate.roomId) {
      conflicts.push({ kind: 'room', message: `${room?.name ?? 'Room'} is already booked ${when} (${a.id}).`, recordId: a.id, overridable: false });
    }
    if (a.clinicianId === candidate.clinicianId) {
      conflicts.push({ kind: 'clinician', message: `${clinician?.fullName ?? 'Clinician'} already has ${a.id} at ${when}.`, recordId: a.id, overridable: true });
    }
  }
  return conflicts;
}
