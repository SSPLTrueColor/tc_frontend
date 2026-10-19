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
import { L } from '../../constants/labels';

const E = L.service.errors;
const A = L.service.audit;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Model-wise PM checklist (by machine division; textile machines get the longest list). */
export function pmChecklist(machine: RecordData | undefined): string[] {
  const c = L.service.checklist;
  const byDivision: Record<string, readonly string[]> = { TX: c.TX, POD: c.POD, LBL: c.LBL };
  return [...(byDivision[s(machine?.divisionId)] ?? []), ...c.common];
}

export function pmSchedule(actor: Actor) {
  const rows = queryRecords(actor, 'pmVisits', { sort: [{ field: 'dueDate', dir: 'asc' }] }).rows;
  return rows.map((p): RecordData & { machineLabel: string; model: string; customerLabel: string } => ({ ...p, machineLabel: s(byId('machines', p.machineId)?.serialNo) || s(p.machineId), model: s(byId('machines', p.machineId)?.model), customerLabel: s(byId('customers', p.customerId)?.name) || s(p.customerId) }));
}

function pmCommit<T>(actor: Actor, id: string, check: (p: RecordData) => boolean, denied: string, fn: (ctx: HookContext, p: RecordData) => T): T {
  const res = getResource('pmVisits');
  return commit((d) => {
    const p = (d.records.pmVisits ?? []).find((x) => x.id === id);
    if (!p || !canReadRecord(actor, res, p)) throw new ServiceError('not_found', E.pmNotFound(id));
    if (!check(p)) throw new ServiceError('forbidden', denied);
    return fn({ d, actor, correlationId: uid('cor') }, p);
  });
}

export function assignPm(actor: Actor, id: string, staffId: string) {
  if (!can(actor, 'ticket.assign')) throw new ServiceError('forbidden', E.pmAssignDenied);
  return pmCommit(actor, id, () => true, '', (ctx, p) => {
    if (p.status === 'done') throw new ServiceError('invalid_state', E.pmAlreadyDone);
    notifyStaff(ctx, staffId, L.service.notify.pmAssigned(p.id, s(p.dueDate)), { page: 'my-jobs' }, 'assignment');
    return patchRecordIn(ctx, 'pmVisits', p.id, { engineerId: staffId }, A.pmAssigned);
  });
}

/** Completes a PM visit; every checklist item must be answered, failed items need a note. */
export function completePm(actor: Actor, id: string, input: { results: { item: string; ok: boolean }[]; notes: string }) {
  if (input.results.some((r) => !r.ok) && !input.notes.trim()) throw new ServiceError('validation', E.pmFindings, { fieldErrors: { notes: E.pmFindingsField } });
  return pmCommit(
    actor,
    id,
    (p) => p.engineerId === actor.staffId || canUpdateRecord(actor, getResource('pmVisits'), p),
    E.pmCompleteDenied,
    (ctx, p) => {
      if (p.status === 'done') throw new ServiceError('invalid_state', E.pmAlreadyDone);
      const text = [...input.results.map((r) => `${r.ok ? '✓' : '✗'} ${r.item}`), input.notes.trim() && L.service.checklist.notes(input.notes.trim())].filter(Boolean).join('\n');
      return patchRecordIn(ctx, 'pmVisits', p.id, { status: 'done', completedAt: todayKey(), checklist: text, engineerId: p.engineerId || actor.staffId }, A.pmCompleted(input.results.some((r) => !r.ok)));
    },
  );
}

/** Raises a PM-type ticket for the visit (e.g. to send an engineer with the job-card flow). */
export function raisePmTicket(actor: Actor, id: string) {
  if (!can(actor, 'ticket.assign')) throw new ServiceError('forbidden', E.pmTicketDenied);
  return pmCommit(actor, id, () => true, '', (ctx, p) => {
    if (p.ticketId) throw new ServiceError('invalid_state', E.pmTicketExists(s(p.ticketId)));
    const machine = byId('machines', p.machineId, ctx.d.records);
    const t = insertRecordIn(ctx, 'tickets', {
      customerId: p.customerId,
      machineId: p.machineId,
      divisionId: p.divisionId || machine?.divisionId,
      description: A.pmTicketDescription(s(p.dueDate), s(machine?.serialNo)),
      category: 'other',
      ticketType: 'pm',
      priority: 'low',
      channel: 'phone',
      assigneeId: p.engineerId || null,
      reportedAt: nowLocal(),
    });
    patchRecordIn(ctx, 'pmVisits', p.id, { ticketId: t.id }, A.pmTicket(t.id));
    return t;
  });
}
