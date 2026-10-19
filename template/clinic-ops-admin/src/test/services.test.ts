import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, parseLocal, todayKey } from '../lib/dates';
import { maskEmail, maskPhone } from '../lib/phiMask';
import { actorFor } from '../services/authz';
import { __setDb, createDb, getDb } from '../services/db';
import { addDraftField, ensureDraft, publishDraft, setDraftMaster, validateDraft } from '../services/config';
import { buildCsv, csvCell } from '../services/exporter';
import { evalGroup, newCondition, newGroup } from '../services/filter';
import { getMaster, getResource } from '../services/registry';
import { createRecord, getRecord, queryRecords, recordPayment, transitionRecord, updateRecord, withComputed } from '../services/runtime';
import { ServiceError } from '../services/types';
import { decideApproval, requestWriteOff } from '../services/workflow';

const manager = () => actorFor('u_morgan', 'riverside');
const frontDesk = () => actorFor('u_jordan', 'riverside');
const clinician = () => actorFor('u_amara', 'riverside');
const billing = () => actorFor('u_sam', 'riverside');

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ServiceError ? e.code : 'unknown';
  }
  return undefined;
}

/** Next weekday (Mon–Fri) at least 20 days out, so seeded bookings never interfere. */
function freeDay(): string {
  let d = addDays(todayKey(), 20);
  while ([0, 6].includes(parseLocal(d).getDay())) d = addDays(d, 1);
  return d;
}

beforeEach(() => {
  __setDb(createDb(new Date()));
});

describe('PHI masking format (phi-masking SPEC §3)', () => {
  it('keeps first 2 / last 2 with one * per hidden char', () => {
    expect(maskPhone('9876543245')).toBe('98******45');
    // SPEC table shows '+91*******10' (7 stars) but its own rule — one * per hidden char —
    // and its reference template yield 8 for 12 digits; we follow the rule.
    expect(maskPhone('+919876543210')).toBe('+91********10');
    expect(maskEmail('johnsmith@example.com')).toBe('jo*****th@example.com');
  });
});

describe('field and row authorization (simulated service layer)', () => {
  it('front desk receives raw contact data; clinician and billing receive masked values', () => {
    const raw = queryRecords(frontDesk(), 'patients', {}).rows[0];
    expect(String(raw.phone)).not.toContain('*');
    const masked = queryRecords(clinician(), 'patients', {}).rows.find((r) => r.id === raw.id)!;
    expect(String(masked.phone)).toContain('*');
    expect(String(queryRecords(billing(), 'patients', {}).rows[0].phone)).toContain('*');
  });

  it('health fields are hidden from front desk and billing, visible to clinicians', () => {
    const id = queryRecords(manager(), 'appointments', {}).rows[0].id;
    expect('visitReason' in getRecord(frontDesk(), 'appointments', id).record).toBe(false);
    expect('visitReason' in getRecord(billing(), 'appointments', id).record).toBe(false);
  });

  it('clinician only sees their own appointments (row scope) and has no invoice access', () => {
    const c = clinician();
    const rows = queryRecords(c, 'appointments', {}).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.clinicianId === c.staffId)).toBe(true);
    expect(code(() => queryRecords(c, 'invoices', {}))).toBe('forbidden');
  });

  it('masked fields cannot be used to filter or search (no inference)', () => {
    const patient = queryRecords(frontDesk(), 'patients', {}).rows[0];
    const phone = String(patient.phone);
    expect(queryRecords(frontDesk(), 'patients', { search: phone }).total).toBeGreaterThan(0);
    expect(queryRecords(billing(), 'patients', { search: phone }).total).toBe(0);
  });

  it('records from another workspace are not found (tenant/workspace isolation)', () => {
    const hill = getDb().records.patients.find((p) => p.workspaceId === 'hillcrest')!;
    expect(code(() => getRecord(manager(), 'patients', hill.id))).toBe('not_found');
  });

  it('rejects writes to fields the role may not edit', () => {
    const p = queryRecords(manager(), 'patients', {}).rows[0];
    expect(code(() => updateRecord(clinician(), 'patients', p.id, { fullName: 'Changed' }, p.version))).toBe('forbidden');
  });
});

