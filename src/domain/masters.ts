import type { MasterDefinition, MasterValue, Tone } from '../metadata/types';
import { L } from '../constants/labels';

const M = L.common.masters;
/** Lead-related shared masters: wording owned by the leads labels (L.leads.masters). */
const LM = L.leads.masters;
/** Customer-related shared masters: wording owned by the customers labels (L.customers.masters). */
const CM = L.customers.masters;

const v = (key: string, label: string, tone: Tone = 'neutral', parent?: string): Omit<MasterValue, 'order'> => ({
  key,
  label,
  tone,
  parent,
  active: true,
});

function master(key: string, label: string, values: Omit<MasterValue, 'order'>[], description?: string): MasterDefinition {
  return {
    id: `mst_${key}`,
    key,
    label,
    description,
    version: 1,
    values: values.map((x, i) => ({ ...x, order: i })),
  };
}

/** Indian states and union territories with their GST state codes (key = GST code). */
export const INDIAN_STATES: [string, string][] = [
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
];

/** Shared masters — immutable keys, editable labels via Administration › Masters. Labels: L.common.masters (GLOSSARY §3). */
/**
 * Child masters whose values belong to a value of another master (ADM-03). Dependent pickers show only
 * the children of the chosen parent, so a new child value must name its parent. Masters bound through a
 * field's `masterParentField` (e.g. Complaint Sub-category → Complaint Category) are found automatically;
 * this lists the ones linked by data only.
 */
export const MASTER_PARENTS: Record<string, string> = { territory: 'state' };

