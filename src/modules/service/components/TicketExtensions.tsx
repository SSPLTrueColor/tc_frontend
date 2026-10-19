/** Service ticket record extensions: warranty / AMC + SLA banner, ticket tabs (SLA Tracking, Site Visits, Remote Support, Chargeable Service, Customer Feedback), service actions and their dialogs. */
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
import { L } from '../../../constants/labels';
import { ROUTES, toPath } from '../../../constants/routes';
import { resourcePath } from '../../../lib/routes';
import { escalationRole } from '../../../services/service/tickets';

const S = L.service;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const CLOCK_TONE: Record<ClockState['status'], Tone> = { met: 'success', breached_met: 'warning', breached: 'danger', at_risk: 'warning', running: 'info', paused: 'neutral', not_applicable: 'neutral' };
const chip = (c: ClockState) => ({ label: S.sla.chips[c.status], tone: CLOCK_TONE[c.status] });

export function clockText(c: ClockState) {
  if (c.status === 'met') return S.sla.early(formatMinutes(-c.minutes));
  if (c.status === 'breached_met') return S.sla.late(formatMinutes(c.minutes));
  if (c.status === 'breached') return S.sla.overdue(formatMinutes(c.minutes));
  if (c.status === 'paused') return S.sla.waitingCustomer;
  return S.sla.left(formatMinutes(c.minutes));
}

