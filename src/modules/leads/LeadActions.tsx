import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addDays, formatDate, todayKey } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { leadsApi } from '../../services/api/leads';
import { canUpdateRecord } from '../../services/authz';
import { getPolicies } from '../../services/policies';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { ServiceError } from '../../services/types';
import { hasResource, leadLabel, safeTitle, type QualifyInput } from '../../services/leads/rules';
import { isFollowUpDue, isNotAttended } from '../../domain/modules/leads/computed';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { VoiceButton } from '../../components/crm/VoiceButton';

const OPEN = ['new', 'contacted', 'nurture'];

/** Lead record actions: Log activity (BR-07), Qualify (LEAD-10), Nurture / Disqualify (LEAD-11). */
export function LeadActions({ res, actor, record }: RecordExtensionProps) {
  const [dialog, setDialog] = useState<null | 'log' | 'qualify' | 'nurture' | 'disqualify'>(null);
  const status = String(record.status);
  const canEdit = canUpdateRecord(actor, res, record);
  const why = canEdit ? undefined : `Read-only for ${actor.role.label}`;
  if (status === 'qualified') {
    return record.opportunityId && hasResource('opportunities') ? (
      <Link className="btn btn-secondary" to={recordPeekPath(actor.workspaceId, 'opportunities', String(record.opportunityId))}>
        <span className="btn-label">Open opportunity {String(record.opportunityId)}</span>
      </Link>
    ) : null;
  }
  const label = leadLabel(record, actor);
  return (
    <>
      {OPEN.includes(status) && (
        <Button icon="message" onClick={() => setDialog('log')}>
          Log activity
        </Button>
      )}
      {['new', 'contacted'].includes(status) && (
        <>
          <Button variant="primary" onClick={() => setDialog('qualify')} disabledReason={why ?? (hasResource('opportunities') ? undefined : 'Opportunities module not available yet')}>
            Qualify
          </Button>
          <Button onClick={() => setDialog('nurture')} disabledReason={why}>
            Nurture
          </Button>
        </>
      )}
      {OPEN.includes(status) && (
        <Button onClick={() => setDialog('disqualify')} disabledReason={why}>
          Disqualify
        </Button>
      )}
      <LogActivityDialog open={dialog === 'log'} onClose={() => setDialog(null)} requireNextFollowUp parent={{ parentResource: 'leads', parentId: record.id, parentLabel: label, customerId: record.customerId as string | undefined }} />
      {dialog === 'qualify' && <QualifyDialog actor={actor} record={record} res={res} onClose={() => setDialog(null)} />}
      {dialog === 'nurture' && <NurtureDialog actor={actor} record={record} res={res} onClose={() => setDialog(null)} />}
      {dialog === 'disqualify' && <DisqualifyDialog actor={actor} record={record} res={res} onClose={() => setDialog(null)} />}
    </>
  );
}

const TIMELINE_DAYS: Record<string, number> = { immediate: 30, '1_3m': 75, '3_6m': 135, '6_12m': 270, '12m_plus': 365 };

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