export const appMasters: MasterDefinition[] = [
  master('division', M.division.label, [
    v('TX', M.division.values.TX, 'accent'),
    v('INK', M.division.values.INK, 'info'),
    v('POD', M.division.values.POD, 'warning'),
    v('LBL', M.division.values.LBL, 'warning'),
    v('PPR', M.division.values.PPR, 'neutral'),
    v('FAB', M.division.values.FAB, 'success'),
  ]),
  master(
    'state',
    M.state.label,
    INDIAN_STATES.map(([code, name]) => v(code, name)),
    M.state.description,
  ),
  master('territory', M.territory.label, [
    v('mumbai', 'Mumbai', 'neutral', '27'),
    v('pune', 'Pune', 'neutral', '27'),
    v('surat', 'Surat', 'neutral', '24'),
    v('ahmedabad', 'Ahmedabad', 'neutral', '24'),
    v('delhi_ncr', 'Delhi NCR', 'neutral', '07'),
    v('ludhiana', 'Ludhiana', 'neutral', '03'),
    v('jaipur', 'Jaipur', 'neutral', '08'),
    v('tiruppur', 'Tiruppur', 'neutral', '33'),
    v('chennai', 'Chennai', 'neutral', '33'),
    v('bengaluru', 'Bengaluru', 'neutral', '29'),
    v('hyderabad', 'Hyderabad', 'neutral', '36'),
    v('kolkata', 'Kolkata', 'neutral', '19'),
  ]),
  master('role', M.role.label, [
    v('admin', L.roles.admin.label, 'accent'),
    v('management', L.roles.management.label, 'accent'),
    v('division_head', L.roles.division_head.label, 'info'),
    v('sales_manager', L.roles.sales_manager.label, 'info'),
    v('sales_exec', L.roles.sales_exec.label),
    v('service_head', L.roles.service_head.label, 'info'),
    v('engineer', L.roles.engineer.label),
    v('coordinator', L.roles.coordinator.label),
    v('scm', L.roles.scm.label),
    v('store', L.roles.store.label),
    v('accounts', L.roles.accounts.label),
    v('profiling', L.roles.profiling.label),
  ]),
  master('employeeStatus', M.userStatus.label, [v('active', M.userStatus.values.active, 'success'), v('on_leave', M.userStatus.values.on_leave, 'warning'), v('inactive', M.userStatus.values.inactive, 'neutral')]),
  master('taskStatus', M.taskStatus.label, [v('todo', M.taskStatus.values.todo, 'info'), v('in_progress', M.taskStatus.values.in_progress, 'warning'), v('done', M.taskStatus.values.done, 'success'), v('cancelled', M.taskStatus.values.cancelled, 'neutral')]),
  master('taskPriority', M.taskPriority.label, [v('low', M.taskPriority.values.low), v('medium', M.taskPriority.values.medium, 'info'), v('high', M.taskPriority.values.high, 'warning'), v('urgent', M.taskPriority.values.urgent, 'danger')]),
  // ---- shared business masters (used by several modules; see docs/CONTRACTS.md)
  master('productType', LM.productType.label, [
    v('machine', LM.productType.values.machine, 'accent'),
    v('ink', LM.productType.values.ink, 'info'),
    v('paper', LM.productType.values.paper),
    v('fabric', LM.productType.values.fabric, 'success'),
    v('spares', LM.productType.values.spares),
    v('service', LM.productType.values.service),
    v('software', LM.productType.values.software),
  ]),
  master('productSubType', LM.productSubType.label, [v('textile', LM.productSubType.values.textile), v('pod', LM.productSubType.values.pod), v('label', LM.productSubType.values.label), v('other', LM.productSubType.values.other)]),
  master('leadSource', LM.leadSource.label, [
    v('website', LM.leadSource.values.website),
    v('exhibition', LM.leadSource.values.exhibition, 'accent'),
    v('referral', LM.leadSource.values.referral, 'success'),
    v('dealer', LM.leadSource.values.dealer),
    v('social', LM.leadSource.values.social),
    v('meta_ads', LM.leadSource.values.meta_ads),
    v('google_ads', LM.leadSource.values.google_ads),
    v('indiamart', LM.leadSource.values.indiamart),
    v('cold_call', LM.leadSource.values.cold_call),
    v('walk_in', LM.leadSource.values.walk_in),
    v('agency', LM.leadSource.values.agency),
  ]),
  master('referrerType', LM.referrerType.label, [v('customer', LM.referrerType.values.customer), v('engineer', LM.referrerType.values.engineer), v('employee', LM.referrerType.values.employee), v('dealer', LM.referrerType.values.dealer)]),
  master('lostReason', LM.lostReason.label, [
    v('no_budget', LM.lostReason.values.no_budget),
    v('bought_competitor', LM.lostReason.values.bought_competitor, 'danger'),
    v('not_reachable', LM.lostReason.values.not_reachable),
    v('duplicate', LM.lostReason.values.duplicate),
    v('not_relevant', LM.lostReason.values.not_relevant),
    v('price', LM.lostReason.values.price, 'warning'),
    v('postponed', LM.lostReason.values.postponed),
    v('other', LM.lostReason.values.other),
  ]),
  master('activityType', M.activityType.label, [
    v('call', M.activityType.values.call),
    v('email', M.activityType.values.email),
    v('whatsapp', M.activityType.values.whatsapp),
    v('meeting', M.activityType.values.meeting),
    v('visit', M.activityType.values.visit),
    v('demo', M.activityType.values.demo),
    v('note', M.activityType.values.note),
  ]),
  master('customerCategory', CM.customerCategory.label, [
    v('prospect', CM.customerCategory.values.prospect, 'info'),
    v('active', CM.customerCategory.values.active, 'success'),
    v('inactive', CM.customerCategory.values.inactive),
    v('dealer', CM.customerCategory.values.dealer, 'accent'),
    v('distributor', CM.customerCategory.values.distributor, 'accent'),
  ]),
  master('segment', CM.segment.label, [
    v('fashion', CM.segment.values.fashion),
    v('job_work', CM.segment.values.job_work),
    v('trader', CM.segment.values.trader),
    v('mill', CM.segment.values.mill),
    v('packaging', CM.segment.values.packaging),
    v('commercial_print', CM.segment.values.commercial_print),
  ]),
  master('industry', M.industry.label, [
    v('textile', M.industry.values.textile),
    v('printing', M.industry.values.printing),
    v('packaging', M.industry.values.packaging),
    v('signage', M.industry.values.signage),
    v('home_textile', M.industry.values.home_textile),
    v('other', M.industry.values.other),
  ]),
  master('buyingRole', M.buyingRole.label, [v('decision_maker', M.buyingRole.values.decision_maker, 'accent'), v('influencer', M.buyingRole.values.influencer, 'info'), v('user', M.buyingRole.values.user), v('finance', M.buyingRole.values.finance)]),
  master('coverage', M.coverage.label, [v('cmc', M.coverage.values.cmc, 'success'), v('amc', M.coverage.values.amc, 'info'), v('warranty', M.coverage.values.warranty, 'success'), v('none', M.coverage.values.none, 'warning')]),
  master('taskType', M.taskType.label, [
    v('call', M.taskType.values.call),
    v('meeting', M.taskType.values.meeting),
    v('visit', M.taskType.values.visit),
    v('demo', M.taskType.values.demo),
    v('follow_up', M.taskType.values.follow_up),
    v('other', M.taskType.values.other),
  ]),
];