/** Compact SLA chips (banner, lists). */
export function SlaChips({ record }: { record: Record<string, unknown> }) {
  const states = clockStates(record, nowLocal()).filter((c) => c.status !== 'not_applicable');
  return (
    <span className="row-gap">
      {states.map((c) => (
        <span key={c.clock} data-tooltip={S.sla.dueAt(CLOCK_LABEL[c.clock], c.due ? formatDateTime(c.due) : S.sla.chips.not_applicable)}>
          <StatusChip label={`${CLOCK_LABEL[c.clock]}: ${chip(c).label}${c.status === 'met' ? '' : ` · ${clockText(c)}`}`} tone={chip(c).tone} />
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
      {cov && <StatusChip label={S.banner.coverage(cov.label)} tone={cov.tone} />}
      {open && <SlaChips record={record} />}
      {!!record.repeatOfId && <Badge tone="danger">{S.banner.repeatOf(s(record.repeatOfId))}</Badge>}
      {!!record.chargeableStatus && record.chargeableStatus !== 'none' && <Badge tone="warning">{masterValue('chargeableStatus', record.chargeableStatus)?.label}</Badge>}
      {!!record.spottedLeadId && <Badge tone="success">{S.banner.lead(s(record.spottedLeadId))}</Badge>}
    </div>
  );
}

/** SLA Tracking tab: every clock, pause total, escalation chain by role name (FR-083, SRV-09). */
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
              {c.due ? <DateText value={c.due} showTime /> : <EmptyValue />} <StatusChip label={chip(c).label} tone={chip(c).tone} /> <span className="muted small">{c.status !== 'not_applicable' && clockText(c)}</span>
              {c.metAt && (
                <div className="muted small">
                  {S.sla.metAt} <DateText value={c.metAt} showTime />
                </div>
              )}
            </dd>
          </div>
        ))}
        <div className="detail-row">
          <dt>{S.sla.paused}</dt>
          <dd>
            {Number(record.pausedMinutes ?? 0) ? formatMinutes(Number(record.pausedMinutes)) : S.sla.never} · {S.sla.pauseNote}
          </dd>
        </div>
        <div className="detail-row">
          <dt>{S.sla.escalation}</dt>
          <dd>
            <div className="small" style={{ marginBottom: 4 }}>
              {level ? S.sla.escalatedTo(escalationRole(level, s(policies.escalation[level - 1]?.to))) : S.sla.notEscalated}
            </div>
            <ol className="plain-list">
              {policies.escalation.map((e, i) => (
                <li key={`${i}-${e.to}`}>
                  {i < level ? '● ' : '○ '}
                  {escalationRole(i + 1, e.to)} <span className="muted small">({e.afterHours ? S.sla.afterBreach(e.afterHours) : S.sla.onBreach})</span>
                </li>
              ))}
            </ol>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function VisitList({ actor, visits }: { actor: RecordExtensionProps['actor']; visits: ReturnType<typeof visitsOf> }) {
  const T = S.tabContent;
  return (
    <ul className="flow-list">
      {visits.map((v) => (
        <li key={v.id} className="flow-item" style={{ alignItems: 'flex-start' }}>
          <StatusChip label={masterValue('visitStatus', v.status)?.label ?? s(v.status)} tone={masterValue('visitStatus', v.status)?.tone} />
          <Link to={resourcePath(actor.workspaceId, 'serviceVisits', { peek: v.id })} className="flow-main">
            <span className="flow-title">
              {masterValue('visitType', v.visitType)?.label} · {recordTitle('employees', v.engineerId)}
            </span>
            <span className="muted small">
              {v.checkInAt ? T.checkedIn(formatDateTime(s(v.checkInAt))) : v.travelStartAt ? T.travellingSince(formatDateTime(s(v.travelStartAt))) : ''}
              {v.checkOutAt ? T.checkedOut(formatDateTime(s(v.checkOutAt))) : ''}
              {v.checkInMock ? T.locationSimulated : ''}
            </span>
            {!!v.workDone && <span className="small">{s(v.workDone)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Site Visits tab: job cards for the service ticket (SRV-06). */
export function VisitsTab({ actor, record }: RecordExtensionProps) {
  const visits = visitsOf(record.id).filter((v) => v.visitType !== 'remote');
  if (!visits.length)
    return (
      <EmptyState icon="id-card" title={S.tabContent.noVisits}>
        {S.tabContent.noVisitsBody}
      </EmptyState>
    );
  return <VisitList actor={actor} visits={visits} />;
}

/** Remote Support tab: troubleshooting calls, total call time, session reference (SRV-07). */
export function RemoteTab({ actor, record }: RecordExtensionProps) {
  const sessions = visitsOf(record.id).filter((v) => v.visitType === 'remote');
  const F = S.fields.tickets;
  if (!sessions.length && !record.remoteSteps)
    return (
      <EmptyState icon="message" title={S.tabContent.noRemote}>
        {S.tabContent.noRemoteBody}
      </EmptyState>
    );
  return (
    <div className="help">
      <dl className="detail-list">
        <div className="detail-row">
          <dt>{S.tabContent.totalDuration}</dt>
          <dd>{record.remoteDurationMin ? S.tabContent.minutes(Number(record.remoteDurationMin)) : <EmptyValue />}</dd>
        </div>
        <div className="detail-row">
          <dt>{F.remoteSessionRef}</dt>
          <dd>{s(record.remoteSessionRef) || <EmptyValue />}</dd>
        </div>
        <div className="detail-row">
          <dt>{F.remoteSteps}</dt>
          <dd style={{ whiteSpace: 'pre-line' }}>{s(record.remoteSteps) || <EmptyValue />}</dd>
        </div>
      </dl>
      {sessions.length > 0 && (
        <>
          <h3 className="panel-title">{S.tabContent.remoteSessions}</h3>
          <VisitList actor={actor} visits={sessions} />
        </>
      )}
    </div>
  );
}

/** Chargeable Service tab: quote, customer decision, billing (SRV-10, BR-36). */
export function ChargeableTab({ record }: RecordExtensionProps) {
  const T = S.tabContent;
  const F = S.fields.tickets;
  const cs = s(record.chargeableStatus || 'none');
  const st = masterValue('chargeableStatus', cs);
  const needed = cs === 'none' && record.coverage === 'none' && !['installation', 'pm', 'training'].includes(s(record.ticketType));
  if (cs === 'none' && !needed)
    return (
      <EmptyState icon="receipt" title={T.chargeableNone}>
        {T.chargeableNoneBody}
      </EmptyState>
    );
  return (
    <div className="help">
      {needed && <InlineAlert tone="warning">{T.chargeableNeeded}</InlineAlert>}
      <dl className="detail-list">
        <div className="detail-row">
          <dt>{F.chargeableStatus}</dt>
          <dd>{st && <StatusChip label={st.label} tone={st.tone} />}</dd>
        </div>
        <div className="detail-row">
          <dt>{F.chargeableAmount}</dt>
          <dd>{record.chargeableAmount ? formatMoney(Number(record.chargeableAmount)) : <EmptyValue />}</dd>
        </div>
        <div className="detail-row">
          <dt>{F.chargeableNote}</dt>
          <dd>{s(record.chargeableNote) || <EmptyValue />}</dd>
        </div>
      </dl>
      <p className="muted small">{T.chargeableHint}</p>
    </div>
  );
}

/** Customer Feedback tab: rating, comment, feedback link and re-opens (SRV-12, SRV-15). */
export function FeedbackTab({ record }: RecordExtensionProps) {
  const T = S.tabContent;
  const F = S.fields.tickets;
  const link = record.feedbackToken ? toPath(ROUTES.feedback, { token: s(record.feedbackToken) }) : '';
  const reopens = Number(record.reopenCount ?? 0);
  if (!record.rating && !record.feedbackComment && !record.resolvedAt && !reopens)
    return (
      <EmptyState icon="star" title={T.noFeedback}>
        {T.noFeedbackBody}
      </EmptyState>
    );
  return (
    <div className="help">
      <dl className="detail-list">
        <div className="detail-row">
          <dt>{F.rating}</dt>
          <dd>{record.rating ? <StatusChip label={T.ratingOf(Number(record.rating))} tone={Number(record.rating) <= 2 ? 'danger' : 'success'} /> : <EmptyValue />}</dd>
        </div>
        <div className="detail-row">
          <dt>{F.feedbackComment}</dt>
          <dd>{s(record.feedbackComment) || <EmptyValue />}</dd>
        </div>
        {reopens > 0 && (
          <div className="detail-row">
            <dt>{F.reopenCount}</dt>
            <dd>{T.reopened(reopens)}</dd>
          </div>
        )}
        {link && (
          <div className="detail-row">
            <dt>{T.feedbackLink}</dt>
            <dd>
              <a className="link" href={link} target="_blank" rel="noreferrer">
                {T.openFeedbackLink}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </div>
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
  const Mn = S.menu;
  const A = S.actions;
  const items: MenuItem[] = [
    { id: 'remote', label: A.recordRemoteSupport, icon: 'message', disabledReason: !open ? Mn.notOpen : !(desk || assignee) ? Mn.engineerOrDesk : undefined, onSelect: () => setDialog('remote') },
    { id: 'quote', label: A.chargeableQuote, icon: 'receipt', separatorBefore: true, disabledReason: !(chargeable || assignee) ? Mn.deskOrEngineer : cs === 'billing_requested' ? Mn.billingAlready : undefined, onSelect: () => setDialog('quote') },
    { id: 'approved', label: A.customerApproved, icon: 'check', disabledReason: !chargeable ? Mn.deskOnly : cs !== 'quoted' ? Mn.quoteFirst : undefined, onSelect: () => void run(serviceApi.chargeableDecision(actor, record.id, true), S.toasts.approvalRecorded) },
    { id: 'declined', label: A.customerDeclined, icon: 'x', disabledReason: !chargeable ? Mn.deskOnly : cs !== 'quoted' ? Mn.quoteFirst : undefined, onSelect: () => void run(serviceApi.chargeableDecision(actor, record.id, false), S.toasts.decisionRecorded) },
    { id: 'billing', label: A.requestBilling, icon: 'send', disabledReason: !chargeable ? Mn.deskOnly : cs !== 'approved' ? Mn.approvalFirst : undefined, onSelect: () => void run(serviceApi.billing(actor, record.id), S.toasts.billingSent) },
    { id: 'waive', label: A.waiveCharges, icon: 'shield', disabledReason: !can(actor, 'approve.service') ? Mn.leadershipOnly : ['billing_requested', 'waived'].includes(cs) ? Mn.notNow : undefined, onSelect: () => setDialog('waive') },
    { id: 'spotted', label: A.opportunitySpottedMenu, icon: 'sparkles', separatorBefore: true, disabledReason: record.spottedLeadId ? Mn.leadExists(s(record.spottedLeadId)) : !(desk || assignee) ? Mn.deskOrEngineer : undefined, onSelect: () => setDialog('spotted') },
    { id: 'jobcard', label: A.openJobCard, icon: 'scroll-text', onSelect: () => window.open(toPath(ROUTES.jobCard, { recordId: record.id }), '_blank') },
    { id: 'resend', label: A.resendJobCard, icon: 'send', disabledReason: record.resolvedAt ? undefined : Mn.afterResolved, onSelect: () => void run(serviceApi.resendJobCard(actor, record.id), S.toasts.jobCardResent) },
  ];
  return (
    <>
      {desk && open && (
        <Button icon="users" onClick={() => setDialog('assign')}>
          {record.assigneeId ? A.reassignEngineer : A.assignEngineer}
        </Button>
      )}
      <Button icon="message" onClick={() => setDialog('activity')}>
        {A.logActivity}
      </Button>
      <Button ref={ref} iconRight="chevron-down" aria-haspopup="menu" onClick={() => setMenu(true)}>
        {A.serviceMenu}
      </Button>
      <Menu open={menu} onClose={() => setMenu(false)} anchor={ref} label={A.serviceMenuLabel} items={items} />
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

/** Assign Engineer with Suggest Engineer: ranked by skill, territory, model experience, workload and availability (FR-079). */
export function AssignDialog({ ticketId, current, onClose }: { ticketId: string; current?: string; onClose: () => void }) {
  const actor = useActor();
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pick, setPick] = useState(current || '');
  const { busy, errors, submit } = useSubmit(onClose);
  const best = list?.find((x) => !x.blocked)?.engineer.id;
  const load = () => {
    setLoadError('');
    setList(null);
    serviceApi
      .suggest(actor, ticketId)
      .then((l) => {
        setList(l);
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
      title={S.assign.title(ticketId)}
      description={S.assign.description}
      footer={
        <>
          <Button icon="sparkles" disabledReason={!best ? S.assign.none : undefined} onClick={() => best && setPick(best)}>
            {S.actions.suggestEngineer}
          </Button>
          <Button onClick={onClose}>{S.actions.cancel}</Button>
          <Button variant="primary" loading={busy} disabledReason={!pick ? S.assign.chooseEngineer : pick === current ? S.assign.alreadyAssigned : undefined} onClick={() => submit(() => serviceApi.assign(actor, ticketId, pick), S.toasts.assigned)}>
            {S.actions.assign}
          </Button>
        </>
      }
    >
      {loadError ? (
        <ErrorState title={S.assign.loadError} onRetry={load}>
          {loadError}
        </ErrorState>
      ) : !list ? (
        <Skeleton rows={4} />
      ) : !list.length ? (
        <EmptyState icon="users" title={S.assign.none} />
      ) : (
        <ul className="menu" role="radiogroup" aria-label={S.assign.listLabel} style={{ maxHeight: 360, overflowY: 'auto' }}>
          {list.map((x) => (
            <li key={x.engineer.id}>
              <button type="button" role="radio" aria-checked={pick === x.engineer.id} className={`menu-item${pick === x.engineer.id ? ' is-current' : ''}`} disabled={!!x.blocked} data-tooltip={x.blocked} onClick={() => setPick(x.engineer.id)}>
                <span className="menu-label">
                  {x.engineer.name}
                  <span className="menu-reason">{x.blocked ?? x.reasons.join(' · ')}</span>
                </span>
                {!x.blocked && x.engineer.id === best && <Badge tone="accent">{S.assign.suggested}</Badge>}
                {!x.blocked && <Badge tone={x.score >= 5 ? 'success' : 'neutral'}>{S.assign.score(x.score)}</Badge>}
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
      title={S.remote.title(ticketId)}
      description={S.remote.description}
      footer={
        <>
          <Button onClick={onClose}>{S.actions.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => submit(() => serviceApi.remote(actor, ticketId, { steps, durationMin: Number(duration), sessionRef: ref, outcome }), outcome === 'site_visit' ? S.toasts.convertedToSiteVisit : S.toasts.remoteRecorded)}>
            {outcome === 'site_visit' ? S.actions.convertToSiteVisit : S.actions.saveSession}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field span-all">
          <span className="field-label-row">
            <label className="field-label" htmlFor="rs-steps">
              {S.remote.steps} <span className="req">*</span>
            </label>
            <VoiceButton onText={(t) => setSteps((x) => (x ? `${x} ${t}` : t))} />
          </span>
          <textarea id="rs-steps" className="input textarea" rows={4} maxLength={2000} value={steps} onChange={(e) => setSteps(e.target.value)} aria-invalid={!!errors.steps || undefined} data-autofocus />
          {errors.steps && <p className="field-error">{errors.steps}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="rs-dur">
            {S.remote.duration} <span className="req">*</span>
          </label>
          <input id="rs-dur" className="input" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} aria-invalid={!!errors.durationMin || undefined} />
          {errors.durationMin && <p className="field-error">{errors.durationMin}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="rs-ref">
            {S.remote.ref}
          </label>
          <input id="rs-ref" className="input" maxLength={60} placeholder={S.remote.refPlaceholder} value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
        <fieldset className="form-field span-all">
          <legend className="field-label">{S.remote.outcome}</legend>
          <div className="segmented">
            {(['continue', 'resolved', 'site_visit'] as const).map((k) => [k, S.remote.outcomes[k]] as const).map(([k, l]) => (
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
      title={S.quote.title(ticketId)}
      description={S.quote.description}
      footer={
        <>
          <Button onClick={onClose}>{S.actions.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => submit(() => serviceApi.quote(actor, ticketId, Number(amount), note), S.toasts.quoteSent)}>
            {S.actions.sendQuote}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label className="field-label" htmlFor="cq-amt">
            {S.quote.amount} <span className="req">*</span>
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
            {S.quote.note} <span className="req">*</span>
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
      title={S.waive.title(ticketId)}
      description={S.waive.description}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            {S.actions.cancel}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => submit(() => serviceApi.waive(actor, ticketId, reason), S.toasts.waived)}>
            {S.actions.waiveChargesConfirm}
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="wv-reason">
          {S.waive.reason} <span className="req">*</span>
        </label>
        <textarea id="wv-reason" className="input textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason || undefined} />
        {errors.reason && <p className="field-error">{errors.reason}</p>}
        <FormError text={errors.form && !errors.reason ? errors.form : undefined} />
      </div>
    </Dialog>
  );
}

const INTERESTS = (['new_machine', 'upgrade', 'consumables', 'amc'] as const).map((value) => ({ value, label: S.spotted.interests[value] }));

export function SpottedDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const actor = useActor();
  const [interest, setInterest] = useState<(typeof INTERESTS)[number]['value']>('consumables');
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
      title={S.spotted.title}
      description={S.spotted.description}
      footer={
        <>
          <Button onClick={onClose}>{S.actions.cancel}</Button>
          <Button variant="primary" loading={busy} disabledReason={leadsAvailable ? undefined : S.spotted.leadsUnavailable} onClick={() => submit(() => serviceApi.spotted(actor, ticketId, { interest, note }), S.toasts.leadCreated)}>
            {S.actions.createLead}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label className="field-label" htmlFor="os-int">
            {S.spotted.interest}
          </label>
          <SelectMenu id="os-int" block label={S.spotted.interestLabel} value={interest} options={INTERESTS} onChange={setInterest} />
        </div>
        <div className="form-field">
          <span className="field-label-row">
            <label className="field-label" htmlFor="os-note">
              {S.spotted.note} <span className="req">*</span>
            </label>
            <VoiceButton onText={(t) => setNote((x) => (x ? `${x} ${t}` : t))} />
          </span>
          <textarea id="os-note" className="input textarea" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!errors.note || undefined} data-autofocus />
          {errors.note && <p className="field-error">{errors.note}</p>}
        </div>
        {!leadsAvailable && <InlineAlert tone="warning">{S.spotted.leadsNotLoaded}</InlineAlert>}
        <FormError text={errors.form && !errors.note ? errors.form : undefined} />
      </div>
    </Dialog>
  );
}
