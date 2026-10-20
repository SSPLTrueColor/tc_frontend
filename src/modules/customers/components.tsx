/** Customers & Contacts record actions, banners and the Convert to Lead dialog (registered in domain/extensions/customers.tsx). */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { ROUTES } from '../../constants/routes';
import { formatMoney } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { call, errorMessage } from '../../services/api/client';
import { convertToLead, defaultFollowUp, fuzzyCustomerMatches, isRegistered, refreshErp, territoryForCity } from '../../services/api/customers';
import { can, canUpdateRecord, perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { activeMasterValues } from '../../services/registry';
import { recordTitle, updateRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { Button } from '../../components/primitives/Button';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { DatePicker } from '../../components/primitives/DatePicker';
import { QuickCreateDialog } from '../../components/resource/RecordForm';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { TextField, Textarea } from '../../components/primitives/controls';

const A = L.customers.actions;
const M = L.customers.messages;

// ---------------------------------------------------------------- ERP refresh (CUS-09, simulated)

export function RefreshErpButton({ actor, record, res, compact }: RecordExtensionProps & { compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const raw = getDb().records.customers?.find((c) => c.id === record.id);
  const allowed = !!raw && (canUpdateRecord(actor, res, raw) || can(actor, 'approve.finance'));
  return (
    <Button
      icon="reset"
      variant={compact ? 'ghost' : undefined}
      loading={busy}
      disabledReason={allowed ? undefined : M.noErp}
      title={A.simulatedErp}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await refreshErp(actor, record.id);
          toast(M.erpRefreshed(formatMoney(r.outstanding)));
        } catch (e) {
          toast(errorMessage(e), 'danger');
        } finally {
          setBusy(false);
        }
      }}
    >
      {A.refreshErp}
    </Button>
  );
}

// ---------------------------------------------------------------- record actions

export function CustomerActions(props: RecordExtensionProps) {
  const { actor, record } = props;
  const [logging, setLogging] = useState(false);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Button icon="message" onClick={() => setLogging(true)} disabledReason={perm(actor, 'activities').create ? undefined : M.noActivity}>
        {A.logActivity}
      </Button>
      <Button icon="plus" onClick={() => setAdding(true)} disabledReason={perm(actor, 'contacts').create ? undefined : M.noContactCreate}>
        {A.addContact}
      </Button>
      <RefreshErpButton {...props} />
      <LogActivityDialog open={logging} onClose={() => setLogging(false)} parent={{ parentResource: 'customers', parentId: record.id, parentLabel: `${record.id} · ${String(record.name)}`, customerId: record.id }} />
      <QuickCreateDialog open={adding} resKey="contacts" initial={{ customerId: record.id, divisionIds: record.divisionIds, ownerId: record.ownerId }} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />
    </>
  );
}

/** Why "Convert to Lead" is unavailable for this contact, or undefined when it is allowed. */
export function convertBlockedReason(actor: RecordExtensionProps['actor'], contact: RecordData) {
  const V = L.customers.convert;
  if (contact.poolStatus === 'converted') return V.disabledConverted;
  if (!isRegistered('leads')) return V.disabledNoLeads;
  if (!perm(actor, 'leads').create) return V.disabledNoPerm;
  return undefined;
}

export function ContactActions({ actor, record }: RecordExtensionProps) {
  const [converting, setConverting] = useState(false);
  const [logging, setLogging] = useState(false);
  return (
    <>
      <Button variant="primary" icon="arrow-up" onClick={() => setConverting(true)} disabledReason={convertBlockedReason(actor, record)}>
        {A.convertToLead}
      </Button>
      <Button icon="message" onClick={() => setLogging(true)} disabledReason={perm(actor, 'activities').create ? undefined : M.noActivity}>
        {A.logActivity}
      </Button>
      {converting && <ConvertDialog actor={actor} contact={record} onClose={() => setConverting(false)} />}
      <LogActivityDialog
        open={logging}
        onClose={() => setLogging(false)}
        parent={{ parentResource: 'contacts', parentId: record.id, parentLabel: `${record.id} · ${String(record.name)}`, customerId: record.customerId ? String(record.customerId) : undefined }}
      />
    </>
  );
}

// ---------------------------------------------------------------- Convert to Lead (CUS-05, BR-04)

