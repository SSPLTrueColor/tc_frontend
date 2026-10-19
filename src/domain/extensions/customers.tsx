/**
 * Customers module behaviour: validation and duplicate rules enforced in the service layer
 * (BR-01, BR-02, BR-03, CUS-01/06), sensible defaults, and the Customer 360 record extensions.
 */
import type { RecordData } from '../../metadata/types';
import { normaliseMobile, validateGstin } from '../../lib/validators';
import type { HookContext } from '../../services/resourceHooks';
import { registerResourceHooks } from '../../services/resourceHooks';
import { ServiceError } from '../../services/types';
import { exactContactMatches, exactCustomerMatches } from '../../services/customers/duplicates';
import { registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { AccountTab, AddressActions, ContactActions, ContactBanner, contactCount, ContactsTab, CustomerActions, CustomerBanner, SalesTab, ServiceTab, TimelineTab } from '../../modules/customers/components';

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const fail = (fieldErrors: Record<string, string>) => {
  throw new ServiceError('validation', Object.values(fieldErrors)[0], { fieldErrors });
};

function checkCustomer(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  if (!empty(c.gstin)) c.gstin = String(c.gstin).trim().toUpperCase();
  if (!empty(c.pan)) c.pan = String(c.pan).trim().toUpperCase();
  const errors: Record<string, string> = {};
  if (!empty(c.gstin)) {
    const msg = validateGstin(String(c.gstin), { stateCode: empty(c.billingState) ? undefined : String(c.billingState), pan: empty(c.pan) ? undefined : String(c.pan) });
    if (msg) errors.gstin = msg;
    else {
      const dup = exactCustomerMatches((ctx.d.records.customers ?? []).filter((x) => x.workspaceId === ctx.actor.workspaceId), c, selfId)[0];
      if (dup) errors.gstin = `This GSTIN already belongs to ${dup.id} “${dup.name}”. Open that customer instead of creating a duplicate.`;
    }
  }
  if (selfId && c.parentId === selfId) errors.parentId = 'A company cannot be its own parent';
  if (selfId && c.parentId) {
    // No cycles in the group hierarchy.
    let cur = String(c.parentId);
    for (let i = 0; i < 20 && cur; i++) {
      if (cur === selfId) {
        errors.parentId = 'This would create a loop in the group hierarchy';
        break;
      }
      cur = String((ctx.d.records.customers ?? []).find((x) => x.id === cur)?.parentId ?? '');
    }
  }
  if (c.dealerId && c.dealerId === selfId) errors.dealerId = 'A company cannot be its own dealer';
  if (Object.keys(errors).length) fail(errors);
}

function checkContact(ctx: HookContext, c: Record<string, unknown>, selfId?: string) {
  if (!empty(c.mobile)) c.mobile = normaliseMobile(String(c.mobile));
  if (!empty(c.whatsapp)) c.whatsapp = normaliseMobile(String(c.whatsapp));
  if (!empty(c.email)) c.email = String(c.email).trim().toLowerCase();
  if (empty(c.mobile) && empty(c.email)) fail({ mobile: 'Enter a mobile number or an email address', email: 'Enter a mobile number or an email address' });
  const dup = exactContactMatches((ctx.d.records.contacts ?? []).filter((x) => x.workspaceId === ctx.actor.workspaceId), c, selfId)[0];
  if (dup) fail({ [dup.field]: `This ${dup.field} already belongs to contact ${dup.id} “${dup.name}”.` });
  if (!empty(c.customerId) && c.poolStatus === 'new' && !selfId) c.poolStatus = 'contacted';
}

registerResourceHooks('customers', {
  beforeCreate: (ctx, c) => {
    if (empty(c.ownerId)) c.ownerId = ctx.actor.staffId;
    if (empty(c.divisionIds)) c.divisionIds = ctx.actor.divisionIds.slice(0, 1);
    checkCustomer(ctx, c);
  },
  beforeUpdate: (ctx, before, c) => checkCustomer(ctx, c, before.id),
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
  beforeUpdate: (ctx, before: RecordData, c) => checkContact(ctx, c, before.id),
});

registerResourceHooks('addresses', {
  // BR-02: coordinates come as a pair; an installation site without them is allowed but flagged in the 360 view.
  beforeCreate: (_ctx, a) => {
    if (empty(a.lat) !== empty(a.lng)) fail({ lat: 'Enter both latitude and longitude, or neither', lng: 'Enter both latitude and longitude, or neither' });
  },
  beforeUpdate: (_ctx, _b, a) => {
    if (empty(a.lat) !== empty(a.lng)) fail({ lat: 'Enter both latitude and longitude, or neither', lng: 'Enter both latitude and longitude, or neither' });
  },
});

registerRecordActions('customers', CustomerActions);
registerRecordBanner('customers', CustomerBanner);
registerRecordTab('customers', { id: 'c360-contacts', label: 'Contacts & sites', component: ContactsTab, count: contactCount });
registerRecordTab('customers', { id: 'c360-timeline', label: 'Timeline', component: TimelineTab });
registerRecordTab('customers', { id: 'c360-sales', label: 'Sales', component: SalesTab });
registerRecordTab('customers', { id: 'c360-service', label: 'Machines & service', component: ServiceTab });
registerRecordTab('customers', { id: 'c360-account', label: 'Account', component: AccountTab });

registerRecordActions('contacts', ContactActions);
registerRecordActions('addresses', AddressActions);
registerRecordBanner('contacts', ContactBanner);
