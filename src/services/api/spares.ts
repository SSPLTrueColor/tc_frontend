/**
 * Spares & consumables page services — the async boundary custom pages call (same signatures a
 * REST API would have). Reads for lists go through useServiceQuery with the sync functions below.
 */
import type { Actor } from '../authz';
import { call } from './client';
import * as req from '../spares/requisitions';
import * as con from '../spares/consumables';

// ---- reads (pass to useServiceQuery)
export const stockAlerts = (actor: Actor) => req.stockAlerts(actor);
export const requisitionsForTicket = (actor: Actor, ticketId: string) => req.requisitionsForTicket(actor, ticketId);
export const leakageList = (actor: Actor) => con.leakageList(actor);
export const reorderList = (actor: Actor) => con.reorderList(actor);
export const customerConsumables = (actor: Actor, customerId: string) => con.customerConsumables(actor, customerId);

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
