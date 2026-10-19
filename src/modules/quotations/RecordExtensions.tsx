/** Quotation record extensions: actions, banner and tabs in the side panel / record page. */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate, formatDateTime, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { call, errorMessage } from '../../services/api/client';
import { useActor } from '../../services/hooks';
import { quotationsApi } from '../../services/api/quotations';
import { perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { byId } from '../../services/lookups';
import { discountApprovalLevels, getPolicies } from '../../services/policies';
import { activeMasterValues, getUser, masterValue } from '../../services/registry';
import { queryRecords, updateRecord } from '../../services/runtime';
import { roi } from '../../services/quotations/pricing';
import { getQuote } from '../../services/quotations/workflow';
import { ServiceError } from '../../services/types';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { Button, IconButton } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { Dialog, Menu } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { LinesTable, TotalsBlock } from './LinesTable';

type Props = RecordExtensionProps;

// ---------------------------------------------------------------- actions

export function QuoteActions({ actor, record }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [dialog, setDialog] = useState<'' | 'submit' | 'send' | 'accept' | 'reject' | 'revise' | 'pullback'>('');
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const raw = (getDb().records.quotations ?? []).find((q) => q.id === record.id);
  if (!raw) return null;
  const status = String(raw.status);
  const latest = !!raw.isLatest;
  const canUpdate = (() => {
    try {
      return getQuote(actor, record.id).canUpdate;
    } catch {
      return false;
    }
  })();
  const ro = canUpdate ? undefined : `Read-only for ${actor.role.label}`;
  const expired = String(raw.validUntil) < todayKey();
  const revisions = (getDb().records.quotations ?? []).filter((q) => String(q.rootId || q.id) === String(raw.rootId || raw.id)).length;

  const primary: JSX.Element[] = [];
  if (!latest) {
    const newest = (getDb().records.quotations ?? []).find((q) => String(q.rootId || q.id) === String(raw.rootId || raw.id) && q.isLatest);
    if (newest) primary.push(<Button key="latest" icon="chevron-right" onClick={() => navigate(`/quotations?peek=${newest.id}`)}>Open latest ({String(newest.quoteNo)})</Button>);
  } else if (status === 'draft') {
    primary.push(
      <Button key="submit" variant="primary" onClick={() => setDialog('submit')} disabledReason={ro}>
        Submit
      </Button>,
      <Button key="edit" icon="pencil" onClick={() => navigate(`/quotations/${record.id}/edit`)} disabledReason={ro}>
        Edit lines
      </Button>,
    );
  } else if (status === 'pending_approval') {
    primary.push(
      <Button key="pull" onClick={() => setDialog('pullback')} disabledReason={ro}>
        Pull back to draft
      </Button>,
    );
  } else if (status === 'approved') {
    primary.push(
      <Button key="send" variant="primary" icon="send" onClick={() => setDialog('send')} disabledReason={ro ?? (expired ? 'Validity has ended — revise first' : undefined)}>
        Send
      </Button>,
    );
  } else if (status === 'sent' || status === 'negotiation') {
    primary.push(
      <Button key="accept" variant="primary" onClick={() => setDialog('accept')} disabledReason={ro ?? (expired ? 'Validity has ended — revise first' : undefined)}>
        Mark accepted
      </Button>,
      <Button key="reject" onClick={() => setDialog('reject')} disabledReason={ro}>
        Mark rejected
      </Button>,
    );
  }
  const canRevise = latest && ['pending_approval', 'approved', 'sent', 'negotiation', 'expired'].includes(status);

  return (
    <>
      {primary}
      <IconButton ref={moreRef} icon="more-vertical" label="Quotation actions" aria-haspopup="menu" onClick={() => setMenu(true)} />
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        anchor={moreRef}
        label="Quotation actions"
        items={[
          { id: 'print', label: 'Print / PDF', icon: 'download', onSelect: () => navigate(`/quotations/${record.id}/print`) },
          { id: 'compare', label: 'Compare revisions', icon: 'columns', disabledReason: revisions > 1 ? undefined : 'Only one revision so far', onSelect: () => navigate(`/quotations/${record.id}/compare`) },
          { id: 'send', label: status === 'approved' ? 'Send' : 'Send again', icon: 'send', disabledReason: !latest || !['approved', 'sent', 'negotiation'].includes(status) ? 'Only approved quotations can be sent' : ro ?? (expired ? 'Validity has ended — revise first' : undefined), onSelect: () => setDialog('send') },
          { id: 'revise', label: 'Revise (new revision)…', icon: 'copy', separatorBefore: true, disabledReason: canRevise ? ro : 'Only open or expired quotations can be revised', onSelect: () => setDialog('revise') },
        ]}
      />
      {dialog === 'submit' && <SubmitDialog record={raw} onClose={() => setDialog('')} />}
      {dialog === 'send' && <SendDialog record={raw} onClose={() => setDialog('')} />}
      {dialog === 'accept' && <AcceptDialog record={raw} onClose={() => setDialog('')} />}
      {dialog === 'reject' && <RejectDialog record={raw} onClose={() => setDialog('')} />}
      {dialog === 'revise' && <ReviseDialog record={raw} onClose={() => setDialog('')} />}
      <Dialog
        open={dialog === 'pullback'}
        onClose={() => setDialog('')}
        size="sm"
        role="alertdialog"
        title={`Pull ${raw.quoteNo} back to draft?`}
        description="The pending approval request is withdrawn. You can change the lines and submit again."
        footer={
          <>
            <Button onClick={() => setDialog('')} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await quotationsApi.backToDraft(actor, raw.id, raw.version);
                  toast(`${raw.quoteNo} is a draft again`);
                  setDialog('');
                } catch (e) {
                  toast(errorMessage(e), 'danger');
                }
              }}
            >
              Withdraw request
            </Button>
          </>
        }
      >
        <p className="muted">Approvers will no longer see this request in their inbox.</p>
      </Dialog>
    </>
  );
}

