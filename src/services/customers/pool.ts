/**
 * Contact Pool (CUS-05): contacts collected before there is a customer — from the phone book,
 * Excel / CSV, visiting-card scan or manual entry. A pool contact leaves the pool through
 * "Convert to Lead" (BR-04); converted contacts stay listed with status "Converted to Lead".
 */
import type { RecordData } from '../../metadata/types';
import { type Actor, perm } from '../authz';
import { getDb } from '../db';
import { deleteRecord, queryRecords } from '../runtime';
import { ServiceError } from '../types';
import { L } from '../../constants/labels';
import { isRegistered } from './operations';

export interface PoolContact {
  contact: RecordData;
  /** Lead created from this contact (converted contacts only). */
  leadId?: string;
}

/** True for contacts that belong to the pool (never linked to a customer, or converted from the pool). */
export const isPoolContact = (c: RecordData) => !c.customerId || c.poolStatus === 'converted';

/** Pool contacts the actor may see, newest first. */
export function listPoolContacts(actor: Actor): PoolContact[] {
  if (perm(actor, 'contacts').read === 'none') throw new ServiceError('forbidden', L.customers.messages.noPoolAccess);
  const rows = queryRecords(actor, 'contacts', { sort: [{ field: 'createdAt', dir: 'desc' }] }).rows.filter(isPoolContact);
  const leads = isRegistered('leads') ? getDb().records.leads ?? [] : [];
  return rows.map((contact) => ({ contact, leadId: contact.poolStatus === 'converted' ? leads.find((l) => l.contactId === contact.id)?.id : undefined }));
}

/** Deletes a pool contact (moves it to the recycle bin). */
export function deletePoolContact(actor: Actor, contactId: string) {
  deleteRecord(actor, 'contacts', contactId);
  return { id: contactId };
}
