/**
 * Phase 2 regression tests (docs/BRD-AUDIT.md 2.1–2.10): configuration saved in Settings changes what
 * the rest of the app does. Masters publish, child masters, message templates, notification preferences,
 * export permission + audit, role matrix, new users signing in, numbering series and role capabilities.
 */
import '../domain/extensions/index';
import { beforeEach, describe, expect, it } from 'vitest';
import { actorFor, canReadRecord, liveStaffUsers } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { ensureDraft, getNumberSeries, nextNumber, parentMasterOf, publishDraft, saveNumberSeries, setDraftMaster, validateDraft } from '../services/config';
import { canExportRows, exportRowsCsv } from '../services/exporter';
import { notify } from '../services/ledger';
import { queueMessage, renderMessage } from '../services/outbox';
import { activeMasterValues, getMaster, getResource, signInUsers } from '../services/registry';
import { resetDemoData } from '../services/demo';
import { saveRoleCapabilities } from '../services/catalog/access';
import { createRecord, deleteRecord } from '../services/runtime';
import { startSignIn } from '../services/session';
import { updateSettings } from '../services/settings';
import { quoteApprovalChain } from '../services/quotations/workflow';
import { uid } from '../lib/ids';

const admin = () => actorFor('u_rahul', 'tc');
const exec = () => actorFor('u_karan', 'tc');

