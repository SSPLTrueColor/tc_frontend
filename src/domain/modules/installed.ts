import type { ResourcePermission } from '../../metadata/types';
import { installedMasters } from './installed/masters';
import { installedResources } from './installed/resources';
import { type ModulePack, p } from './types';

const KEYS = ['installations', 'machines', 'warranties', 'amcContracts', 'trainingRecords', 'machineComponents', 'machineReadings', 'machineMoves'] as const;
type Key = (typeof KEYS)[number];
const same = (perm: ResourcePermission, overrides: Partial<Record<Key, ResourcePermission>> = {}) => Object.fromEntries(KEYS.map((k) => [k, overrides[k] ?? perm])) as Record<Key, ResourcePermission>;
const RO_HISTORY = p('all');

/**
 * Installed base (BRD 4.6 Dispatch-to-installation, 4.7 Installed base, warranty & AMC).
 * Permissions follow REQUIREMENTS §2.2: service leadership and coordinators run installations
 * and contracts; engineers work their own jobs; sales sees its division's base and owns renewals.
 * Machine moves are written only by the Relocate / transfer action (no direct create).
 */
export const installedPack: ModulePack = {
  id: 'installed',
  nav: {
    id: 'installed',
    label: 'Installed base',
    icon: 'printer',
    resources: ['installations', 'machines', 'amcContracts', 'warranties', 'trainingRecords', 'machineComponents', 'machineReadings', 'machineMoves'],
    pages: [{ id: 'renewals', label: 'Renewals', icon: 'reset', path: 'renewals' }],
    navChildIcons: [],
  },
  resources: installedResources,
  masters: installedMasters,
  permissions: {
    admin: same(p('all', 'all', true, true, true), { machineMoves: p('all', 'none', false, false, true) }),
    management: same(p('all', 'none', false, false, true)),
    division_head: same(p('division', 'none', false, false, true), { amcContracts: p('division', 'division', true, false, true), machineMoves: RO_HISTORY }),
    sales_manager: same(p('division'), { amcContracts: p('team', 'team', true, false, true), machineMoves: p('division') }),
    sales_exec: same(p('division'), { amcContracts: p('own', 'own', true), installations: p('division'), machineMoves: p('division') }),
    service_head: same(p('all', 'all', true, false, true), { machineMoves: p('all', 'none', false, false, true) }),
    engineer: same(p('division'), {
      installations: p('own', 'own'),
      trainingRecords: p('division', 'own', true),
      machineReadings: p('division', 'own', true),
      machineComponents: p('division', 'division', true),
    }),
    coordinator: same(p('division', 'division', true, false, true), { machineMoves: p('division') }),
    scm: same(p('all'), { amcContracts: p('none'), trainingRecords: p('none') }),
    store: same(p('none'), { machines: p('all'), machineComponents: p('all') }),
    accounts: same(p('all', 'none', false, false, true)),
    profiling: same(p('none')),
  },
  capabilities: {
    service_head: ['install.signoff', 'machine.transfer', 'amc.renew'],
    coordinator: ['install.signoff', 'machine.transfer', 'amc.renew'],
    engineer: ['install.signoff'],
    admin: ['install.signoff', 'machine.transfer', 'amc.renew'],
    division_head: ['amc.renew'],
    sales_manager: ['amc.renew'],
    sales_exec: ['amc.renew'],
  },
};
