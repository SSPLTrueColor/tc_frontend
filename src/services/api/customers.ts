/**
 * Customers & Contacts — async page services (simulated network boundary). Same signatures a REST
 * client would have; the bodies call the in-browser engine.
 * Reads are plain functions passed to useServiceQuery (which adds the simulated latency);
 * writes go through call().
 */
import { call } from './client';
import type { Actor } from '../authz';
import { activitiesForCustomer } from '../activities';
import { customer360, customer360Overview, customerDocuments } from '../customers/view360';
import { convertContactToLead, type ConvertInput, listDuplicateGroups, mergeCustomers, previewTransfer, syncFromErp, transferOwnership } from '../customers/operations';
import { importRows, type ImportRow, rowsFromCsv, samplePhoneBook, sampleVisitingCard } from '../customers/importContacts';
import { deletePoolContact, listPoolContacts } from '../customers/pool';

export type { LinkedRow, LinkedSet, PaymentRow, FeedbackRow, DocumentRow, Customer360 } from '../customers/view360';
export type { PoolContact } from '../customers/pool';
export type { ConvertInput } from '../customers/operations';
export type { ImportRow } from '../customers/importContacts';

// ---- reads (wrap in useServiceQuery)
export const getCustomer360 = (actor: Actor, customerId: string) => customer360(actor, customerId);
export const getCustomer360Overview = (actor: Actor, customerId: string) => customer360Overview(actor, customerId);
export const getCustomerDocuments = (actor: Actor, customerId: string) => customerDocuments(actor, customerId);
export const getCustomerTimeline = (actor: Actor, customerId: string) => activitiesForCustomer(actor, customerId);
export const getContactPool = (actor: Actor) => listPoolContacts(actor);
export const getDuplicateGroups = (actor: Actor) => listDuplicateGroups(actor);
export const getTransferPreview = (actor: Actor, fromStaffId: string) => previewTransfer(actor, fromStaffId);

// ---- writes / actions
export const refreshErp = (actor: Actor, customerId: string) => call(() => syncFromErp(actor, customerId));
export const convertToLead = (actor: Actor, input: ConvertInput) => call(() => convertContactToLead(actor, input));
export const removePoolContact = (actor: Actor, contactId: string) => call(() => deletePoolContact(actor, contactId));
export const merge = (actor: Actor, keepId: string, removeId: string) => call(() => mergeCustomers(actor, keepId, removeId));
export const transfer = (actor: Actor, fromStaffId: string, toStaffId: string, reason: string) => call(() => transferOwnership(actor, fromStaffId, toStaffId, reason));
export const parseContactCsv = (text: string) => call(() => rowsFromCsv(text), { fast: true });
export const phoneBookSample = () => call(() => samplePhoneBook());
export const visitingCardSample = (n: number) => call(() => sampleVisitingCard(n));
export const importContacts = (actor: Actor, rows: ImportRow[]) => call(() => importRows(actor, rows));

// ---- small sync helpers used by forms and banners
export { CONTACT_CSV_TEMPLATE } from '../customers/importContacts';
export { defaultFollowUp, isRegistered, territoryForCity } from '../customers/operations';
export { fuzzyCustomerMatches } from '../customers/duplicates';
export { isPoolContact } from '../customers/pool';
export { countLinked, openOpportunities } from '../customers/view360';
