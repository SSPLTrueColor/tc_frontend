/** Customer 360 tabs, record actions and banners (registered in domain/extensions/customers.tsx). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { formatMoney } from '../../lib/format';
import { formatDate, todayKey } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { call, errorMessage } from '../../services/api/client';
import { convertToLead, refreshErp } from '../../services/api/customers';
import { activitiesForCustomer } from '../../services/activities';
import { can, canUpdateRecord, perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { activeMasterValues, masterLabel, masterValue } from '../../services/registry';
import { recordTitle, updateRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { customer360, type LinkedRow } from '../../services/customers/view360';
import { defaultFollowUp, isRegistered } from '../../services/customers/operations';
import { fuzzyCustomerMatches } from '../../services/customers/duplicates';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { Button } from '../../components/primitives/Button';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { DatePicker } from '../../components/primitives/DatePicker';
import { InfoTip } from '../../components/primitives/InfoTip';
import { FormDrawer, QuickCreateDialog } from '../../components/resource/RecordForm';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';

// ---------------------------------------------------------------- shared bits

function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h3 className="detail-section-title">
          {title} {count !== undefined && <span className="muted">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function RowList({ rows, ws, empty }: { rows: LinkedRow[]; ws: string; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="related-list">
      {rows.map((r) => (
        <li key={`${r.resKey}:${r.id}`}>
          <Link to={recordPeekPath(ws, r.resKey, r.id)} className="rel-link">
            <span className="mono">{r.id}</span> {r.title !== r.id ? r.title : ''}
          </Link>
          <span className="muted small">
            {r.amount !== undefined ? formatMoney(r.amount) : ''}
            {r.amount !== undefined && r.date ? ' · ' : ''}
            {r.date ? formatDate(r.date) : ''}
          </span>
          {r.status && <StatusChip label={r.status.label} tone={r.status.tone} />}
        </li>
      ))}
    </ul>
  );
}

function use360(actor: RecordExtensionProps['actor'], id: string) {
  return useServiceQuery(() => customer360(actor, id), [actor.user.id, id]);
}

function Loading({ q }: { q: { error: string | null; retry: () => void } }) {
  return q.error ? (
    <ErrorState title="Could not load" onRetry={q.retry}>
      {q.error}
    </ErrorState>
  ) : (
    <Skeleton rows={4} />
  );
}

const addressLine = (a: RecordData) => [a.line1, a.city, masterLabel('state', a.state), a.pincode].filter(Boolean).join(', ');

// ---------------------------------------------------------------- Contacts & sites

export function ContactsTab({ actor, record }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  const [adding, setAdding] = useState<'contacts' | 'addresses' | null>(null);
  if (!q.data) return <Loading q={q} />;
  const { contacts, addresses } = q.data;
  const initial = adding === 'contacts' ? { customerId: record.id, divisionIds: record.divisionIds, ownerId: record.ownerId } : { customerId: record.id, state: record.billingState };
  return (
    <div className="related">
      <Section title="Contacts" count={contacts.length} action={perm(actor, 'contacts').create && <Button variant="ghost" icon="plus" onClick={() => setAdding('contacts')}>New</Button>}>
        {contacts.length ? (
          <ul className="related-list">
            {contacts.map((c) => (
              <li key={c.id}>
                <Link to={recordPeekPath(actor.workspaceId, 'contacts', c.id)} className="rel-link">
                  {String(c.name)}
                </Link>
                <span className="muted small">
                  {[c.designation, masterLabel('buyingRole', c.buyingRole)].filter(Boolean).join(' · ') || <EmptyValue />}
                </span>
                {c.buyingRole === 'decision_maker' && <StatusChip label="Decision maker" tone="accent" />}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="users" title="No contacts yet">Add the people you deal with at this company.</EmptyState>
        )}
      </Section>
      <Section title="Addresses & sites" count={addresses.length} action={perm(actor, 'addresses').create && <Button variant="ghost" icon="plus" onClick={() => setAdding('addresses')}>New</Button>}>
        {addresses.length ? (
          <ul className="related-list">
            {addresses.map((a) => (
              <li key={a.id}>
                <Link to={recordPeekPath(actor.workspaceId, 'addresses', a.id)} className="rel-link">
                  {String(a.label)}
                </Link>
                <span className="muted small">{addressLine(a)}</span>
                <StatusChip label={masterLabel('addressType', a.addressType)} tone={masterValue('addressType', a.addressType)?.tone} />
                {a.addressType === 'installation' && (a.lat === null || a.lat === undefined) && <StatusChip label="No geo-tag" tone="warning" />}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="building" title="No addresses yet">Add billing, shipping and installation-site addresses.</EmptyState>
        )}
      </Section>
      <QuickCreateDialog open={!!adding} resKey={adding ?? 'contacts'} initial={initial} onClose={() => setAdding(null)} onCreated={() => setAdding(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- Timeline

export function TimelineTab({ actor, record }: RecordExtensionProps) {
  const q = useServiceQuery(() => activitiesForCustomer(actor, record.id), [actor.user.id, record.id]);
  const [logging, setLogging] = useState(false);
  return (
    <div className="related">
      <Section title="Customer timeline" count={q.data?.length} action={perm(actor, 'activities').create && <Button variant="ghost" icon="plus" onClick={() => setLogging(true)}>Log activity</Button>}>
        {!q.data ? (
          <Loading q={q} />
        ) : q.data.length ? (
          <ul className="related-list">
            {q.data.slice(0, 40).map((a) => (
              <li key={a.id}>
                <span className="muted small nowrap">
                  <DateText value={String(a.at)} />
                </span>
                <Link to={recordPeekPath(actor.workspaceId, 'activities', a.id)} className="rel-link">
                  {String(a.subject)}
                </Link>
                <span className="muted small">
                  {masterLabel('activityType', a.activityType)} · {recordTitle('employees', a.byId, actor)}
                  {a.parentLabel ? ` · ${String(a.parentLabel)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="message" title="No interactions yet">Calls, visits and notes on this customer, its leads, deals and tickets appear here.</EmptyState>
        )}
      </Section>
      <LogActivityDialog open={logging} onClose={() => setLogging(false)} parent={{ parentResource: 'customers', parentId: record.id, parentLabel: `${record.id} · ${String(record.name)}`, customerId: record.id }} />
    </div>
  );
}

// ---------------------------------------------------------------- Sales

const SALES_LABEL: Record<string, string> = { leads: 'Leads', opportunities: 'Opportunities', quotations: 'Quotations', salesOrders: 'Sales orders' };

export function SalesTab({ actor, record }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  if (!q.data) return <Loading q={q} />;
  return (
    <div className="related">
      {q.data.sales.map((s) => (
        <Section key={s.resKey} title={SALES_LABEL[s.resKey]} count={s.available ? s.rows.length : undefined}>
          {s.available ? <RowList rows={s.rows} ws={actor.workspaceId} empty={`No ${SALES_LABEL[s.resKey].toLowerCase()} for this customer.`} /> : <p className="muted">Not available for your role or not part of this build yet.</p>}
        </Section>
      ))}
      <Section title="Payment status (ERP)">
        <ErpFigures record={record} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- Installed base & service

export function ServiceTab({ actor, record }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  if (!q.data) return <Loading q={q} />;
  const { machines, contracts, tickets, training, available } = q.data;
  const rated = tickets.filter((t) => typeof t.rating === 'number');
  const csat = rated.length ? rated.reduce((s, t) => s + Number(t.rating), 0) / rated.length : null;
  return (
    <div className="related">
      <Section title="Installed machines" count={available.machines ? machines.length : undefined}>
        {available.machines ? <RowList rows={machines} ws={actor.workspaceId} empty="No machines installed for this customer." /> : <p className="muted">Installed base is not part of this build yet.</p>}
      </Section>
      <Section title="Warranty & AMC / CMC" count={available.amcContracts ? contracts.length : undefined}>
        {available.amcContracts ? <RowList rows={contracts} ws={actor.workspaceId} empty="No warranty or service contract on record." /> : <p className="muted">Contracts are not part of this build yet.</p>}
      </Section>
      <Section title="Service tickets" count={available.tickets ? tickets.length : undefined}>
        {available.tickets ? (
          <>
            {csat !== null && (
              <p className="small">
                Average feedback rating <strong>{csat.toFixed(1)} / 5</strong> from {rated.length} closed ticket(s).
              </p>
            )}
            <RowList rows={tickets} ws={actor.workspaceId} empty="No service tickets for this customer." />
          </>
        ) : (
          <p className="muted">Service tickets are not part of this build yet.</p>
        )}
      </Section>
      {training.length > 0 && (
        <Section title="Training records" count={training.length}>
          <RowList rows={training} ws={actor.workspaceId} empty="" />
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- ERP + account plan

function ErpFigures({ record }: { record: RecordData }) {
  const fig = (v: unknown) => (typeof v === 'number' ? formatMoney(v) : <EmptyValue />);
  return (
    <dl className="detail-list">
      <div className="detail-row">
        <dt>Credit limit</dt>
        <dd>{fig(record.creditLimit)}</dd>
      </div>
      <div className="detail-row">
        <dt>Outstanding</dt>
        <dd>{fig(record.outstanding)}</dd>
      </div>
      <div className="detail-row">
        <dt>Overdue</dt>
        <dd>{typeof record.overdue === 'number' && record.overdue > 0 ? <strong className="text-danger">{formatMoney(record.overdue)}</strong> : fig(record.overdue)}</dd>
      </div>
      <div className="detail-row">
        <dt>Last synced</dt>
        <dd>{record.erpSyncedAt ? <DateText value={String(record.erpSyncedAt)} showTime /> : <EmptyValue />}</dd>
      </div>
    </dl>
  );
}

export function AccountTab({ actor, record, res }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  const [editing, setEditing] = useState(false);
  const raw = getDb().records.customers?.find((c) => c.id === record.id);
  const canEdit = !!raw && canUpdateRecord(actor, res, raw);
  const openOpps = q.data?.sales.find((s) => s.resKey === 'opportunities')?.rows.filter((r) => !['Won', 'Lost'].includes(r.status?.label ?? '')) ?? [];
  const decisionMakers = q.data?.contacts.filter((c) => c.buyingRole === 'decision_maker' || c.buyingRole === 'finance') ?? [];
  const review = record.planNextReview ? String(record.planNextReview) : '';
  return (
    <div className="related">
      <Section
        title="Credit & outstanding (ERP)"
        action={
          <span className="dialog-title-row">
            <InfoTip text="Read-only figures from the ERP. In this prototype the ERP is simulated." label="About ERP figures" />
          </span>
        }
      >
        <ErpFigures record={record} />
      </Section>
      <Section title="Key account plan" action={canEdit && <Button variant="ghost" icon="pencil" onClick={() => setEditing(true)}>{record.keyAccount ? 'Edit plan' : 'Make key account'}</Button>}>
        {!record.keyAccount ? (
          <p className="muted">Not a key account. Mark it as a key account to keep a one-page plan.</p>
        ) : (
          <>
            {review && review < todayKey() && (
              <InlineAlert tone="warning" title="Plan review overdue">
                The plan was due for review on {formatDate(review)}.
              </InlineAlert>
            )}
            <dl className="detail-list">
              <div className="detail-row">
                <dt>Objectives</dt>
                <dd>{record.planObjectives ? String(record.planObjectives) : <EmptyValue />}</dd>
              </div>
              <div className="detail-row">
                <dt>Key contacts</dt>
                <dd>
                  {record.planKeyContacts ? String(record.planKeyContacts) : null}
                  {decisionMakers.length > 0 && <div className="muted small">On record: {decisionMakers.map((c) => `${String(c.name)} (${masterLabel('buyingRole', c.buyingRole)})`).join(', ')}</div>}
                  {!record.planKeyContacts && !decisionMakers.length && <EmptyValue />}
                </dd>
              </div>
              <div className="detail-row">
                <dt>Risks</dt>
                <dd>{record.planRisks ? String(record.planRisks) : <EmptyValue />}</dd>
              </div>
              <div className="detail-row">
                <dt>Next review</dt>
                <dd>{review ? formatDate(review) : <EmptyValue />}</dd>
              </div>
            </dl>
            <h4 className="detail-section-title">Open opportunities</h4>
            {q.data ? <RowList rows={openOpps} ws={actor.workspaceId} empty="No open opportunities." /> : <Skeleton rows={2} />}
          </>
        )}
      </Section>
      <FormDrawer open={editing} resKey="customers" recordId={record.id} onClose={() => setEditing(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- record actions

export function CustomerActions({ actor, record, res }: RecordExtensionProps) {
  const toast = useToast();
  const [logging, setLogging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const raw = getDb().records.customers?.find((c) => c.id === record.id);
  const canErp = !!raw && (canUpdateRecord(actor, res, raw) || can(actor, 'approve.finance'));
  return (
    <>
      <Button icon="message" onClick={() => setLogging(true)} disabledReason={perm(actor, 'activities').create ? undefined : 'Your role cannot log activities'}>
        Log activity
      </Button>
      <Button icon="plus" onClick={() => setAdding(true)} disabledReason={perm(actor, 'contacts').create ? undefined : 'Your role cannot add contacts'}>
        Add contact
      </Button>
      <Button
        icon="reset"
        loading={busy}
        disabledReason={canErp ? undefined : 'Only the account owner, their managers or Accounts can refresh ERP figures'}
        title="Simulated ERP read"
        onClick={async () => {
          setBusy(true);
          try {
            const r = await refreshErp(actor, record.id);
            toast(`ERP figures refreshed (simulated): outstanding ${formatMoney(r.outstanding)}`);
          } catch (e) {
            toast(errorMessage(e), 'danger');
          } finally {
            setBusy(false);
          }
        }}
      >
        Refresh from ERP
      </Button>
      <LogActivityDialog open={logging} onClose={() => setLogging(false)} parent={{ parentResource: 'customers', parentId: record.id, parentLabel: `${record.id} · ${String(record.name)}`, customerId: record.id }} />
      <QuickCreateDialog open={adding} resKey="contacts" initial={{ customerId: record.id, divisionIds: record.divisionIds, ownerId: record.ownerId }} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />
    </>
  );
}

export function ContactActions({ actor, record }: RecordExtensionProps) {
  const [converting, setConverting] = useState(false);
  const [logging, setLogging] = useState(false);
  const converted = record.poolStatus === 'converted';
  const leadsReady = isRegistered('leads');
  return (
    <>
      <Button
        variant="primary"
        icon="arrow-up"
        onClick={() => setConverting(true)}
        disabledReason={converted ? 'Already converted to a lead' : !leadsReady ? 'Lead management is not available in this build yet' : !perm(actor, 'leads').create ? 'Your role cannot create leads' : undefined}
      >
        Convert to lead
      </Button>
      <Button icon="message" onClick={() => setLogging(true)} disabledReason={perm(actor, 'activities').create ? undefined : 'Your role cannot log activities'}>
        Log activity
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

function ConvertDialog({ actor, contact, onClose }: { actor: RecordExtensionProps['actor']; contact: RecordData; onClose: () => void }) {
  const toast = useToast();
  const pool = !contact.customerId;
  const divisions = activeMasterValues('division');
  const sales = (getDb().records.employees ?? []).filter((e) => ['sales_exec', 'sales_manager', 'division_head', 'coordinator'].includes(String(e.roleId)) && e.status !== 'inactive');
  const [v, setV] = useState({
    companyName: '',
    territoryId: '',
    billingState: '',
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
  const err = (k: string) => errors[k] && <p className="field-error">{errors[k]}</p>;
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = await convertToLead(actor, { contactId: contact.id, ...v });
      toast(`Lead ${r.leadId} created${pool ? ` with new customer ${r.customerId}` : ''}`);
      onClose();
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
      else setErrors({ form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Convert ${String(contact.name)} to a lead`}
      description={pool ? 'This contact is in the pool, so the company is created as a prospect at the same time.' : `The lead is created for ${recordTitle('customers', contact.customerId)} with this contact.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Create lead
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        {pool && (
          <>
            <div className="form-field span-all">
              <label className="field-label" htmlFor="cv-company">
                Company name <span className="req">*</span>
              </label>
              <input id="cv-company" className="input" value={v.companyName} onChange={(e) => set('companyName', e.target.value)} data-autofocus />
              {err('companyName')}
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="cv-territory">
                Territory <span className="req">*</span>
              </label>
              <SelectMenu id="cv-territory" block label="Territory" value={v.territoryId} options={activeMasterValues('territory').map((t) => ({ value: t.key, label: t.label }))} onChange={(t) => setV((x) => ({ ...x, territoryId: t, billingState: x.billingState || (activeMasterValues('territory').find((m) => m.key === t)?.parent ?? '') }))} />
              {err('territoryId')}
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="cv-state">
                State <span className="req">*</span>
              </label>
              <SelectMenu id="cv-state" block label="State" value={v.billingState} options={activeMasterValues('state').map((t) => ({ value: t.key, label: t.label }))} onChange={(t) => set('billingState', t)} />
              {err('billingState')}
            </div>
          </>
        )}
        <div className="form-field">
          <label className="field-label" htmlFor="cv-div">
            Division <span className="req">*</span>
          </label>
          <SelectMenu id="cv-div" block label="Division" value={v.divisionId} options={divisions.map((d) => ({ value: d.key, label: d.label }))} onChange={(t) => set('divisionId', t)} />
          {err('divisionId')}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-pt">
            Product interest <span className="req">*</span>
          </label>
          <SelectMenu id="cv-pt" block label="Product interest" value={v.productType} options={activeMasterValues('productType').map((d) => ({ value: d.key, label: d.label }))} onChange={(t) => set('productType', t)} />
          {err('productType')}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-owner">
            Lead owner <span className="req">*</span>
          </label>
          <SelectMenu id="cv-owner" block label="Lead owner" value={v.ownerId} options={sales.map((e) => ({ value: e.id, label: `${String(e.fullName)} — ${String(e.designation)}` }))} onChange={(t) => set('ownerId', t)} />
          {err('ownerId')}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-next">
            Next follow-up <span className="req">*</span>
          </label>
          <DatePicker id="cv-next" block value={v.nextFollowUpAt} onChange={(t) => set('nextFollowUpAt', t ?? '')} label="Next follow-up" />
          {err('nextFollowUpAt')}
        </div>
        {contact.source === 'exhibition' && (
          <div className="form-field span-all">
            <label className="field-label" htmlFor="cv-event">
              Exhibition / event <span className="req">*</span>
            </label>
            <input id="cv-event" className="input" maxLength={120} value={v.eventName} onChange={(e) => set('eventName', e.target.value)} placeholder="e.g. Gartex Texprocess, Mumbai 2026" />
            {err('eventName')}
          </div>
        )}
        <div className="form-field span-all">
          <label className="field-label" htmlFor="cv-req">
            Requirement
          </label>
          <textarea id="cv-req" className="input textarea" rows={2} maxLength={1000} value={v.requirement} onChange={(e) => set('requirement', e.target.value)} />
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
  const others = (getDb().records.customers ?? []).filter((c) => c.workspaceId === actor.workspaceId);
  const similar = fuzzyCustomerMatches(others, record.name, record.id).slice(0, 2);
  if (!similar.length) return null;
  return (
    <InlineAlert tone="warning" title="Possible duplicate">
      Looks like {similar.map((s, i) => (
        <span key={s.id}>
          {i > 0 && ', '}
          <Link to={recordPeekPath(actor.workspaceId, 'customers', s.id)}>{s.name}</Link> ({Math.round(s.score * 100)}%)
        </span>
      ))}
      .{can(actor, 'customers.merge') && (
        <>
          {' '}
          <Link to="/admin/duplicates">Review and merge</Link>
        </>
      )}
    </InlineAlert>
  );
}

export function ContactBanner({ actor, record }: RecordExtensionProps) {
  if (record.poolStatus === 'converted') {
    const lead = isRegistered('leads') ? (getDb().records.leads ?? []).find((l) => l.contactId === record.id) : undefined;
    return (
      <InlineAlert tone="success" title="Converted to a lead">
        {lead ? <Link to={recordPeekPath(actor.workspaceId, 'leads', lead.id)}>Open {lead.id}</Link> : 'The lead was created from this contact.'}
      </InlineAlert>
    );
  }
  if (!record.customerId)
    return (
      <InlineAlert tone="info" title="In the contact pool">
        Not linked to a company yet. Use “Convert to lead” when there is a real requirement.
      </InlineAlert>
    );
  return null;
}

/** Contacts tab badge count. */
export const contactCount = ({ record }: RecordExtensionProps) => (getDb().records.contacts ?? []).filter((c) => c.customerId === record.id).length;


