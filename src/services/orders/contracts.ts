/** Sales contracts (FR-053 / FR-054): division templates, versions, simulated e-signature. */
import { nowIso } from '../../lib/clock';
import { fyLabel } from '../../lib/fy';
import { uid } from '../../lib/ids';
import { formatMoney } from '../../lib/format';
import type { RecordData } from '../../metadata/types';
import { type Actor, can, canReadRecord, canUpdateRecord } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, notify } from '../ledger';
import { byId, userOfStaff } from '../lookups';
import { queueMessage } from '../outbox';
import { getResource } from '../registry';
import { insertRecordIn, patchRecordIn } from '../runtime';
import { type Db, ServiceError } from '../types';
import { contractsOf, SO } from './orders';

interface Template {
  deliveryTerms: string;
  loadingTerms: string;
  installationTerms: string;
  warrantyTerms: string;
  sparesTerms: string;
  inkCommitment: string;
  amcTerms: string;
}

const MACHINE_BASE: Template = {
  deliveryTerms: 'Delivery within 8–10 weeks of advance receipt, ex-works Mumbai unless agreed otherwise. Risk passes on delivery at site.',
  loadingTerms: 'Unloading, crane / hydra and positioning at site are in the customer’s scope and cost.',
  installationTerms: 'Installation and commissioning by True Colors engineers within 7 working days of site readiness confirmation (power, earthing, UPS, climate, space, compressed air, network).',
  warrantyTerms: '12 months from installation sign-off covering parts and labour, excluding print heads damaged by misuse, consumables and electrical surges.',
  sparesTerms: 'Spare parts supplied at the prevailing price list for 7 years from installation.',
  inkCommitment: 'Customer agrees to use genuine True Colors inks during warranty; ink prices as per the current rate contract.',
  amcTerms: 'Annual Maintenance Contract offered after warranty at 8% of machine value per year (labour and preventive visits).',
};

/** One template per division (§13 #11 assumption: one template per division). */
export const DIVISION_TEMPLATES: Record<string, Template> = {
  TX: MACHINE_BASE,
  POD: { ...MACHINE_BASE, inkCommitment: 'Genuine True Colors toner / ink for POD presses at contract prices for the warranty period.' },
  LBL: { ...MACHINE_BASE, inkCommitment: 'Genuine label inks and varnishes at contract prices for the warranty period.' },
  INK: { ...MACHINE_BASE, deliveryTerms: 'Delivery within 3–5 working days of order confirmation.', installationTerms: 'Not applicable.', warrantyTerms: 'Ink shelf life as printed on the container; replacement for manufacturing defects.', sparesTerms: 'Not applicable.', inkCommitment: 'Quantities and prices as per order.', amcTerms: 'Not applicable.' },
  PPR: { ...MACHINE_BASE, deliveryTerms: 'Delivery within 3–5 working days of order confirmation.', installationTerms: 'Not applicable.', warrantyTerms: 'Replacement of rolls with manufacturing defects reported within 15 days.', sparesTerms: 'Not applicable.', inkCommitment: 'Not applicable.', amcTerms: 'Not applicable.' },
  FAB: { ...MACHINE_BASE, deliveryTerms: 'Delivery as per the agreed production schedule.', installationTerms: 'Not applicable.', warrantyTerms: 'Fabric quality as per approved sample; claims within 7 days of delivery.', sparesTerms: 'Not applicable.', inkCommitment: 'Not applicable.', amcTerms: 'Not applicable.' },
};

const pendingOtp = new Map<string, string>();
const rows = (d: Db, key: string) => (d.records[key] ?? []) as RecordData[];

function contractNoFor(d: Db, order: RecordData, version: number) {
  const first = contractsOf(d, order.id).find((c) => Number(c.version) === 1);
  if (first) return `${String(first.contractNo).replace(/-v\d+$/, '')}-v${version}`;
  const k = `scNo:${order.divisionId}:${fyLabel()}`;
  d.counters[k] = (d.counters[k] ?? 0) + 1;
  return `SC/${order.divisionId}/${fyLabel()}/${String(d.counters[k]).padStart(4, '0')}`;
}

