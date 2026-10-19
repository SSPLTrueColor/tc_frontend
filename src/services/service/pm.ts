/** Preventive maintenance (FR-085, SRV-11): schedule views, assignment, model-wise checklist, completion. */
import { nowLocal, todayKey } from '../../lib/dates';
import { uid } from '../../lib/ids';
import type { RecordData } from '../../metadata/types';
import { type Actor, can, canReadRecord, canUpdateRecord } from '../authz';
import { commit } from '../db';
import { byId } from '../lookups';
import { getResource } from '../registry';
import type { HookContext } from '../resourceHooks';
import { insertRecordIn, patchRecordIn, queryRecords } from '../runtime';
import { ServiceError } from '../types';
import { notifyStaff } from './tickets';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Model-wise PM checklist (by machine division; textile machines get the longest list). */
export function pmChecklist(machine: RecordData | undefined): string[] {
  const common = ['Clean machine exterior and work area', 'Check power supply, earthing and UPS', 'Update firmware / RIP if a release is pending', 'Record print counter reading'];
  const byDivision: Record<string, string[]> = {
    TX: ['Nozzle check on every head; clean / purge as needed', 'Inspect ink lines and dampers for leaks', 'Check belt tension and encoder strip', 'Clean and check heater / dryer', 'Verify fabric feed and tension rollers'],
    POD: ['Nozzle check and head alignment', 'Clean paper path and feed rollers', 'Check cutter blade', 'Verify colour calibration'],
    LBL: ['Check web tension and guides', 'Inspect die / cutter station', 'Head alignment and nozzle check', 'Verify registration marks sensor'],
  };
  return [...(byDivision[s(machine?.divisionId)] ?? []), ...common];
}

export function pmSchedule(actor: Actor) {
  const rows = queryRecords(actor, 'pmVisits', { sort: [{ field: 'dueDate', dir: 'asc' }] }).rows;
  return rows.map((p): RecordData & { machineLabel: string; model: string; customerLabel: string } => ({ ...p, machineLabel: s(byId('machines', p.machineId)?.serialNo) || s(p.machineId), model: s(byId('machines', p.machineId)?.model), customerLabel: s(byId('customers', p.customerId)?.name) || s(p.customerId) }));
}

function pmCommit<T>(actor: Actor, id: string, check: (p: RecordData) => boolean, denied: string, fn: (ctx: HookContext, p: RecordData) => T): T {
  const res = getResource('pmVisits');
  return commit((d) => {
    const p = (d.records.pmVisits ?? []).find((x) => x.id === id);
    if (!p || !canReadRecord(actor, res, p)) throw new ServiceError('not_found', `PM visit ${id} was not found.`);
    if (!check(p)) throw new ServiceError('forbidden', denied);
    return fn({ d, actor, correlationId: uid('cor') }, p);
  });
}

export function assignPm(actor: Actor, id: string, staffId: string) {
  if (!can(actor, 'ticket.assign')) throw new ServiceError('forbidden', 'Only coordinators and service leadership assign PM visits.');
  return pmCommit(actor, id, () => true, '', (ctx, p) => {
    if (p.status === 'done') throw new ServiceError('invalid_state', 'This PM visit is already done.');
    notifyStaff(ctx, staffId, `PM visit ${p.id} due ${s(p.dueDate)} assigned to you`, { page: 'my-jobs' }, 'assignment');
    return patchRecordIn(ctx, 'pmVisits', p.id, { engineerId: staffId }, 'PM visit assigned');
  });
}

/** Completes a PM visit; every checklist item must be answered, failed items need a note. */
export function completePm(actor: Actor, id: string, input: { results: { item: string; ok: boolean }[]; notes: string }) {
  if (input.results.some((r) => !r.ok) && !input.notes.trim()) throw new ServiceError('validation', 'Describe what was found for the failed checklist items.', { fieldErrors: { notes: 'Required when an item fails' } });
  return pmCommit(
    actor,
    id,
    (p) => p.engineerId === actor.staffId || canUpdateRecord(actor, getResource('pmVisits'), p),
    'Only the assigned engineer or the service desk can complete this PM visit.',
    (ctx, p) => {
      if (p.status === 'done') throw new ServiceError('invalid_state', 'This PM visit is already done.');
      const text = [...input.results.map((r) => `${r.ok ? '✓' : '✗'} ${r.item}`), input.notes.trim() && `Notes: ${input.notes.trim()}`].filter(Boolean).join('\n');
      return patchRecordIn(ctx, 'pmVisits', p.id, { status: 'done', completedAt: todayKey(), checklist: text, engineerId: p.engineerId || actor.staffId }, `PM visit completed${input.results.some((r) => !r.ok) ? ' with findings' : ''}`);
    },
  );
}

/** Raises a PM-type ticket for the visit (e.g. to send an engineer with the job-card flow). */
export function raisePmTicket(actor: Actor, id: string) {
  if (!can(actor, 'ticket.assign')) throw new ServiceError('forbidden', 'Only the service desk raises PM tickets.');
  return pmCommit(actor, id, () => true, '', (ctx, p) => {
    if (p.ticketId) throw new ServiceError('invalid_state', `Ticket ${p.ticketId} already exists for this visit.`);
    const machine = byId('machines', p.machineId, ctx.d.records);
    const t = insertRecordIn(ctx, 'tickets', {
      customerId: p.customerId,
      machineId: p.machineId,
      divisionId: p.divisionId || machine?.divisionId,
      description: `Preventive maintenance visit due ${s(p.dueDate)}${machine ? ` for ${s(machine.serialNo)}` : ''}`,
      category: 'other',
      ticketType: 'pm',
      priority: 'low',
      channel: 'phone',
      assigneeId: p.engineerId || null,
      reportedAt: nowLocal(),
    });
    patchRecordIn(ctx, 'pmVisits', p.id, { ticketId: t.id }, `PM ticket ${t.id} raised`);
    return t;
  });
}
