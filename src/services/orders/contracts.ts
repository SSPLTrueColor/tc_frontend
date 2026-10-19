/** Sales contracts (SO-05 / SO-06, FR-053 / FR-054): division templates, versions, simulated e-signature. */
import { L } from '../../constants/labels';
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

const T = L.orders.templates;
const MACHINE_BASE: Template = { ...T.machine };
const NA = T.notApplicable;

/** One template per division (§13 #11 assumption: one template per division). */
export const DIVISION_TEMPLATES: Record<string, Template> = {
  TX: MACHINE_BASE,
  POD: { ...MACHINE_BASE, inkCommitment: T.podInk },
  LBL: { ...MACHINE_BASE, inkCommitment: T.labelInk },
  INK: { ...MACHINE_BASE, deliveryTerms: T.shortDelivery, installationTerms: NA, warrantyTerms: T.inkWarranty, sparesTerms: NA, inkCommitment: T.inkCommitment, amcTerms: NA },
  PPR: { ...MACHINE_BASE, deliveryTerms: T.shortDelivery, installationTerms: NA, warrantyTerms: T.paperWarranty, sparesTerms: NA, inkCommitment: NA, amcTerms: NA },
  FAB: { ...MACHINE_BASE, deliveryTerms: T.fabricDelivery, installationTerms: NA, warrantyTerms: T.fabricWarranty, sparesTerms: NA, inkCommitment: NA, amcTerms: NA },
};

const E = L.orders.errors;
const N = L.orders.notices;
const pendingOtp = new Map<string, string>();
const rows = (d: Db, key: string) => (d.records[key] ?? []) as RecordData[];

function contractNoFor(d: Db, order: RecordData, version: number) {
  const first = contractsOf(d, order.id).find((c) => Number(c.contractVersion) === 1);
  if (first) return `${String(first.contractNo).replace(/-v\d+$/, '')}-v${version}`;
  const k = `scNo:${order.divisionId}:${fyLabel()}`;
  d.counters[k] = (d.counters[k] ?? 0) + 1;
  return `SC/${order.divisionId}/${fyLabel()}/${String(d.counters[k]).padStart(4, '0')}`;
}

/** Generates a new contract version from the approved order; earlier versions become superseded. */
export function generateContract(actor: Actor, orderId: string): RecordData {
  if (!can(actor, 'orders.contract')) throw new ServiceError('forbidden', E.contractForbidden);
  return commit((d) => {
    const order = rows(d, SO).find((o) => o.id === orderId);
    if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', E.notFound(orderId));
    if (!canUpdateRecord(actor, getResource(SO), order)) throw new ServiceError('forbidden', E.contractOrderForbidden);
    if (['pending_approval', 'cancelled'].includes(String(order.status))) throw new ServiceError('invalid_state', E.contractNotApproved);
    const ctx = { d, actor, correlationId: uid('cor') };
    const existing = contractsOf(d, orderId);
    if (existing.some((c) => c.status === 'signed')) throw new ServiceError('invalid_state', E.contractSigned);
    const version = (Number(existing[0]?.contractVersion) || 0) + 1;
    existing.filter((c) => c.status !== 'superseded').forEach((c) => patchRecordIn(ctx, 'salesContracts', c.id, { status: 'superseded' }, N.contractSuperseded(version)));
    const t = DIVISION_TEMPLATES[String(order.divisionId)] ?? MACHINE_BASE;
    const c = insertRecordIn(ctx, 'salesContracts', {
      contractNo: contractNoFor(d, order, version),
      salesOrderId: order.id,
      customerId: order.customerId,
      ownerId: order.ownerId,
      divisionId: order.divisionId,
      contractVersion: version,
      status: 'draft',
      contractValue: order.grandTotal,
      paymentTerms: (order.paymentTerms as string) || N.defaultPaymentTerms,
      deliveryTerms: (order.deliveryTerms as string) || t.deliveryTerms,
      loadingTerms: t.loadingTerms,
      installationTerms: (order.installationTerms as string) || t.installationTerms,
      warrantyTerms: (order.warrantyTerms as string) || t.warrantyTerms,
      sparesTerms: t.sparesTerms,
      inkCommitment: t.inkCommitment,
      amcTerms: t.amcTerms,
    });
    appendAudit(d, actor, { action: 'salesContract.generated', resource: SO, recordId: order.id, summary: N.contractGenerated(String(c.contractNo), version, formatMoney(Number(order.grandTotal))), correlationId: ctx.correlationId });
    return c;
  });
}