// ---------------------------------------------------------------- address geo-tag (FR-002, simulated)

/** Approximate centres of the hub cities — fallback when the browser location is unavailable. */
const CITY_GEO: Record<string, [number, number]> = {
  mumbai: [19.076, 72.8777], pune: [18.5204, 73.8567], surat: [21.1702, 72.8311], ahmedabad: [23.0225, 72.5714], delhi: [28.6139, 77.209], 'new delhi': [28.6139, 77.209], ludhiana: [30.901, 75.8573], jaipur: [26.9124, 75.7873], tiruppur: [11.1085, 77.3411], chennai: [13.0827, 80.2707], bengaluru: [12.9716, 77.5946], hyderabad: [17.385, 78.4867], kolkata: [22.5726, 88.3639],
};

export function AddressActions({ actor, record, res }: RecordExtensionProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const raw = getDb().records.addresses?.find((a) => a.id === record.id);
  const allowed = !!raw && canUpdateRecord(actor, res, raw);
  const save = async (lat: number, lng: number, how: string) => {
    try {
      await call(() => updateRecord(actor, 'addresses', record.id, { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }, raw!.version));
      toast(`Location saved (${how})`);
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
      disabledReason={allowed ? undefined : 'Your role cannot edit this address'}
      title="Uses this device’s location when allowed; otherwise a simulated point near the city"
      onClick={() => {
        setBusy(true);
        const fallback = () => {
          const c = CITY_GEO[String(record.city ?? '').trim().toLowerCase()] ?? [20.5937, 78.9629];
          save(c[0] + (Math.random() - 0.5) * 0.02, c[1] + (Math.random() - 0.5) * 0.02, 'simulated near the city');
        };
        if (!navigator.geolocation) return fallback();
        navigator.geolocation.getCurrentPosition((p) => save(p.coords.latitude, p.coords.longitude, 'device location'), fallback, { timeout: 4000 });
      }}
    >
      Use my location
    </Button>
  );
}
