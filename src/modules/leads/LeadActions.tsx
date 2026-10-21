import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addDays, formatDate, todayKey } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { leadsApi } from '../../services/api/leads';
import { canUpdateRecord } from '../../services/authz';
import { getPolicies } from '../../services/policies';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { ServiceError } from '../../services/types';
import { hasResource, leadLabel, needsFirstContact, safeTitle, validateFirstContact, type FirstContactInput, type QualifyInput } from '../../services/leads/rules';
import { isFollowUpDue, isNotAttended } from '../../domain/modules/leads/computed';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { Button, IconButton } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { Dialog, Menu, type MenuItem } from '../../components/primitives/overlay';
import { Icon } from '../../components/primitives/Icon';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { L } from '../../constants/labels';

const A = L.leads.actions;
const D = L.leads.dialogs;
const B = L.leads.banners;
const FL = L.leads.fields.leads;
import { VoiceButton } from '../../components/crm/VoiceButton';
import { LinkButton, TextField, Textarea } from '../../components/primitives/controls';
import { NumberInput } from '../../components/primitives/NumberInput';
import { NUMBER_LIMITS } from '../../services/validation';

const OPEN = ['new', 'contacted', 'nurture'];

/**
 * Lead record actions. Primary buttons are the next steps forward only: Create Opportunity (LEAD-10, always
 * offered on an open lead — a New lead logs its first contact inside the same dialog), Reactivate on a Nurture
 * lead (LEAD-11) and Log Follow-up (BR-07). Nurture / Disqualify sit in the "More" menu.
 */
export function LeadActions({ res, actor, record }: RecordExtensionProps) {
  const [dialog, setDialog] = useState<null | 'log' | 'convert' | 'nurture' | 'disqualify' | 'reactivate'>(null);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const status = String(record.status);
  const canEdit = canUpdateRecord(actor, res, record);
  const why = canEdit ? undefined : D.readOnlyFor(actor.role.label);
  if (status === 'qualified') {
    return record.opportunityId && hasResource('opportunities') ? <LinkButton to={recordPeekPath(actor.workspaceId, 'opportunities', String(record.opportunityId))}>{A.openOpportunity(String(record.opportunityId))}</LinkButton> : null;
  }
  if (!OPEN.includes(status)) return null;
  const label = leadLabel(record, actor);
  const isNurture = status === 'nurture';
  const menuItems: MenuItem[] = [
    ...(isNurture
      ? []
      : [
          {
            id: 'nurture',
            label: A.nurture,
            icon: 'pause',
            disabledReason: why,
            onSelect: () => setDialog('nurture'),
          },
        ]),
    {
      id: 'disqualify',
      label: A.disqualify,
      icon: 'ban',
      danger: true,
      separatorBefore: !isNurture,
      disabledReason: why,
      onSelect: () => setDialog('disqualify'),
    },
  ];
  return (
    <>
      <Button icon="target" variant="primary" onClick={() => setDialog('convert')} disabledReason={why ?? (!hasResource('opportunities') ? D.noOpportunities : undefined)}>
        {A.convertToOpportunity}
      </Button>
      {isNurture && (
        <Button icon="refresh" onClick={() => setDialog('reactivate')} disabledReason={why}>
          {A.reactivate}
        </Button>
      )}
      <Button icon="message" onClick={() => setDialog('log')}>
        {A.logFollowUp}
      </Button>
      <Button ref={moreRef} iconRight="chevron-down" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}>
        {A.more}
      </Button>
      <Menu open={menu} onClose={() => setMenu(false)} anchor={moreRef} label={A.moreLabel} items={menuItems} />
      <LogActivityDialog
        open={dialog === 'log'}
        onClose={() => setDialog(null)}
        title={A.logFollowUp}
        requireNextFollowUp
        parent={{
          parentResource: 'leads',
          parentId: record.id,
          parentLabel: label,
          customerId: record.customerId as string | undefined,
        }}
      />
      {dialog === 'convert' && <ConvertDialog actor={actor} record={record} res={res} onClose={() => setDialog(null)} />}
      {dialog === 'reactivate' && <ReactivateDialog actor={actor} record={record} res={res} onClose={() => setDialog(null)} />}
      {dialog === 'nurture' && <NurtureDialog actor={actor} record={record} res={res} onClose={() => setDialog(null)} />}
      {dialog === 'disqualify' && <DisqualifyDialog actor={actor} record={record} res={res} onClose={() => setDialog(null)} />}
    </>
  );
}

