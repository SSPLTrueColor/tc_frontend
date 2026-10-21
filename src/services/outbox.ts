/**
 * Simulated outbound messaging (email, WhatsApp, SMS, push). Nothing is sent: messages are
 * recorded here so a demo can show exactly what the live system would deliver (COM-03, §6).
 *
 * ADM-06: every message is rendered from the active Notification Template for its {event, channel}
 * (Settings › Notification Templates), with {{placeholders}} filled from the related record. When no
 * template applies, the caller's text is kept.
 *
 * COM-03: staff alerts follow the recipient's Notification Preferences: a channel switched off for an
 * event is not used, quiet hours hold the message until they end, and the daily digest batches email
 * alerts into one message per day. In-app notifications are always delivered (see ledger.notify).
 */
import { formatDate } from '../lib/dates';
import { formatMoney } from '../lib/format';
import { istNow, nowIso } from '../lib/clock';
import { uid } from '../lib/ids';
import { recordPeekPath } from '../lib/routes';
import type { RecordData } from '../metadata/types';
import { type Actor, can } from './authz';
import { commit, defaultSettings, getDb } from './db';
import { getResource } from './registry';
import type { HookContext } from './resourceHooks';
import { type AppNotification, type Db, type NotifChannel, type NotifEvent, type NotificationPrefs, type OutboxMessage, ServiceError } from './types';
import { L } from '../constants/labels';

const O = L.admin.outbox;
const OUTBOX_LIMIT = 1000;

export type QueueInput = Omit<OutboxMessage, 'id' | 'workspaceId' | 'createdAt' | 'createdBy' | 'status'> & {
  /** notificationEvent master key; inferred from the related record when omitted. */
  event?: string;
  /** Placeholder values that override the ones read from the related record. */
  vars?: Record<string, string>;
  /**
   * The user wrote their own body (e.g. edited it in the Send dialog): the template still supplies the
   * subject, but the body is kept as written.
   */
  keepBody?: boolean;
  /** Appended to the final body after rendering (e.g. the "[Attachment: …pdf]" line). */
  bodySuffix?: string;
};

// ---------------------------------------------------------------- templates (ADM-06)

/** Outbox channel → Notification Channel master key. */
const TEMPLATE_CHANNEL: Record<OutboxMessage['channel'], string> = { email: 'email', whatsapp: 'whatsapp', sms: 'sms', push: 'in_app' };

/** Older callers name a template by a code; map it to the event it belongs to. */
const TEMPLATE_CODE_EVENT: Record<string, string> = { 'ticket.acknowledged': 'ticket_logged', 'ticket.resolved': 'feedback_request' };

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const find = (d: Db, resource: string, id: unknown) => (id ? (d.records[resource] ?? []).find((r) => r.id === id) : undefined);

function inferEvent(d: Db, m: QueueInput): string | undefined {
  if (m.event) return m.event;
  if (m.templateId && TEMPLATE_CODE_EVENT[m.templateId]) return TEMPLATE_CODE_EVENT[m.templateId];
  const res = m.related?.resource;
  if (res === 'amcContracts') return 'renewal_reminder';
  // Quotation sends name their event explicitly (sendQuote passes event: 'quotation_sent').
  if (res === 'installations') {
    const i = find(d, 'installations', m.related?.recordId);
    return i && m.subject === L.installed.service.scheduledSubject(s(i.id)) ? 'installation_scheduled' : undefined;
  }
  return undefined;
}

