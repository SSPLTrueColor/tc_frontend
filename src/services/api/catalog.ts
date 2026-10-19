/**
 * Async boundary for Administration pages and the Product & Price Master. Each call waits the simulated
 * network delay (see client.ts); reads are passed to useServiceQuery as their sync counterparts.
 * Same signatures a real API would have — a backend swap replaces this file only.
 */
import type { Actor } from '../authz';
import { getRoleMatrix, resetRolePermissions, type RoleChanges, saveRolePermissions } from '../catalog/access';
import { type FormLayoutInput, listFormLayouts, resetFormLayout, saveFormLayout } from '../catalog/formLayouts';
import { commitImport, previewImport, type ImportPreview } from '../catalog/importer';
import { simulateIncomingLead, simulateIncomingMessage, syncFromErp } from '../catalog/integrations';
import { pickGroup, type PolicyGroup } from '../catalog/policyRules';
import { DEFAULT_POLICIES, getPolicies, type Policies, updatePolicies } from '../policies';
import { purgeRecord, restoreRecord } from '../runtime';
import { call } from './client';

// Workflows & Approval Matrices / SLA Matrix / Configurable Rules
export const fetchPolicies = () => call(() => getPolicies());
export const savePolicies = (actor: Actor, patch: Partial<Policies>) => call(() => updatePolicies(actor, patch));
/** Restores the shipped defaults of one page only (other pages keep their values). */
export const resetPolicies = (actor: Actor, group: PolicyGroup) => call(() => updatePolicies(actor, pickGroup(DEFAULT_POLICIES, group)));

// Roles & Permissions
export const fetchRoleMatrix = (actor: Actor) => call(() => getRoleMatrix(actor));
export const saveRole = (actor: Actor, roleId: string, changes: RoleChanges) => call(() => saveRolePermissions(actor, roleId, changes));
export const resetRole = (actor: Actor, roleId: string) => call(() => resetRolePermissions(actor, roleId));

// Custom Fields & Form Layouts
export const fetchFormLayouts = (actor: Actor) => call(() => listFormLayouts(actor));
export const saveLayout = (actor: Actor, input: FormLayoutInput) => call(() => saveFormLayout(actor, input));
export const resetLayout = (actor: Actor, resource: string, division: string) => call(() => resetFormLayout(actor, resource, division));

// Bulk Import / Export
export const previewCsvImport = (actor: Actor, resKey: string, text: string) => call(() => previewImport(actor, resKey, text));
export const runCsvImport = (actor: Actor, preview: ImportPreview) => call(() => commitImport(actor, preview));

// Recycle Bin
export const restoreFromBin = (actor: Actor, binId: string) => call(() => restoreRecord(actor, binId));
export const purgeFromBin = (actor: Actor, binId: string) => call(() => purgeRecord(actor, binId));

// Integrations
export const captureLead = (actor: Actor, source: string) => call(() => simulateIncomingLead(actor, source));
export const runErpSync = (actor: Actor) => call(() => syncFromErp(actor));
export const receiveMessage = (actor: Actor, channel: 'whatsapp' | 'email') => call(() => simulateIncomingMessage(actor, channel));