/** List row / board card action: Create Opportunity (LEAD-10) — New / Nurture leads go through the combined flow. */
export function LeadCardActions({ actor, record, res }: RecordExtensionProps) {
  const [open, setOpen] = useState(false);
  if (!OPEN.includes(String(record.status)) || !hasResource('opportunities') || !canUpdateRecord(actor, res, record)) return null;
  return (
    <>
      <IconButton icon="target" className="convert-icon-btn" label={A.convertToOpportunity} onClick={() => setOpen(true)} />
      {open && <ConvertDialog actor={actor} record={record} res={res} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Status changes from the list / board that need details (LEAD-09…11): Contacted = log the first follow-up
 * (or Reactivate a Nurture lead), Qualified = Create Opportunity (combined flow for New / Nurture leads),
 * Nurture / Disqualified = their dialogs. Same rules as the record actions.
 */
export function leadMoveTargets({ actor, res, record }: RecordExtensionProps): string[] {
  if (!canUpdateRecord(actor, res, record)) return [];
  const status = String(record.status);
  const out: string[] = [];
  if (['new', 'nurture'].includes(status)) out.push('contacted');
  if (OPEN.includes(status) && hasResource('opportunities')) out.push('qualified');
  if (['new', 'contacted'].includes(status)) out.push('nurture');
  if (OPEN.includes(status)) out.push('disqualified');
  return out;
}

export function LeadMoveDialog({ actor, res, record, to, onClose }: RecordExtensionProps & { to: string; onClose: () => void }) {
  if (to === 'contacted' && String(record.status) === 'nurture') return <ReactivateDialog actor={actor} record={record} res={res} onClose={onClose} />;
  if (to === 'contacted')
    return (
      <LogActivityDialog
        open
        onClose={onClose}
        title={A.logFollowUp}
        requireNextFollowUp
        parent={{
          parentResource: 'leads',
          parentId: record.id,
          parentLabel: leadLabel(record, actor),
          customerId: record.customerId as string | undefined,
        }}
      />
    );
  if (to === 'qualified') return <ConvertDialog actor={actor} record={record} res={res} onClose={onClose} />;
  if (to === 'nurture') return <NurtureDialog actor={actor} record={record} res={res} onClose={onClose} />;
  if (to === 'disqualified') return <DisqualifyDialog actor={actor} record={record} res={res} onClose={onClose} />;
  return null;
}

const TIMELINE_DAYS: Record<string, number> = {
  immediate: 30,
  '1_3m': 75,
  '3_6m': 135,
  '6_12m': 270,
  '12m_plus': 365,
};

function Field({ id, label, required, error, children }: { id: string; label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="form-field">
      <label className="field-label" htmlFor={id}>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/**
 * Create Opportunity (LEAD-10). A New lead (or a Nurture lead never contacted) first logs the first contact
 * in the same modal — "1 First contact → 2 Opportunity details" — which moves it to Contacted (Appendix A).
 * A Nurture lead is reactivated to Contacted (audited) together with the conversion.
 */
function ConvertDialog({ actor, record, onClose }: RecordExtensionProps & { onClose: () => void }) {
  const toast = useToast();
  const customer = safeTitle('customers', record.customerId, actor);
  const withContactStep = useRef(needsFirstContact(record)).current;
  const [step, setStep] = useState(withContactStep ? 0 : 1);
  // Version to convert against: step 1 bumps it when the first contact is logged.
  const [version, setVersion] = useState(record.version);
  const [status, setStatus] = useState(String(record.status));
  const [fc, setFc] = useState<FirstContactInput>({
    activityType: 'call',
    subject: D.convert.firstContactSubject,
    notes: '',
    nextFollowUpAt: addDays(todayKey(), 1),
  });
  const [q, setQ] = useState<QualifyInput>({
    requirement: String(record.requirement ?? ''),
    budget: Number(record.budget ?? 0),
    decisionMaker: String(record.decisionMaker ?? ''),
    timeline: String(record.timeline ?? ''),
    currentSetup: String(record.currentSetup ?? ''),
    opportunityName: D.convert.defaultName(customer, masterLabel('productType', record.productType), record.subType ? masterLabel('productSubType', record.subType) : ''),
    value: Number(record.budget ?? 0),
    expectedCloseDate: addDays(todayKey(), TIMELINE_DAYS[String(record.timeline)] ?? 60),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof QualifyInput>(k: K, v: QualifyInput[K]) => setQ((x) => ({ ...x, [k]: v }));
  const setF = <K extends keyof FirstContactInput>(k: K, v: FirstContactInput[K]) => setFc((x) => ({ ...x, [k]: v }));
  const inFlight = useRef(false);
  // The timeline only suggests a close date until the user picks one themselves.
  const closeTouched = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const saveContact = () => {
    const e = validateFirstContact(fc);
    setErrors(e);
    if (Object.keys(e).length) return;
    void run(async () => {
      const lead = await leadsApi.logContact(actor, record.id, fc);
      toast(L.common.toasts.activityLogged);
      setVersion(lead.version);
      setStatus(String(lead.status));
      setErrors({});
      setStep(1);
    });
  };
  const submit = () =>
    run(async () => {
      const out = await leadsApi.convertWithFirstContact(actor, record.id, version, q);
      toast(D.convert.done(record.id, out.opportunityId));
      onClose();
    });
  const contactStep = step === 0;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={D.convert.title(record.id)}
      description={contactStep ? D.convert.firstContactDescription : D.convert.description(getPolicies().stageProbability.needs_assessment ?? 10)}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          {contactStep ? (
            <Button variant="primary" loading={busy} onClick={saveContact}>
              {A.saveAndContinue}
            </Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={submit}>
              {D.convert.submit}
            </Button>
          )}
        </>
      }
    >
      {withContactStep && <ConvertSteps step={step} />}
      {contactStep ? (
        <div className="form-grid cols-2">
          <Field id="fc-type" label={L.common.activity.type} required error={errors.activityType}>
            <SelectMenu
              id="fc-type"
              block
              label={L.common.activity.type}
              value={fc.activityType}
              options={activeMasterValues('activityType').map((v) => ({
                value: v.key,
                label: v.label,
              }))}
              onChange={(v) => setF('activityType', v)}
            />
          </Field>
          <Field id="fc-next" label={L.common.activity.nextFollowUp} required error={errors.nextFollowUpAt}>
            <DatePicker id="fc-next" block value={fc.nextFollowUpAt} onChange={(v) => setF('nextFollowUpAt', v ?? '')} label={L.common.activity.nextFollowUp} />
          </Field>
          <div className="form-field span-all">
            <label className="field-label" htmlFor="fc-subject">
              {D.convert.outcome} <span className="req">*</span>
            </label>
            <TextField id="fc-subject" maxLength={140} value={fc.subject} onChange={(e) => setF('subject', e.target.value)} aria-invalid={!!errors.subject || undefined} data-autofocus />
            {errors.subject && <p className="field-error">{errors.subject}</p>}
          </div>
          <div className="form-field span-all">
            <span className="field-label-row">
              <label className="field-label" htmlFor="fc-notes">
                {L.common.activity.notes}
              </label>
              <VoiceButton onText={(t) => setF('notes', fc.notes ? `${fc.notes} ${t}` : t)} label={L.common.voice.dictateNotes} />
            </span>
            <Textarea id="fc-notes" className="textarea" rows={2} maxLength={2000} value={fc.notes} onChange={(e) => setF('notes', e.target.value)} />
          </div>
          {errors.form && (
            <p className="field-error span-all" role="alert">
              {errors.form}
            </p>
          )}
        </div>
      ) : (
        <>
          {status === 'nurture' && <InlineAlert tone="info">{D.convert.nurtureNote}</InlineAlert>}
          <div className="form-grid cols-2">
            <div className="form-field span-all">
              <span className="field-label-row">
                <label className="field-label" htmlFor="q-need">
                  {FL.requirement} <span className="req">*</span>
                </label>
                <VoiceButton onText={(t) => set('requirement', q.requirement ? `${q.requirement} ${t}` : t)} label={D.convert.dictate} />
              </span>
              <Textarea id="q-need" className="textarea" rows={2} maxLength={2000} value={q.requirement} onChange={(e) => set('requirement', e.target.value)} aria-invalid={!!errors.requirement || undefined} data-autofocus />
              {errors.requirement && <p className="field-error">{errors.requirement}</p>}
            </div>
            <Field id="q-budget" label={D.convert.budget} required error={errors.budget}>
              <NumberInput id="q-budget" rule={NUMBER_LIMITS.amount} invalid={!!errors.budget} value={q.budget || null} onValueChange={(n) => set('budget', n ?? 0)} />
            </Field>
            <Field id="q-dm" label={FL.decisionMaker} required error={errors.decisionMaker}>
              <TextField id="q-dm" maxLength={80} value={q.decisionMaker} onChange={(e) => set('decisionMaker', e.target.value)} />
            </Field>
            <Field id="q-tl" label={FL.timeline} required error={errors.timeline}>
              <SelectMenu
                id="q-tl"
                block
                label={FL.timeline}
                value={q.timeline}
                options={activeMasterValues('purchaseTimeline').map((v) => ({
                  value: v.key,
                  label: v.label,
                }))}
                onChange={(v) =>
                  setQ((x) => ({
                    ...x,
                    timeline: v,
                    expectedCloseDate: closeTouched.current ? x.expectedCloseDate : addDays(todayKey(), TIMELINE_DAYS[v] ?? 60),
                  }))
                }
              />
            </Field>
            <Field id="q-setup" label={FL.currentSetup}>
              <TextField id="q-setup" maxLength={120} value={q.currentSetup} onChange={(e) => set('currentSetup', e.target.value)} />
            </Field>
            <div className="form-field span-all">
              <label className="field-label" htmlFor="q-name">
                {D.convert.opportunityName} <span className="req">*</span>
              </label>
              <TextField id="q-name" maxLength={120} value={q.opportunityName} onChange={(e) => set('opportunityName', e.target.value)} />
              {errors.opportunityName && <p className="field-error">{errors.opportunityName}</p>}
            </div>
            <Field id="q-value" label={D.convert.value} required error={errors.value}>
              <NumberInput id="q-value" rule={NUMBER_LIMITS.amount} invalid={!!errors.value} value={q.value || null} onValueChange={(n) => set('value', n ?? 0)} />
            </Field>
            <Field id="q-close" label={D.convert.expectedCloseDate} required error={errors.expectedCloseDate}>
              <DatePicker
                id="q-close"
                block
                value={q.expectedCloseDate}
                onChange={(v) => {
                  closeTouched.current = true;
                  set('expectedCloseDate', v ?? '');
                }}
                label={D.convert.expectedCloseDate}
              />
            </Field>
            {errors.form && (
              <p className="field-error span-all" role="alert">
                {errors.form}
              </p>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

/** "1 First contact → 2 Opportunity details" rail (same markup as the record form wizard). */
function ConvertSteps({ step }: { step: number }) {
  return (
    <ol className="wizard-steps" aria-label={D.convert.steps.label}>
      {[D.convert.steps.firstContact, D.convert.steps.details].map((t, i) => (
        <li key={t} className={i === step ? 'is-current' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
          <span className="wizard-num">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
          {t}
        </li>
      ))}
    </ol>
  );
}

/** LEAD-11: Nurture → Contacted with the next follow-up date (BR-07). */
function ReactivateDialog({ actor, record, onClose }: RecordExtensionProps & { onClose: () => void }) {
  const toast = useToast();
  const [next, setNext] = useState(addDays(todayKey(), 1));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!next) return setError(L.common.activity.nextRequired);
    if (next < todayKey()) return setError(L.common.activity.notPast);
    setBusy(true);
    try {
      await leadsApi.reactivate(actor, record.id, record.version, next, note);
      toast(D.reactivate.done(record.id, formatDate(next)));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={D.reactivate.title(record.id)}
      description={D.reactivate.description}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {A.reactivate}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="r-next" label={FL.nextFollowUpAt} required error={error || undefined}>
          <DatePicker id="r-next" block value={next} onChange={(v) => setNext(v ?? '')} label={FL.nextFollowUpAt} />
        </Field>
        <Field id="r-note" label={D.reactivate.note}>
          <Textarea id="r-note" className="textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function NurtureDialog({ actor, record, onClose }: RecordExtensionProps & { onClose: () => void }) {
  const toast = useToast();
  const [until, setUntil] = useState(addDays(todayKey(), 90));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={D.nurture.title(record.id)}
      description={D.nurture.description}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await leadsApi.nurture(actor, record.id, record.version, until, note);
                toast(D.nurture.done(record.id, formatDate(until)));
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {A.moveToNurture}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="n-until" label={FL.nurtureUntil} required>
          <DatePicker id="n-until" block value={until} onChange={(v) => setUntil(v ?? '')} label={FL.nurtureUntil} />
        </Field>
        <Field id="n-note" label={D.nurture.note}>
          <Textarea id="n-note" className="textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function DisqualifyDialog({ actor, record, onClose }: RecordExtensionProps & { onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      role="alertdialog"
      title={D.disqualify.title(record.id)}
      description={D.disqualify.description}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            {A.keepOpen}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await leadsApi.disqualify(actor, record.id, record.version, reason, note);
                toast(D.disqualify.done(record.id, masterLabel('lostReason', reason)));
                onClose();
              } catch (e) {
                setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {A.disqualify}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="d-reason" label={D.disqualify.reason} required error={errors.reason}>
          <SelectMenu
            id="d-reason"
            block
            label={D.disqualify.reason}
            value={reason}
            invalid={!!errors.reason}
            options={activeMasterValues('lostReason').map((v) => ({
              value: v.key,
              label: v.label,
            }))}
            onChange={setReason}
          />
        </Field>
        <Field id="d-note" label={D.disqualify.note} required={reason === 'other'} error={errors.note}>
          <Textarea id="d-note" className="textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {errors.form && (
          <p className="field-error" role="alert">
            {errors.form}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Status-dependent banner: SLA breach, overdue follow-up, conversion, nurture, disqualification. */
export function LeadBanner({ actor, record }: RecordExtensionProps) {
  const status = String(record.status);
  if (status === 'qualified')
    return (
      <InlineAlert tone="success" title={B.qualifiedTitle}>
        {B.qualifiedBody} {record.opportunityId && hasResource('opportunities') ? <Link to={recordPeekPath(actor.workspaceId, 'opportunities', String(record.opportunityId))}>{String(record.opportunityId)}</Link> : String(record.opportunityId ?? '')}.{' '}
        {B.readOnly}
      </InlineAlert>
    );
  if (status === 'disqualified')
    return (
      <InlineAlert tone="info" title={B.disqualifiedTitle(masterLabel('lostReason', record.disqualifyReason))}>
        {record.statusNote ? String(record.statusNote) : B.disqualifiedBody}
      </InlineAlert>
    );
  if (isNotAttended(record))
    return (
      <InlineAlert tone="danger" title={B.notAttendedTitle}>
        {B.notAttendedBody(getPolicies().leadFirstContactHours)}
      </InlineAlert>
    );
  if (status === 'nurture' && record.nurtureUntil)
    return (
      <InlineAlert tone="info" title={B.nurtureTitle(formatDate(String(record.nurtureUntil)))}>
        {record.statusNote ? `${String(record.statusNote)} · ` : ''}
        {B.nurtureBody}
      </InlineAlert>
    );
  if (isFollowUpDue(record) && String(record.nextFollowUpAt) < todayKey())
    return (
      <InlineAlert tone="warning" title={B.overdueTitle}>
        {B.overdueBody(formatDate(String(record.nextFollowUpAt)))}
      </InlineAlert>
    );
  if (status === 'new')
    return (
      <InlineAlert tone="info" title={B.newLeadTitle}>
        {B.newLeadBody}
      </InlineAlert>
    );
  return null;
}