function requireContract(d: Db, actor: Actor, id: string) {
  const c = rows(d, 'salesContracts').find((x) => x.id === id);
  if (!c || !canReadRecord(actor, getResource('salesContracts'), c)) throw new ServiceError('not_found', E.contractNotFound);
  return c;
}

/** FR-054 (simulated): sends the signing link; the one-time code is returned for on-screen display. */
export function sendForSignature(actor: Actor, contractId: string): { otp: string; to?: string } {
  if (!can(actor, 'orders.contract')) throw new ServiceError('forbidden', E.sendForbidden);
  return commit((d) => {
    const c = requireContract(d, actor, contractId);
    if (c.status !== 'draft' && c.status !== 'sent_for_signature') throw new ServiceError('invalid_state', E.sendDraftOnly);
    const ctx = { d, actor, correlationId: uid('cor') };
    const otp = String(100000 + Math.floor(Math.random() * 900000));
    pendingOtp.set(contractId, otp);
    const contact = rows(d, 'contacts').find((x) => x.customerId === c.customerId && x.consentEmail && x.email);
    patchRecordIn(ctx, 'salesContracts', contractId, { status: 'sent_for_signature', sentAt: nowIso() }, N.contractSent);
    if (contact) queueMessage(ctx, { channel: 'email', to: String(contact.email), subject: N.contractSignSubject(String(c.contractNo)), body: N.contractSignBody(String(contact.name), String(c.contractNo)), related: { resource: 'salesContracts', recordId: contractId } });
    return { otp, to: contact?.email as string | undefined };
  });
}

/** Customer signs with the one-time code (simulated e-signature provider). */
export function signContract(actor: Actor, contractId: string, otp: string, signerName: string) {
  if (!signerName.trim()) throw new ServiceError('validation', E.signerRequired, { fieldErrors: { signerName: L.orders.common.required } });
  commit((d) => {
    const c = requireContract(d, actor, contractId);
    if (c.status !== 'sent_for_signature') throw new ServiceError('invalid_state', E.sendFirst);
    if (pendingOtp.get(contractId) !== otp.trim()) throw new ServiceError('validation', E.otpIncorrect, { fieldErrors: { otp: E.otpIncorrectField } });
    pendingOtp.delete(contractId);
    const ctx = { d, actor, correlationId: uid('cor') };
    patchRecordIn(ctx, 'salesContracts', contractId, { status: 'signed', signedAt: nowIso(), signedBy: signerName.trim() }, N.contractSignedLog(signerName.trim()));
    const u = userOfStaff(c.ownerId);
    if (u) notify(d, { userId: u.id, workspaceId: c.workspaceId, kind: 'info', title: N.contractSigned(String(c.contractNo), signerName.trim()), link: { resource: 'salesContracts', recordId: contractId } });
  });
}

/** Latest non-superseded contract of an order for the Sales Contract PDF page. */
export function printableContract(actor: Actor, orderId: string) {
  const d = getDb();
  const order = rows(d, SO).find((o) => o.id === orderId);
  if (!order || !canReadRecord(actor, getResource(SO), order)) throw new ServiceError('not_found', E.notFound(orderId));
  const contract = contractsOf(d, orderId).find((c) => c.status !== 'superseded');
  if (!contract) throw new ServiceError('not_found', E.noContract);
  return { order, contract, customer: byId('customers', order.customerId), site: byId('addresses', order.siteAddressId) };
}
