import '../domain/extensions/index';
import { beforeEach, describe, expect, it } from 'vitest';
import { __setDb, createDb, getDb } from '../services/db';
import { actorFor, canReadRecord } from '../services/authz';
import { getResource } from '../services/registry';
import { salesRows } from '../services/sales';
import { quotationOrigin } from '../services/quotations/workflow';
import { sidebarModules, workspaceForModule } from '../domain/sidebar';

beforeEach(() => __setDb(createDb(new Date())));
describe('consolidated sales workspace', () => {
 it('shows scoped records and does not double-count converted leads', () => {
   const actor = actorFor('u_karan', 'tc');
   const rows = salesRows(actor);
   expect(rows.length).toBeGreaterThan(0);
   for (const row of rows) {
     expect(canReadRecord(actor, getResource(row.resource), row.record)).toBe(true);
     if (row.resource === 'leads') expect(row.record.status).not.toBe('qualified');
   }
 });
 it('groups navigation without dropping resource routes', () => {
   expect(sidebarModules).toHaveLength(8);
   expect(workspaceForModule('quotations')).toBe('leads');
   expect(workspaceForModule('service')).toBe('installed');
   const resources = sidebarModules.flatMap((m) => m.resources);
   expect(new Set(resources).size).toBe(resources.length);
   expect(resources).toEqual(expect.arrayContaining(['leads', 'opportunities', 'quotations', 'dispatches', 'machines', 'tickets']));
 });
 it('resolves source leads only when readable and preserves direct-customer opportunities', () => {
   const actor = actorFor('u_vikram', 'tc');
   for (const quote of getDb().records.quotations.filter((q) => canReadRecord(actor, getResource('quotations'), q))) {
     const origin = quotationOrigin(actor, quote.id);
     if (origin.leadId) {
       const lead = getDb().records.leads.find((l) => l.id === origin.leadId)!;
       expect(canReadRecord(actor, getResource('leads'), lead)).toBe(true);
       expect(origin.directCustomer).toBe(false);
     }
   }
 });
 it('separates revision work from approval status', () => {
   const field = getResource('quotations').fields.find((f) => f.key === 'reviewStage')!;
   expect(field.computed!({status: 'draft', revision: 2})).toBe('under_revision');
   expect(field.computed!({status: 'pending_approval', revision: 2})).toBe('pending_approval');
 });
});
