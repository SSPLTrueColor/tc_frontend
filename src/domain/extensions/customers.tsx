/**
 * Customers & Contacts behaviour: validation and duplicate rules enforced in the service layer
 * (BR-01, BR-02, BR-03, CUS-01/06), sensible defaults, and the Customer 360° View record extensions.
 */
// Consumables (spares) and Training Records (installed) tabs sit in the middle of the Customer 360° View,
// so those modules register first and this file applies the final tab order synchronously.
import './spares';
import './installed';
import type { RecordData } from '../../metadata/types';
import { normaliseMobile, validateGstin } from '../../lib/validators';
import { todayKey } from '../../lib/dates';
import { canReadRecord } from '../../services/authz';
import { getResource } from '../../services/registry';
import type { HookContext } from '../../services/resourceHooks';
import { registerResourceHooks } from '../../services/resourceHooks';
import { ServiceError } from '../../services/types';
import { exactContactMatches, exactCustomerMatches } from '../../services/customers/duplicates';
import { getRecordTabs, registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { L } from '../../constants/labels';
import { ContactActions, ContactBanner, CustomerActions, CustomerBanner, SiteActions } from '../../modules/customers/components';
import {
  ActivityHistoryTab,
  contactCount,
  ContactsTab,
  DocumentsTab,
  FeedbackTab,
  KeyAccountPlanTab,
  LeadsTab,
  MachinesTab,
  OpportunitiesTab,
  OverviewTab,
  PaymentStatusTab,
  QuotationsTab,
  SalesOrdersTab,
  siteCount,
  SitesTab,
  TicketsTab,
  WarrantyAmcTab,
} from '../../modules/customers/customer360';

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const fail = (fieldErrors: Record<string, string>) => {
  throw new ServiceError('validation', Object.values(fieldErrors)[0], { fieldErrors });
};

/** Trims text fields; whitespace-only values become empty so the required check catches them. */
function trimFields(r: Record<string, unknown>, keys: string[]) {
  keys.forEach((k) => {
    if (typeof r[k] === 'string') r[k] = (r[k] as string).trim();
  });
}

/** The company a contact or site is attached to must be one the actor can see (REQUIREMENTS §2.2 scope). */
function checkCompanyInScope(ctx: HookContext, customerId: unknown, field = 'customerId') {
  if (empty(customerId)) return;
  const company = (ctx.d.records.customers ?? []).find((x) => x.id === customerId);
  if (company && !canReadRecord(ctx.actor, getResource('customers'), company)) fail({ [field]: L.customers.messages.companyOutOfScope });
}

function checkCustomer(ctx: HookContext, c: Record<string, unknown>, before?: RecordData) {
  const selfId = before?.id;
  trimFields(c, ['name', 'legalName', 'website']);
  if (!empty(c.gstin)) c.gstin = String(c.gstin).trim().toUpperCase();
  if (!empty(c.pan)) c.pan = String(c.pan).trim().toUpperCase();
  const errors: Record<string, string> = {};
  if (empty(c.name)) errors.name = L.customers.messages.nameRequired;
  if (!empty(c.gstin)) {
    const msg = validateGstin(String(c.gstin), { stateCode: empty(c.billingState) ? undefined : String(c.billingState), pan: empty(c.pan) ? undefined : String(c.pan) });
    if (msg) errors.gstin = msg;
    else {
      const dup = exactCustomerMatches((ctx.d.records.customers ?? []).filter((x) => x.workspaceId === ctx.actor.workspaceId), c, selfId)[0];
      if (dup) errors.gstin = L.customers.messages.gstinTaken(dup.id, String(dup.name));
    }
  }
  if (selfId && c.parentId === selfId) errors.parentId = L.customers.messages.ownParent;
  if (selfId && c.parentId) {
    // No cycles in the group hierarchy.
    let cur = String(c.parentId);
    for (let i = 0; i < 20 && cur; i++) {
      if (cur === selfId) {
        errors.parentId = L.customers.messages.parentLoop;
        break;
      }
      cur = String((ctx.d.records.customers ?? []).find((x) => x.id === cur)?.parentId ?? '');
    }
  }
  if (c.dealerId && c.dealerId === selfId) errors.dealerId = L.customers.messages.ownDealer;
  else if (c.dealerId && c.dealerId !== before?.dealerId) {
    // CUS-08: the dealer link points at a Dealer or Distributor (the form filters the list; the service enforces it).
    const dealer = (ctx.d.records.customers ?? []).find((x) => x.id === c.dealerId);
    if (dealer && !['dealer', 'distributor'].includes(String(dealer.category))) errors.dealerId = L.customers.messages.notADealer;
  }
  // CUS-11: a new review date must not be in the past, but an overdue date already on record must not block other edits.
  if (c.keyAccount && !empty(c.planNextReview) && c.planNextReview !== before?.planNextReview && String(c.planNextReview).slice(0, 10) < todayKey()) errors.planNextReview = L.customers.messages.reviewPast;
  if (Object.keys(errors).length) fail(errors);
}

function checkContact(ctx: HookContext, c: Record<string, unknown>, before?: RecordData) {
  const selfId = before?.id;
  trimFields(c, ['name', 'designation', 'department', 'city']);
  if (empty(c.name)) fail({ name: L.customers.messages.nameRequired });
  if (c.customerId !== before?.customerId) checkCompanyInScope(ctx, c.customerId);
  if (!empty(c.mobile)) c.mobile = normaliseMobile(String(c.mobile));
  if (!empty(c.whatsapp)) c.whatsapp = normaliseMobile(String(c.whatsapp));
  if (!empty(c.email)) c.email = String(c.email).trim().toLowerCase();
  if (empty(c.mobile) && empty(c.email)) fail({ mobile: L.customers.messages.reachRequired, email: L.customers.messages.reachRequired });
  const dup = exactContactMatches((ctx.d.records.contacts ?? []).filter((x) => x.workspaceId === ctx.actor.workspaceId), c, selfId)[0];
  if (dup) fail({ [dup.field]: L.customers.messages.contactTaken(dup.field, dup.id, String(dup.name)) });
  if (!empty(c.customerId) && c.poolStatus === 'new' && !selfId) c.poolStatus = 'contacted';
}

registerResourceHooks('customers', {
  beforeCreate: (ctx, c) => {
    if (empty(c.ownerId)) c.ownerId = ctx.actor.staffId;
    if (empty(c.divisionIds)) c.divisionIds = ctx.actor.divisionIds.slice(0, 1);
    checkCustomer(ctx, c);
  },
  beforeUpdate: (ctx, before, c) => checkCustomer(ctx, c, before),
});

registerResourceHooks('contacts', {
  beforeCreate: (ctx, c) => {
    if (empty(c.ownerId)) c.ownerId = ctx.actor.staffId;
    if (empty(c.divisionIds)) {
      const company = (ctx.d.records.customers ?? []).find((x) => x.id === c.customerId);
      c.divisionIds = (company?.divisionIds as string[] | undefined)?.slice() ?? ctx.actor.divisionIds.slice(0, 1);
    }
    if (empty(c.poolStatus)) c.poolStatus = 'new';
    checkContact(ctx, c);
  },
  beforeUpdate: (ctx, before: RecordData, c) => checkContact(ctx, c, before),
});

/**
 * Sites (resource key `addresses`). BR-02: coordinates come as a pair; an installation site without them is allowed
 * but flagged in the 360° view. Sites carry no owner, so scope follows the company: a user may only add or change
 * sites of companies they can see (REQUIREMENTS §2.2 — Sales executive "CEV Own").
 */
function checkSite(ctx: HookContext, a: Record<string, unknown>, before?: RecordData) {
  trimFields(a, ['label', 'line1', 'city', 'pincode']);
  const errors: Record<string, string> = {};
  (['label', 'line1', 'city'] as const).forEach((k) => {
    if (empty(a[k])) errors[k] = L.customers.messages.required;
  });
  if (empty(a.lat) !== empty(a.lng)) Object.assign(errors, { lat: L.customers.messages.geoPair, lng: L.customers.messages.geoPair });
  if (Object.keys(errors).length) fail(errors);
  if (before) {
    const company = (ctx.d.records.customers ?? []).find((x) => x.id === before.customerId);
    if (company && !canReadRecord(ctx.actor, getResource('customers'), company)) throw new ServiceError('forbidden', L.customers.messages.noSiteEdit);
  }
  if (a.customerId !== before?.customerId) checkCompanyInScope(ctx, a.customerId);
}

registerResourceHooks('addresses', {
  beforeCreate: (ctx, a) => checkSite(ctx, a),
  beforeUpdate: (ctx, before, a) => checkSite(ctx, a, before),
});

registerRecordActions('customers', CustomerActions);
registerRecordBanner('customers', CustomerBanner);
registerRecordActions('contacts', ContactActions);
registerRecordActions('addresses', SiteActions);
registerRecordBanner('contacts', ContactBanner);

// ---------------------------------------------------------------- Customer 360° View tabs (CUS-07, GLOSSARY §1.2)

const T = L.customers.tabs;
registerRecordTab('customers', { id: 'c360-overview', label: T.overview, component: OverviewTab });
registerRecordTab('customers', { id: 'c360-contacts', label: T.contacts, component: ContactsTab, count: contactCount });
registerRecordTab('customers', { id: 'c360-sites', label: T.sites, component: SitesTab, count: siteCount });
registerRecordTab('customers', { id: 'c360-leads', label: T.leads, component: LeadsTab });
registerRecordTab('customers', { id: 'c360-opportunities', label: T.opportunities, component: OpportunitiesTab });
registerRecordTab('customers', { id: 'c360-quotations', label: T.quotations, component: QuotationsTab });
registerRecordTab('customers', { id: 'c360-sales-orders', label: T.salesOrders, component: SalesOrdersTab });
registerRecordTab('customers', { id: 'c360-payment', label: T.paymentStatus, component: PaymentStatusTab });
registerRecordTab('customers', { id: 'c360-machines', label: T.installedMachines, component: MachinesTab });
registerRecordTab('customers', { id: 'c360-warranty', label: T.warrantyAmc, component: WarrantyAmcTab });
registerRecordTab('customers', { id: 'c360-tickets', label: T.serviceTickets, component: TicketsTab });
registerRecordTab('customers', { id: 'c360-feedback', label: T.feedback, component: FeedbackTab });
registerRecordTab('customers', { id: 'c360-plan', label: T.keyAccountPlan, component: KeyAccountPlanTab });
registerRecordTab('customers', { id: 'c360-activity', label: T.activityHistory, component: ActivityHistoryTab });
registerRecordTab('customers', { id: 'c360-documents', label: T.documents, component: DocumentsTab });

/**
 * Tab order per GLOSSARY §1.2. "Consumables" (spares module) and "Training Records" (installed
 * module) are registered by their own modules (imported above), then every tab is re-registered in order.
 */
const TAB_ORDER = ['c360-overview', 'c360-contacts', 'c360-sites', 'c360-leads', 'c360-opportunities', 'c360-quotations', 'c360-sales-orders', 'c360-payment', 'c360-machines', 'c360-warranty', 'c360-tickets', 'c360-feedback', 'spares-consumables', 'training', 'c360-plan', 'c360-activity', 'c360-documents'];
const TAB_LABELS: Record<string, string> = { 'spares-consumables': T.consumables, training: T.trainingRecords };
function orderCustomer360Tabs() {
  const rank = (id: string) => (TAB_ORDER.includes(id) ? TAB_ORDER.indexOf(id) : TAB_ORDER.length);
  [...getRecordTabs('customers')].sort((a, b) => rank(a.id) - rank(b.id)).forEach((t) => registerRecordTab('customers', { ...t, label: TAB_LABELS[t.id] ?? t.label }));
}
orderCustomer360Tabs();
