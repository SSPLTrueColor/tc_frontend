/** Record tabs on a sales order: Lines, Payments, Processing, Dispatch, Contract. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { call, errorMessage } from '../../services/api/client';
import { orderView, recordPaymentReceipt, savePaymentSchedule, generateSalesContract, sendContractForSignature, signSalesContract } from '../../services/api/orders';
import { can, canUpdateRecord } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getResource, masterValue } from '../../services/registry';
import { updateRecord } from '../../services/runtime';
import { getPolicies } from '../../services/policies';
import type { ScheduleRow } from '../../services/orders/orders';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { DiffAlert, Field, LinesTable, TotalsBlock } from './components';
import { ConfirmDeliveryDialog } from './OrderActions';

function useOrder(record: RecordExtensionProps['record'], actor: RecordExtensionProps['actor']) {
  return useServiceQuery(() => orderView(actor, record.id), [record.id, actor.user.id]);
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

const chip = (master: string, key: unknown) => {
  const v = masterValue(master, key);
  return v ? <StatusChip label={v.label} tone={v.tone} /> : <EmptyValue />;
};

// ---------------------------------------------------------------- Lines

export function LinesTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  if (!q.data) return <Loading q={q} />;
  const v = q.data;
  const o = v.order;
  return (
    <div className="details">
      {v.diff && <DiffAlert diff={v.diff} tolerance={getPolicies().soTolerancePct} />}
      <LinesTable lines={v.lines} diffAgainst={v.quotation ? v.quotationLines : undefined} />
      <TotalsBlock
        t={{ subtotal: Number(o.subtotal), discountTotal: Number(o.discountTotal), freight: Number(o.freight) || 0, insurance: Number(o.insurance) || 0, taxable: Number(o.taxable), cgst: Number(o.cgst), sgst: Number(o.sgst), igst: Number(o.igst), grandTotal: Number(o.grandTotal), maxDiscountPct: Number(o.maxDiscountPct) }}
        intraState={String(o.placeOfSupply) === getPolicies().companyGstState}
      />
      {v.canEditLines && (
        <p>
          <Link className="btn btn-secondary" to={`/salesOrders/${encodeURIComponent(o.id)}/edit`}>
            <span className="btn-label">Edit lines</span>
          </Link>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Payments (FR-055 / BR-25)

export function PaymentsTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  const [editing, setEditing] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  if (!q.data) return <Loading q={q} />;
  const v = q.data;
  const closed = ['completed', 'cancelled'].includes(String(v.order.status));
  const received = v.milestones.reduce((t, m) => t + (Number(m.receivedAmount) || 0), 0);
  const total = Number(v.order.grandTotal);
  return (
    <div className="details">
      <dl className="detail-list">
        <div className="detail-row">
          <dt>Received</dt>
          <dd>
            {formatMoney(received)} of {formatMoney(total)}
          </dd>
        </div>
        <div className="detail-row">
          <dt>Outstanding</dt>
          <dd>{formatMoney(Math.max(0, total - received))}</dd>
        </div>
      </dl>
      {v.milestones.length ? (
        <div className="table-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">Milestone</th>
                <th scope="col" className="th-num">
                  Share
                </th>
                <th scope="col" className="th-num">
                  Amount
                </th>
                <th scope="col">Due</th>
                <th scope="col" className="th-num">
                  Received
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
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
                        Record receipt
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="calendar-clock" title="No payment schedule" />
      )}
      <div className="row-gap">
        <Button onClick={() => setEditing(true)} disabledReason={!v.canEdit ? `Read-only for ${actor.role.label}` : closed ? 'The order is closed' : undefined}>
          Edit schedule
        </Button>
      </div>
      <p className="muted small">Receipts and outstanding amounts come from the ERP (simulated: Accounts records what the ERP reports). Reminders go to the sales owner {getPolicies().paymentReminderDaysBefore} days before and after each due date.</p>
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
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Payment schedule"
      description="Advance, milestone and balance payments. The shares must total 100%. Milestones with receipts cannot be removed."
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
                await savePaymentSchedule(actor, orderId, rows.map(({ id, label, percent, dueDate }) => ({ id, label, percent: Number(percent), dueDate })));
                toast('Payment schedule saved');
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save schedule
          </Button>
        </>
      }
    >
      <div className="table-scroll">
        <table className="mini-table">
          <thead>
            <tr>
              <th scope="col">Milestone</th>
              <th scope="col">Share %</th>
              <th scope="col">Due date</th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`}>
                <td>
                  <input className="input input-compact" aria-label={`Milestone ${i + 1} label`} value={r.label} maxLength={60} onChange={(e) => set(i, { label: e.target.value })} />
                </td>
                <td>
                  <input className="input input-compact orders-num" type="number" min={0} max={100} aria-label={`Milestone ${i + 1} share`} value={r.percent} onChange={(e) => set(i, { percent: Number(e.target.value) })} />
                </td>
                <td>
                  <DatePicker label={`Milestone ${i + 1} due date`} value={r.dueDate} onChange={(v) => set(i, { dueDate: v ?? '' })} clearable={false} />
                </td>
                <td>
                  <button type="button" className="link small" disabled={r.received > 0 || rows.length === 1} title={r.received > 0 ? 'Has receipts' : undefined} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-gap">
        <Button icon="plus" onClick={() => setRows([...rows, { label: 'Balance', percent: Math.max(0, Math.round((100 - total) * 100) / 100), dueDate: addDays(orderDate, 60), received: 0 }])}>
          Add milestone
        </Button>
        <span className={total === 100 ? 'muted small' : 'small text-danger'}>Total {total}%</span>
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Record receipt · ${String(milestone.label)}`}
      description="Simulates the receipt the ERP would report. Nothing is charged or collected here."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await recordPaymentReceipt(actor, milestone.id, Number(amount), date);
                toast(`Receipt of ${formatMoney(Number(amount))} recorded`);
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Record receipt
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field id="rc-amount" label="Amount (₹)" required help={`Outstanding ${formatMoney(outstanding)}`}>
          <input id="rc-amount" className="input" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus />
        </Field>
        <Field id="rc-date" label="Received on" required>
          <DatePicker id="rc-date" label="Received on" value={date} onChange={(v) => setDate(v ?? '')} />
        </Field>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- Processing (FR-056)

export function ProcessingTab({ actor, record }: RecordExtensionProps) {
  const q = useOrder(record, actor);
  const toast = useToast();
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!q.data) return <Loading q={q} />;
  const o = q.data.order;
  const editable = can(actor, 'orders.process') && canUpdateRecord(actor, getResource('salesOrders'), o) && ['confirmed', 'payment_pending', 'payment_received', 'processing', 'ready_for_dispatch', 'on_hold'].includes(String(o.status));
  const f = form ?? { poToPrincipalNo: o.poToPrincipalNo ?? '', poToPrincipalDate: o.poToPrincipalDate ?? '', shipmentEta: o.shipmentEta ?? '', customsStatus: o.customsStatus ?? 'not_applicable', machineReady: !!o.machineReady, pdiDone: !!o.pdiDone, processingNotes: o.processingNotes ?? '' };
  const set = (p: Record<string, unknown>) => setForm({ ...f, ...p });
  const statusText = (b: unknown) => (b ? 'Yes' : 'No');
  if (!editable)
    return (
      <div className="details">
        {!can(actor, 'orders.process') && <InlineAlert tone="info">Import / SCM updates processing. You can follow the progress here.</InlineAlert>}
        <dl className="detail-list">
          <div className="detail-row">
            <dt>PO to principal</dt>
            <dd>{o.poToPrincipalNo ? `${o.poToPrincipalNo}${o.poToPrincipalDate ? ` · ${formatDate(String(o.poToPrincipalDate))}` : ''}` : <EmptyValue />}</dd>
          </div>
          <div className="detail-row">
            <dt>Shipment ETA</dt>
            <dd>{o.shipmentEta ? <DateText value={String(o.shipmentEta)} /> : <EmptyValue />}</dd>
          </div>
          <div className="detail-row">
            <dt>Customs</dt>
            <dd>{chip('customsStatus', o.customsStatus)}</dd>
          </div>
          <div className="detail-row">
            <dt>Machine ready</dt>
            <dd>{statusText(o.machineReady)}</dd>
          </div>
          <div className="detail-row">
            <dt>Pre-dispatch inspection</dt>
            <dd>{statusText(o.pdiDone)}</dd>
          </div>
          <div className="detail-row">
            <dt>Notes</dt>
            <dd>{o.processingNotes ? String(o.processingNotes) : <EmptyValue />}</dd>
          </div>
        </dl>
      </div>
    );
  return (
    <div className="details">
      <div className="form-grid cols-2">
        <Field id="pr-po" label="PO to principal no.">
          <input id="pr-po" className="input" maxLength={40} value={String(f.poToPrincipalNo)} onChange={(e) => set({ poToPrincipalNo: e.target.value })} />
        </Field>
        <Field id="pr-po-date" label="PO to principal date">
          <DatePicker id="pr-po-date" label="PO to principal date" value={String(f.poToPrincipalDate || '')} onChange={(v) => set({ poToPrincipalDate: v ?? '' })} />
        </Field>
        <Field id="pr-eta" label="Shipment ETA">
          <DatePicker id="pr-eta" label="Shipment ETA" value={String(f.shipmentEta || '')} onChange={(v) => set({ shipmentEta: v ?? '' })} />
        </Field>
        <Field id="pr-customs" label="Customs">
          <SelectMenu
            id="pr-customs"
            block
            label="Customs"
            value={String(f.customsStatus)}
            options={['not_applicable', 'pending', 'filed', 'cleared'].map((k) => ({ value: k, label: masterValue('customsStatus', k)?.label ?? k }))}
            onChange={(v) => set({ customsStatus: v })}
          />
        </Field>
        <label className="orders-check">
          <input type="checkbox" checked={!!f.machineReady} onChange={(e) => set({ machineReady: e.target.checked })} /> Machine ready
        </label>
        <label className="orders-check">
          <input type="checkbox" checked={!!f.pdiDone} onChange={(e) => set({ pdiDone: e.target.checked })} /> Pre-dispatch inspection done
        </label>
        <Field id="pr-notes" label="Processing notes" wide>
          <textarea id="pr-notes" className="input textarea" rows={2} maxLength={1000} value={String(f.processingNotes)} onChange={(e) => set({ processingNotes: e.target.value })} />
        </Field>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="row-gap">
        <Button
          variant="primary"
          loading={busy}
          disabledReason={form ? undefined : 'No changes'}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const patch = { ...f, poToPrincipalDate: f.poToPrincipalDate || null, shipmentEta: f.shipmentEta || null };
              await call(() => updateRecord(actor, 'salesOrders', o.id, patch, o.version));
              toast('Processing status updated');
              setForm(null);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save processing
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Dispatch (FR-060 / FR-061)

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
              {d.id} · {String(d.transporter)} {chip('dispatchStatus', d.status)}
            </h3>
            <dl className="detail-list">
              <div className="detail-row">
                <dt>LR / challan</dt>
                <dd>
                  {String(d.lrNumber)}
                  {d.challanNo ? ` · ${d.challanNo}` : ''}
                </dd>
              </div>
              <div className="detail-row">
                <dt>Invoice / e-way bill</dt>
                <dd>{[d.invoiceRef, d.ewayBill].filter(Boolean).join(' · ') || <EmptyValue />}</dd>
              </div>
              <div className="detail-row">
                <dt>Dispatched</dt>
                <dd>
                  <DateText value={String(d.dispatchDate)} />
                </dd>
              </div>
              <div className="detail-row">
                <dt>Expected / actual</dt>
                <dd>
                  <DateText value={String(d.expectedDelivery)} /> / {d.actualDelivery ? <DateText value={String(d.actualDelivery)} /> : <EmptyValue label="Not yet" />}
                  {!d.actualDelivery && String(d.expectedDelivery) < todayKey() && <span className="tag tone-danger orders-tag">Delayed</span>}
                </dd>
              </div>
              <div className="detail-row">
                <dt>Proof of delivery</dt>
                <dd>{d.podFileName ? `${d.podFileName}${d.podPhotoName ? ` · photo ${d.podPhotoName}` : ''}` : <EmptyValue />}</dd>
              </div>
            </dl>
            {d.status === 'in_transit' && can(actor, 'orders.dispatch') && <Button onClick={() => setDelivering(d.id)}>Confirm delivery</Button>}
          </section>
        ))
      ) : (
        <EmptyState icon="send" title="Not dispatched yet">
          {q.data.order.status === 'ready_for_dispatch' ? 'Use “Record dispatch” above.' : 'The order is dispatched once it is ready for dispatch.'}
        </EmptyState>
      )}
      {delivering && <ConfirmDeliveryDialog dispatch={list.find((x) => x.id === delivering)!} onClose={() => setDelivering(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Contract (FR-053 / FR-054)

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
      toast(`${c.contractNo} generated`);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="details">
      {!approved && <InlineAlert tone="info">“Generate sales contract” becomes available once the order is approved.</InlineAlert>}
      {current ? (
        <section className="detail-section">
          <h3 className="detail-section-title">
            {String(current.contractNo)} · version {String(current.version)} {chip('contractStatus', current.status)}
          </h3>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Value</dt>
              <dd>{formatMoney(Number(current.contractValue))}</dd>
            </div>
            <div className="detail-row">
              <dt>Signed</dt>
              <dd>{current.signedAt ? <>{String(current.signedBy)} · <DateText value={String(current.signedAt)} showTime /></> : <EmptyValue label="Not signed" />}</dd>
            </div>
          </dl>
          <div className="row-gap">
            <Link className="btn btn-secondary" to={`/orders/${encodeURIComponent(v.order.id)}/contract/print`}>
              <span className="btn-label">Print / PDF</span>
            </Link>
            <Link className="btn btn-secondary" to={`/salesContracts?peek=${encodeURIComponent(current.id)}`}>
              <span className="btn-label">Edit terms</span>
            </Link>
            {['draft', 'sent_for_signature'].includes(String(current.status)) && (
              <Button
                disabledReason={can(actor, 'orders.contract') ? undefined : 'Your role cannot send contracts'}
                onClick={async () => {
                  try {
                    const r = await sendContractForSignature(actor, current.id);
                    setSign({ id: current.id, otp: r.otp });
                    toast(r.to ? `Signing request e-mailed to ${r.to} (simulated)` : 'Signing request created (no consenting e-mail contact)', 'info');
                  } catch (e) {
                    toast(errorMessage(e), 'danger');
                  }
                }}
              >
                Send for e-signature
              </Button>
            )}
            {current.status !== 'signed' && (
              <Button loading={busy} onClick={generate} disabledReason={canGenerate ? undefined : 'Your role cannot generate contracts'}>
                New version
              </Button>
            )}
          </div>
        </section>
      ) : (
        <EmptyState icon="scroll-text" title="No contract yet" action={<Button variant="primary" loading={busy} onClick={generate} disabledReason={!approved ? 'Order not approved yet' : canGenerate ? undefined : 'Your role cannot generate contracts'}>Generate sales contract</Button>}>
          Uses the {String(v.order.divisionId)} division template with the order’s payment, delivery and warranty terms.
        </EmptyState>
      )}
      {v.contracts.filter((c) => c.status === 'superseded').length > 0 && (
        <p className="muted small">
          Earlier versions:{' '}
          {v.contracts
            .filter((c) => c.status === 'superseded')
            .map((c) => `v${c.version}`)
            .join(', ')}
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
  const [error, setError] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Customer e-signature (simulated)"
      description="In the live system the customer signs on the e-signature provider’s page. Here you play the customer."
      footer={
        <>
          <Button onClick={onClose}>Later</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await signSalesContract(actor, contractId, code, name);
                toast('Contract signed');
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Sign contract
          </Button>
        </>
      }
    >
      <InlineAlert tone="info" title="Simulated one-time code">
        The customer’s code is <strong className="mono">{otp}</strong>.
      </InlineAlert>
      <div className="form-grid cols-2">
        <Field id="sg-name" label="Signer name" required>
          <input id="sg-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <Field id="sg-otp" label="One-time code" required>
          <input id="sg-otp" className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      {error && <p className="field-error">{error}</p>}
    </Dialog>
  );
}