/** Generates a new contract version from the approved order; earlier versions become superseded. */
export function generateContract(actor: Actor, orderId: string): RecordData {
  if (!can(actor, 'orders.contract')) throw new ServiceError('forbidden', 'Your role cannot generate sales contracts.');
  return commit((d) => {
    const order = rows(d, SO).find((o) => o.id === orderId);
    if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', `Sales order ${orderId} was not found.`);
    if (!canUpdateRecord(actor, getResource(SO), order)) throw new ServiceError('forbidden', 'You cannot change this order.');
    if (['pending_approval', 'cancelled'].includes(String(order.status))) throw new ServiceError('invalid_state', 'A contract can be generated only after the order is approved (FR-053).');
    const ctx = { d, actor, correlationId: uid('cor') };
    const existing = contractsOf(d, orderId);
    if (existing.some((c) => c.status === 'signed')) throw new ServiceError('invalid_state', 'The current contract is already signed. Contact an administrator to amend a signed contract.');
    const version = (Number(existing[0]?.version) || 0) + 1;
    existing.filter((c) => c.status !== 'superseded').forEach((c) => patchRecordIn(ctx, 'salesContracts', c.id, { status: 'superseded' }, `Superseded by version ${version}`));
    const t = DIVISION_TEMPLATES[String(order.divisionId)] ?? MACHINE_BASE;
    const c = insertRecordIn(ctx, 'salesContracts', {
      contractNo: contractNoFor(d, order, version),
      salesOrderId: order.id,
      customerId: order.customerId,
      ownerId: order.ownerId,
      divisionId: order.divisionId,
      version,
      status: 'draft',
      contractValue: order.grandTotal,
      paymentTerms: (order.paymentTerms as string) || 'As per the payment schedule of the sales order.',
      deliveryTerms: (order.deliveryTerms as string) || t.deliveryTerms,
      loadingTerms: t.loadingTerms,
      installationTerms: (order.installationTerms as string) || t.installationTerms,
      warrantyTerms: (order.warrantyTerms as string) || t.warrantyTerms,
      sparesTerms: t.sparesTerms,
      inkCommitment: t.inkCommitment,
      amcTerms: t.amcTerms,
    });
    appendAudit(d, actor, { action: 'salesContract.generated', resource: SO, recordId: order.id, summary: `Generated ${c.contractNo} (v${version}) for ${formatMoney(Number(order.grandTotal))}`, correlationId: ctx.correlationId });
    return c;
  });
}

function requireContract(d: Db, actor: Actor, id: string) {
  const c = rows(d, 'salesContracts').find((x) => x.id === id);
  if (!c || !canReadRecord(actor, getResource('salesContracts'), c)) throw new ServiceError('not_found', 'Contract not found.');
  return c;
}

/** FR-054 (simulated): sends the signing link; the one-time code is returned for on-screen display. */
export function sendForSignature(actor: Actor, contractId: string): { otp: string; to?: string } {
  if (!can(actor, 'orders.contract')) throw new ServiceError('forbidden', 'Your role cannot send contracts.');
  return commit((d) => {
    const c = requireContract(d, actor, contractId);
    if (c.status !== 'draft' && c.status !== 'sent_for_signature') throw new ServiceError('invalid_state', 'Only the current draft contract can be sent for signature.');
    const ctx = { d, actor, correlationId: uid('cor') };
    const otp = String(100000 + Math.floor(Math.random() * 900000));
    pendingOtp.set(contractId, otp);
    const contact = rows(d, 'contacts').find((x) => x.customerId === c.customerId && x.consentEmail && x.email);
    patchRecordIn(ctx, 'salesContracts', contractId, { status: 'sent_for_signature', sentAt: nowIso() }, 'Sent for e-signature (simulated)');
    if (contact) queueMessage(ctx, { channel: 'email', to: String(contact.email), subject: `Please sign ${c.contractNo}`, body: `Dear ${contact.name}, please review and sign sales contract ${c.contractNo}. Your one-time signing code will be sent by SMS.`, related: { resource: 'salesContracts', recordId: contractId } });
    return { otp, to: contact?.email as string | undefined };
  });
}

/** Customer signs with the one-time code (simulated e-signature provider). */
export function signContract(actor: Actor, contractId: string, otp: string, signerName: string) {
  if (!signerName.trim()) throw new ServiceError('validation', 'Enter the signer’s name.', { fieldErrors: { signerName: 'Required' } });
  commit((d) => {
    const c = requireContract(d, actor, contractId);
    if (c.status !== 'sent_for_signature') throw new ServiceError('invalid_state', 'Send the contract for signature first.');
    if (pendingOtp.get(contractId) !== otp.trim()) throw new ServiceError('validation', 'That code is not correct.', { fieldErrors: { otp: 'Incorrect code' } });
    pendingOtp.delete(contractId);
    const ctx = { d, actor, correlationId: uid('cor') };
    patchRecordIn(ctx, 'salesContracts', contractId, { status: 'signed', signedAt: nowIso(), signedBy: signerName.trim() }, `Signed electronically by ${signerName.trim()} (simulated)`);
    const u = userOfStaff(c.ownerId);
    if (u) notify(d, { userId: u.id, workspaceId: c.workspaceId, kind: 'info', title: `${c.contractNo} signed by ${signerName.trim()}`, link: { resource: 'salesContracts', recordId: contractId } });
  });
}

/** Latest non-superseded contract of an order for the print view. */
export function printableContract(actor: Actor, orderId: string) {
  const d = getDb();
  const order = rows(d, SO).find((o) => o.id === orderId);
  if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', `Sales order ${orderId} was not found.`);
  const contract = contractsOf(d, orderId).find((c) => c.status !== 'superseded');
  if (!contract) throw new ServiceError('not_found', 'No contract has been generated for this order yet.');
  return { order, contract, customer: byId('customers', order.customerId), site: byId('addresses', order.siteAddressId) };
}
