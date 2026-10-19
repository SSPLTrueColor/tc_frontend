/**
 * Customers module — async page services (simulated network boundary). Same signatures a REST
 * client would have; the bodies call the in-browser engine.
 */
import { call } from './client';
import type { Actor } from '../authz';
import { activitiesForCustomer } from '../activities';
import { customer360 } from '../customers/view360';
import { convertContactToLead, type ConvertInput, listDuplicateGroups, mergeCustomers, previewTransfer, syncFromErp, transferOwnership } from '../customers/operations';
import { importRows, type ImportRow, rowsFromCsv, samplePhoneBook, sampleVisitingCard } from '../customers/importContacts';

export const getCustomer360 = (actor: Actor, customerId: string) => call(() => customer360(actor, customerId));
export const getCustomerTimeline = (actor: Actor, customerId: string) => call(() => activitiesForCustomer(actor, customerId));
export const refreshErp = (actor: Actor, customerId: string) => call(() => syncFromErp(actor, customerId));
export const convertToLead = (actor: Actor, input: ConvertInput) => call(() => convertContactToLead(actor, input));
export const getDuplicateGroups = (actor: Actor) => call(() => listDuplicateGroups(actor));
export const merge = (actor: Actor, keepId: string, removeId: string) => call(() => mergeCustomers(actor, keepId, removeId));
export const getTransferPreview = (actor: Actor, fromStaffId: string) => call(() => previewTransfer(actor, fromStaffId));
export const transfer = (actor: Actor, fromStaffId: string, toStaffId: string, reason: string) => call(() => transferOwnership(actor, fromStaffId, toStaffId, reason));
export const parseContactCsv = (text: string) => call(() => rowsFromCsv(text), { fast: true });
export const phoneBookSample = () => call(() => samplePhoneBook());
export const visitingCardSample = (n: number) => call(() => sampleVisitingCard(n));
export const importContacts = (actor: Actor, rows: ImportRow[]) => call(() => importRows(actor, rows));
