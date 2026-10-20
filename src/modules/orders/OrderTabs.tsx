/**
 * Sales order record tabs (GLOSSARY §1.2): Changes vs Quotation, Approval, Payment Schedule, Order Processing,
 * ERP Invoice, Dispatch & Delivery, Sales Contract, Hold / Cancellation. Details and Activity are shared tabs.
 */
import { APPROVAL_TONE } from '../../domain/statusTones';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordEditPath, recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { orderView, pushOrderToErp, recordPaymentReceipt, savePaymentSchedule, generateSalesContract, sendContractForSignature, signSalesContract, updateOrderProcessing } from '../../services/api/orders';
import { can, canUpdateRecord } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getResource, getUser, masterValue } from '../../services/registry';
import { getPolicies } from '../../services/policies';
import { approvalTypeLabel } from '../../services/workflow';
import { APPROVAL, type ScheduleRow } from '../../services/orders/orders';
import type { Approval } from '../../services/types';
import { ServiceError } from '../../services/types';
import { SO_PROCESSING_STATUSES, CUSTOMS_STATUSES } from '../../domain/modules/orders';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { DiffAlert, Field, LinesTable, TotalsBlock } from './components';
import { ConfirmDeliveryDialog } from './OrderActions';
import { Checkbox, LinkButton, TextField, Textarea } from '../../components/primitives/controls';
import { Table } from '../../components/primitives/Table';

const O = L.orders;
const D = L.dispatch;
const F = O.fields.salesOrders;
const R = O.record;

function useOrder(record: RecordExtensionProps['record'], actor: RecordExtensionProps['actor']) {
  return useServiceQuery(() => orderView(actor, record.id), [record.id, actor.user.id]);
}

function Loading({ q }: { q: { error: string | null; retry: () => void } }) {
  return q.error ? (
    <ErrorState title={O.common.loadError} onRetry={q.retry}>
      {q.error}
    </ErrorState>
  ) : (
    <Skeleton rows={4} />
  );
}

export const chip = (master: string, key: unknown) => {
  const v = masterValue(master, key);
  return v ? <StatusChip label={v.label} tone={v.tone} /> : <EmptyValue />;
};


const approvalChip = (a: Approval) => <StatusChip label={O.approvals.status[a.status]} tone={APPROVAL_TONE[a.status]} />;
const userName = (id: string | undefined) => (id ? getUser(id)?.name ?? id : '');

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- Changes vs Quotation (SO-03)

