/**
 * Spare Parts (4.9) and Consumables (4.10) page services — the async boundary custom pages call
 * (same signatures a REST API would have). Reads are sync functions passed to useServiceQuery,
 * which adds the simulated latency; writes go through call().
 */
import type { Actor } from '../authz';
import { call } from './client';
import * as req from '../spares/requisitions';
import * as con from '../spares/consumables';
import * as stock from '../spares/stock';
import * as orders from './orders';
import { deleteRecord } from '../runtime';
import type { QuoteLine } from '../orders/lines';

// ---- reads (pass to useServiceQuery)
export const mainStoreStock = (actor: Actor) => stock.mainStoreStock(actor);
export const engineerStock = (actor: Actor, engineerId?: string | null) => stock.engineerStock(actor, engineerId);
export const engineerStockScope = (actor: Actor) => stock.engineerStockScope(actor);
export const minimumLevelAlerts = (actor: Actor) => req.minimumLevelAlerts(actor);
export const requisitionsForTicket = (actor: Actor, ticketId: string) => req.requisitionsForTicket(actor, ticketId);
export const leakageList = (actor: Actor) => con.leakageList(actor);
export const reorderList = (actor: Actor) => con.reorderList(actor);
export const repeatOrderList = (actor: Actor) => con.repeatOrderList(actor);
export const dealerOrderList = (actor: Actor) => con.dealerOrderList(actor);
export const customerConsumables = (actor: Actor, customerId: string) => con.customerConsumables(actor, customerId);
/** CON-02 repeat draft from the orders module (rate contract → price list → previous price). */
export const repeatOrderDraft = (actor: Actor, orderId: string) => orders.draftFromRepeat(actor, orderId);

// ---- writes
export const rejectRequisition = (actor: Actor, id: string, reason: string, version: number) => call(() => req.rejectRequisition(actor, id, reason, version));
export const issueRequisition = (actor: Actor, id: string, input: { issuedQty: number; courier: string; docketNo: string }, version: number) => call(() => req.issueRequisition(actor, id, input, version));
export const recordConsumption = (actor: Actor, id: string, input: { consumedQty: number; basis: string; defectiveReturned: boolean }, version: number) => call(() => req.recordConsumption(actor, id, input, version));
export const returnRequisition = (actor: Actor, id: string, reason: string, version: number) => call(() => req.returnRequisition(actor, id, reason, version));
export const receiveDefective = (actor: Actor, id: string, version: number) => call(() => req.receiveDefective(actor, id, version));
export const raiseClaimFromRequisition = (actor: Actor, id: string, oem: string) => call(() => req.raiseClaimFromRequisition(actor, id, oem));
export const syncStockFromErp = (actor: Actor) => call(() => req.syncStockFromErp(actor));
export const sweepMinLevels = (actor: Actor) => call(() => req.sweepMinLevels(actor));
export const sendReorderReminders = (actor: Actor) => call(() => con.sendReorderReminders(actor));
/** One-tap Repeat Order: creates the sales order through the orders module (goes for approval). */
export const placeRepeatOrder = (actor: Actor, input: { orderId: string; lines: QuoteLine[]; customerPoNo: string; customerPoDate: string; poFileName: string; poFileSize?: number; idempotencyKey: string }) =>
  orders.createOrder(actor, { source: 'repeat', sourceId: input.orderId, lines: input.lines, customerPoNo: input.customerPoNo, customerPoDate: input.customerPoDate, poFileName: input.poFileName, poFileSize: input.poFileSize, idempotencyKey: input.idempotencyKey });
export const deleteDealerOrder = (actor: Actor, id: string) => call(() => deleteRecord(actor, 'dealerOrders', id));
