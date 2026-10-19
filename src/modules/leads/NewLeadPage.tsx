import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addDays, todayKey } from '../../lib/dates';
import { resourcePath, recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { leadsApi } from '../../services/api/leads';
import { canReadRecord, fieldAccessMap, perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { useActor } from '../../services/hooks';
import { activeMasterValues, getResource } from '../../services/registry';
import { ServiceError } from '../../services/types';
import { validateValues } from '../../services/validation';
import { findDuplicateCustomers, findDuplicateLeads, hasResource, safeTitle, type NewCompanyInput, type NewContactInput } from '../../services/leads/rules';
import { Button } from '../../components/primitives/Button';
import { InlineAlert, NoAccess, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { FormSections } from '../../components/resource/FormFields';
import { initialValues } from '../../components/resource/RecordForm';
import { PageHeader } from '../../components/shell/PageHeader';

type Values = Record<string, unknown>;
const EMPTY_COMPANY: NewCompanyInput = { name: '', city: '', state: '', territoryId: '', gstin: '', industry: '' };
const EMPTY_CONTACT: NewContactInput = { name: '', mobile: '', email: '', designation: '' };

/** LEAD-01: register a lead from an existing or new company/contact without leaving the screen. */
export function NewLeadPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const res = getResource('leads');
  const access = useMemo(() => fieldAccessMap(actor, res, 'create'), [actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<Values>(() => initialValues(res, { divisionId: actor.divisionIds[0], nextFollowUpAt: addDays(todayKey(), 1) }));
  const [companyMode, setCompanyMode] = useState<'existing' | 'new'>('existing');
  const [contactMode, setContactMode] = useState<'existing' | 'new'>('existing');
  const [company, setCompany] = useState<NewCompanyInput>(EMPTY_COMPANY);
  const [contact, setContact] = useState<NewContactInput>(EMPTY_CONTACT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const setValue = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v, ...(k === 'customerId' ? { contactId: null } : {}), ...(k === 'divisionId' ? { ownerId: null } : {}) }));

  const partyReady = hasResource('customers') && hasResource('contacts');
  const customers = useMemo(() => (partyReady ? (getDb().records.customers ?? []).filter((c) => canReadRecord(actor, getResource('customers'), c)) : []), [partyReady, actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const contacts = useMemo(() => (partyReady && values.customerId ? (getDb().records.contacts ?? []).filter((c) => c.customerId === values.customerId) : []), [partyReady, values.customerId]);
  const owners = (getDb().records.employees ?? []).filter((e) => e.status !== 'inactive' && ((e.divisionIds as string[]) ?? []).includes(String(values.divisionId)));
  const ownerEditable = access.ownerId === 'edit';

  const dupLeads = useMemo(
    () => findDuplicateLeads(actor, { customerId: companyMode === 'existing' ? (values.customerId as string) : undefined, contactId: contactMode === 'existing' ? (values.contactId as string) : undefined, divisionId: values.divisionId as string, mobile: contactMode === 'new' ? contact.mobile : undefined, email: contactMode === 'new' ? contact.email : undefined, companyName: companyMode === 'new' ? company.name : undefined }),
    [actor, values.customerId, values.contactId, values.divisionId, companyMode, contactMode, contact.mobile, contact.email, company.name],
  );
  const dupCompanies = companyMode === 'new' && company.name.trim().length >= 4 ? findDuplicateCustomers(company.name, company.gstin) : [];

  if (!perm(actor, 'leads').create) return <NoAccess what="creating leads" />;

  const save = async () => {
    const newCompany = companyMode === 'new' ? company : null;
    const newContact = companyMode === 'new' || contactMode === 'new' ? contact : null;
    const editable = new Set(Object.entries(access).filter(([, a]) => a === 'edit').map(([k]) => k));
    if (newCompany) editable.delete('customerId');
    if (newContact) editable.delete('contactId');
    const client = validateValues(res, { ...values, status: 'new' }, editable);
    setErrors(client);
    if (Object.keys(client).length) {
      setMessage('Please fix the highlighted fields.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const out = await leadsApi.create(actor, values, newCompany, newContact);
      toast(`Lead ${out.record.id} created`);
      navigate(recordPeekPath(actor.workspaceId, 'leads', out.record.id));
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => errors[k] && <p className="field-error">{errors[k]}</p>;

  return (
    <div className="page">
      <PageHeader
        title="New lead"
        description="Only company, contact, division, source, product interest and the next follow-up date are required. Everything else can be added later."
        actions={
          <>
            <Button onClick={() => navigate(resourcePath(actor.workspaceId, 'leads'))}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabledReason={partyReady ? undefined : 'Needs the Customers module'}>
              Create lead
            </Button>
          </>
        }
      />
      <div className="content-surface record-form">
        {!partyReady && (
          <InlineAlert tone="warning" title="Companies are not available yet">
            Leads belong to a company and a contact person. The Customers module is not published in this build, so leads cannot be created here yet.
          </InlineAlert>
        )}
        {message && (
          <InlineAlert tone="danger" title="Not saved">
            {message}
          </InlineAlert>
        )}
        {(dupLeads.visible.length > 0 || dupLeads.hidden > 0) && (
          <InlineAlert tone="warning" title="Possible duplicate">
            An open lead already exists for this company or contact in this division:{' '}
            {dupLeads.visible.map((l, i) => (
              <span key={l.id}>
                {i > 0 && ', '}
                <Link to={recordPeekPath(actor.workspaceId, 'leads', l.id)}>{l.id}</Link>
              </span>
            ))}
            {dupLeads.hidden > 0 && ` ${dupLeads.hidden} lead(s) owned by another team`}. You can still create this lead.
          </InlineAlert>
        )}

        <fieldset className="form-section">
          <legend className="sr-only">Company and contact</legend>
          <div className="form-grid">
            <div className="form-field span-all">
              <span className="field-label">Company</span>
              <div className="segmented" role="radiogroup" aria-label="Company">
                {(['existing', 'new'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={companyMode === m}
                    className={`seg-btn${companyMode === m ? ' is-on' : ''}`}
                    onClick={() => {
                      setCompanyMode(m);
                      if (m === 'new') setContactMode('new');
                    }}
                  >
                    {m === 'existing' ? 'Existing company' : '+ New company'}
                  </button>
                ))}
              </div>
            </div>
            {companyMode === 'existing' ? (
              <div className="form-field">
                <label className="field-label" htmlFor="nl-cust">
                  Company <span className="req">*</span>
                </label>
                <SelectMenu id="nl-cust" block searchable label="Company" value={(values.customerId as string) ?? ''} invalid={!!errors.customerId} options={customers.map((c) => ({ value: c.id, label: `${String(c.name)} · ${c.id}` }))} onChange={(v) => setValue('customerId', v)} placeholder={customers.length ? 'Search companies…' : 'No companies yet'} />
                {err('customerId')}
              </div>
            ) : (
              <>
                <div className="form-field">
                  <label className="field-label" htmlFor="nc-name">
                    Company name <span className="req">*</span>
                  </label>
                  <input id="nc-name" className="input" maxLength={120} value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} aria-invalid={!!errors['company.name'] || undefined} />
                  {err('company.name')}
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="nc-city">
                    City <span className="req">*</span>
                  </label>
                  <input id="nc-city" className="input" maxLength={60} value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} />
                  {err('company.city')}
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="nc-state">
                    State <span className="req">*</span>
                  </label>
                  <SelectMenu
                    id="nc-state"
                    block
                    searchable
                    label="State"
                    value={company.state}
                    options={activeMasterValues('state').map((s) => ({ value: s.key, label: s.label }))}
                    onChange={(v) => setCompany({ ...company, state: v, territoryId: activeMasterValues('territory').find((t) => t.parent === v)?.key ?? company.territoryId })}
                  />
                  {err('company.state')}
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="nc-terr">
                    Territory / hub <span className="req">*</span>
                  </label>
                  <SelectMenu id="nc-terr" block label="Territory" value={company.territoryId} options={activeMasterValues('territory').map((s) => ({ value: s.key, label: s.label }))} onChange={(v) => setCompany({ ...company, territoryId: v })} />
                  {err('company.territoryId')}
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="nc-gstin">
                    GSTIN <span className="optional">(optional)</span>
                  </label>
                  <input id="nc-gstin" className="input" maxLength={15} value={company.gstin} onChange={(e) => setCompany({ ...company, gstin: e.target.value.toUpperCase() })} />
                </div>
                {dupCompanies.length > 0 && (
                  <div className="span-all">
                    <InlineAlert tone="warning" title="This company may already exist">
                      {dupCompanies.slice(0, 3).map((c) => (
                        <Button
                          key={c.id}
                          onClick={() => {
                            setCompanyMode('existing');
                            setContactMode('existing');
                            setValue('customerId', c.id);
                          }}
                        >
                          Use {String(c.name)} ({c.id})
                        </Button>
                      ))}
                    </InlineAlert>
                  </div>
                )}
              </>
            )}
            {companyMode === 'existing' && (
              <div className="form-field">
                <span className="field-label-row">
                  <label className="field-label" htmlFor="nl-contact">
                    Contact person <span className="req">*</span>
                  </label>
                  <button type="button" className="link small" onClick={() => setContactMode(contactMode === 'existing' ? 'new' : 'existing')}>
                    {contactMode === 'existing' ? '+ New contact' : 'Pick existing'}
                  </button>
                </span>
                {contactMode === 'existing' && (
                  <SelectMenu id="nl-contact" block label="Contact person" value={(values.contactId as string) ?? ''} invalid={!!errors.contactId} options={contacts.map((c) => ({ value: c.id, label: `${String(c.name)}${c.designation ? ` · ${String(c.designation)}` : ''}` }))} onChange={(v) => setValue('contactId', v)} placeholder={values.customerId ? (contacts.length ? 'Select…' : 'No contacts — add a new one') : 'Pick the company first'} disabled={!values.customerId} />
                )}
                {contactMode === 'existing' && err('contactId')}
              </div>
            )}
            {(companyMode === 'new' || contactMode === 'new') && (
              <>
                <div className="form-field">
                  <label className="field-label" htmlFor="nk-name">
                    Contact name <span className="req">*</span>
                  </label>
                  <input id="nk-name" className="input" maxLength={80} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                  {err('contact.name')}
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="nk-desig">
                    Designation <span className="optional">(optional)</span>
                  </label>
                  <input id="nk-desig" className="input" maxLength={80} value={contact.designation} onChange={(e) => setContact({ ...contact, designation: e.target.value })} />
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="nk-mobile">
                    Mobile
                  </label>
                  <input id="nk-mobile" className="input" inputMode="tel" maxLength={16} value={contact.mobile} onChange={(e) => setContact({ ...contact, mobile: e.target.value })} />
                  {err('contact.mobile')}
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="nk-email">
                    Email
                  </label>
                  <input id="nk-email" className="input" type="email" maxLength={120} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                  {err('contact.email')}
                </div>
              </>
            )}
            {ownerEditable && (
              <div className="form-field">
                <label className="field-label" htmlFor="nl-owner">
                  Owner <span className="optional">(optional — auto-assign)</span>
                </label>
                <SelectMenu
                  id="nl-owner"
                  block
                  searchable
                  label="Owner"
                  value={(values.ownerId as string) ?? ''}
                  invalid={!!errors.ownerId}
                  options={[{ value: '', label: 'Assign automatically' }, ...owners.map((e) => ({ value: e.id, label: `${String(e.fullName)} · ${String(e.designation)}` }))]}
                  onChange={(v) => setValue('ownerId', v || null)}
                />
                {err('ownerId')}
              </div>
            )}
          </div>
        </fieldset>
        <FormSections res={res} fieldKeys={['divisionId', 'nextFollowUpAt']} values={values} setValue={setValue} errors={errors} access={access} actor={actor} />
        <FormSections res={res} sectionIds={['source', 'need', 'bant', 'where']} values={values} setValue={setValue} errors={errors} access={access} actor={actor} />
        {!!values.customerId && companyMode === 'existing' && <p className="muted small">Company: {safeTitle('customers', values.customerId, actor)}</p>}
      </div>
    </div>
  );
}
