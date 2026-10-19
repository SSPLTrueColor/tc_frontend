/**
 * Customer 360° read model (CUS-07): everything linked to one customer, gathered from each
 * module's resources through the scoped runtime. Resources that are not built yet, or that the
 * actor cannot read, are skipped — they never fail the view.
 */
import type { RecordData } from '../../metadata/types';
import type { Tone } from '../../metadata/types';
import { type Actor, perm } from '../authz';
import { getResource, masterValue } from '../registry';
import { getRecord, queryRecords, recordTitle } from '../runtime';
import { isRegistered } from './operations';

export interface LinkedRow {
  resKey: string;
  resLabel: string;
  id: string;
  title: string;
  status?: { label: string; tone?: Tone };
  amount?: number;
  date?: string;
}

const AMOUNT = ['grandTotal', 'value', 'amount'];
const DATE = ['expectedCloseDate', 'quoteDate', 'orderDate', 'installDate', 'reportedAt', 'endDate', 'scheduledAt', 'nextFollowUpAt', 'createdAt'];

function describe(actor: Actor, resKey: string, r: RecordData): LinkedRow {
  const res = getResource(resKey);
  const statusField = res.lifecycle ? res.fields.find((f) => f.key === res.lifecycle!.field) : res.fields.find((f) => (f.key === 'status' || f.key === 'stage') && f.type === 'master');
  const mv = statusField?.master ? masterValue(statusField.master, r[statusField.key]) : undefined;
  const amountKey = AMOUNT.find((k) => typeof r[k] === 'number');
  const dateKey = DATE.find((k) => r[k]);
  return {
    resKey,
    resLabel: res.label,
    id: r.id,
    title: recordTitle(resKey, r.id, actor),
    status: mv ? { label: mv.label, tone: mv.tone } : undefined,
    amount: amountKey ? Number(r[amountKey]) : undefined,
    date: dateKey ? String(r[dateKey]) : undefined,
  };
}

/** Rows of `resKey` where `field` = value, or [] when the resource is missing / not readable. */
export function linked(actor: Actor, resKey: string, field: string, value: string): RecordData[] {
  if (!isRegistered(resKey) || perm(actor, resKey).read === 'none') return [];
  return queryRecords(actor, resKey, { where: { [field]: value } }).rows;
}

export const linkedRows = (actor: Actor, resKey: string, field: string, value: string) => linked(actor, resKey, field, value).map((r) => describe(actor, resKey, r));

export function customer360(actor: Actor, customerId: string) {
  const customer = getRecord(actor, 'customers', customerId).record;
  const machines = linked(actor, 'machines', 'customerId', customerId);
  return {
    customer,
    contacts: linked(actor, 'contacts', 'customerId', customerId),
    addresses: linked(actor, 'addresses', 'customerId', customerId),
    sales: ['leads', 'opportunities', 'quotations', 'salesOrders'].map((k) => ({ resKey: k, available: isRegistered(k) && perm(actor, k).read !== 'none', rows: linkedRows(actor, k, 'customerId', customerId) })),
    machines: machines.map((m) => describe(actor, 'machines', m)),
    contracts: [...linkedRows(actor, 'amcContracts', 'customerId', customerId), ...machines.flatMap((m) => linkedRows(actor, 'warranties', 'machineId', m.id))],
    training: linkedRows(actor, 'trainingRecords', 'customerId', customerId),
    tickets: linked(actor, 'tickets', 'customerId', customerId).map((t) => ({ ...describe(actor, 'tickets', t), rating: t.rating as number | undefined })),
    available: Object.fromEntries(['machines', 'amcContracts', 'tickets', 'leads', 'opportunities', 'quotations', 'salesOrders'].map((k) => [k, isRegistered(k)])) as Record<string, boolean>,
  };
}

export type Customer360 = ReturnType<typeof customer360>;
