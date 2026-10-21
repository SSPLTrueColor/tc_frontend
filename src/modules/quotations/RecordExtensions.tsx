/** Quotation record extensions: actions, banner and tabs (GLOSSARY §1.2) in the side panel / record page. */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { formatDate, formatDateTime, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { call, errorMessage } from '../../services/api/client';
import { useActor } from '../../services/hooks';
import { quotationsApi } from '../../services/api/quotations';
import { perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { byId } from '../../services/lookups';
import { getPolicies } from '../../services/policies';
import { activeMasterValues, getUser, masterLabel, masterValue } from '../../services/registry';
import { queryRecords, updateRecord } from '../../services/runtime';
import { computeTotals, roi } from '../../services/quotations/pricing';
import { canUndoSelection, getQuote, levelName, quoteApprovalChain, quotationOrigin, undoSelection } from '../../services/quotations/workflow';
import { liveOrderForQuote, quoteBlockReason, selectedQuoteOf } from '../../services/quotations/selection';
import { quotationBlocker } from '../../services/orders/orders';
import { ServiceError } from '../../services/types';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { Button, IconButton } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { Dialog, Menu } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { LinesTable, TaxSummary, TotalsBlock } from './LinesTable';
import { TextField, Textarea } from '../../components/primitives/controls';
import { NumberInput } from '../../components/primitives/NumberInput';
import { isBadNumber, NUMBER_LIMITS, type NumberRule } from '../../services/validation';
import { SegmentedControl } from '../../components/primitives/controls';
import { FileInput } from '../../components/primitives/controls';

type Props = RecordExtensionProps;

const T = L.quotations;
const A = T.actions;
const D = T.dialogs;
const B = T.banner;
const C = T.tabContent;
const F = T.fields.quotations;
const SEL = T.selection;

const quotePath = (id: string) => recordPeekPath('tc', 'quotations', id);
const pdfPath = (id: string) => toPath(ROUTES.quotationPdf, { recordId: id });
const comparePath = (id: string, withId?: string) => toPath(ROUTES.quotationCompare, { recordId: id }, { with: withId });

// ---------------------------------------------------------------- actions

export function QuoteActions({ actor, record }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [dialog, setDialog] = useState<'' | 'submit' | 'send' | 'accept' | 'reject' | 'version' | 'pullback' | 'undo'>('');
  const [undoBusy, setUndoBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const raw = (getDb().records.quotations ?? []).find((q) => q.id === record.id);
  if (!raw) return null;
  const status = String(raw.status);
  const latest = !!raw.isLatest;
  const view = (() => {
    try {
      return getQuote(actor, record.id);
    } catch {
      return null;
    }
  })();
  const origin = view ? quotationOrigin(actor, record.id) : undefined;
  const canUpdate = !!view?.canUpdate;
  const ro = canUpdate ? undefined : T.common.readOnlyFor(actor.role.label);
  const expired = String(raw.validUntil) < todayKey();
  const versions = (getDb().records.quotations ?? []).filter((q) => String(q.rootId || q.id) === String(raw.rootId || raw.id)).length;
  // Quotation selection guard: why this quotation can no longer be acted on (Not Selected, another accepted, opportunity lost).
  const block = quoteBlockReason(getDb(), raw);
  const soCreate = perm(actor, 'salesOrders').create;
  const soReason = !soCreate ? C.cannotCreateSo(actor.role.label) : quotationBlocker(getDb(), raw) ?? undefined;
  const liveSo = status === 'accepted' ? liveOrderForQuote(getDb(), raw) : undefined;

  const primary: JSX.Element[] = [];
  if (status === 'not_selected') {
    // Read-only: no actions, only the way to the selected quotation.
    const sel = raw.selectedQuotationId ? (getDb().records.quotations ?? []).find((q) => q.id === raw.selectedQuotationId) : undefined;
    if (sel)
      primary.push(
        <Button key="selected" icon="chevron-right" onClick={() => navigate(quotePath(sel.id))}>
          {SEL.openSelected(String(sel.quoteNo))}
        </Button>,
      );
  } else if (!latest) {
    const newest = (getDb().records.quotations ?? []).find((q) => String(q.rootId || q.id) === String(raw.rootId || raw.id) && q.isLatest);
    if (newest)
      primary.push(
        <Button key="latest" icon="chevron-right" onClick={() => navigate(quotePath(newest.id))}>
          {A.openLatest(String(newest.quoteNo))}
        </Button>,
      );
  } else if (status === 'draft') {
    primary.push(
      <Button key="submit" variant="primary" onClick={() => setDialog('submit')} disabledReason={ro ?? block}>
        {A.submitForApproval}
      </Button>,
      <Button key="edit" icon="pencil" onClick={() => navigate(toPath(ROUTES.quotationEdit, { recordId: record.id }))} disabledReason={ro ?? block}>
        {A.editLineItems}
      </Button>,
    );
  } else if (status === 'pending_approval') {
    primary.push(
      <Button key="pull" onClick={() => setDialog('pullback')} disabledReason={ro ?? block}>
        {A.pullBack}
      </Button>,
    );
  } else if (status === 'approved') {
    // Send / Accept are optional: the customer PO on the sales order is the acceptance.
    primary.push(
      <Button key="so" variant="primary" onClick={() => navigate(toPath(ROUTES.salesOrderNew, {}, { quotation: record.id }))} disabledReason={soReason}>
        {A.generateSalesOrder}
      </Button>,
      <Button key="send" icon="send" onClick={() => setDialog('send')} disabledReason={ro ?? block ?? (expired ? T.common.validityEnded : undefined)}>
        {A.sendQuotation}
      </Button>,
    );
  } else if (status === 'sent' || status === 'negotiation') {
    primary.push(
      <Button key="so" variant="primary" onClick={() => navigate(toPath(ROUTES.salesOrderNew, {}, { quotation: record.id }))} disabledReason={soReason}>
        {A.generateSalesOrder}
      </Button>,
      <Button key="accept" onClick={() => setDialog('accept')} disabledReason={ro ?? block ?? (expired ? T.common.validityEnded : undefined)}>
        {A.markAccepted}
      </Button>,
      <Button key="reject" onClick={() => setDialog('reject')} disabledReason={ro ?? block}>
        {A.markRejected}
      </Button>,
    );
  } else if (status === 'accepted') {
    const so = view?.salesOrder;
    if (so)
      primary.push(
        <Button key="so" icon="chevron-right" onClick={() => navigate(recordPeekPath('tc', 'salesOrders', so.id))}>
          {A.openSalesOrder}
        </Button>,
      );
    else
      primary.push(
        <Button key="so" variant="primary" onClick={() => navigate(toPath(ROUTES.salesOrderNew, {}, { quotation: record.id }))} disabledReason={soReason}>
          {A.generateSalesOrder}
        </Button>,
      );
  }
  const canVersion = latest && ['pending_approval', 'approved', 'sent', 'negotiation', 'expired'].includes(status);
  const readOnly = status === 'not_selected';
  const menuItems = [
    { id: 'pdf', label: A.quotationPdf, icon: 'download' as const, onSelect: () => navigate(pdfPath(record.id)) },
    { id: 'compare', label: A.compareVersions, icon: 'columns' as const, disabledReason: versions > 1 ? undefined : C.onlyOneVersion, onSelect: () => navigate(comparePath(record.id)) },
    ...(readOnly
      ? []
      : [
          { id: 'send', label: A.sendQuotation, icon: 'send' as const, disabledReason: !latest || !['approved', 'sent', 'negotiation'].includes(status) ? C.onlyApprovedSend : ro ?? block ?? (expired ? T.common.validityEnded : undefined), onSelect: () => setDialog('send') },
          { id: 'version', label: A.createVersion, icon: 'copy' as const, separatorBefore: true, disabledReason: canVersion ? ro ?? block : C.onlyOpenVersion, onSelect: () => setDialog('version') },
        ]),
    ...(status === 'accepted' && canUndoSelection(actor)
      ? [{ id: 'undo', label: SEL.undo, icon: 'undo' as const, separatorBefore: true, disabledReason: liveSo ? SEL.undoOrderExists(String(liveSo.orderNo ?? liveSo.id)) : ro, onSelect: () => setDialog('undo') }]
      : []),
  ];

  return (
    <>
      {origin?.leadId && <Button icon="chevron-right" className="is-wide" onClick={() => navigate(recordPeekPath(actor.workspaceId, 'leads', origin.leadId!))}>Open Lead · {origin.leadId}</Button>}
      {origin?.directCustomer && <span className="muted small">Existing-customer opportunity</span>}
      {latest && Number(raw.revision) > 0 && status === 'draft' && <StatusChip label="Under Revision" tone="warning" />}
      {primary}
      <IconButton ref={moreRef} icon="more-vertical" label={A.menu} aria-haspopup="menu" onClick={() => setMenu(true)} />
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        anchor={moreRef}
        label={A.menu}
        items={menuItems}
      />
      {dialog === 'submit' && <SubmitDialog record={raw} onClose={() => setDialog('')} />}
      {dialog === 'send' && <SendDialog record={raw} onClose={() => setDialog('')} />}
      {dialog === 'accept' && <AcceptDialog record={raw} onClose={() => setDialog('')} />}
      {dialog === 'reject' && <RejectDialog record={raw} onClose={() => setDialog('')} />}
      {dialog === 'version' && <VersionDialog record={raw} onClose={() => setDialog('')} />}
      <Dialog
        open={dialog === 'pullback'}
        onClose={() => setDialog('')}
        size="sm"
        role="alertdialog"
        title={D.pullBack.title(String(raw.quoteNo))}
        description={D.pullBack.description}
        footer={
          <>
            <Button onClick={() => setDialog('')} data-autofocus>
              {A.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await quotationsApi.backToDraft(actor, raw.id, raw.version);
                  toast(D.pullBack.done(String(raw.quoteNo)));
                  setDialog('');
                } catch (e) {
                  toast(errorMessage(e), 'danger');
                }
              }}
            >
              {A.withdrawRequest}
            </Button>
          </>
        }
      >
        <p className="muted">{D.pullBack.body}</p>
      </Dialog>
      <Dialog
        open={dialog === 'undo'}
        onClose={() => setDialog('')}
        size="sm"
        role="alertdialog"
        title={SEL.undoTitle(String(raw.quoteNo))}
        description={SEL.undoBody}
        footer={
          <>
            <Button onClick={() => setDialog('')} data-autofocus>
              {A.cancel}
            </Button>
            <Button
              variant="danger"
              loading={undoBusy}
              onClick={async () => {
                if (undoBusy) return;
                setUndoBusy(true);
                try {
                  await call(() => undoSelection(actor, raw.id, raw.version));
                  toast(SEL.undoDone(String(raw.quoteNo)));
                  setDialog('');
                } catch (e) {
                  toast(errorMessage(e), 'danger');
                } finally {
                  setUndoBusy(false);
                }
              }}
            >
              {SEL.undo}
            </Button>
          </>
        }
      >
        <p className="muted">{SEL.undoBody}</p>
      </Dialog>
    </>
  );
}

type DProps = { record: Props['record']; onClose: () => void };

function useRun(onClose: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const run = async (op: () => Promise<unknown>, done: string) => {
    if (inFlight.current) return; // double click: one request only
    inFlight.current = true;
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
      inFlight.current = false;
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
  const levels = quoteApprovalChain(actor, record, pct);
  const no = String(record.quoteNo);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={D.submit.title(no)}
      description={levels.length ? D.submit.needsApproval(pct, levels.map(levelName).join(' → ')) : D.submit.withinLimit(pct)}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => quotationsApi.submit(actor, record.id, record.version, reason), levels.length ? D.submit.sent(no) : D.submit.approved(no))}>
            {A.submitForApproval}
          </Button>
        </>
      }
    >
      <p className="muted">{D.submit.total(formatMoney(Number(record.grandTotal) || 0))}</p>
      {levels.length > 0 && (
        <div className="form-field">
          <label className="field-label" htmlFor="qs-reason">
            {D.submit.reason} <span className="req">*</span>
          </label>
          <Textarea id="qs-reason" className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus aria-invalid={!!errors.reason || undefined} />
          {errors.reason && <p className="field-error">{errors.reason}</p>}
        </div>
      )}
    </Dialog>
  );
}

function SendDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const S = D.send;
  const contact = byId('contacts', record.contactId);
  const noEmail = contact?.consentEmail === false;
  const noWhatsapp = contact?.consentWhatsapp === false;
  // Default to a channel the contact has consented to; with neither, the only option is "shared offline".
  const [channel, setChannel] = useState<'email' | 'whatsapp' | 'manual'>(!noEmail ? 'email' : !noWhatsapp ? 'whatsapp' : 'manual');
  const [to, setTo] = useState(String((channel === 'email' ? contact?.email : contact?.whatsapp ?? contact?.mobile) ?? ''));
  const [message, setMessage] = useState(S.defaultMessage(String(contact?.name ?? S.sirMadam), String(record.quoteNo), formatDate(String(record.validUntil)), actor.user.name));
  const { busy, errors, run } = useRun(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={S.title(String(record.quoteNo))}
      description={S.description}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" icon="send" loading={busy} onClick={() => run(() => quotationsApi.send(actor, record.id, record.version, { channel, to, message }), S.done(String(record.quoteNo), channel === 'email' ? S.email : channel === 'whatsapp' ? S.whatsapp : S.manual))}>
            {A.sendQuotation}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field">
          <label className="field-label" htmlFor="qsend-ch">
            {S.channel}
          </label>
          <SelectMenu
            id="qsend-ch"
            block
            label={S.channel}
            value={channel}
            options={[
              { value: 'email', label: S.email, disabled: noEmail },
              { value: 'whatsapp', label: S.whatsapp, disabled: noWhatsapp },
              { value: 'manual', label: S.manual },
            ]}
            onChange={(v) => {
              setChannel(v as 'email' | 'whatsapp' | 'manual');
              setTo(String((v === 'email' ? contact?.email : contact?.whatsapp ?? contact?.mobile) ?? ''));
            }}
          />
        </div>
        {channel === 'manual' ? (
          <p className="muted small">{S.manualHelp}</p>
        ) : (
          <div className="form-field">
            <label className="field-label" htmlFor="qsend-to">
              {channel === 'email' ? S.emailAddress : S.whatsappNumber} <span className="req">*</span>
            </label>
            <TextField id="qsend-to" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!errors.to || undefined} />
            {errors.to && <p className="field-error">{errors.to}</p>}
          </div>
        )}
        <div className="form-field span-all">
          <label className="field-label" htmlFor="qsend-msg">
            {S.message}
          </label>
          <Textarea id="qsend-msg" className="textarea" rows={5} maxLength={1500} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        {contact && noEmail && noWhatsapp ? (
          <p className="muted small span-all">{S.noConsentAny(String(contact.name))}</p>
        ) : contact && (noEmail || noWhatsapp) && (
          <p className="muted small span-all">
            {S.noConsent(
              String(contact.name),
              [contact.consentEmail === false && S.email.toLowerCase(), contact.consentWhatsapp === false && S.whatsapp].filter(Boolean).join(S.or),
            )}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function AcceptDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const X = D.accept;
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
      title={X.title(String(record.quoteNo))}
      description={X.description}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => quotationsApi.accept(actor, record.id, record.version, { method, poNo, poDate, file, acceptedByName: name }), X.done(String(record.quoteNo)))}>
            {A.markAccepted}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field span-all">
          <span className="field-label">{X.method}</span>
          <SegmentedControl
            label={X.method}
            value={method}
            onChange={(next) => setMethod(next as 'po' | 'electronic')}
            options={activeMasterValues('acceptanceMethod').map((m) => ({ value: m.key, label: m.label }))}
          />
        </div>
        {method === 'po' ? (
          <>
            <div className="form-field">
              <label className="field-label" htmlFor="qa-po">
                {X.poNo} <span className="req">*</span>
              </label>
              <TextField id="qa-po" maxLength={40} value={poNo} onChange={(e) => setPoNo(e.target.value)} aria-invalid={!!errors.poNo || undefined} data-autofocus />
              {errors.poNo && <p className="field-error">{errors.poNo}</p>}
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="qa-podate">
                {X.poDate} <span className="req">*</span>
              </label>
              <DatePicker id="qa-podate" block label={X.poDate} value={poDate} invalid={!!errors.poDate} onChange={(v) => setPoDate(v ?? '')} />
              {errors.poDate && <p className="field-error">{errors.poDate}</p>}
            </div>
            <div className="form-field span-all">
              <span className="field-label-row">
                <span className="field-label">
                  {X.poCopy} <span className="req">*</span>
                </span>
                <InfoTip text={X.poCopyHelp(getPolicies().maxFileMb)} label={X.poCopyAbout} />
              </span>
              <div className="row-gap">
                <Button icon="arrow-up" onClick={() => fileRef.current?.click()}>
                  {file ? A.replaceFile : A.chooseFile}
                </Button>
                <span className="muted small">{file ? X.fileInfo(file.name, (file.size / 1024).toFixed(0)) : X.noFile}</span>
              </div>
              <FileInput
                ref={fileRef}
                
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
              {X.acceptedBy} <span className="req">*</span>
            </label>
            <TextField id="qa-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.acceptedByName || undefined} data-autofocus />
            {errors.acceptedByName && <p className="field-error">{errors.acceptedByName}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function RejectDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const X = D.reject;
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const { busy, errors, run } = useRun(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      role="alertdialog"
      title={X.title(String(record.quoteNo))}
      description={X.description}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            {A.cancel}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => run(() => quotationsApi.reject(actor, record.id, record.version, reason, note), X.done(String(record.quoteNo)))}>
            {A.markRejected}
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="qr-reason">
          {X.reason} <span className="req">*</span>
        </label>
        <SelectMenu id="qr-reason" block label={X.reason} value={reason} invalid={!!errors.reason} options={activeMasterValues('lostReason').map((v) => ({ value: v.key, label: v.label }))} onChange={setReason} />
        {errors.reason && <p className="field-error">{errors.reason}</p>}
      </div>
      <div className="form-field">
        <label className="field-label" htmlFor="qr-note">
          {X.note} <span className="optional">{T.common.optional}</span>
        </label>
        <Textarea id="qr-note" className="textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}

/** Create Version (QUO-09): R(n+1) as a draft; the current version becomes read-only. */
function VersionDialog({ record, onClose }: DProps) {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const X = D.version;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={X.title(String(record.quoteNo))}
      description={X.description((Number(record.revision) || 0) + 1)}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (inFlight.current) return;
              inFlight.current = true;
              setBusy(true);
              setError('');
              try {
                const id = await quotationsApi.createVersion(actor, record.id, record.version, note);
                toast(X.done);
                onClose();
                navigate(toPath(ROUTES.quotationEdit, { recordId: id }));
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                inFlight.current = false;
                setBusy(false);
              }
            }}
          >
            {A.createVersion}
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="qv-note">
          {X.note} <span className="req">*</span>
        </label>
        <Textarea id="qv-note" className="textarea" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus aria-invalid={!!error || undefined} />
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
  if (status === 'not_selected') {
    const sel = raw.selectedQuotationId ? (getDb().records.quotations ?? []).find((q) => q.id === raw.selectedQuotationId) : undefined;
    const date = formatDate(String((sel?.acceptedAt as string | undefined) ?? raw.notSelectedAt ?? '').slice(0, 10));
    return (
      <InlineAlert tone="info" title={sel ? SEL.bannerTitle(String(sel.quoteNo), date) : SEL.bannerLostTitle(formatDate(String(raw.notSelectedAt ?? '').slice(0, 10)))}>
        {SEL.bannerBody}{' '}
        {sel && (
          <Link className="link" to={quotePath(sel.id)}>
            {SEL.openSelected(String(sel.quoteNo))}
          </Link>
        )}
      </InlineAlert>
    );
  }
  if (!raw.isLatest)
    return (
      <InlineAlert tone="info" title={B.olderVersion}>
        {B.olderVersionBody}
      </InlineAlert>
    );
  if (status === 'pending_approval') {
    const a = getDb().approvals.find((x) => x.recordId === raw.id && x.status === 'pending');
    const level = a?.levels[a.currentLevel];
    return (
      <InlineAlert tone="warning" title={a && level ? B.waitingFor(levelName(level), a.currentLevel + 1, a.levels.length) : B.waitingForApproval}>
        {a ? B.requestedBy(a.id, getUser(a.requestedBy)?.name ?? B.theOwner) : ''} {B.approversDecide} <Link to={ROUTES.quotationPendingApprovals}>{A.viewPendingApprovals}</Link>
      </InlineAlert>
    );
  }
  if (status === 'draft' && raw.rejectNote)
    return (
      <InlineAlert tone="warning" title={B.returnedToDraft}>
        {String(raw.rejectNote)}
      </InlineAlert>
    );
  if (status === 'expired')
    return (
      <InlineAlert tone="info" title={B.expiredOn(formatDate(String(raw.validUntil)))}>
        {B.expiredBody}
      </InlineAlert>
    );
  if (status === 'accepted') {
    const ordered = (getDb().records.salesOrders ?? []).some((o) => o.quotationId === raw.id && o.status !== 'cancelled');
    const canOrder = perm(actor, 'salesOrders').create && !ordered;
    return (
      <InlineAlert tone="success" title={raw.acceptedAt ? B.acceptedOn(formatDateTime(String(raw.acceptedAt))) : B.accepted}>
        {raw.acceptanceMethod === 'po' ? B.acceptedPo(String(raw.customerPoNo), String(raw.poFileName)) : B.acceptedElectronic(String(raw.acceptedByName))} {canOrder ? B.generateHint : ''}
      </InlineAlert>
    );
  }
  if (['approved', 'sent', 'negotiation'].includes(status)) {
    const daysLeft = Math.round((new Date(String(raw.validUntil)).getTime() - new Date(todayKey()).getTime()) / 86_400_000);
    if (daysLeft <= 3)
      return (
        <InlineAlert tone="warning" title={daysLeft < 0 ? B.validityEnded : B.validFor(daysLeft)}>
          {B.followUp}
        </InlineAlert>
      );
  }
  return null;
}

// ---------------------------------------------------------------- tabs

function useQuote(actor: Props['actor'], id: string) {
  return useServiceQuery(() => getQuote(actor, id), [id, actor.user.id]);
}

function TabState({ q, error, rows = 4 }: { q: ReturnType<typeof useQuote>; error: string; rows?: number }) {
  if (q.error)
    return (
      <ErrorState title={error} onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  return <Skeleton rows={rows} />;
}

/** Line Items (QUO-02 / QUO-03). */
export function LinesTab({ actor, record }: Props) {
  const q = useQuote(actor, record.id);
  if (!q.data) return <TabState q={q} error={C.linesError} />;
  return (
    <div className="qt-tab">
      <LinesTable lines={q.data.lines} showMargin={q.data.showMargin} />
    </div>
  );
}

/** Pricing & GST (QUO-04, QUO-12): totals, GST split by place of supply, landed cost / margin when permitted. */
export function PricingTab({ actor, record }: Props) {
  const q = useQuote(actor, record.id);
  if (!q.data) return <TabState q={q} error={C.pricingError} />;
  const r = q.data.record;
  const totals = computeTotals(q.data.lines, String(r.placeOfSupply), Number(r.freight) || 0, Number(r.insurance) || 0, getPolicies().companyGstState);
  const sameState = String(r.placeOfSupply) === getPolicies().companyGstState;
  return (
    <div className="qt-tab">
      <p className="muted small">
        {C.placeOfSupply(masterLabel('state', r.placeOfSupply), String(r.placeOfSupply))} · {sameState ? C.intraState : C.interState} {C.extrasTaxed}
      </p>
      <TotalsBlock
        t={{ subtotal: Number(r.subtotal), discountTotal: Number(r.discountTotal), freight: Number(r.freight), insurance: Number(r.insurance), taxable: Number(r.taxable), cgst: Number(r.cgst), sgst: Number(r.sgst), igst: Number(r.igst), grandTotal: Number(r.grandTotal), amountInWords: String(r.amountInWords ?? ''), landedCostTotal: r.landedCostTotal as number | null, marginPct: r.marginPct as number | null }}
        showMargin={q.data.showMargin}
        interState={!sameState}
      />
      <h3 className="panel-title">{C.taxSummary}</h3>
      <TaxSummary totals={totals} interState={!sameState} />
    </div>
  );
}

/** Commercial Terms (QUO-07): template and the terms printed on the quotation. */
export function TermsTab({ actor, record }: Props) {
  const q = useQuote(actor, record.id);
  if (!q.data) return <TabState q={q} error={C.termsError} />;
  const r = q.data.record;
  const tpl = byId('termsTemplates', r.termsTemplateId);
  const rows: [string, unknown][] = [
    [F.paymentTerms, r.paymentTerms],
    [F.deliveryTerms, r.deliveryTerms],
    [F.warrantyTerms, r.warrantyTerms],
    [F.installationTerms, r.installationTerms],
  ];
  return (
    <div className="qt-tab">
      <dl className="detail-list">
        <div className="detail-row">
          <dt>{F.termsTemplateId}</dt>
          <dd>{tpl ? String(tpl.name) : <EmptyValue label={C.noTemplate} />}</dd>
        </div>
        {rows.map(([label, value]) => (
          <div className="detail-row" key={label}>
            <dt>{label}</dt>
            <dd className="qt-pre">{String(value ?? '').trim() ? String(value) : <EmptyValue label={C.noTerms} />}</dd>
          </div>
        ))}
      </dl>
      {q.data.canEdit && <p className="muted small">{C.termsEditHint}</p>}
    </div>
  );
}

/** Approval (QUO-06): discount approval requests with each level, decision and comment. */
export function ApprovalTab({ actor, record }: Props) {
  const q = useQuote(actor, record.id);
  if (!q.data) return <TabState q={q} error={C.approvalError} />;
  const list = q.data.approvals;
  if (!list.length)
    return (
      <EmptyState icon="check-square" title={C.approvalNone}>
        {C.approvalNoneBody}
      </EmptyState>
    );
  const tone = (s: string) => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : s === 'pending' ? 'warning' : 'neutral');
  return (
    <div className="qt-tab">
      {list.map((a) => (
        <section key={a.id} className="qt-approval">
          <div className="row-gap">
            <strong>{a.id}</strong>
            <StatusChip label={C.requestStatus[a.status]} tone={tone(a.status)} />
            {a.status === 'pending' && (
              <Link className="link small" to={ROUTES.quotationPendingApprovals}>
                {A.viewPendingApprovals}
              </Link>
            )}
          </div>
          <p className="muted small">
            {C.requested(getUser(a.requestedBy)?.name ?? B.theOwner, formatDateTime(a.requestedAt))}
            {a.reason ? ` · ${C.reason(a.reason)}` : ''}
            {a.remindedAt ? ` · ${C.reminded(formatDateTime(a.remindedAt))}` : ''}
          </p>
          <ul className="flow-list" aria-label={C.approvalChain}>
            {a.levels.map((lv, i) => {
              const dec = a.decisions.find((x) => x.level === i);
              const state = dec ? dec.decision : a.status === 'pending' && i === a.currentLevel ? 'pending' : a.status === 'withdrawn' ? 'withdrawn' : 'notReached';
              return (
                <li key={i} className="flow-item">
                  <span className="tag tone-neutral">{i + 1}</span>
                  <span className="flow-main">
                    <span className="flow-title">{levelName(lv)}</span>
                    {dec && (
                      <span className="muted small">
                        {C.decidedBy(getUser(dec.by)?.name ?? dec.by, formatDateTime(dec.at))}
                        {dec.note ? ` · ${dec.note}` : ''}
                      </span>
                    )}
                  </span>
                  <StatusChip label={C.levelStatus[state]} tone={tone(state)} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Versions (QUO-09): R0, R1 … with status and a link to Compare Versions. */
export function VersionsTab({ actor, record }: Props) {
  const q = useQuote(actor, record.id);
  if (!q.data) return <TabState q={q} error={C.versionsError} rows={3} />;
  return (
    <ul className="flow-list">
      {[...q.data.revisions].reverse().map((r) => {
        const st = masterValue('quoteStatus', r.status);
        return (
          <li key={r.id} className="flow-item">
            <StatusChip label={`v${(Number(r.revision) || 0) + 1} · ${r.isLatest && r.status !== 'not_selected' ? 'Active' : 'Previous'}`} tone={r.isLatest && r.status !== 'not_selected' ? 'success' : 'neutral'} />
            <Link to={quotePath(r.id)} className="flow-main">
              <span className="flow-title">
                {String(r.quoteNo)} · {formatMoney(Number(r.grandTotal) || 0)}
              </span>
              <span className="muted small">
                {formatDateTime(String(r.createdAt ?? r.quoteDate))} · {getUser(String(r.createdBy))?.name ?? 'Sales team'} · {r.revisionNote ? String(r.revisionNote) : C.firstIssue}
              </span>
            </Link>
            {st && <StatusChip label={st.label} tone={st.tone} />}
            {r.id !== record.id && (
              <Link className="link small" to={comparePath(record.id, r.id)}>
                {A.compare}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Documents (QUO-08, QUO-11): the generated Quotation PDF per version and the customer PO copy. */
export function DocumentsTab({ actor, record }: Props) {
  const q = useQuote(actor, record.id);
  if (!q.data) return <TabState q={q} error={C.documentsError} rows={3} />;
  const r = q.data.record;
  const docs: { id: string; title: string; sub: string; to?: string }[] = [{ id: 'pdf', title: C.docQuotationPdf(String(r.quoteNo)), sub: formatDate(String(r.quoteDate)), to: pdfPath(r.id) }];
  if (r.roiOutputPerDay) docs.push({ id: 'roi', title: C.docRoi, sub: T.tabs.roi });
  if (r.poFileName) docs.push({ id: 'po', title: C.docPoCopy(String(r.poFileName)), sub: [r.customerPoNo, r.customerPoDate ? formatDate(String(r.customerPoDate)) : ''].filter(Boolean).join(' · ') });
  return (
    <div className="qt-tab">
      <p className="muted small">{C.documentsIntro}</p>
      <ul className="flow-list">
        {docs.map((d) => (
          <li key={d.id} className="flow-item">
            <span className="flow-main">
              <span className="flow-title">{d.title}</span>
              <span className="muted small">{d.sub}</span>
            </span>
            {d.to && (
              <Link className="link small" to={d.to}>
                {A.open}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** ROI / Payback Calculator (QUO-13). Inputs are saved on the quotation in any status. */
export function RoiTab({ actor, record }: Props) {
  const toast = useToast();
  const raw = (getDb().records.quotations ?? []).find((q) => q.id === record.id);
  const [v, setV] = useState<Record<'out' | 'price' | 'cost' | 'days', number | null>>({
    out: Number(raw?.roiOutputPerDay ?? 500),
    price: Number(raw?.roiPricePerUnit ?? 120),
    cost: Number(raw?.roiCostPerUnit ?? 45),
    days: Number(raw?.roiWorkingDays ?? 25),
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
  // COM-05: typed text is kept; "-5" or "1e3" shows why and blocks the save (the preview treats it as 0).
  const RULES: Record<keyof typeof v, NumberRule> = { out: NUMBER_LIMITS.count, days: { min: 1, max: 31, integer: true }, price: NUMBER_LIMITS.amount, cost: NUMBER_LIMITS.amount };
  const fin = (n: number | null) => (n !== null && Number.isFinite(n) ? n : 0);
  const bad = (Object.keys(RULES) as (keyof typeof v)[]).some((k) => isBadNumber(v[k], RULES[k]));
  const r = roi({ investment: Number(raw.grandTotal) || 0, outputPerDay: fin(v.out), pricePerUnit: fin(v.price), costPerUnit: fin(v.cost), workingDays: fin(v.days) });
  const field = (k: keyof typeof v, label: string, prefix?: string) => (
    <div className="form-field">
      <label className="field-label" htmlFor={`roi-${k}`}>
        {label}
      </label>
      <NumberInput id={`roi-${k}`} prefix={prefix} value={v[k]} rule={RULES[k]} onValueChange={(n) => setV((cur) => ({ ...cur, [k]: n }))} />
    </div>
  );
  return (
    <div className="qt-tab">
      <p className="muted small">{C.roiIntro(formatMoney(Number(raw.grandTotal) || 0))}</p>
      <div className="form-grid cols-2">
        {field('out', C.roiOutput)}
        {field('days', C.roiDays)}
        {field('price', C.roiPrice, '₹')}
        {field('cost', C.roiCost, '₹')}
      </div>
      <dl className="detail-list qt-totals">
        <div className="detail-row">
          <dt>{C.roiContribution}</dt>
          <dd className="num">{formatMoney(r.contributionPerUnit)}</dd>
        </div>
        <div className="detail-row">
          <dt>{C.roiMonthly}</dt>
          <dd className="num">{formatMoney(r.monthlyContribution)}</dd>
        </div>
        <div className="detail-row">
          <dt>{C.roiPayback}</dt>
          <dd className="num">
            <strong>{r.paybackMonths === null ? <EmptyValue label={C.roiNotRecovered} /> : C.roiMonths(r.paybackMonths)}</strong>
          </dd>
        </div>
      </dl>
      <Button
        loading={busy}
        disabledReason={canSave ? (bad ? L.common.form.fixHighlighted : undefined) : T.common.readOnlyFor(actor.role.label)}
        onClick={async () => {
          setBusy(true);
          try {
            const fresh = (getDb().records.quotations ?? []).find((q) => q.id === record.id)!;
            await call(() => updateRecord(actor, 'quotations', record.id, { roiOutputPerDay: fin(v.out), roiPricePerUnit: fin(v.price), roiCostPerUnit: fin(v.cost), roiWorkingDays: fin(v.days) || 1 }, fresh.version));
            toast(C.roiSaved);
          } catch (e) {
            toast(errorMessage(e), 'danger');
          } finally {
            setBusy(false);
          }
        }}
      >
        {A.saveToQuotation}
      </Button>
    </div>
  );
}

/** Opportunity → Quotations tab: every quotation and version grouped Selected / Active / Not Selected / Superseded, with "New Quotation". */
export function OpportunityQuotesTab({ actor, record }: Props) {
  const navigate = useNavigate();
  const q = useServiceQuery(() => (perm(actor, 'quotations').read === 'none' ? [] : queryRecords(actor, 'quotations', { where: { opportunityId: record.id }, sort: [{ field: 'quoteDate', dir: 'desc' }] }).rows), [record.id, actor.user.id]);
  const closed = ['won', 'lost'].includes(String(record.stage));
  const selected = selectedQuoteOf(getDb(), record.id);
  const action = (
    <Button
      variant="primary"
      icon="plus"
      onClick={() => navigate(toPath(ROUTES.quotationNew, {}, { opportunity: record.id }))}
      disabledReason={!perm(actor, 'quotations').create ? C.cannotCreate(actor.role.label) : record.stage === 'won' && selected ? SEL.oppWonNew(String(selected.quoteNo)) : closed ? C.oppClosed : undefined}
    >
      {A.newQuotation}
    </Button>
  );
  if (q.error)
    return (
      <ErrorState title={C.quotationsError} onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={3} />;
  const rows = q.data;
  if (!rows.length)
    return (
      <EmptyState icon="receipt" title={C.noQuotations} action={action}>
        {C.noQuotationsBody}
      </EmptyState>
    );
  const G = SEL.groups;
  const groupOf = (r: (typeof rows)[number]) => (r.status === 'accepted' ? 'selected' : r.status === 'not_selected' ? 'notSelected' : r.status === 'superseded' || !r.isLatest ? 'superseded' : ['rejected', 'expired'].includes(String(r.status)) ? 'closed' : 'active');
  const order = ['selected', 'active', 'notSelected', 'superseded', 'closed'] as const;
  return (
    <div className="qt-tab">
      {order.map((g) => {
        const list = rows.filter((r) => groupOf(r) === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-label={G[g]}>
            <h3 className="panel-title">
              {G[g]} <span className="muted small">({list.length})</span>
            </h3>
            <ul className="flow-list">
              {list.map((r) => {
                const st = masterValue('quoteStatus', r.status);
                return (
                  <li key={r.id} className="flow-item">
                    <Link to={quotePath(r.id)} className="flow-main">
                      <span className="flow-title">
                        {String(r.quoteNo)} · {formatMoney(Number(r.grandTotal) || 0)}
                      </span>
                      <span className="muted small">
                        {formatDate(String(r.quoteDate))} · {g === 'notSelected' && r.notSelectedReason ? String(r.notSelectedReason) : C.validUntilShort(formatDate(String(r.validUntil)))}
                      </span>
                    </Link>
                    {g === 'selected' && <StatusChip label={SEL.selectedChip} tone="success" />}
                    {st && <StatusChip label={st.label} tone={st.tone} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {action}
    </div>
  );
}