export function ConvertDialog({ actor, contact, onClose }: { actor: RecordExtensionProps['actor']; contact: RecordData; onClose: () => void }) {
  const toast = useToast();
  const V = L.customers.convert;
  const pool = !contact.customerId;
  const divisions = activeMasterValues('division');
  const sales = (getDb().records.employees ?? []).filter((e) => ['sales_exec', 'sales_manager', 'division_head', 'coordinator'].includes(String(e.roleId)) && e.status !== 'inactive');
  // BR-04: territory / hub and billing state are pre-filled from the contact's city when it is a hub.
  const guess = pool ? territoryForCity(contact.city) : undefined;
  const [v, setV] = useState({
    companyName: '',
    territoryId: guess?.territoryId ?? '',
    billingState: guess?.billingState ?? '',
    divisionId: ((contact.divisionIds as string[]) ?? [])[0] ?? actor.divisionIds[0] ?? '',
    productType: 'machine',
    ownerId: String(contact.ownerId ?? actor.staffId),
    nextFollowUpAt: defaultFollowUp(),
    requirement: '',
    eventName: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, val: string) => setV((x) => ({ ...x, [k]: val }));
  // CUS-06 / BR-01: the inline company is checked for similar names (non-blocking warning).
  const similar = pool && v.companyName.trim().length >= 3 ? fuzzyCustomerMatches((getDb().records.customers ?? []).filter((c) => c.workspaceId === actor.workspaceId), v.companyName).slice(0, 3) : [];
  const err = (k: string) => errors[k] && <p className="field-error">{errors[k]}</p>;
  const saving = useRef(false);
  const save = async () => {
    if (saving.current) return; // no double submit
    saving.current = true;
    setBusy(true);
    setErrors({});
    try {
      const r = await convertToLead(actor, { contactId: contact.id, ...v });
      toast(V.done(r.leadId, pool ? r.customerId : undefined));
      onClose();
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
      else setErrors({ form: errorMessage(e) });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={V.title(String(contact.name))}
      description={pool ? V.poolDescription : V.linkedDescription(recordTitle('customers', contact.customerId))}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {A.createLead}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        {pool && (
          <>
            <div className="form-field span-all">
              <label className="field-label" htmlFor="cv-company">
                {V.companyName} <span className="req">*</span>
              </label>
              <TextField id="cv-company" maxLength={120} value={v.companyName} onChange={(e) => set('companyName', e.target.value)} data-autofocus />
              {err('companyName')}
              {similar.length > 0 && (
                <InlineAlert tone="warning" title={L.customers.banners.duplicateTitle}>
                  {L.customers.banners.looksLike}{' '}
                  {similar.map((m, i) => (
                    <span key={m.id}>
                      {i > 0 && ', '}
                      <Link to={recordPeekPath(actor.workspaceId, 'customers', m.id)}>{m.name}</Link> ({Math.round(m.score * 100)}%)
                    </span>
                  ))}
                  . {V.similarHint}
                </InlineAlert>
              )}
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="cv-territory">
                {V.territory} <span className="req">*</span>
              </label>
              <SelectMenu
                id="cv-territory"
                block
                label={V.territory}
                value={v.territoryId}
                options={activeMasterValues('territory').map((t) => ({ value: t.key, label: t.label }))}
                onChange={(t) => setV((x) => ({ ...x, territoryId: t, billingState: x.billingState || (activeMasterValues('territory').find((m) => m.key === t)?.parent ?? '') }))}
              />
              {err('territoryId')}
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="cv-state">
                {V.state} <span className="req">*</span>
              </label>
              <SelectMenu id="cv-state" block label={V.state} value={v.billingState} options={activeMasterValues('state').map((t) => ({ value: t.key, label: t.label }))} onChange={(t) => set('billingState', t)} />
              {err('billingState')}
            </div>
          </>
        )}
        <div className="form-field">
          <label className="field-label" htmlFor="cv-div">
            {V.division} <span className="req">*</span>
          </label>
          <SelectMenu id="cv-div" block label={V.division} value={v.divisionId} options={divisions.map((d) => ({ value: d.key, label: d.label }))} onChange={(t) => set('divisionId', t)} />
          {err('divisionId')}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-pt">
            {V.productType} <span className="req">*</span>
          </label>
          <SelectMenu id="cv-pt" block label={V.productType} value={v.productType} options={activeMasterValues('productType').map((d) => ({ value: d.key, label: d.label }))} onChange={(t) => set('productType', t)} />
          {err('productType')}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-owner">
            {V.ownerId} <span className="req">*</span>
          </label>
          <SelectMenu id="cv-owner" block label={V.ownerId} value={v.ownerId} options={sales.map((e) => ({ value: e.id, label: `${String(e.fullName)} — ${String(e.designation)}` }))} onChange={(t) => set('ownerId', t)} />
          {err('ownerId')}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-next">
            {V.nextFollowUp} <span className="req">*</span>
          </label>
          <DatePicker id="cv-next" block value={v.nextFollowUpAt} onChange={(t) => set('nextFollowUpAt', t ?? '')} label={V.nextFollowUp} />
          {err('nextFollowUpAt')}
        </div>
        {contact.source === 'exhibition' && (
          <div className="form-field span-all">
            <label className="field-label" htmlFor="cv-event">
              {V.eventName} <span className="req">*</span>
            </label>
            <TextField id="cv-event" maxLength={120} value={v.eventName} onChange={(e) => set('eventName', e.target.value)} placeholder={V.eventPlaceholder} />
            {err('eventName')}
          </div>
        )}
        <div className="form-field span-all">
          <label className="field-label" htmlFor="cv-req">
            {V.requirement}
          </label>
          <Textarea id="cv-req" className="textarea" rows={2} maxLength={1000} value={v.requirement} onChange={(e) => set('requirement', e.target.value)} />
        </div>
        {errors.form && (
          <p className="field-error span-all" role="alert">
            {errors.form}
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- banners

export function CustomerBanner({ actor, record }: RecordExtensionProps) {
  const B = L.customers.banners;
  const others = (getDb().records.customers ?? []).filter((c) => c.workspaceId === actor.workspaceId);
  const similar = fuzzyCustomerMatches(others, record.name, record.id).slice(0, 2);
  if (!similar.length) return null;
  return (
    <InlineAlert tone="warning" title={B.duplicateTitle}>
      {B.looksLike}{' '}
      {similar.map((s, i) => (
        <span key={s.id}>
          {i > 0 && ', '}
          <Link to={recordPeekPath(actor.workspaceId, 'customers', s.id)}>{s.name}</Link> ({Math.round(s.score * 100)}%)
        </span>
      ))}
      .
      {can(actor, 'customers.merge') && (
        <>
          {' '}
          <Link to={ROUTES.duplicateMerge}>{A.reviewMerge}</Link>
        </>
      )}
    </InlineAlert>
  );
}

export function ContactBanner({ actor, record }: RecordExtensionProps) {
  const B = L.customers.banners;
  if (record.poolStatus === 'converted') {
    const lead = isRegistered('leads') ? (getDb().records.leads ?? []).find((l) => l.contactId === record.id) : undefined;
    return (
      <InlineAlert tone="success" title={B.convertedTitle}>
        {lead ? <Link to={recordPeekPath(actor.workspaceId, 'leads', lead.id)}>{A.openLead(lead.id)}</Link> : B.convertedText}
      </InlineAlert>
    );
  }
  if (!record.customerId)
    return (
      <InlineAlert tone="info" title={B.poolTitle}>
        {B.poolText} <Link to={ROUTES.contactPool}>{L.nav.pages.contactPool.title}</Link>
      </InlineAlert>
    );
  return null;
}

// ---------------------------------------------------------------- site geo-tag (FR-002, simulated)

/** Approximate centres of the hub cities — fallback when the browser location is unavailable. */
const CITY_GEO: Record<string, [number, number]> = {
  mumbai: [19.076, 72.8777], pune: [18.5204, 73.8567], surat: [21.1702, 72.8311], ahmedabad: [23.0225, 72.5714], delhi: [28.6139, 77.209], 'new delhi': [28.6139, 77.209], ludhiana: [30.901, 75.8573], jaipur: [26.9124, 75.7873], tiruppur: [11.1085, 77.3411], chennai: [13.0827, 80.2707], bengaluru: [12.9716, 77.5946], hyderabad: [17.385, 78.4867], kolkata: [22.5726, 88.3639],
};

export function SiteActions({ actor, record, res }: RecordExtensionProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const raw = getDb().records.addresses?.find((a) => a.id === record.id);
  const allowed = !!raw && canUpdateRecord(actor, res, raw);
  const save = async (lat: number, lng: number, how: string) => {
    try {
      await call(() => updateRecord(actor, 'addresses', record.id, { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }, raw!.version));
      toast(M.locationSaved(how));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      icon="pin"
      loading={busy}
      disabledReason={allowed ? undefined : M.noSiteEdit}
      title={A.locationTip}
      onClick={() => {
        setBusy(true);
        const fallback = () => {
          const c = CITY_GEO[String(record.city ?? '').trim().toLowerCase()] ?? [20.5937, 78.9629];
          save(c[0] + (Math.random() - 0.5) * 0.02, c[1] + (Math.random() - 0.5) * 0.02, M.locationSimulated);
        };
        if (!navigator.geolocation) return fallback();
        navigator.geolocation.getCurrentPosition((p) => save(p.coords.latitude, p.coords.longitude, M.locationDevice), fallback, { timeout: 4000 });
      }}
    >
      {A.useMyLocation}
    </Button>
  );
}