type DProps = { record: Props['record']; onClose: () => void };

function useRun(onClose: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = async (op: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setErrors({});
    try {
      await op();
      toast(done);
      onClose();
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, run };
}

function SubmitDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const [reason, setReason] = useState('');
  const { busy, errors, run } = useRun(onClose);
  const pct = Number(record.maxDiscountPct) || 0;
  const levels = discountApprovalLevels(pct);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Submit ${record.quoteNo}`}
      description={levels.length ? `Highest discount ${pct}% needs approval: ${levels.map((l) => l.label).join(' → ')}.` : `Highest discount ${pct}% is within the limit — the quotation is approved at once.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => quotationsApi.submit(actor, record.id, record.version, reason), levels.length ? `${record.quoteNo} sent for approval` : `${record.quoteNo} approved`)}>
            {levels.length ? 'Submit for approval' : 'Approve'}
          </Button>
        </>
      }
    >
      <p className="muted">Total {formatMoney(Number(record.grandTotal) || 0)}.</p>
      {levels.length > 0 && (
        <div className="form-field">
          <label className="field-label" htmlFor="qs-reason">
            Reason for the discount <span className="req">*</span>
          </label>
          <textarea id="qs-reason" className="input textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus aria-invalid={!!errors.reason || undefined} />
          {errors.reason && <p className="field-error">{errors.reason}</p>}
        </div>
      )}
    </Dialog>
  );
}

function SendDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const contact = byId('contacts', record.contactId);
  const [channel, setChannel] = useState<'email' | 'whatsapp'>(contact?.consentEmail === false && contact?.consentWhatsapp !== false ? 'whatsapp' : 'email');
  const [to, setTo] = useState(String((channel === 'email' ? contact?.email : contact?.whatsapp ?? contact?.mobile) ?? ''));
  const [message, setMessage] = useState(`Dear ${contact?.name ?? 'Sir / Madam'},\nPlease find attached our quotation ${record.quoteNo}, valid until ${formatDate(String(record.validUntil))}.\nRegards, ${actor.user.name}`);
  const { busy, errors, run } = useRun(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Send ${record.quoteNo}`}
      description="Simulated: the message and PDF are recorded in the message outbox; nothing leaves this browser. The sent date is logged on the quotation."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="send" loading={busy} onClick={() => run(() => quotationsApi.send(actor, record.id, record.version, { channel, to, message }), `${record.quoteNo} sent by ${channel === 'email' ? 'email' : 'WhatsApp'}`)}>
            Send
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field">
          <label className="field-label" htmlFor="qsend-ch">
            Channel
          </label>
          <SelectMenu
            id="qsend-ch"
            block
            label="Channel"
            value={channel}
            options={[
              { value: 'email', label: 'Email', disabled: contact?.consentEmail === false },
              { value: 'whatsapp', label: 'WhatsApp', disabled: contact?.consentWhatsapp === false },
            ]}
            onChange={(v) => {
              setChannel(v as 'email' | 'whatsapp');
              setTo(String((v === 'email' ? contact?.email : contact?.whatsapp ?? contact?.mobile) ?? ''));
            }}
          />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="qsend-to">
            {channel === 'email' ? 'Email address' : 'WhatsApp number'} <span className="req">*</span>
          </label>
          <input id="qsend-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!errors.to || undefined} />
          {errors.to && <p className="field-error">{errors.to}</p>}
        </div>
        <div className="form-field span-all">
          <label className="field-label" htmlFor="qsend-msg">
            Message
          </label>
          <textarea id="qsend-msg" className="input textarea" rows={5} maxLength={1500} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        {contact && (contact.consentEmail === false || contact.consentWhatsapp === false) && (
          <p className="muted small span-all">
            {String(contact.name)} has not consented to {[contact.consentEmail === false && 'email', contact.consentWhatsapp === false && 'WhatsApp'].filter(Boolean).join(' or ')} (DPDP Act) — that channel is disabled.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function AcceptDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const [method, setMethod] = useState<'po' | 'electronic'>('po');
  const [poNo, setPoNo] = useState('');
  const [poDate, setPoDate] = useState(todayKey());
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [name, setName] = useState('');
  const { busy, errors, run } = useRun(onClose);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Record acceptance · ${record.quoteNo}`}
      description="The quotation becomes Accepted and the opportunity is marked Won, which enables “Generate sales order”."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => quotationsApi.accept(actor, record.id, record.version, { method, poNo, poDate, file, acceptedByName: name }), `${record.quoteNo} accepted`)}>
            Record acceptance
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field span-all">
          <span className="field-label">Accepted by</span>
          <div className="segmented" role="radiogroup" aria-label="Acceptance method">
            {activeMasterValues('acceptanceMethod').map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={method === m.key} className={`seg-btn${method === m.key ? ' is-on' : ''}`} onClick={() => setMethod(m.key as 'po' | 'electronic')}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {method === 'po' ? (
          <>
            <div className="form-field">
              <label className="field-label" htmlFor="qa-po">
                Customer PO number <span className="req">*</span>
              </label>
              <input id="qa-po" className="input" maxLength={40} value={poNo} onChange={(e) => setPoNo(e.target.value)} aria-invalid={!!errors.poNo || undefined} data-autofocus />
              {errors.poNo && <p className="field-error">{errors.poNo}</p>}
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="qa-podate">
                PO date <span className="req">*</span>
              </label>
              <DatePicker id="qa-podate" block label="PO date" value={poDate} invalid={!!errors.poDate} onChange={(v) => setPoDate(v ?? '')} />
              {errors.poDate && <p className="field-error">{errors.poDate}</p>}
            </div>
            <div className="form-field span-all">
              <span className="field-label-row">
                <span className="field-label">
                  PO copy <span className="req">*</span>
                </span>
                <InfoTip text={`PDF, JPG or PNG up to ${getPolicies().maxFileMb} MB. Simulated upload: only the file name and size are kept.`} label="About the PO copy" />
              </span>
              <div className="row-gap">
                <Button icon="arrow-up" onClick={() => fileRef.current?.click()}>
                  {file ? 'Replace file' : 'Choose file'}
                </Button>
                <span className="muted small">{file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : 'No file chosen'}</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) setFile({ name: f.name, size: f.size });
                }}
              />
              {errors.file && <p className="field-error">{errors.file}</p>}
            </div>
          </>
        ) : (
          <div className="form-field span-all">
            <label className="field-label" htmlFor="qa-name">
              Name of the person accepting <span className="req">*</span>
            </label>
            <input id="qa-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.acceptedByName || undefined} data-autofocus />
            {errors.acceptedByName && <p className="field-error">{errors.acceptedByName}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function RejectDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const { busy, errors, run } = useRun(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      role="alertdialog"
      title={`Mark ${record.quoteNo} rejected?`}
      description="Use when the customer declines this quotation. The reason feeds the lost-quotation report."
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => run(() => quotationsApi.reject(actor, record.id, record.version, reason, note), `${record.quoteNo} marked rejected`)}>
            Mark rejected
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="qr-reason">
          Reason <span className="req">*</span>
        </label>
        <SelectMenu id="qr-reason" block label="Reason" value={reason} invalid={!!errors.reason} options={activeMasterValues('lostReason').map((v) => ({ value: v.key, label: v.label }))} onChange={setReason} />
        {errors.reason && <p className="field-error">{errors.reason}</p>}
      </div>
      <div className="form-field">
        <label className="field-label" htmlFor="qr-note">
          Note <span className="optional">(optional)</span>
        </label>
        <textarea id="qr-note" className="input textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}

function ReviseDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Revise ${record.quoteNo}`}
      description={`Creates revision R${(Number(record.revision) || 0) + 1} as a draft with today’s prices. This revision becomes read-only and any pending approval is withdrawn.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const id = await quotationsApi.revise(actor, record.id, record.version, note);
                toast(`Revision created — edit it and submit again`);
                onClose();
                navigate(`/quotations/${id}/edit`);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create revision
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="qv-note">
          What changes? <span className="req">*</span>
        </label>
        <textarea id="qv-note" className="input textarea" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus aria-invalid={!!error || undefined} />
        {error && <p className="field-error">{error}</p>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- banner

export function QuoteBanner({ actor, record }: Props) {
  const raw = (getDb().records.quotations ?? []).find((q) => q.id === record.id);
  if (!raw) return null;
  const status = String(raw.status);
  if (!raw.isLatest) return <InlineAlert tone="info" title="Older revision">This revision is read-only. Open the latest revision to continue.</InlineAlert>;
  if (status === 'pending_approval') {
    const a = getDb().approvals.find((x) => x.recordId === raw.id && x.status === 'pending');
    const level = a?.levels[a.currentLevel];
    return (
      <InlineAlert tone="warning" title={`Waiting for ${level?.label ?? 'approval'}${a ? ` (level ${a.currentLevel + 1} of ${a.levels.length})` : ''}`}>
        {a ? `${a.id} requested by ${getUser(a.requestedBy)?.name ?? 'the owner'}.` : ''} Approvers decide in their Work inbox.{' '}
        {a && <Link to="/inbox?tab=approvals">Open inbox</Link>}
      </InlineAlert>
    );
  }
  if (status === 'draft' && raw.rejectNote) return <InlineAlert tone="warning" title="Returned to draft">{String(raw.rejectNote)}</InlineAlert>;
  if (status === 'expired') return <InlineAlert tone="info" title={`Expired on ${formatDate(String(raw.validUntil))}`}>Revise the quotation to re-quote with current prices.</InlineAlert>;
  if (status === 'accepted') {
    const canOrder = perm(actor, 'salesOrders').create;
    return (
      <InlineAlert tone="success" title={`Accepted${raw.acceptedAt ? ` on ${formatDateTime(String(raw.acceptedAt))}` : ''}`}>
        {raw.acceptanceMethod === 'po' ? `Customer PO ${raw.customerPoNo} (${raw.poFileName}).` : `Accepted electronically by ${raw.acceptedByName}.`} {canOrder ? 'Generate the sales order from the opportunity.' : ''}
      </InlineAlert>
    );
  }
  if (['approved', 'sent', 'negotiation'].includes(status)) {
    const daysLeft = Math.round((new Date(String(raw.validUntil)).getTime() - new Date(todayKey()).getTime()) / 86_400_000);
    if (daysLeft <= 3) return <InlineAlert tone="warning" title={daysLeft < 0 ? 'Validity has ended' : `Valid for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}`}>Follow up with the customer or revise the quotation.</InlineAlert>;
  }
  return null;
}

// ---------------------------------------------------------------- tabs

function useQuote(actor: Props['actor'], id: string) {
  return useServiceQuery(() => getQuote(actor, id), [id, actor.user.id]);
}

export function LinesTab({ actor, record }: Props) {
  const q = useQuote(actor, record.id);
  if (q.error)
    return (
      <ErrorState title="Could not load the line items" onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={4} />;
  const r = q.data.record;
  return (
    <div className="qt-tab">
      <LinesTable lines={q.data.lines} showMargin={q.data.showMargin} compact />
      <TotalsBlock t={{ subtotal: Number(r.subtotal), discountTotal: Number(r.discountTotal), freight: Number(r.freight), insurance: Number(r.insurance), taxable: Number(r.taxable), cgst: Number(r.cgst), sgst: Number(r.sgst), igst: Number(r.igst), grandTotal: Number(r.grandTotal), amountInWords: String(r.amountInWords ?? ''), landedCostTotal: r.landedCostTotal as number | null, marginPct: r.marginPct as number | null }} showMargin={q.data.showMargin} />
    </div>
  );
}

export function RevisionsTab({ actor, record }: Props) {
  const q = useQuote(actor, record.id);
  if (q.error)
    return (
      <ErrorState title="Could not load revisions" onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={3} />;
  const revs = q.data.revisions;
  return (
    <ul className="flow-list">
      {revs.map((r) => {
        const st = masterValue('quoteStatus', r.status);
        return (
          <li key={r.id} className="flow-item">
            <span className="tag tone-neutral">R{Number(r.revision) || 0}</span>
            <Link to={`/quotations?peek=${r.id}`} className="flow-main">
              <span className="flow-title">
                {String(r.quoteNo)} · {formatMoney(Number(r.grandTotal) || 0)}
              </span>
              <span className="muted small">
                {formatDate(String(r.quoteDate))} · {r.revisionNote ? String(r.revisionNote) : 'First issue'}
              </span>
            </Link>
            {st && <StatusChip label={st.label} tone={st.tone} />}
            {r.id !== record.id && (
              <Link className="link small" to={`/quotations/${record.id}/compare?with=${r.id}`}>
                Compare
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RoiTab({ actor, record }: Props) {
  const toast = useToast();
  const raw = (getDb().records.quotations ?? []).find((q) => q.id === record.id);
  const [v, setV] = useState({
    out: String(raw?.roiOutputPerDay ?? 500),
    price: String(raw?.roiPricePerUnit ?? 120),
    cost: String(raw?.roiCostPerUnit ?? 45),
    days: String(raw?.roiWorkingDays ?? 25),
  });
  const [busy, setBusy] = useState(false);
  if (!raw) return null;
  const canSave = (() => {
    try {
      return getQuote(actor, record.id).canUpdate;
    } catch {
      return false;
    }
  })();
  const r = roi({ investment: Number(raw.grandTotal) || 0, outputPerDay: Number(v.out), pricePerUnit: Number(v.price), costPerUnit: Number(v.cost), workingDays: Number(v.days) });
  const field = (k: keyof typeof v, label: string, prefix?: string) => (
    <div className="form-field">
      <label className="field-label" htmlFor={`roi-${k}`}>
        {label}
      </label>
      <div className={`input-affix${prefix ? ' has-start' : ''}`}>
        {prefix && <span className="affix affix-start">{prefix}</span>}
        <input id={`roi-${k}`} className="input" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
      </div>
    </div>
  );
  return (
    <div className="qt-tab">
      <p className="muted small">Payback on the quotation value of {formatMoney(Number(raw.grandTotal) || 0)} from the customer’s own production. Indicative only — attach it when sending.</p>
      <div className="form-grid cols-2">
        {field('out', 'Production per day (metres / prints)')}
        {field('days', 'Working days per month')}
        {field('price', 'Customer’s selling price per unit', '₹')}
        {field('cost', 'Running cost per unit (ink, media, power)', '₹')}
      </div>
      <dl className="detail-list qt-totals">
        <div className="detail-row">
          <dt>Contribution per unit</dt>
          <dd className="num">{formatMoney(r.contributionPerUnit)}</dd>
        </div>
        <div className="detail-row">
          <dt>Monthly contribution</dt>
          <dd className="num">{formatMoney(r.monthlyContribution)}</dd>
        </div>
        <div className="detail-row">
          <dt>Payback</dt>
          <dd className="num">
            <strong>{r.paybackMonths === null ? <EmptyValue label="Not recovered at these numbers" /> : `${r.paybackMonths} months`}</strong>
          </dd>
        </div>
      </dl>
      <Button
        loading={busy}
        disabledReason={canSave ? undefined : `Read-only for ${actor.role.label}`}
        onClick={async () => {
          setBusy(true);
          try {
            const fresh = (getDb().records.quotations ?? []).find((q) => q.id === record.id)!;
            await call(() => updateRecord(actor, 'quotations', record.id, { roiOutputPerDay: Number(v.out) || 0, roiPricePerUnit: Number(v.price) || 0, roiCostPerUnit: Number(v.cost) || 0, roiWorkingDays: Number(v.days) || 1 }, fresh.version));
            toast('ROI inputs saved on the quotation');
          } catch (e) {
            toast(errorMessage(e), 'danger');
          } finally {
            setBusy(false);
          }
        }}
      >
        Save to quotation
      </Button>
    </div>
  );
}

/** Opportunity → Quotations tab (latest revision of each quotation) with "New quotation". */
export function OpportunityQuotesTab({ actor, record }: Props) {
  const navigate = useNavigate();
  const q = useServiceQuery(() => (perm(actor, 'quotations').read === 'none' ? [] : queryRecords(actor, 'quotations', { where: { opportunityId: record.id, isLatest: true }, sort: [{ field: 'quoteDate', dir: 'desc' }] }).rows), [record.id, actor.user.id]);
  const closed = ['won', 'lost'].includes(String(record.stage));
  const action = (
    <Button variant="primary" icon="plus" onClick={() => navigate(`/quotations/new?opportunity=${record.id}`)} disabledReason={!perm(actor, 'quotations').create ? `${actor.role.label} cannot create quotations` : closed ? 'The opportunity is closed' : undefined}>
      New quotation
    </Button>
  );
  if (q.error)
    return (
      <ErrorState title="Could not load quotations" onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={3} />;
  const rows = q.data;
  if (!rows.length)
    return (
      <EmptyState icon="receipt" title="No quotations yet" action={action}>
        Prepare a quotation from the product price list.
      </EmptyState>
    );
  return (
    <div className="qt-tab">
      <ul className="flow-list">
        {rows.map((r) => {
          const st = masterValue('quoteStatus', r.status);
          return (
            <li key={r.id} className="flow-item">
              <Link to={`/quotations?peek=${r.id}`} className="flow-main">
                <span className="flow-title">
                  {String(r.quoteNo)} · {formatMoney(Number(r.grandTotal) || 0)}
                </span>
                <span className="muted small">
                  {formatDate(String(r.quoteDate))} · valid until {formatDate(String(r.validUntil))}
                </span>
              </Link>
              {st && <StatusChip label={st.label} tone={st.tone} />}
            </li>
          );
        })}
      </ul>
      {action}
    </div>
  );
}