function QualifyDialog({ actor, record, onClose }: RecordExtensionProps & { onClose: () => void }) {
  const toast = useToast();
  const customer = safeTitle('customers', record.customerId, actor);
  const [q, setQ] = useState<QualifyInput>({
    requirement: String(record.requirement ?? ''),
    budget: Number(record.budget ?? 0),
    decisionMaker: String(record.decisionMaker ?? ''),
    timeline: String(record.timeline ?? ''),
    currentSetup: String(record.currentSetup ?? ''),
    opportunityName: `${customer} – ${masterLabel('productType', record.productType)}${record.subType ? ` (${masterLabel('productSubType', record.subType)})` : ''}`,
    value: Number(record.budget ?? 0),
    expectedCloseDate: addDays(todayKey(), TIMELINE_DAYS[String(record.timeline)] ?? 60),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof QualifyInput>(k: K, v: QualifyInput[K]) => setQ((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      const out = await leadsApi.qualify(actor, record.id, record.version, q);
      toast(`${record.id} qualified — opportunity ${out.opportunityId} created`);
      onClose();
    } catch (e) {
      setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Qualify ${record.id}`}
      description={`Confirms the need, budget, decision maker and timeline (BANT-lite) and creates an opportunity with this lead’s company, contact, owner and history. The lead then becomes read-only. Stage probability starts at ${getPolicies().stageProbability.needs_assessment ?? 10}%.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Qualify and create opportunity
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field span-all">
          <span className="field-label-row">
            <label className="field-label" htmlFor="q-need">
              Customer requirement (need) <span className="req">*</span>
            </label>
            <VoiceButton onText={(t) => set('requirement', q.requirement ? `${q.requirement} ${t}` : t)} label="Dictate requirement" />
          </span>
          <textarea id="q-need" className="input textarea" rows={2} maxLength={2000} value={q.requirement} onChange={(e) => set('requirement', e.target.value)} aria-invalid={!!errors.requirement || undefined} data-autofocus />
          {errors.requirement && <p className="field-error">{errors.requirement}</p>}
        </div>
        <Field id="q-budget" label="Budget (₹)" required error={errors.budget}>
          <input id="q-budget" className="input" type="number" min={0} value={q.budget || ''} onChange={(e) => set('budget', Number(e.target.value))} />
        </Field>
        <Field id="q-dm" label="Decision maker" required error={errors.decisionMaker}>
          <input id="q-dm" className="input" maxLength={80} value={q.decisionMaker} onChange={(e) => set('decisionMaker', e.target.value)} />
        </Field>
        <Field id="q-tl" label="Purchase timeline" required error={errors.timeline}>
          <SelectMenu
            id="q-tl"
            block
            label="Purchase timeline"
            value={q.timeline}
            options={activeMasterValues('purchaseTimeline').map((v) => ({ value: v.key, label: v.label }))}
            onChange={(v) => setQ((x) => ({ ...x, timeline: v, expectedCloseDate: addDays(todayKey(), TIMELINE_DAYS[v] ?? 60) }))}
          />
        </Field>
        <Field id="q-setup" label="Current set-up / competitor machine">
          <input id="q-setup" className="input" maxLength={120} value={q.currentSetup} onChange={(e) => set('currentSetup', e.target.value)} />
        </Field>
        <div className="form-field span-all">
          <label className="field-label" htmlFor="q-name">
            Opportunity name <span className="req">*</span>
          </label>
          <input id="q-name" className="input" maxLength={120} value={q.opportunityName} onChange={(e) => set('opportunityName', e.target.value)} />
          {errors.opportunityName && <p className="field-error">{errors.opportunityName}</p>}
        </div>
        <Field id="q-value" label="Expected value (₹)" required error={errors.value}>
          <input id="q-value" className="input" type="number" min={0} value={q.value || ''} onChange={(e) => set('value', Number(e.target.value))} />
        </Field>
        <Field id="q-close" label="Expected close date" required error={errors.expectedCloseDate}>
          <DatePicker id="q-close" block value={q.expectedCloseDate} onChange={(v) => set('expectedCloseDate', v ?? '')} label="Expected close date" />
        </Field>
        {errors.form && (
          <p className="field-error span-all" role="alert">
            {errors.form}
          </p>
        )}
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
      title={`Nurture ${record.id}`}
      description="For leads that are interested but not ready to buy. The lead stays open and you are reminded on the re-contact date."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await leadsApi.nurture(actor, record.id, record.version, until, note);
                toast(`${record.id} moved to Nurture until ${formatDate(until)}`);
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Move to Nurture
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="n-until" label="Re-contact on" required>
          <DatePicker id="n-until" block value={until} onChange={(v) => setUntil(v ?? '')} label="Re-contact on" />
        </Field>
        <Field id="n-note" label="Note">
          <textarea id="n-note" className="input textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
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
      title={`Disqualify ${record.id}?`}
      description="Closes the lead with a reason from the master list. Only a manager can reactivate it later."
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            Keep lead open
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await leadsApi.disqualify(actor, record.id, record.version, reason, note);
                toast(`${record.id} disqualified (${masterLabel('lostReason', reason)})`);
                onClose();
              } catch (e) {
                setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Disqualify
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="d-reason" label="Reason" required error={errors.reason}>
          <SelectMenu id="d-reason" block label="Reason" value={reason} invalid={!!errors.reason} options={activeMasterValues('lostReason').map((v) => ({ value: v.key, label: v.label }))} onChange={setReason} />
        </Field>
        <Field id="d-note" label="Note" required={reason === 'other'} error={errors.note}>
          <textarea id="d-note" className="input textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
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
      <InlineAlert tone="success" title="Qualified">
        Converted to opportunity{' '}
        {record.opportunityId && hasResource('opportunities') ? <Link to={recordPeekPath(actor.workspaceId, 'opportunities', String(record.opportunityId))}>{String(record.opportunityId)}</Link> : String(record.opportunityId ?? '')}. This lead is read-only.
      </InlineAlert>
    );
  if (status === 'disqualified')
    return (
      <InlineAlert tone="info" title={`Disqualified — ${masterLabel('lostReason', record.disqualifyReason)}`}>
        {record.statusNote ? String(record.statusNote) : 'Only a manager can reactivate this lead.'}
      </InlineAlert>
    );
  if (isNotAttended(record))
    return (
      <InlineAlert tone="danger" title="Not attended">
        No contact logged within {getPolicies().leadFirstContactHours} hours of creation — the owner’s manager has been alerted. Log the first contact now.
      </InlineAlert>
    );
  if (status === 'nurture' && record.nurtureUntil)
    return (
      <InlineAlert tone="info" title={`Nurture until ${formatDate(String(record.nurtureUntil))}`}>
        {record.statusNote ? String(record.statusNote) : 'Re-contact on this date, then reactivate or close the lead.'}
      </InlineAlert>
    );
  if (isFollowUpDue(record) && String(record.nextFollowUpAt) < todayKey())
    return (
      <InlineAlert tone="warning" title="Follow-up overdue">
        Planned for {formatDate(String(record.nextFollowUpAt))}. Log the activity and set the next follow-up date.
      </InlineAlert>
    );
  return null;
}