function appLink(ws: string, resource: string, id: string) {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}${recordPeekPath(ws, resource, id)}`;
}

/** Placeholder values read from the related record ({{customer}}, {{contact}}, {{record}}, {{owner}}, {{date}}, {{amount}}, {{link}}). */
export function templateVars(d: Db, ws: string, related?: { resource: string; recordId: string }): Record<string, string> {
  if (!related) return { date: formatDate(istNow().slice(0, 10)) };
  const r = find(d, related.resource, related.recordId);
  if (!r) return { record: related.recordId, date: formatDate(istNow().slice(0, 10)) };
  let title = related.recordId;
  try {
    const res = getResource(related.resource);
    title = s(r[res.titleField]) || related.recordId;
    if (related.resource === 'installations') title = s(find(d, 'salesOrders', r.salesOrderId)?.orderNo) || title;
  } catch {
    /* unknown resource: keep the id */
  }
  const customer = find(d, 'customers', r.customerId);
  const contact = find(d, 'contacts', r.contactId) ?? (d.records.contacts ?? []).find((c) => c.customerId === r.customerId);
  const ownerId = r.ownerId ?? r.engineerId ?? r.assigneeId ?? r.serviceOwnerId;
  const owner = find(d, 'employees', ownerId);
  const amount = r.grandTotal ?? r.value ?? r.amount;
  const date = r.scheduledAt ?? r.endDate ?? r.quoteDate ?? r.dueDate;
  return {
    record: title,
    customer: s(customer?.name),
    contact: s(contact?.name) || s(customer?.name),
    owner: s(owner?.fullName),
    amount: typeof amount === 'number' || (amount !== null && amount !== undefined && amount !== '' && !Number.isNaN(Number(amount))) ? formatMoney(Number(amount)) : '',
    date: formatDate(s(date).slice(0, 10) || istNow().slice(0, 10)),
    link: appLink(ws, related.resource, related.recordId),
  };
}

/** Fills {{placeholders}}; a placeholder without a value is dropped (and the spacing tidied). */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.:;])/g, '$1')
    .trim();
}

/** Active template for an event and outbox channel, newest first. */
export function templateFor(d: Db, ws: string, event: string, channel: OutboxMessage['channel']): RecordData | undefined {
  const ch = TEMPLATE_CHANNEL[channel];
  return (d.records.notificationTemplates ?? [])
    .filter((t) => t.workspaceId === ws && t.event === event && t.channel === ch && (t.status ?? 'active') === 'active' && !t.deletedAt)
    .sort((a, b) => s(b.updatedAt).localeCompare(s(a.updatedAt)))[0];
}

/** Renders subject and body from the matching template, or returns the caller's text unchanged. */
export function renderMessage(d: Db, ws: string, m: QueueInput): { subject?: string; body: string; templateId?: string; templateName?: string; event?: string } {
  const event = inferEvent(d, m);
  const tpl = event ? templateFor(d, ws, event, m.channel) : undefined;
  const withSuffix = (b: string) => (m.bodySuffix ? `${b} ${m.bodySuffix}` : b);
  if (!tpl) return { subject: m.subject, body: withSuffix(m.body), templateId: m.templateId, event };
  const own = Object.fromEntries(Object.entries(m.vars ?? {}).map(([k, v]) => [k, /^\d{4}-\d{2}-\d{2}/.test(v) ? formatDate(v.slice(0, 10)) : v]));
  const vars = { ...templateVars(d, ws, m.related), ...own };
  return {
    subject: m.channel === 'email' ? fillTemplate(s(tpl.subject) || s(m.subject), vars) || m.subject : m.subject,
    body: withSuffix(m.keepBody ? m.body : fillTemplate(s(tpl.body), vars) || m.body),
    // A caller's template code (e.g. ticket.resolved) is kept; the record id of the template used is in the name line.
    templateId: m.templateId ?? s(tpl.id),
    templateName: s(tpl.name),
    event,
  };
}

function push(d: Db, msg: OutboxMessage) {
  d.outbox.unshift(msg);
  if (d.outbox.length > OUTBOX_LIMIT) d.outbox.length = OUTBOX_LIMIT;
  return msg;
}

/** Customer-facing message (quotation, dispatch, ticket, renewal…), rendered from its template when one is active. */
export function queueMessage(ctx: HookContext, m: QueueInput): OutboxMessage {
  const { event: _e, vars: _v, keepBody: _k, bodySuffix: _s, ...rest } = m;
  const r = renderMessage(ctx.d, ctx.actor.workspaceId, m);
  const msg: OutboxMessage = {
    ...rest,
    subject: r.subject,
    body: r.body,
    templateId: r.templateId,
    templateName: r.templateName,
    event: r.event,
    audience: 'customer',
    id: uid('msg'),
    workspaceId: ctx.actor.workspaceId,
    createdAt: nowIso(),
    createdBy: ctx.actor.user.id,
    status: 'simulated',
  };
  if (!msg.subject) delete msg.subject;
  if (!msg.templateId) delete msg.templateId;
  if (!msg.templateName) delete msg.templateName;
  if (!msg.event) delete msg.event;
  return push(ctx.d, msg);
}

// ---------------------------------------------------------------- staff alerts and Notification Preferences (COM-03)

/** Which preference event an in-app notification belongs to (null = in-app only). */
export function preferenceEventOf(n: Pick<AppNotification, 'kind' | 'link'>): NotifEvent | null {
  const res = n.link && 'resource' in n.link ? n.link.resource : '';
  switch (n.kind) {
    case 'approval_request':
    case 'approval_decision':
      return 'approvals';
    case 'escalation':
      return 'slaBreach';
    case 'exception':
      return res === 'tickets' ? 'slaBreach' : null;
    case 'reminder':
      if (['amcContracts', 'warranties', 'machines'].includes(res)) return 'renewals';
      if (['salesOrders', 'paymentMilestones', 'invoices'].includes(res)) return 'payments';
      return 'followUps';
    default:
      return null;
  }
}

const hm = (iso: string) => iso.slice(11, 16);

/** Is a wall-clock "HH:mm" inside the quiet window (which may run past midnight)? */
export function inQuietHours(q: NotificationPrefs['quietHours'], at: string): boolean {
  if (!q.enabled || q.from === q.to) return false;
  const t = hm(at);
  return q.from < q.to ? t >= q.from && t < q.to : t >= q.from || t < q.to;
}

/** IST wall-clock time when the quiet window that contains `at` ends. */
function quietEnd(q: NotificationPrefs['quietHours'], at: string): string {
  const day = at.slice(0, 10);
  if (hm(at) < q.to) return `${day}T${q.to}:00`;
  const next = new Date(`${day}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const y = next.getFullYear();
  const mo = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}T${q.to}:00`;
}

function prefsOf(d: Db, userId: string): NotificationPrefs {
  return { ...defaultSettings().notifications, ...(d.settings[userId]?.notifications ?? {}) };
}

/**
 * ADM-06: Notification Template event used for a staff alert. The notification may name it itself
 * (`templateEvent`); otherwise it follows from the kind and the record it is about.
 */
function staffTemplateEvent(n: Omit<AppNotification, 'id' | 'createdAt'>, related?: { resource: string; recordId: string }): string | undefined {
  if (n.templateEvent) return n.templateEvent;
  switch (n.kind) {
    case 'approval_request':
      return 'approval_requested';
    case 'approval_decision':
      return 'approval_decided';
    case 'escalation':
      return related?.resource === 'leads' ? 'lead_not_attended' : related?.resource === 'tickets' ? 'sla_breach' : undefined;
    default:
      return undefined;
  }
}

const CHANNEL_OUT: Partial<Record<NotifChannel, OutboxMessage['channel']>> = { email: 'email', whatsapp: 'whatsapp', push: 'push' };

/**
 * Sends a staff alert on every channel the recipient enabled for its event. Called by `notify` after
 * the in-app notification is stored. Returns the outbox entries written (for tests and audit).
 */
export function routeStaffAlert(d: Db, n: Omit<AppNotification, 'id' | 'createdAt'>, staff: { userId: string; email?: string; mobile?: string }): OutboxMessage[] {
  const event = preferenceEventOf(n);
  if (!event) return [];
  const prefs = prefsOf(d, staff.userId);
  const channels = (prefs.events[event] ?? []).map((c) => CHANNEL_OUT[c]).filter((c): c is OutboxMessage['channel'] => !!c);
  const at = istNow();
  const quiet = inQuietHours(prefs.quietHours, at);
  const related = n.about ?? (n.link && 'resource' in n.link ? n.link : undefined);
  const tplEvent = staffTemplateEvent(n, related);
  const out: OutboxMessage[] = [];
  for (const channel of channels) {
    const to = channel === 'email' ? s(staff.email) : channel === 'push' ? staff.userId : s(staff.mobile);
    if (!to) continue;
    const digest = channel === 'email' && prefs.dailyDigest;
    // Rendered from the active template for the alert's event (e.g. "Approval requested"), else the default text.
    const r = renderMessage(d, n.workspaceId, {
      channel,
      to,
      subject: channel === 'email' ? O.staffSubject(n.title) : undefined,
      body: related ? O.staffBody(n.title, related.recordId) : n.title,
      related,
      event: tplEvent,
      vars: n.templateVars,
    });
    const msg: OutboxMessage = {
      id: uid('msg'),
      workspaceId: n.workspaceId,
      channel,
      to,
      subject: channel === 'email' ? r.subject : undefined,
      body: r.body,
      templateId: r.templateName ? r.templateId : undefined,
      templateName: r.templateName,
      related,
      createdAt: nowIso(),
      createdBy: 'system',
      status: digest ? 'digest' : quiet ? 'queued' : 'simulated',
      audience: 'staff',
      event,
      recipientUserId: staff.userId,
      deliverAt: digest ? undefined : quiet ? quietEnd(prefs.quietHours, at) : undefined,
    };
    if (!msg.subject) delete msg.subject;
    if (!msg.deliverAt) delete msg.deliverAt;
    if (!msg.templateId) delete msg.templateId;
    if (!msg.templateName) delete msg.templateName;
    if (!msg.related) delete msg.related;
    out.push(push(d, msg));
  }
  return out;
}

/**
 * Releases messages whose quiet hours are over and folds yesterday's (or older) digest items into one
 * digest email per person. Runs when the Sent Messages list is read and from the daily sweep.
 */
export function releaseDue(d: Db): number {
  const at = istNow();
  const today = nowIso().slice(0, 10); // createdAt is a UTC stamp
  let changed = 0;
  d.outbox.forEach((m) => {
    if (m.status === 'queued' && m.deliverAt && m.deliverAt <= at) {
      m.status = 'simulated';
      changed++;
    }
  });
  const pending = d.outbox.filter((m) => m.status === 'digest' && m.createdAt.slice(0, 10) < today);
  const byUser = new Map<string, OutboxMessage[]>();
  pending.forEach((m) => byUser.set(s(m.recipientUserId), [...(byUser.get(s(m.recipientUserId)) ?? []), m]));
  byUser.forEach((items, userId) => {
    const ids = new Set(items.map((m) => m.id));
    d.outbox = d.outbox.filter((m) => !ids.has(m.id));
    push(d, {
      id: uid('msg'),
      workspaceId: items[0].workspaceId,
      channel: 'email',
      to: items[0].to,
      subject: O.digestSubject(items.length),
      body: items.map((m) => `• ${m.body}`).join('\n'),
      createdAt: nowIso(),
      createdBy: 'system',
      status: 'simulated',
      audience: 'staff',
      event: 'digest',
      recipientUserId: userId,
    });
    changed++;
  });
  return changed;
}

export function listOutbox(actor: Actor): OutboxMessage[] {
  if (!can(actor, 'outbox.view')) throw new ServiceError('forbidden', L.common.errors.outboxOnly);
  const at = istNow();
  const today = nowIso().slice(0, 10);
  const due = getDb().outbox.some((m) => (m.status === 'queued' && !!m.deliverAt && m.deliverAt <= at) || (m.status === 'digest' && m.createdAt.slice(0, 10) < today));
  if (due) commit((d) => releaseDue(d));
  return getDb().outbox.filter((m) => m.workspaceId === actor.workspaceId);
}