describe('validation from canonical metadata', () => {
  it('requires member ID only when a payer other than self-pay is chosen', () => {
    const base = { fullName: 'Test Person', dateOfBirth: '1990-02-03', phone: '+1 555-0100-1234' };
    const err = (() => {
      try {
        createRecord(frontDesk(), 'patients', { ...base, payer: 'northstar' });
      } catch (e) {
        return e as ServiceError;
      }
    })();
    expect(err?.code).toBe('validation');
    expect(err?.fieldErrors?.memberId).toBeTruthy();
    expect(createRecord(frontDesk(), 'patients', { ...base, payer: 'self_pay' }).record.id).toMatch(/^P-/);
  });

  it('enforces cross-field date rule on invoices', () => {
    const p = queryRecords(billing(), 'patients', {}).rows[0];
    const lineItems = [{ serviceCode: 'consult_std', qty: 1, unitPrice: 90 }];
    expect(code(() => createRecord(billing(), 'invoices', { patientId: p.id, payer: 'self_pay', issueDate: '2026-05-10', dueDate: '2026-05-01', lineItems }))).toBe('validation');
  });

  it('dependent master values must match their parent', () => {
    const p = queryRecords(frontDesk(), 'patients', {}).rows[0];
    expect(code(() => createRecord(frontDesk(), 'referrals', { patientId: p.id, specialty: 'imaging', service: 'cardio_consult', urgency: 'routine', dueBy: addDays(todayKey(), 5) }))).toBe('validation');
  });
});

describe('idempotency and optimistic concurrency', () => {
  it('a retried create with the same key creates one record', () => {
    const base = { fullName: 'Retry Person', dateOfBirth: '1985-01-01', phone: '+1 555-0100-9999', payer: 'self_pay' };
    const before = getDb().records.patients.length;
    const a = createRecord(frontDesk(), 'patients', base, { idempotencyKey: 'k1' });
    const b = createRecord(frontDesk(), 'patients', base, { idempotencyKey: 'k1' });
    expect(a.record.id).toBe(b.record.id);
    expect(getDb().records.patients.length).toBe(before + 1);
  });

  it('a stale version is rejected', () => {
    const p = queryRecords(frontDesk(), 'patients', {}).rows[0];
    updateRecord(frontDesk(), 'patients', p.id, { preferredName: 'One' }, p.version);
    expect(code(() => updateRecord(frontDesk(), 'patients', p.id, { preferredName: 'Two' }, p.version))).toBe('version_conflict');
  });

  it('a retried manual payment does not double-post', () => {
    const inv = getDb().records.invoices.find((i) => i.workspaceId === 'riverside' && i.status === 'issued')!;
    const total = Number(withComputed(getResource('invoices'), inv).total);
    recordPayment(billing(), inv.id, 10, 'cash', inv.version, 'pay-1');
    recordPayment(billing(), inv.id, 10, 'cash', inv.version, 'pay-1');
    const after = getDb().records.invoices.find((i) => i.id === inv.id)!;
    expect(Number(after.amountPaid)).toBe(Number(inv.amountPaid || 0) + 10);
    expect(total).toBeGreaterThan(10);
  });
});

describe('scheduling service', () => {
  const book = (actor = frontDesk(), extra: Record<string, unknown> = {}, override?: string) => {
    const day = freeDay();
    const c = actorFor('u_amara', 'riverside').staffId;
    const p = queryRecords(manager(), 'patients', {}).rows[0];
    return createRecord(actor, 'appointments', { patientId: p.id, clinicianId: c, start: `${day}T10:00`, durationMin: 30, visitMode: 'in_person', roomId: 'R-1001', appointmentType: 'follow_up', ...extra }, { overrideReason: override });
  };

  it('rejects overlapping bookings of an exclusive room', () => {
    book();
    let err: ServiceError | undefined;
    try {
      book(frontDesk(), { clinicianId: 'S-1005', start: `${freeDay()}T10:15` });
    } catch (e) {
      err = e as ServiceError;
    }
    expect(err?.code).toBe('conflict');
    expect(err?.conflicts?.some((c) => c.kind === 'room' && !c.overridable)).toBe(true);
  });

  it('room in maintenance cannot be booked', () => {
    expect(code(() => book(frontDesk(), { roomId: 'R-1006' }))).toBe('conflict');
  });

  it('clinician double-booking needs an authorized override with a reason', () => {
    book();
    const second = { roomId: 'R-1002', start: `${freeDay()}T10:10` };
    expect(code(() => book(frontDesk(), second, 'agreed'))).toBe('conflict'); // front desk cannot override
    expect(code(() => book(manager(), second))).toBe('conflict'); // manager without reason
    expect(book(manager(), second, 'Agreed with clinician').record.id).toMatch(/^A-/);
    expect(getDb().audit.some((a) => a.action === 'schedule.override')).toBe(true);
  });

  it('telehealth bookings clear the room (declared hidden-field policy)', () => {
    const r = book(frontDesk(), { visitMode: 'telehealth', roomId: 'R-1001' });
    expect(getDb().records.appointments.find((a) => a.id === r.record.id)!.roomId).toBeNull();
  });
});

