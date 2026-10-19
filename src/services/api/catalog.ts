/**
 * Async boundary for catalog & administration pages. Each call waits the simulated network delay
 * (see client.ts); reads are passed to useServiceQuery as their sync counterparts.
 */
import type { Actor } from '../authz';
import { commitImport, previewImport, type ImportPreview } from '../catalog/importer';
import { simulateIncomingLead, simulateIncomingMessage, syncFromErp } from '../catalog/integrations';
import { DEFAULT_POLICIES, type Policies, updatePolicies } from '../policies';
import { purgeRecord, restoreRecord } from '../runtime';
import { call } from './client';

export const savePolicies = (actor: Actor, patch: Partial<Policies>) => call(() => updatePolicies(actor, patch));
export const resetPolicies = (actor: Actor) => call(() => updatePolicies(actor, { ...DEFAULT_POLICIES }));

export const previewCsvImport = (actor: Actor, resKey: string, text: string) => call(() => previewImport(actor, resKey, text));
export const runCsvImport = (actor: Actor, preview: ImportPreview) => call(() => commitImport(actor, preview));

export const restoreFromBin = (actor: Actor, binId: string) => call(() => restoreRecord(actor, binId));
export const purgeFromBin = (actor: Actor, binId: string) => call(() => purgeRecord(actor, binId));

export const captureLead = (actor: Actor, source: string) => call(() => simulateIncomingLead(actor, source));
export const runErpSync = (actor: Actor) => call(() => syncFromErp(actor));
export const receiveMessage = (actor: Actor, channel: 'whatsapp' | 'email') => call(() => simulateIncomingMessage(actor, channel));
