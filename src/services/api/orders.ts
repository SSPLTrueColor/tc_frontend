/**
 * Orders page services: async functions with the same signatures a REST API would have.
 * Reads are passed to useServiceQuery (which adds the simulated latency); writes go through call().
 */
import type { Actor } from '../authz';
import { call } from './client';
import * as so from '../orders/orders';
import * as sc from '../orders/contracts';
import type { QuoteLine } from '../orders/lines';

export { orderView, eligibleQuotations, repeatableOrders, draftFromQuotation, draftFromRepeat, getOrder } from '../orders/orders';
export { printableContract } from '../orders/contracts';

export const createOrder = (actor: Actor, input: so.CreateOrderInput) => call(() => so.createOrder(actor, input));
export const submitOrderForApproval = (actor: Actor, id: string, note: string) => call(() => so.submitForApproval(actor, id, note));
export const updateOrderLines = (actor: Actor, id: string, input: { lines: QuoteLine[]; freight: number; insurance: number; version: number; note?: string }) => call(() => so.updateLines(actor, id, input));
export const requestOrderStatusChange = (actor: Actor, id: string, kind: 'hold' | 'resume' | 'cancel', reason: string) => call(() => so.requestStatusChange(actor, id, kind, reason));
export const syncOrderFromErp = (actor: Actor, id: string) => call(() => so.syncFromErp(actor, id));
export const savePaymentSchedule = (actor: Actor, id: string, rows: so.ScheduleRow[]) => call(() => so.saveSchedule(actor, id, rows));
export const recordPaymentReceipt = (actor: Actor, milestoneId: string, amount: number, date: string) => call(() => so.recordReceipt(actor, milestoneId, amount, date));
export const sendPaymentReminders = (actor: Actor) => call(() => so.runPaymentReminders(actor));
export const recordOrderDispatch = (actor: Actor, id: string, input: so.DispatchInput) => call(() => so.recordDispatch(actor, id, input));
export const confirmOrderDelivery = (actor: Actor, dispatchId: string, input: { actualDelivery: string; podFileName: string; podFileSize?: number; podPhotoName?: string }) => call(() => so.confirmDelivery(actor, dispatchId, input));
export const generateSalesContract = (actor: Actor, orderId: string) => call(() => sc.generateContract(actor, orderId));
export const sendContractForSignature = (actor: Actor, contractId: string) => call(() => sc.sendForSignature(actor, contractId));
export const signSalesContract = (actor: Actor, contractId: string, otp: string, signer: string) => call(() => sc.signContract(actor, contractId, otp, signer));
