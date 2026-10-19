/** Ticket record extensions: coverage + SLA banner, SLA and Visits tabs, service actions and their dialogs. */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { nowLocal, formatDateTime } from '../../../lib/dates';
import { formatMoney } from '../../../lib/format';
import { errorMessage } from '../../../services/api/client';
import { serviceApi } from '../../../services/api/service';
import { can } from '../../../services/authz';
import { getPolicies } from '../../../services/policies';
import { masterValue, getResource } from '../../../services/registry';
import { useActor } from '../../../services/hooks';
import { visitsOf } from '../../../services/service/jobs';
import { CLOCK_LABEL, clockStates, formatMinutes, type ClockState } from '../../../services/service/sla';
import { OPEN_STATUSES } from '../../../services/service/tickets';
import type { Suggestion } from '../../../services/service/board';
import { ServiceError } from '../../../services/types';
import type { RecordExtensionProps } from '../../../components/resource/extensions';
import { Button } from '../../../components/primitives/Button';
import { DateText, EmptyValue } from '../../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../../components/primitives/feedback';
import { Dialog, Menu, type MenuItem } from '../../../components/primitives/overlay';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import { LogActivityDialog } from '../../../components/crm/LogActivityDialog';
import { VoiceButton } from '../../../components/crm/VoiceButton';
import { recordTitle } from '../../../services/runtime';
import type { Tone } from '../../../metadata/types';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const CLOCK_CHIP: Record<ClockState['status'], { label: string; tone: Tone }> = {
  met: { label: 'Met', tone: 'success' },
  breached_met: { label: 'Met late', tone: 'warning' },
  breached: { label: 'Breached', tone: 'danger' },
  at_risk: { label: 'At risk', tone: 'warning' },
  running: { label: 'On track', tone: 'info' },
  paused: { label: 'Paused', tone: 'neutral' },
  not_applicable: { label: 'N/A', tone: 'neutral' },
};

export function clockText(c: ClockState) {
  if (c.status === 'met') return `${formatMinutes(-c.minutes)} early`;
  if (c.status === 'breached_met') return `${formatMinutes(c.minutes)} late`;
  if (c.status === 'breached') return `${formatMinutes(c.minutes)} overdue`;
  if (c.status === 'paused') return 'waiting for customer';
  return `${formatMinutes(c.minutes)} left`;
}

/** Compact SLA chips (banner, lists). */
export function SlaChips({ record }: { record: Record<string, unknown> }) {
  const states = clockStates(record, nowLocal()).filter((c) => c.status !== 'not_applicable');
  return (
    <span className="row-gap">
      {states.map((c) => (
        <span key={c.clock} data-tooltip={`${CLOCK_LABEL[c.clock]} due ${c.due ? formatDateTime(c.due) : 'N/A'}`}>
          <StatusChip label={`${CLOCK_LABEL[c.clock]}: ${CLOCK_CHIP[c.status].label}${c.status === 'met' ? '' : ` · ${clockText(c)}`}`} tone={CLOCK_CHIP[c.status].tone} />
        </span>
      ))}
    </span>
  );
}

export function TicketBanner({ record }: RecordExtensionProps) {
  const cov = masterValue('coverage', record.coverage);
  const open = OPEN_STATUSES.includes(s(record.status));
  return (
    <div className="row-gap" style={{ flexWrap: 'wrap', gap: 6, margin: '4px 0 8px' }}>
      {cov && <StatusChip label={`Coverage: ${cov.label}`} tone={cov.tone} />}
      {open && <SlaChips record={record} />}
      {!!record.repeatOfId && <Badge tone="danger">Repeat of {s(record.repeatOfId)}</Badge>}
      {!!record.chargeableStatus && record.chargeableStatus !== 'none' && <Badge tone="warning">{masterValue('chargeableStatus', record.chargeableStatus)?.label}</Badge>}
      {!!record.spottedLeadId && <Badge tone="success">Lead {s(record.spottedLeadId)}</Badge>}
    </div>
  );
}

