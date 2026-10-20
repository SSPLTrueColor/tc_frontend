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
import { type DpRequestInput, listSessions, logDpRequest, resolveDpRequest, saveNotificationPrefs, saveRetention, setConsent, setMfaOptIn, signOutDevice, signOutOtherDevices } from '../account';
import type { DataProtection, NotificationPrefs } from '../types';
import { addGrant, changeRole, extendGrant, type GrantInput, revokeGrant } from '../catalog/grants';
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

// Account & governance settings (Notification Preferences, Security, Data Protection)
export const saveNotifications = (actor: Actor, prefs: NotificationPrefs) => call(() => saveNotificationPrefs(actor, prefs));
export const fetchSessions = (userId: string) => call(() => listSessions(userId));
export const changeMfa = (actor: Actor, on: boolean) => call(() => setMfaOptIn(actor, on));
export const endSession = (actor: Actor, id: string) => call(() => signOutDevice(actor, id));
export const endOtherSessions = (actor: Actor) => call(() => signOutOtherDevices(actor));
export const changeConsent = (actor: Actor, key: keyof DataProtection['consents'], on: boolean) => call(() => setConsent(actor, key, on));
export const changeRetention = (actor: Actor, r: DataProtection['retention']) => call(() => saveRetention(actor, r));
export const fileDpRequest = (actor: Actor, input: DpRequestInput) => call(() => logDpRequest(actor, input));
export const closeDpRequest = (actor: Actor, id: string, status: 'done' | 'rejected') => call(() => resolveDpRequest(actor, id, status));

// Roles & Permissions: people and extra access
export const giveExtraAccess = (actor: Actor, input: GrantInput) => call(() => addGrant(actor, input));
export const removeExtraAccess = (actor: Actor, id: string) => call(() => revokeGrant(actor, id));
export const extendExtraAccess = (actor: Actor, id: string, days = 30) => call(() => extendGrant(actor, id, days));
export const changePersonRole = (actor: Actor, userId: string, roleId: string) => call(() => changeRole(actor, userId, roleId));
