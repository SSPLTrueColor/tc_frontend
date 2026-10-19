import type { MasterDefinition, MasterValue, Tone } from '../../../metadata/types';

const v = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[], description?: string): MasterDefinition => ({
  id: `mst_${key}`,
  key,
  label,
  description,
  version: 1,
  values: values.map((x, i) => ({ ...x, order: i })),
});

/** Installed-base masters (installations, machines, warranty, AMC/CMC, training). */
export const installedMasters: MasterDefinition[] = [
  master('installationStatus', 'Installation status', [
    v('scheduled', 'Scheduled', 'info'),
    v('site_ready', 'Site ready', 'accent'),
    v('in_progress', 'In progress', 'warning'),
    v('trial_training', 'Trial & training', 'warning'),
    v('signed_off', 'Signed off', 'success'),
  ]),
  master('installStep', 'Installation step', [
    v('unpack', 'Unpacking & inspection'),
    v('position', 'Positioning & levelling'),
    v('power_on', 'Power-on & self test'),
    v('heads', 'Print-head installation & alignment'),
    v('ink_fill', 'Ink filling & purge'),
    v('rip', 'RIP software set-up'),
    v('profile', 'Colour profiling'),
    v('test_print', 'Test print'),
  ]),
  master('trainingTopic', 'Training topic', [
    v('operation', 'Daily operation'),
    v('maintenance', 'Daily / weekly maintenance'),
    v('rip', 'RIP workflow'),
    v('colour', 'Colour management'),
    v('troubleshooting', 'Basic troubleshooting'),
    v('safety', 'Safety'),
  ]),
  master('installSignOffMethod', 'Sign-off method', [v('otp', 'OTP to customer mobile'), v('signature', 'Digital signature')]),
  master('machineStatus', 'Machine status', [v('active', 'Active', 'success'), v('relocated', 'Relocated', 'info'), v('scrapped', 'Scrapped', 'neutral')]),
  master('warrantyCoverage', 'Warranty coverage', [v('parts_labour', 'Parts & labour', 'success'), v('labour', 'Labour only', 'info')]),
  master('warrantyStatus', 'Warranty status', [v('active', 'Active', 'success'), v('expiring', 'Expiring ≤ 90 days', 'warning'), v('expired', 'Expired', 'neutral'), v('future', 'Not started', 'info')]),
  master('amcType', 'Contract type', [v('amc', 'AMC – labour only', 'info'), v('cmc', 'CMC – comprehensive', 'success')]),
  master('amcStatus', 'Contract status', [
    v('draft', 'Draft', 'neutral'),
    v('active', 'Active', 'success'),
    v('due_for_renewal', 'Due for renewal', 'warning'),
    v('renewed', 'Renewed', 'accent'),
    v('expired', 'Expired', 'neutral'),
    v('lost', 'Lost', 'danger'),
  ]),
  master('amcBilling', 'Billing frequency', [v('annual', 'Annual (advance)'), v('half_yearly', 'Half-yearly'), v('quarterly', 'Quarterly')]),
  master('machineComponentType', 'Component type', [v('print_head', 'Print head', 'accent'), v('main_board', 'Main board'), v('head_board', 'Head board'), v('ink_pump', 'Ink pump'), v('encoder', 'Encoder'), v('other', 'Other')]),
  master('machineComponentStatus', 'Component status', [v('in_service', 'In service', 'success'), v('replaced', 'Replaced', 'neutral')]),
  master('machineReadingSource', 'Reading source', [v('visit', 'Engineer visit'), v('remote', 'Remote / RIP log'), v('customer', 'Reported by customer')]),
  master('machineMoveType', 'Ownership / site change', [v('relocation', 'Relocation (same owner)', 'info'), v('resale', 'Resale (new owner)', 'warning')]),
  master('retrainingStatus', 'Re-training', [v('none', 'Not requested'), v('requested', 'Requested', 'warning'), v('scheduled', 'Scheduled', 'info'), v('done', 'Done', 'success')]),
];