export function LinesTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  if (!q.data) return <Loading q={q} />;
  const v = q.data;
  const o = v.order;
  return (
    <div className="details">
      {v.diff ? <DiffAlert diff={v.diff} tolerance={getPolicies().soTolerancePct} /> : <InlineAlert tone="info">{O.diff.noQuotation}</InlineAlert>}
      <LinesTable lines={v.lines} diffAgainst={v.quotation ? v.quotationLines : undefined} />
      <TotalsBlock
        t={{ subtotal: Number(o.subtotal), discountTotal: Number(o.discountTotal), freight: Number(o.freight) || 0, insurance: Number(o.insurance) || 0, taxable: Number(o.taxable), cgst: Number(o.cgst), sgst: Number(o.sgst), igst: Number(o.igst), grandTotal: Number(o.grandTotal), maxDiscountPct: Number(o.maxDiscountPct) }}
        intraState={String(o.placeOfSupply) === getPolicies().companyGstState}
      />
      {v.canEditLines && (
        <p>
          <LinkButton to={recordEditPath('salesOrders', o.id)}>{O.actions.editLines}</LinkButton>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Approval (SO-04)

function ApprovalList({ list }: { list: Approval[] }) {
  return (
    
      <Table>
        <thead>
          <tr>
            <th scope="col">{O.table.type}</th>
            <th scope="col">{O.table.requested}</th>
            <th scope="col">{O.table.reason}</th>
            <th scope="col">{O.table.levels}</th>
            <th scope="col">{O.table.status}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <td>
                {approvalTypeLabel(a.type)}
                <div className="muted small mono">{a.id}</div>
              </td>
              <td className="nowrap">
                <DateText value={a.requestedAt.slice(0, 10)} />
                <div className="muted small">{userName(a.requestedBy)}</div>
              </td>
              <td>{a.reason || <EmptyValue />}</td>
              <td>
                {a.levels.map((l, i) => {
                  const d = a.decisions.find((x) => x.level === i);
                  return (
                    <div key={i} className="small">
                      {R.level(i + 1, a.levels.length, l.label)}
                      {d && <div className="muted">{R.decidedBy(userName(d.by), O.approvals.status[d.decision], d.note)}</div>}
                    </div>
                  );
                })}
              </td>
              <td>{approvalChip(a)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    
  );
}

export function ApprovalTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  if (!q.data) return <Loading q={q} />;
  const list = q.data.approvals.filter((a) => a.type === APPROVAL);
  return (
    <div className="details">
      <dl className="detail-list">
        <Row label={F.status}>{chip('soStatus', q.data.order.status)}</Row>
        <Row label={F.financeCheck}>{q.data.order.financeCheck ? O.common.yes : O.common.no}</Row>
      </dl>
      {list.length ? (
        <ApprovalList list={list} />
      ) : (
        <EmptyState icon="check-square" title={R.noApprovals}>
          {R.noApprovalsBody}
        </EmptyState>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Payment Schedule (SO-07 / BR-25)

export function PaymentsTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  const [editing, setEditing] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  if (!q.data) return <Loading q={q} />;
  const v = q.data;
  const closed = ['completed', 'cancelled'].includes(String(v.order.status));
  const received = v.milestones.reduce((t, m) => t + (Number(m.receivedAmount) || 0), 0);
  const total = Number(v.order.grandTotal);
  const FM = O.fields.paymentMilestones;
  return (
    <div className="details">
      <dl className="detail-list">
        <Row label={R.received}>{R.receivedOf(formatMoney(received), formatMoney(total))}</Row>
        <Row label={R.outstanding}>{formatMoney(Math.max(0, total - received))}</Row>
      </dl>
      {v.milestones.length ? (
        
          <Table>
            <thead>
              <tr>
                <th scope="col">{FM.label}</th>
                <th scope="col" className="th-num">
                  {FM.percent}
                </th>
                <th scope="col" className="th-num">
                  {FM.amount}
                </th>
                <th scope="col">{FM.dueDate}</th>
                <th scope="col" className="th-num">
                  {FM.receivedAmount}
                </th>
                <th scope="col">{FM.status}</th>
                <th scope="col">
                  <span className="sr-only">{O.table.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {v.milestones.map((m) => (
                <tr key={m.id}>
                  <td>{String(m.label)}</td>
                  <td className="num">{String(m.percent)}%</td>
                  <td className="num">{formatMoney(Number(m.amount))}</td>
                  <td>
                    <DateText value={String(m.dueDate)} />
                  </td>
                  <td className="num">{formatMoney(Number(m.receivedAmount) || 0)}</td>
                  <td>{chip('milestoneStatus', m.status)}</td>
                  <td>
                    {can(actor, 'orders.receipts') && m.status !== 'received' && !['pending_approval', 'cancelled'].includes(String(v.order.status)) && (
                      <Button size="compact" onClick={() => setReceipt(m.id)}>
                        {O.actions.recordReceipt}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        
      ) : (
        <EmptyState icon="calendar-clock" title={R.noSchedule} />
      )}
      <div className="row-gap">
        <Button onClick={() => setEditing(true)} disabledReason={!v.canEdit ? O.common.readOnly(actor.role.label) : closed ? R.closed : undefined}>
          {O.actions.editSchedule}
        </Button>
        <Link className="link small" to={ROUTES.paymentSchedule}>
          {O.actions.allMilestones}
        </Link>
      </div>
      <p className="muted small">{R.erpNote(getPolicies().paymentReminderDaysBefore)}</p>
      {editing && <ScheduleDialog orderId={v.order.id} orderDate={String(v.order.orderDate)} rows={v.milestones.map((m) => ({ id: m.id, label: String(m.label), percent: Number(m.percent), dueDate: String(m.dueDate), received: Number(m.receivedAmount) || 0 }))} onClose={() => setEditing(false)} />}
      {receipt && <ReceiptDialog milestone={v.milestones.find((m) => m.id === receipt)!} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function ScheduleDialog({ orderId, orderDate, rows: initial, onClose }: { orderId: string; orderDate: string; rows: (ScheduleRow & { received: number })[]; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const total = Math.round(rows.reduce((t, r) => t + (Number(r.percent) || 0), 0) * 100) / 100;
  const set = (i: number, p: Partial<ScheduleRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const FM = O.fields.paymentMilestones;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={R.scheduleTitle}
      description={R.scheduleDescription}
      footer={
        <>
          <Button onClick={onClose}>{O.actions.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await savePaymentSchedule(actor, orderId, rows.map(({ id, label, percent, dueDate }) => ({ id, label, percent: Number(percent), dueDate })));
                toast(R.scheduleSaved);
                onClose();
              } catch (e) {
                setError(errorMessage(e));
                toast(errorMessage(e), 'danger');
              } finally {
                setBusy(false);
              }
            }}
          >
            {O.actions.saveSchedule}
          </Button>
        </>
      }
    >
      
        <Table>
          <thead>
            <tr>
              <th scope="col">{FM.label}</th>
              <th scope="col">{O.table.sharePct}</th>
              <th scope="col">{FM.dueDate}</th>
              <th scope="col">
                <span className="sr-only">{O.actions.remove}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`}>
                <td>
                  <TextField dense aria-label={R.milestoneAria(i + 1, FM.label)} value={r.label} maxLength={60} onChange={(e) => set(i, { label: e.target.value })} />
                </td>
                <td>
                  <TextField dense className="orders-num" type="number" min={0} max={100} aria-label={R.milestoneAria(i + 1, FM.percent)} value={r.percent} onChange={(e) => set(i, { percent: Number(e.target.value) })} />
                </td>
                <td>
                  <DatePicker label={R.milestoneAria(i + 1, FM.dueDate)} value={r.dueDate} onChange={(v) => set(i, { dueDate: v ?? '' })} clearable={false} />
                </td>
                <td>
                  <button type="button" className="link small" disabled={r.received > 0 || rows.length === 1} title={r.received > 0 ? R.hasReceipts : undefined} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    {O.actions.remove}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      
      <div className="row-gap">
        <Button icon="plus" onClick={() => setRows([...rows, { label: O.schedule.balance, percent: Math.max(0, Math.round((100 - total) * 100) / 100), dueDate: addDays(orderDate, 60), received: 0 }])}>
          {O.actions.addMilestone}
        </Button>
        <span className={total === 100 ? 'muted small' : 'small text-danger'}>{R.total(total)}</span>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function ReceiptDialog({ milestone, onClose }: { milestone: Record<string, unknown> & { id: string }; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const outstanding = Math.round((Number(milestone.amount) - (Number(milestone.receivedAmount) || 0)) * 100) / 100;
  const [amount, setAmount] = useState(String(outstanding));
  const [date, setDate] = useState(todayKey());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={R.receiptTitle(String(milestone.label))}
      description={R.receiptDescription}
      footer={
        <>
          <Button onClick={onClose}>{O.actions.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                await recordPaymentReceipt(actor, milestone.id, Number(amount), date);
                toast(R.receiptSaved(formatMoney(Number(amount))));
                onClose();
              } catch (e) {
                setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
                toast(errorMessage(e), 'danger');
              } finally {
                setBusy(false);
              }
            }}
          >
            {O.actions.recordReceipt}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field id="rc-amount" label={R.receiptAmount} required help={R.receiptOutstanding(formatMoney(outstanding))} error={errors.amount}>
          <TextField id="rc-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount || undefined} data-autofocus />
        </Field>
        <Field id="rc-date" label={R.receiptDate} required error={errors.receivedAt}>
          <DatePicker id="rc-date" label={R.receiptDate} value={date} onChange={(v) => setDate(v ?? '')} invalid={!!errors.receivedAt} />
        </Field>
      </div>
      {errors.form && (
        <p className="field-error" role="alert">
          {errors.form}
        </p>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- Order Processing (SO-08)

export function ProcessingTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  const toast = useToast();
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!q.data) return <Loading q={q} />;
  const o = q.data.order;
  const editable = can(actor, 'orders.process') && canUpdateRecord(actor, getResource('salesOrders'), o) && SO_PROCESSING_STATUSES.includes(String(o.status));
  const f = form ?? { poToPrincipalNo: o.poToPrincipalNo ?? '', poToPrincipalDate: o.poToPrincipalDate ?? '', shipmentEta: o.shipmentEta ?? '', customsStatus: o.customsStatus ?? 'not_applicable', machineReady: !!o.machineReady, pdiDone: !!o.pdiDone, processingNotes: o.processingNotes ?? '' };
  const set = (p: Record<string, unknown>) => setForm({ ...f, ...p });
  const yesNo = (b: unknown) => (b ? O.common.yes : O.common.no);
  const link = (
    <Link className="link small" to={ROUTES.orderProcessing}>
      {L.nav.pages.orderProcessing.title}
    </Link>
  );
  if (!editable)
    return (
      <div className="details">
        {!can(actor, 'orders.process') && <InlineAlert tone="info">{R.processingViewOnly}</InlineAlert>}
        <dl className="detail-list">
          <Row label={R.poToPrincipal}>{o.poToPrincipalNo ? `${o.poToPrincipalNo}${o.poToPrincipalDate ? ` · ${formatDate(String(o.poToPrincipalDate))}` : ''}` : <EmptyValue />}</Row>
          <Row label={F.shipmentEta}>{o.shipmentEta ? <DateText value={String(o.shipmentEta)} /> : <EmptyValue />}</Row>
          <Row label={F.customsStatus}>{chip('customsStatus', o.customsStatus)}</Row>
          <Row label={F.machineReady}>{yesNo(o.machineReady)}</Row>
          <Row label={F.pdiDone}>{yesNo(o.pdiDone)}</Row>
          <Row label={R.notes}>{o.processingNotes ? String(o.processingNotes) : <EmptyValue />}</Row>
        </dl>
        {link}
      </div>
    );
  return (
    <div className="details">
      <div className="form-grid cols-2">
        <Field id="pr-po" label={F.poToPrincipalNo} error={errors.poToPrincipalNo}>
          <TextField id="pr-po" maxLength={40} value={String(f.poToPrincipalNo)} onChange={(e) => set({ poToPrincipalNo: e.target.value })} aria-invalid={!!errors.poToPrincipalNo || undefined} />
        </Field>
        <Field id="pr-po-date" label={F.poToPrincipalDate} error={errors.poToPrincipalDate}>
          <DatePicker id="pr-po-date" label={F.poToPrincipalDate} value={String(f.poToPrincipalDate || '')} onChange={(v) => set({ poToPrincipalDate: v ?? '' })} invalid={!!errors.poToPrincipalDate} />
        </Field>
        <Field id="pr-eta" label={F.shipmentEta} error={errors.shipmentEta}>
          <DatePicker id="pr-eta" label={F.shipmentEta} value={String(f.shipmentEta || '')} onChange={(v) => set({ shipmentEta: v ?? '' })} invalid={!!errors.shipmentEta} />
        </Field>
        <Field id="pr-customs" label={F.customsStatus} error={errors.customsStatus}>
          <SelectMenu id="pr-customs" block label={F.customsStatus} value={String(f.customsStatus)} options={CUSTOMS_STATUSES.map((k) => ({ value: k, label: masterValue('customsStatus', k)?.label ?? k }))} onChange={(v) => set({ customsStatus: v })} />
        </Field>
        <div>
          <label className="orders-check">
            <Checkbox checked={!!f.machineReady} onChange={(e) => set({ machineReady: e.target.checked })} /> {F.machineReady}
          </label>
          {errors.machineReady && <p className="field-error">{errors.machineReady}</p>}
        </div>
        <div>
          <label className="orders-check">
            <Checkbox checked={!!f.pdiDone} onChange={(e) => set({ pdiDone: e.target.checked })} /> {F.pdiDone}
          </label>
          {errors.pdiDone && <p className="field-error">{errors.pdiDone}</p>}
        </div>
        <Field id="pr-notes" label={F.processingNotes} wide error={errors.processingNotes}>
          <Textarea id="pr-notes" className="textarea" rows={2} maxLength={1000} value={String(f.processingNotes)} onChange={(e) => set({ processingNotes: e.target.value })} />
        </Field>
      </div>
      {errors.form && <p className="field-error">{errors.form}</p>}
      <div className="row-gap">
        <Button
          variant="primary"
          loading={busy}
          disabledReason={form ? undefined : R.noChanges}
          onClick={async () => {
            setBusy(true);
            setErrors({});
            try {
              await updateOrderProcessing(
                actor,
                o.id,
                { poToPrincipalNo: String(f.poToPrincipalNo ?? ''), poToPrincipalDate: String(f.poToPrincipalDate ?? ''), shipmentEta: String(f.shipmentEta ?? ''), customsStatus: String(f.customsStatus), machineReady: !!f.machineReady, pdiDone: !!f.pdiDone, processingNotes: String(f.processingNotes ?? '') },
                o.version,
              );
              toast(R.processingSaved);
              setForm(null);
            } catch (e) {
              setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
              toast(errorMessage(e), 'danger');
            } finally {
              setBusy(false);
            }
          }}
        >
          {O.actions.saveProcessing}
        </Button>
        {link}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ERP Invoice (SO-09)

export function ErpInvoiceTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!q.data) return <Loading q={q} />;
  const o = q.data.order;
  const approved = !['pending_approval', 'cancelled'].includes(String(o.status));
  return (
    <div className="details">
      {!approved ? <InlineAlert tone="info">{R.erpBeforeApproval}</InlineAlert> : !o.invoiceNo && <InlineAlert tone="info">{R.erpPending}</InlineAlert>}
      <dl className="detail-list">
        <Row label={F.financeCheck}>{o.financeCheck ? O.common.yes : O.common.no}</Row>
        <Row label={F.erpPushedAt}>{o.erpPushedAt ? <DateText value={String(o.erpPushedAt).slice(0, 10)} /> : <EmptyValue label={R.erpNotPushed} />}</Row>
        <Row label={F.invoiceNo}>{o.invoiceNo ? <span className="mono">{String(o.invoiceNo)}</span> : <EmptyValue />}</Row>
        <Row label={F.invoiceDate}>{o.invoiceDate ? <DateText value={String(o.invoiceDate)} /> : <EmptyValue />}</Row>
        <Row label={F.ewayBill}>{o.ewayBill ? <span className="mono">{String(o.ewayBill)}</span> : <EmptyValue />}</Row>
      </dl>
      {approved && !o.invoiceNo && (
        <div className="row-gap">
          <Button
            icon="reset"
            loading={busy}
            disabledReason={can(actor, 'orders.erp') ? undefined : O.disabled.erp}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await pushOrderToErp(actor, o.id);
                toast(R.erpReceived(String(r.invoiceNo)));
              } catch (e) {
                toast(errorMessage(e), 'danger');
              } finally {
                setBusy(false);
              }
            }}
          >
            {O.actions.pushToErp}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Dispatch & Delivery (INS-01 / INS-02)

export function DispatchTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  const [delivering, setDelivering] = useState<string | null>(null);
  if (!q.data) return <Loading q={q} />;
  const list = q.data.dispatches;
  return (
    <div className="details">
      {list.length ? (
        list.map((d) => (
          <section key={d.id} className="detail-section">
            <h3 className="detail-section-title">
              <Link to={recordPeekPath('tc', 'dispatches', d.id)}>{R.dispatchTitle(d.id, String(d.transporter))}</Link> {chip('dispatchStatus', d.status)}
            </h3>
            <dl className="detail-list">
              <Row label={R.lrChallan}>
                {String(d.lrNumber)}
                {d.challanNo ? ` · ${d.challanNo}` : ''}
              </Row>
              <Row label={R.invoiceEway}>{[d.invoiceRef, d.ewayBill].filter(Boolean).join(' · ') || <EmptyValue />}</Row>
              <Row label={R.dispatched}>
                <DateText value={String(d.dispatchDate)} />
              </Row>
              <Row label={R.expectedActual}>
                <DateText value={String(d.expectedDelivery)} /> / {d.actualDelivery ? <DateText value={String(d.actualDelivery)} /> : <EmptyValue label={O.common.notYet} />}
                {!d.actualDelivery && String(d.expectedDelivery) < todayKey() && <span className="tag tone-danger orders-tag">{O.common.delayed}</span>}
              </Row>
              <Row label={R.pod}>{d.podFileName ? `${d.podFileName}${d.podPhotoName ? R.podPhoto(String(d.podPhotoName)) : ''}` : <EmptyValue />}</Row>
            </dl>
            {d.status === 'in_transit' && can(actor, 'orders.dispatch') && <Button onClick={() => setDelivering(d.id)}>{D.actions.confirmDelivery}</Button>}
          </section>
        ))
      ) : (
        <EmptyState icon="send" title={R.notDispatched}>
          {q.data.order.status === 'ready_for_dispatch' ? R.notDispatchedReady : R.notDispatchedLater}
        </EmptyState>
      )}
      {delivering && <ConfirmDeliveryDialog dispatch={list.find((x) => x.id === delivering)!} onClose={() => setDelivering(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Sales Contract (SO-05 / SO-06)

export function ContractTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sign, setSign] = useState<{ id: string; otp: string } | null>(null);
  if (!q.data) return <Loading q={q} />;
  const v = q.data;
  const current = v.contracts.find((c) => c.status !== 'superseded');
  const approved = !['pending_approval', 'cancelled'].includes(String(v.order.status));
  const canGenerate = can(actor, 'orders.contract') && v.canEdit;
  const generate = async () => {
    setBusy(true);
    try {
      const c = await generateSalesContract(actor, v.order.id);
      toast(R.contractGenerated(String(c.contractNo)));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="details">
      {!approved && <InlineAlert tone="info">{R.contractAfterApproval}</InlineAlert>}
      {current ? (
        <section className="detail-section">
          <h3 className="detail-section-title">
            <Link to={recordPeekPath('tc', 'salesContracts', current.id)}>{R.contractHeading(String(current.contractNo), String(current.contractVersion))}</Link> {chip('contractStatus', current.status)}
          </h3>
          <dl className="detail-list">
            <Row label={R.contractValue}>{formatMoney(Number(current.contractValue))}</Row>
            <Row label={R.contractSigned}>
              {current.signedAt ? (
                <>
                  {String(current.signedBy)} · <DateText value={String(current.signedAt)} showTime />
                </>
              ) : (
                <EmptyValue label={O.common.notSigned} />
              )}
            </Row>
          </dl>
          <div className="row-gap">
            <LinkButton to={toPath(ROUTES.salesContractPdf, { recordId: v.order.id })}>{O.actions.viewPdf}</LinkButton>
            <LinkButton to={recordPeekPath('tc', 'salesContracts', current.id)}>{O.actions.editTerms}</LinkButton>
            {['draft', 'sent_for_signature'].includes(String(current.status)) && (
              <Button
                disabledReason={can(actor, 'orders.contract') ? undefined : O.disabled.sendContract}
                onClick={async () => {
                  try {
                    const r = await sendContractForSignature(actor, current.id);
                    setSign({ id: current.id, otp: r.otp });
                    toast(r.to ? R.signingSent(r.to) : R.signingCreated, 'info');
                  } catch (e) {
                    toast(errorMessage(e), 'danger');
                  }
                }}
              >
                {O.actions.sendForSignature}
              </Button>
            )}
            {current.status !== 'signed' && (
              <Button loading={busy} onClick={generate} disabledReason={canGenerate ? undefined : O.disabled.contract}>
                {O.actions.newContractVersion}
              </Button>
            )}
          </div>
        </section>
      ) : (
        <EmptyState
          icon="scroll-text"
          title={R.noContract}
          action={
            <Button variant="primary" loading={busy} onClick={generate} disabledReason={!approved ? O.disabled.notApproved : canGenerate ? undefined : O.disabled.contract}>
              {O.actions.generateSalesContract}
            </Button>
          }
        >
          {R.noContractBody(String(v.order.divisionId))}
        </EmptyState>
      )}
      {v.contracts.filter((c) => c.status === 'superseded').length > 0 && (
        <p className="muted small">
          {R.earlierVersions(
            v.contracts
              .filter((c) => c.status === 'superseded')
              .map((c) => `v${c.contractVersion}`)
              .join(', '),
          )}
        </p>
      )}
      {sign && <SignDialog contractId={sign.id} otp={sign.otp} onClose={() => setSign(null)} />}
    </div>
  );
}

export function SignDialog({ contractId, otp, onClose }: { contractId: string; otp: string; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={R.signTitle}
      description={R.signDescription}
      footer={
        <>
          <Button onClick={onClose}>{O.actions.later}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              setErrors({});
              try {
                await signSalesContract(actor, contractId, code, name);
                toast(R.signed);
                onClose();
              } catch (e) {
                setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
                toast(errorMessage(e), 'danger');
              }
            }}
          >
            {O.actions.signContract}
          </Button>
        </>
      }
    >
      <InlineAlert tone="info" title={R.otpTitle}>
        {R.otpBody} <strong className="mono">{otp}</strong>.
      </InlineAlert>
      <div className="form-grid cols-2">
        <Field id="sg-name" label={R.signerName} required error={errors.signerName}>
          <TextField id="sg-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <Field id="sg-otp" label={R.otp} required error={errors.otp}>
          <TextField id="sg-otp" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      {errors.form && <p className="field-error">{errors.form}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- Hold / Cancellation (SO-10)

export function HoldCancelTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  if (!q.data) return <Loading q={q} />;
  const o = q.data.order;
  const list = q.data.approvals.filter((a) => a.type !== APPROVAL);
  const before = o.statusBeforeHold ? masterValue('soStatus', o.statusBeforeHold)?.label ?? String(o.statusBeforeHold) : '';
  return (
    <div className="details">
      {o.status === 'on_hold' && <InlineAlert tone="danger" title={O.banner.hold}>{before ? R.onHoldSince(before) : String(o.holdReason ?? '')}</InlineAlert>}
      <dl className="detail-list">
        <Row label={F.status}>{chip('soStatus', o.status)}</Row>
        <Row label={F.holdReason}>{o.holdReason ? String(o.holdReason) : <EmptyValue />}</Row>
        <Row label={F.cancelReason}>{o.cancelReason ? String(o.cancelReason) : <EmptyValue />}</Row>
      </dl>
      <h3 className="detail-section-title">{R.holdHistory}</h3>
      {list.length ? (
        <ApprovalList list={list} />
      ) : (
        <EmptyState icon="alert" title={R.noHoldHistory}>
          {R.noHoldHistoryBody}
        </EmptyState>
      )}
    </div>
  );
}