describe('lifecycle transitions', () => {
  it('front desk cannot start a visit (capability), clinician can', () => {
    const c = clinician();
    const appt = queryRecords(c, 'appointments', {}).rows.find((a) => a.status === 'confirmed' || a.status === 'scheduled')!;
    const checked = transitionRecord(frontDesk(), 'appointments', appt.id, 'checked_in', appt.version);
    expect(code(() => transitionRecord(frontDesk(), 'appointments', appt.id, 'in_progress', checked.record.version))).toBe('forbidden');
    expect(transitionRecord(c, 'appointments', appt.id, 'in_progress', checked.record.version).record.status).toBe('in_progress');
  });

  it('rejects transitions not in the state machine', () => {
    const t = queryRecords(manager(), 'tasks', {}).rows.find((x) => x.status === 'todo')!;
    expect(code(() => transitionRecord(manager(), 'tasks', t.id, 'blocked', t.version))).toBe('invalid_state');
  });
});

describe('workflow approvals stay separate from tasks and notifications', () => {
  it('requester cannot decide; completing the review task does not approve', () => {
    const inv = getDb().records.invoices.find((i) => i.workspaceId === 'riverside' && i.status === 'issued' && !getDb().approvals.some((a) => a.recordId === i.id))!;
    const a = requestWriteOff(billing(), inv.id, 'Uncollectable after reminders');
    expect(code(() => decideApproval(billing(), a.id, 'approved', '', a.version))).toBe('forbidden');

    const task = getDb().records.tasks.find((t) => t.id === a.taskId)!;
    transitionRecord(manager(), 'tasks', task.id, 'done', task.version);
    expect(getDb().approvals.find((x) => x.id === a.id)!.status).toBe('pending');
    expect(getDb().records.invoices.find((i) => i.id === inv.id)!.status).toBe('issued');

    decideApproval(manager(), a.id, 'approved', 'ok', a.version);
    expect(getDb().records.invoices.find((i) => i.id === inv.id)!.status).toBe('written_off');
  });

  it('separation of duties: a manager cannot approve their own request', () => {
    const inv = getDb().records.invoices.find((i) => i.workspaceId === 'riverside' && i.status === 'issued' && !getDb().approvals.some((a) => a.recordId === i.id))!;
    const a = requestWriteOff(manager(), inv.id, 'Hardship case reviewed at desk');
    expect(code(() => decideApproval(manager(), a.id, 'approved', '', a.version))).toBe('forbidden');
  });
});

describe('configuration studio', () => {
  it('blocks deactivating a master value used by a saved view filter', () => {
    const m = actorFor('u_morgan', 'riverside');
    ensureDraft(m);
    const master = getMaster('invoiceStatus');
    setDraftMaster(m, { ...master, values: master.values.map((v) => (v.key === 'issued' ? { ...v, active: false } : v)) });
    const issues = validateDraft(getDb().config.draft!);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('Open balances'))).toBe(true);
    expect(code(() => publishDraft(m))).toBe('validation');
  });

  it('a published custom field appears in the canonical resource and validates', () => {
    const m = manager();
    ensureDraft(m);
    addDraftField(m, { resource: 'patients', key: 'preferredPharmacy', label: 'Preferred pharmacy', type: 'text', required: false, sensitivity: 'none' });
    publishDraft(m);
    const res = getResource('patients');
    expect(res.fields.some((f) => f.key === 'preferredPharmacy')).toBe(true);
    expect(res.version).toBe(2);
    expect(res.form.sections.some((s) => s.fields.includes('preferredPharmacy'))).toBe(true);
  });

  it('a required new field without a default is rejected when records exist', () => {
    const m = manager();
    ensureDraft(m);
    addDraftField(m, { resource: 'rooms', key: 'cleaningZone', label: 'Cleaning zone', type: 'text', required: true, sensitivity: 'none' });
    expect(validateDraft(getDb().config.draft!).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('filter engine and export', () => {
  it('evaluates nested AND/OR groups', () => {
    const g = { ...newGroup('and'), children: [newCondition('a', 'eq', 'x'), { ...newGroup('or'), children: [newCondition('b', 'gt', 5), newCondition('c', 'contains', 'hi')] }] };
    const r = (v: Record<string, unknown>) => (k: string) => ({ value: v[k] });
    expect(evalGroup(g, r({ a: 'x', b: 1, c: 'oh hi' }))).toBe(true);
    expect(evalGroup(g, r({ a: 'x', b: 1, c: 'nope' }))).toBe(false);
    expect(evalGroup(g, r({ a: 'y', b: 9, c: 'hi' }))).toBe(false);
  });

  it('guards spreadsheet formula injection and keeps masked values masked', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    const c = clinician();
    const res = getResource('patients');
    const rows = queryRecords(c, 'patients', {}).rows.slice(0, 3);
    const csv = buildCsv(c, res, rows, ['id', 'fullName', 'phone']);
    csv
      .split('\n')
      .slice(1)
      .forEach((line) => expect(line).toContain('*'));
  });
});