describe('configuration takes effect', () => {
  beforeEach(() => __setDb(createDb()));

  it('2.1: Division, State, GST Rate and Purchase Timeline masters can be edited and published (shipped keys are not re-validated)', () => {
    ensureDraft(admin());
    for (const key of ['division', 'state', 'gstRate', 'purchaseTimeline']) {
      const m = getMaster(key);
      setDraftMaster(admin(), { ...m, values: m.values.map((v, i) => (i === 0 ? { ...v, label: `${v.label} (edited)` } : v)) });
    }
    const draft = getDb().config.draft!;
    expect(validateDraft(draft).filter((i) => i.severity === 'error')).toEqual([]);
    publishDraft(admin());
    expect(getMaster('division').values[0].label).toMatch(/\(edited\)$/);
  });

  it('2.1: a newly added value must still use a snake_case key', () => {
    ensureDraft(admin());
    const m = getMaster('leadSource');
    setDraftMaster(admin(), { ...m, values: [...m.values, { key: 'Bad Key', label: 'Bad', active: true, order: 99 }] });
    expect(validateDraft(getDb().config.draft!).some((i) => i.severity === 'error' && i.message.includes('Bad Key'))).toBe(true);
  });

  it('2.2: a new child value needs a parent and then shows in the dependent dropdown', () => {
    expect(parentMasterOf('complaintSubCategory')).toBe('complaintCategory');
    expect(parentMasterOf('territory')).toBe('state');
    ensureDraft(admin());
    const sub = getMaster('complaintSubCategory');
    const parent = getMaster('complaintCategory').values[0].key;
    setDraftMaster(admin(), { ...sub, values: [...sub.values, { key: 'belt_noise', label: 'Belt noise', active: true, order: 99 }] });
    expect(validateDraft(getDb().config.draft!).some((i) => i.severity === 'error' && i.message.includes('Belt noise'))).toBe(true);
    setDraftMaster(admin(), { ...sub, values: [...sub.values, { key: 'belt_noise', label: 'Belt noise', active: true, order: 99, parent }] });
    publishDraft(admin());
    expect(activeMasterValues('complaintSubCategory', parent).map((v) => v.key)).toContain('belt_noise');
  });

  it('2.4: outbox messages are rendered from the active Notification Template, else the original text is kept', () => {
    const tpl = getDb().records.notificationTemplates.find((t) => t.event === 'renewal_reminder' && t.channel === 'email')!;
    tpl.body = 'Hello {{contact}}, contract {{record}} ends on {{date}}.';
    const c = getDb().records.amcContracts[0];
    const ctx = { d: getDb(), actor: admin(), correlationId: uid('cor') };
    const msg = queueMessage(ctx, { channel: 'email', to: 'x@example.com', subject: 'S', body: 'fallback text', related: { resource: 'amcContracts', recordId: c.id } });
    expect(msg.body).toContain(String(c.contractNo));
    expect(msg.body).not.toContain('{{');
    expect(msg.templateName).toBe(tpl.name);
    // No template for SMS renewals → the caller's text stays.
    const plain = renderMessage(getDb(), 'tc', { channel: 'sms', to: '9800000000', body: 'fallback text', related: { resource: 'amcContracts', recordId: c.id } });
    expect(plain.body).toBe('fallback text');
    // A deactivated template is not used.
    tpl.status = 'inactive';
    expect(renderMessage(getDb(), 'tc', { channel: 'email', to: 'x', body: 'fallback text', related: { resource: 'amcContracts', recordId: c.id } }).body).toBe('fallback text');
  });

  it('2.5: Notification Preferences decide the channels, quiet hours hold and the digest batches', () => {
    const user = 'u_rohan';
    const before = getDb().outbox.length;
    updateSettings(user, { notifications: { events: { approvals: ['inApp'], followUps: ['inApp'], slaBreach: ['inApp'], renewals: ['inApp'], payments: ['inApp'] }, quietHours: { enabled: false, from: '21:00', to: '08:00' }, dailyDigest: false } });
    notify(getDb(), { userId: user, workspaceId: 'tc', kind: 'approval_request', title: 'Approve Q-1', link: { resource: 'quotations', recordId: 'Q-1' } });
    expect(getDb().outbox.length).toBe(before); // every external channel off
    updateSettings(user, { notifications: { events: { approvals: ['inApp', 'email', 'whatsapp'], followUps: ['inApp'], slaBreach: ['inApp'], renewals: ['inApp'], payments: ['inApp'] }, quietHours: { enabled: true, from: '00:00', to: '23:59' }, dailyDigest: false } });
    notify(getDb(), { userId: user, workspaceId: 'tc', kind: 'approval_request', title: 'Approve Q-2', link: { resource: 'quotations', recordId: 'Q-2' } });
    const sent = getDb().outbox.filter((m) => m.recipientUserId === user);
    expect(sent.map((m) => m.channel).sort()).toEqual(['email', 'whatsapp']);
    expect(sent.every((m) => m.status === 'queued' && !!m.deliverAt)).toBe(true);
    updateSettings(user, { notifications: { events: { approvals: ['inApp', 'email'], followUps: ['inApp'], slaBreach: ['inApp'], renewals: ['inApp'], payments: ['inApp'] }, quietHours: { enabled: false, from: '21:00', to: '08:00' }, dailyDigest: true } });
    notify(getDb(), { userId: user, workspaceId: 'tc', kind: 'approval_request', title: 'Approve Q-3', link: { resource: 'quotations', recordId: 'Q-3' } });
    expect(getDb().outbox[0].status).toBe('digest');
  });

  it('2.6: quotation discount approvers follow the live reporting line', () => {
    const q = getDb().records.quotations.find((x) => x.ownerId === exec().staffId)!;
    const before = quoteApprovalChain(exec(), q, 12);
    expect(before[0]?.approverStaffId).toBe(actorFor('u_rohan', 'tc').staffId);
    // Karan now reports to Priya (Sales Manager): level 1 follows the user record, not the shipped pack.
    const karan = getDb().records.employees.find((e) => e.id === exec().staffId)!;
    karan.managerId = actorFor('u_priya', 'tc').staffId;
    const after = quoteApprovalChain(actorFor('u_karan', 'tc'), q, 12);
    expect(after[0]?.approverStaffId).toBe(actorFor('u_priya', 'tc').staffId);
    expect(liveStaffUsers('tc').some((u) => u.id === 'u_priya')).toBe(true);
  });

  it('2.8: numbering series settings drive the document numbers', () => {
    const d = getDb();
    expect(nextNumber(d, 'quotation', 'TX')).toMatch(/^QT\/TX\/\d{2}-\d{2}\/\d{4}$/);
    saveNumberSeries(admin(), 'quotation', { ...getNumberSeries('quotation'), prefix: 'QUO', separator: '-', padding: 6 }, 900);
    expect(nextNumber(getDb(), 'quotation', 'TX')).toMatch(/^QUO-TX-\d{2}-\d{2}-000900$/);
    expect(() => saveNumberSeries(admin(), 'quotation', getNumberSeries('quotation'), 5)).toThrow(/above/);
    expect(() => saveNumberSeries(exec(), 'lead', getNumberSeries('lead'), null)).toThrow();
    // Record ids that are document numbers (tickets, leads, opportunities) use the series too.
    saveNumberSeries(admin(), 'ticket', { ...getNumberSeries('ticket'), prefix: 'SRV' }, null);
    const m = getDb().records.machines.find((x) => x.divisionId === 'TX' && x.status !== 'scrapped')!;
    const t = createRecord(actorFor('u_meera', 'tc'), 'tickets', { customerId: m.customerId, machineId: m.id, channel: 'phone', description: 'Head clog', category: 'mechanical', ticketType: 'breakdown', priority: 'medium' }).record;
    expect(String(t.id)).toMatch(/^SRV-\d{4}-\d{5}$/);
  });

  it('2.9: Export selected needs the export permission and is audited', () => {
    expect(canExportRows(exec())).toBe(false);
    expect(() => exportRowsCsv(exec(), { label: 'Follow-ups', header: ['A'], cells: [['1']] })).toThrow();
    const n = getDb().audit.length;
    const csv = exportRowsCsv(admin(), { label: 'Follow-ups', header: ['Lead'], cells: [['=cmd'], ['LD-1']] });
    expect(csv.split('\n')[1]).toBe("'=cmd"); // formula-injection guard
    expect(getDb().audit.length).toBe(n + 1);
    expect(getDb().audit[0].action).toBe('export');
    expect(canExportRows(actorFor('u_rohan', 'tc'), 'quotations')).toBe(true);
  });

  it('2.9: role matrix follows Appendix B', () => {
    const ravi = actorFor('u_ravi', 'tc');
    const customers = getResource('customers');
    const own = new Set(getDb().records.tickets.filter((t) => t.assigneeId === ravi.staffId).map((t) => String(t.customerId)));
    const visible = getDb().records.customers.filter((c) => canReadRecord(ravi, customers, c));
    expect(visible.length).toBeLessThan(getDb().records.customers.length);
    own.forEach((id) => expect(visible.some((c) => c.id === id)).toBe(true));
    const accounts = actorFor('u_swati', 'tc');
    const tickets = getResource('tickets');
    expect(getDb().records.tickets.filter((t) => canReadRecord(accounts, tickets, t)).every((t) => (t.chargeableStatus && t.chargeableStatus !== 'none') || t.ticketType === 'chargeable_visit' || Number(t.chargeableAmount) > 0)).toBe(true);
    const tanvi = actorFor('u_tanvi', 'tc');
    const samples = new Set(getDb().records.sampleRequests.map((s) => String(s.opportunityId)));
    expect(getDb().records.opportunities.filter((o) => canReadRecord(tanvi, getResource('opportunities'), o)).every((o) => samples.has(String(o.id)))).toBe(true);
    expect(actorFor('u_rajesh', 'tc').role.resources.amcContracts.read).not.toBe('none');
    expect(actorFor('u_manoj', 'tc').role.resources.quotations.create).toBe(true);
  });

  it('2.9: delete needs the update scope as well as the delete flag', () => {
    const rohan = actorFor('u_rohan', 'tc');
    const res = Object.entries(rohan.role.resources).find(([, p]) => p.delete && p.update !== p.read);
    if (!res) return; // no role/resource with a wider read than update scope to probe
    const [key, p] = res;
    const outside = (getDb().records[key] ?? []).find((r) => canReadRecord(rohan, getResource(key), r) && !(p.update === 'own' ? r[getResource(key).ownerField ?? ''] === rohan.staffId : rohan.teamStaffIds.includes(String(r[getResource(key).ownerField ?? '']))));
    if (outside) expect(() => deleteRecord(rohan, key, String(outside.id))).toThrow();
  });

  it('2.10: a user added in Administration › Users can sign in and is listed in the switcher', () => {
    const e = createRecord(admin(), 'employees', { fullName: 'Isha Patel', designation: 'Sales Executive – Textile', roleId: 'sales_exec', divisionIds: ['TX'], managerId: actorFor('u_rohan', 'tc').staffId, email: 'isha.patel@truecolors.example', mobile: '9812345670', status: 'active' }).record;
    const u = signInUsers('tc').find((x) => x.staffIds.tc === e.id)!;
    expect(u).toBeTruthy();
    startSignIn(u.id);
    expect(getDb().session.userId).toBe(u.id);
    expect(actorFor(u.id, 'tc').role.id).toBe('sales_exec');
  });

  it('2.10: Reset demo data is for the System Administrator only', () => {
    expect(() => resetDemoData(exec())).toThrow();
    expect(() => resetDemoData(admin())).not.toThrow();
  });

  it('2.10: role capabilities (approve levels, export) are editable per role and take effect', () => {
    expect(actorFor('u_manoj', 'tc').role.capabilities).not.toContain('data.export');
    saveRoleCapabilities(admin(), 'service_head', [...actorFor('u_manoj', 'tc').role.capabilities, 'data.export']);
    expect(actorFor('u_manoj', 'tc').role.capabilities).toContain('data.export');
    expect(canExportRows(actorFor('u_manoj', 'tc'))).toBe(true);
    saveRoleCapabilities(admin(), 'sales_manager', []);
    expect(actorFor('u_rohan', 'tc').role.capabilities).not.toContain('approve.l1');
    expect(getDb().audit[0].action).toBe('access.role_changed');
  });
});
