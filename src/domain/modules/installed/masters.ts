import type { MasterDefinition, MasterValue, Tone } from '../../../metadata/types';
import { L } from '../../../constants/labels';

const M = L.installed.masters;
type MasterId = keyof typeof M;

const master = <K extends MasterId>(key: K, values: [keyof (typeof M)[K]['values'] & string, Tone?][], description?: string): MasterDefinition => ({
  id: `mst_${key}`,
  key,
  label: M[key].label,
  description,
  version: 1,
  values: values.map(([k, tone], i): MasterValue => ({ key: k, label: (M[key].values as Record<string, string>)[k], tone: tone ?? 'neutral', active: true, order: i })),
});

/** Installed-base masters (installation jobs, machines, warranty, AMC / CMC, training). Labels: L.installed.masters. */
export const installedMasters: MasterDefinition[] = [
  master('installationStatus', [['scheduled', 'info'], ['site_ready', 'accent'], ['in_progress', 'warning'], ['trial_training', 'warning'], ['signed_off', 'success']]),
  master('installStep', [['unpack'], ['position'], ['power_on'], ['heads'], ['ink_fill'], ['rip'], ['profile'], ['test_print']]),
  master('trainingTopic', [['operation'], ['maintenance'], ['rip'], ['colour'], ['troubleshooting'], ['safety']]),
  master('installSignOffMethod', [['otp'], ['signature']]),
  master('machineStatus', [['active', 'success'], ['relocated', 'info'], ['scrapped', 'neutral']]),
  master('warrantyCoverage', [['parts_labour', 'success'], ['labour', 'info']]),
  master('warrantyStatus', [['active', 'success'], ['expiring', 'warning'], ['expired', 'neutral'], ['future', 'info']]),
  master('amcType', [['amc', 'info'], ['cmc', 'success']]),
  master('amcStatus', [['draft', 'neutral'], ['active', 'success'], ['due_for_renewal', 'warning'], ['renewed', 'accent'], ['expired', 'neutral'], ['lost', 'danger']]),
  master('amcBilling', [['annual'], ['half_yearly'], ['quarterly']]),
  master('machineComponentType', [['print_head', 'accent'], ['main_board'], ['head_board'], ['ink_pump'], ['encoder'], ['other']]),
  master('machineComponentStatus', [['in_service', 'success'], ['replaced', 'neutral']]),
  master('machineReadingSource', [['visit'], ['remote'], ['customer']]),
  master('machineMoveType', [['relocation', 'info'], ['resale', 'warning']]),
  master('retrainingStatus', [['none'], ['requested', 'warning'], ['scheduled', 'info'], ['done', 'success']]),
];