/** SLA tab: every clock, pause total, escalation chain (FR-083). */
export function SlaTab({ record }: RecordExtensionProps) {
  const states = clockStates(record, nowLocal());
  const policies = getPolicies();
  const level = Number(record.escalationLevel ?? 0);
  return (
    <div className="help">
      <dl className="detail-list">
        {states.map((c) => (
          <div key={c.clock} className="detail-row">
            <dt>{CLOCK_LABEL[c.clock]}</dt>
            <dd>
              {c.due ? <DateText value={c.due} showTime /> : <EmptyValue />} <StatusChip label={CLOCK_CHIP[c.status].label} tone={CLOCK_CHIP[c.status].tone} /> <span className="muted small">{c.status !== 'not_applicable' && clockText(c)}</span>
              {c.metAt && (
                <div className="muted small">
                  Met at <DateText value={c.metAt} showTime />
                </div>
              )}
            </dd>
          </div>
        ))}
        <div className="detail-row">
          <dt>Paused</dt>
          <dd>{Number(record.pausedMinutes ?? 0) ? formatMinutes(Number(record.pausedMinutes)) : 'Never'} · the clocks pause only while waiting for the customer</dd>
        </div>
        <div className="detail-row">
          <dt>Escalation</dt>
          <dd>
            <ol className="plain-list">
              {policies.escalation.map((e, i) => (
                <li key={e.to}>
                  {i < level ? '● ' : '○ '}
                  {e.to} <span className="muted small">({e.afterHours ? `${e.afterHours} h after breach` : 'on breach'})</span>
                </li>
              ))}
            </ol>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Visits tab: job cards and remote sessions for the ticket. */
export function VisitsTab({ record }: RecordExtensionProps) {
  const visits = visitsOf(record.id);
  if (!visits.length) return <EmptyState icon="id-card" title="No visits yet">The engineer’s travel, check-in and job card appear here.</EmptyState>;
  return (
    <ul className="flow-list">
      {visits.map((v) => (
        <li key={v.id} className="flow-item" style={{ alignItems: 'flex-start' }}>
          <StatusChip label={masterValue('visitStatus', v.status)?.label ?? s(v.status)} tone={masterValue('visitStatus', v.status)?.tone} />
          <Link to={`/serviceVisits?peek=${v.id}`} className="flow-main">
            <span className="flow-title">
              {masterValue('visitType', v.visitType)?.label} · {recordTitle('employees', v.engineerId)}
            </span>
            <span className="muted small">
              {v.checkInAt ? `In ${formatDateTime(s(v.checkInAt))}` : v.travelStartAt ? `Travelling since ${formatDateTime(s(v.travelStartAt))}` : ''}
              {v.checkOutAt ? ` · Out ${formatDateTime(s(v.checkOutAt))}` : ''}
              {v.checkInMock ? ' · location simulated' : ''}
            </span>
            {!!v.workDone && <span className="small">{s(v.workDone)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- actions

type DialogKind = 'assign' | 'activity' | 'remote' | 'quote' | 'waive' | 'spotted' | null;

export function TicketActions({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const open = OPEN_STATUSES.includes(s(record.status));
  const desk = can(actor, 'ticket.assign');
  const assignee = record.assigneeId === actor.staffId;
  const chargeable = can(actor, 'ticket.chargeable');
  const cs = s(record.chargeableStatus || 'none');
  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast(ok);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };
  const items: MenuItem[] = [
    { id: 'remote', label: 'Record remote support…', icon: 'message', disabledReason: !open ? 'Ticket is not open' : !(desk || assignee) ? 'Only the engineer or service desk' : undefined, onSelect: () => setDialog('remote') },
    { id: 'quote', label: 'Chargeable quote…', icon: 'receipt', separatorBefore: true, disabledReason: !(chargeable || assignee) ? 'Service desk or assigned engineer only' : cs === 'billing_requested' ? 'Billing already requested' : undefined, onSelect: () => setDialog('quote') },
    { id: 'approved', label: 'Customer approved the quote', icon: 'check', disabledReason: !chargeable ? 'Service desk only' : cs !== 'quoted' ? 'Send a quote first' : undefined, onSelect: () => void run(serviceApi.chargeableDecision(actor, record.id, true), 'Customer approval recorded') },
    { id: 'declined', label: 'Customer declined the quote', icon: 'x', disabledReason: !chargeable ? 'Service desk only' : cs !== 'quoted' ? 'Send a quote first' : undefined, onSelect: () => void run(serviceApi.chargeableDecision(actor, record.id, false), 'Customer decision recorded') },
    { id: 'billing', label: 'Request billing in ERP', icon: 'send', disabledReason: !chargeable ? 'Service desk only' : cs !== 'approved' ? 'Needs customer approval first (BR-36)' : undefined, onSelect: () => void run(serviceApi.billing(actor, record.id), 'Billing request sent to ERP (simulated)') },
    { id: 'waive', label: 'Waive charges…', icon: 'shield', disabledReason: !can(actor, 'approve.service') ? 'Service leadership only' : ['billing_requested', 'waived'].includes(cs) ? 'Not applicable now' : undefined, onSelect: () => setDialog('waive') },
    { id: 'spotted', label: 'Opportunity spotted…', icon: 'sparkles', separatorBefore: true, disabledReason: record.spottedLeadId ? `Lead ${s(record.spottedLeadId)} already created` : !(desk || assignee) ? 'Assigned engineer or service desk' : undefined, onSelect: () => setDialog('spotted') },
    { id: 'jobcard', label: 'Open job card', icon: 'scroll-text', onSelect: () => window.open(`/tickets/${record.id}/job-card`, '_blank') },
    { id: 'resend', label: 'Re-send job card & feedback link', icon: 'send', disabledReason: record.resolvedAt ? undefined : 'Available after the ticket is resolved', onSelect: () => void run(serviceApi.resendJobCard(actor, record.id), 'Job card and feedback link re-sent (see Message outbox)') },
  ];
  return (
    <>
      {desk && open && (
        <Button icon="users" onClick={() => setDialog('assign')}>
          {record.assigneeId ? 'Re-assign' : 'Assign engineer'}
        </Button>
      )}
      <Button icon="message" onClick={() => setDialog('activity')}>
        Log activity
      </Button>
      <Button ref={ref} iconRight="chevron-down" aria-haspopup="menu" onClick={() => setMenu(true)}>
        Service
      </Button>
      <Menu open={menu} onClose={() => setMenu(false)} anchor={ref} label="Service actions" items={items} />
      {dialog === 'assign' && <AssignDialog ticketId={record.id} current={s(record.assigneeId)} onClose={() => setDialog(null)} />}
      {dialog === 'activity' && (
        <LogActivityDialog
          open
          onClose={() => setDialog(null)}
          parent={{ parentResource: 'tickets', parentId: record.id, parentLabel: `${record.id} · ${recordTitle('customers', record.customerId)}`, customerId: s(record.customerId) || undefined }}
        />
      )}
      {dialog === 'remote' && <RemoteDialog ticketId={record.id} onClose={() => setDialog(null)} />}
      {dialog === 'quote' && <QuoteDialog ticketId={record.id} onClose={() => setDialog(null)} />}
      {dialog === 'waive' && <WaiveDialog ticketId={record.id} onClose={() => setDialog(null)} />}
      {dialog === 'spotted' && <SpottedDialog ticketId={record.id} onClose={() => setDialog(null)} />}
    </>
  );
}

function useSubmit(onClose: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (p: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setErrors({});
    try {
      await p();
      toast(ok);
      onClose();
    } catch (e) {
      setErrors(e instanceof ServiceError && e.fieldErrors ? { ...e.fieldErrors, form: e.message } : { form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, submit };
}

const FormError = ({ text }: { text?: string }) =>
  text ? (
    <p className="field-error span-all" role="alert">
      {text}
    </p>
  ) : null;

/** Assign with suggestions ranked by skill, territory, model experience, workload and availability (FR-079). */
export function AssignDialog({ ticketId, current, onClose }: { ticketId: string; current?: string; onClose: () => void }) {
  const actor = useActor();
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pick, setPick] = useState(current || '');
  const { busy, errors, submit } = useSubmit(onClose);
  const load = () => {
    setLoadError('');
    setList(null);
    serviceApi
      .suggest(actor, ticketId)
      .then((l) => {
        setList(l);
        if (!current) setPick(l.find((x) => !x.blocked)?.engineer.id ?? '');
      })
      .catch((e) => setLoadError(errorMessage(e)));
  };
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    load();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Assign engineer · ${ticketId}`}
      description="Suggestions rank engineers by division skill, territory, experience with this model, open workload and availability today."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabledReason={!pick ? 'Choose an engineer' : pick === current ? 'Already assigned' : undefined} onClick={() => submit(() => serviceApi.assign(actor, ticketId, pick), 'Engineer assigned and notified')}>
            Assign
          </Button>
        </>
      }
    >
      {loadError ? (
        <ErrorState title="Could not load engineers" onRetry={load}>
          {loadError}
        </ErrorState>
      ) : !list ? (
        <Skeleton rows={4} />
      ) : !list.length ? (
        <EmptyState icon="users" title="No engineers in your scope" />
      ) : (
        <ul className="menu" role="radiogroup" aria-label="Engineers" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {list.map((x) => (
            <li key={x.engineer.id}>
              <button type="button" role="radio" aria-checked={pick === x.engineer.id} className={`menu-item${pick === x.engineer.id ? ' is-current' : ''}`} disabled={!!x.blocked} data-tooltip={x.blocked} onClick={() => setPick(x.engineer.id)}>
                <span className="menu-label">
                  {x.engineer.name}
                  <span className="menu-reason">{x.blocked ?? x.reasons.join(' · ')}</span>
                </span>
                {!x.blocked && <Badge tone={x.score >= 5 ? 'success' : 'neutral'}>Score {x.score}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <FormError text={errors.form} />
    </Dialog>
  );
}

function RemoteDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const actor = useActor();
  const [steps, setSteps] = useState('');
  const [duration, setDuration] = useState('');
  const [ref, setRef] = useState('');
  const [outcome, setOutcome] = useState<'continue' | 'resolved' | 'site_visit'>('continue');
  const { busy, errors, submit } = useSubmit(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Remote support · ${ticketId}`}
      description="Records the troubleshooting call. If it could not be fixed remotely, convert it to a site visit."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => submit(() => serviceApi.remote(actor, ticketId, { steps, durationMin: Number(duration), sessionRef: ref, outcome }), outcome === 'site_visit' ? 'Converted to a site visit' : 'Remote session recorded')}>
            Save session
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field span-all">
          <span className="field-label-row">
            <label className="field-label" htmlFor="rs-steps">
              Troubleshooting steps <span className="req">*</span>
            </label>
            <VoiceButton onText={(t) => setSteps((x) => (x ? `${x} ${t}` : t))} />
          </span>
          <textarea id="rs-steps" className="input textarea" rows={4} maxLength={2000} value={steps} onChange={(e) => setSteps(e.target.value)} aria-invalid={!!errors.steps || undefined} data-autofocus />
          {errors.steps && <p className="field-error">{errors.steps}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="rs-dur">
            Call duration (min) <span className="req">*</span>
          </label>
          <input id="rs-dur" className="input" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} aria-invalid={!!errors.durationMin || undefined} />
          {errors.durationMin && <p className="field-error">{errors.durationMin}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="rs-ref">
            Remote session reference
          </label>
          <input id="rs-ref" className="input" maxLength={60} placeholder="e.g. AnyDesk 482 119 330" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
        <fieldset className="form-field span-all">
          <legend className="field-label">Outcome</legend>
          <div className="segmented">
            {(
              [
                ['continue', 'Still working'],
                ['resolved', 'Fixed remotely'],
                ['site_visit', 'Needs site visit'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={`seg-btn${outcome === k ? ' is-on' : ''}`} aria-pressed={outcome === k} onClick={() => setOutcome(k)}>
                {l}
              </button>
            ))}
          </div>
        </fieldset>
        <FormError text={errors.form} />
      </div>
    </Dialog>
  );
}

function QuoteDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const actor = useActor();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const { busy, errors, submit } = useSubmit(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Chargeable quote · ${ticketId}`}
      description="For machines without warranty or contract (BR-36). The quote goes to the customer by WhatsApp (simulated); work is billed only after they approve."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => submit(() => serviceApi.quote(actor, ticketId, Number(amount), note), 'Quote sent to the customer (see Message outbox)')}>
            Send quote
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label className="field-label" htmlFor="cq-amt">
            Amount (excl. GST) <span className="req">*</span>
          </label>
          <div className="input-affix">
            <span className="affix affix-start">₹</span>
            <input id="cq-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={!!errors.amount || undefined} data-autofocus />
          </div>
          {amount && Number(amount) > 0 && <span className="muted small">{formatMoney(Number(amount))}</span>}
          {errors.amount && <p className="field-error">{errors.amount}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cq-note">
            Visit charges and parts <span className="req">*</span>
          </label>
          <textarea id="cq-note" className="input textarea" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!errors.note || undefined} />
          {errors.note && <p className="field-error">{errors.note}</p>}
        </div>
        <FormError text={errors.form} />
      </div>
    </Dialog>
  );
}

function WaiveDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const actor = useActor();
  const [reason, setReason] = useState('');
  const { busy, errors, submit } = useSubmit(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      role="alertdialog"
      title={`Waive charges on ${ticketId}?`}
      description="The visit will not be billed. The reason is recorded in the audit log."
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => submit(() => serviceApi.waive(actor, ticketId, reason), 'Charges waived')}>
            Waive charges
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="wv-reason">
          Reason <span className="req">*</span>
        </label>
        <textarea id="wv-reason" className="input textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason || undefined} />
        {errors.reason && <p className="field-error">{errors.reason}</p>}
        <FormError text={errors.form && !errors.reason ? errors.form : undefined} />
      </div>
    </Dialog>
  );
}

const INTERESTS = [
  { value: 'new_machine', label: 'New / additional machine' },
  { value: 'upgrade', label: 'Upgrade (heads, RIP, width)' },
  { value: 'consumables', label: 'Ink / paper / fabric' },
  { value: 'amc', label: 'AMC / CMC contract' },
];

export function SpottedDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const actor = useActor();
  const [interest, setInterest] = useState('consumables');
  const [note, setNote] = useState('');
  const { busy, errors, submit } = useSubmit(onClose);
  const leadsAvailable = (() => {
    try {
      getResource('leads');
      return true;
    } catch {
      return false;
    }
  })();
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Opportunity spotted"
      description="Creates a lead for the customer’s sales owner with you as the referrer. You are told when it converts."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabledReason={leadsAvailable ? undefined : 'Leads are not available in this build yet'} onClick={() => submit(() => serviceApi.spotted(actor, ticketId, { interest, note }), 'Lead created for the sales owner')}>
            Create lead
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label className="field-label" htmlFor="os-int">
            Customer is interested in
          </label>
          <SelectMenu id="os-int" block label="Interest" value={interest} options={INTERESTS} onChange={setInterest} />
        </div>
        <div className="form-field">
          <span className="field-label-row">
            <label className="field-label" htmlFor="os-note">
              What did you notice? <span className="req">*</span>
            </label>
            <VoiceButton onText={(t) => setNote((x) => (x ? `${x} ${t}` : t))} />
          </span>
          <textarea id="os-note" className="input textarea" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!errors.note || undefined} data-autofocus />
          {errors.note && <p className="field-error">{errors.note}</p>}
        </div>
        {!leadsAvailable && <InlineAlert tone="warning">Leads module not loaded.</InlineAlert>}
        <FormError text={errors.form && !errors.note ? errors.form : undefined} />
      </div>
    </Dialog>
  );
}
