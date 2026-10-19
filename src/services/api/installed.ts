/**
 * Installed-base page services (async boundary). Same signatures a REST API would have;
 * each call waits the simulated network delay before running the engine-side logic.
 */
import type { RecordData } from '../../metadata/types';
import { todayKey } from '../../lib/dates';
import type { Actor } from '../authz';
import { call } from './client';
import {
  attachInstallationMedia,
  daysBetween,
  markContractLost,
  moveMachine,
  type MoveInput,
  renewContract,
  type RenewInput,
  replaceComponent,
  runRenewalSweep,
  shareReadinessChecklist,
  signOffInstallation,
  type SignOffInput,
  startSignOffOtp,
} from '../installed/logic';
import { queryRecords } from '../runtime';
import { getPolicies } from '../policies';

export const installedApi = {
  shareReadinessChecklist: (actor: Actor, id: string) => call(() => shareReadinessChecklist(actor, id)),
  attachMedia: (actor: Actor, id: string, files: { name: string; size: number }[]) => call(() => attachInstallationMedia(actor, id, files)),
  startSignOffOtp: (actor: Actor, id: string) => call(() => startSignOffOtp(actor, id)),
  signOff: (actor: Actor, id: string, input: SignOffInput, version: number) => call(() => signOffInstallation(actor, id, input, version)),
  moveMachine: (actor: Actor, machineId: string, input: MoveInput) => call(() => moveMachine(actor, machineId, input)),
  replaceComponent: (actor: Actor, componentId: string, input: { newSerial: string; date: string; reason: string }) => call(() => replaceComponent(actor, componentId, input)),
  renew: (actor: Actor, id: string, input: RenewInput) => call(() => renewContract(actor, id, input)),
  markLost: (actor: Actor, id: string, reason: string, note: string) => call(() => markContractLost(actor, id, reason, note)),
};

export type RenewalBucket = 'upcoming' | 'due' | 'lapsed' | 'renewed' | 'lost';

export interface RenewalRow {
  contract: RecordData;
  daysLeft: number;
  bucket: RenewalBucket;
}

/**
 * Renewal pipeline read model (IB-05). Runs the idempotent renewal sweep first (it commits only
 * when a reminder, status change or expiry is due on the simulated clock), then groups the
 * contracts the actor can see. Safe inside useServiceQuery's silent refresh.
 */
export function loadRenewals(actor: Actor): RenewalRow[] {
  runRenewalSweep(actor);
  const today = todayKey();
  const horizon = Math.max(...getPolicies().renewalReminderDays, 90) + 30;
  return queryRecords(actor, 'amcContracts', { sort: [{ field: 'endDate', dir: 'asc' }] })
    .rows.map((c) => {
      const daysLeft = daysBetween(today, String(c.endDate));
      const s = String(c.status);
      const bucket: RenewalBucket | null =
        s === 'due_for_renewal' ? 'due' : s === 'active' && daysLeft <= horizon ? 'upcoming' : s === 'expired' && daysLeft >= -90 ? 'lapsed' : s === 'renewed' && daysLeft >= -180 ? 'renewed' : s === 'lost' && daysLeft >= -365 ? 'lost' : null;
      return bucket ? { contract: c, daysLeft, bucket } : null;
    })
    .filter((x): x is RenewalRow => !!x);
}
