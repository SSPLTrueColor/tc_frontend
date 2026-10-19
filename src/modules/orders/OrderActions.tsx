/** Sales order record actions, banner and dialogs (approval, hold/cancel, ERP, dispatch, delivery). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { addDays, todayKey } from '../../lib/dates';
import { errorMessage } from '../../services/api/client';
import { confirmOrderDelivery, recordOrderDispatch, requestOrderStatusChange, submitOrderForApproval, syncOrderFromErp } from '../../services/api/orders';
import { can, canUpdateRecord } from '../../services/authz';
import { getDb } from '../../services/db';
import { useActor } from '../../services/hooks';
import { getResource, getUser } from '../../services/registry';
import { approvalTypeLabel, levelHolders } from '../../services/workflow';
import { SO_BEFORE_DISPATCH } from '../../domain/modules/orders';
import { ServiceError } from '../../services/types';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { Field, FilePick } from './components';
import { ReceiptDialog } from './OrderTabs';

type Kind = 'hold' | 'resume' | 'cancel' | 'submit';

const pendingFor = (id: string) => getDb().approvals.filter((a) => a.recordId === id && a.resource === 'salesOrders' && a.status === 'pending');

export function OrderActions({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const [reason, setReason] = useState<Kind | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const status = String(record.status);
  const raw = getDb().records.salesOrders?.find((r) => r.id === record.id);
  const editable = !!raw && canUpdateRecord(actor, getResource('salesOrders'), raw);
  const pending = pendingFor(record.id);
  const openApproval = pending.find((a) => a.type === 'salesOrder.approval');
  const statusRequest = pending.find((a) => a.type !== 'salesOrder.approval');
  const ro = editable ? undefined : `Read-only for ${actor.role.label}`;

  return (
    <>
      {status === 'pending_approval' && !openApproval && (
        <Button variant="primary" onClick={() => setReason('submit')} disabledReason={ro}>
          Submit for approval
        </Button>
      )}
      {SO_BEFORE_DISPATCH.includes(status) && editable && (
        <Link className="btn btn-secondary" to={`/salesOrders/${encodeURIComponent(record.id)}/edit`}>
          <span className="btn-label">Edit lines</span>
        </Link>
      )}
      {status === 'ready_for_dispatch' && (
        <Button variant="primary" icon="send" onClick={() => setDispatching(true)} disabledReason={can(actor, 'orders.dispatch') ? undefined : 'Import/SCM or a coordinator records dispatches'}>
          Record dispatch
        </Button>
      )}
      {!['pending_approval', 'cancelled'].includes(status) && !record.invoiceNo && (
        <Button
          icon="reset"
          disabledReason={can(actor, 'orders.erp') ? undefined : 'Accounts, Import/SCM or an administrator syncs with the ERP'}
          onClick={async () => {
            try {
              const r = await syncOrderFromErp(actor, record.id);
              toast(`ERP invoice ${r.invoiceNo} received (simulated)`);
            } catch (e) {
              toast(errorMessage(e), 'danger');
            }
          }}
        >
          Sync from ERP
        </Button>
      )}
      {record.orderKind === 'consumables' && status !== 'cancelled' && can(actor, 'orders.contract') && (
        <Link className="btn btn-secondary" to={`/orders/new?repeatOf=${encodeURIComponent(record.id)}`}>
          <span className="btn-label">Repeat order</span>
        </Link>
      )}
      {SO_BEFORE_DISPATCH.includes(status) && (
        <Button onClick={() => setReason('hold')} disabledReason={ro ?? (statusRequest ? `${approvalTypeLabel(statusRequest.type)} already pending` : undefined)}>
          Put on hold
        </Button>
      )}
      {status === 'on_hold' && (
        <Button onClick={() => setReason('resume')} disabledReason={ro ?? (statusRequest ? `${approvalTypeLabel(statusRequest.type)} already pending` : undefined)}>
          Request resume
        </Button>
      )}
      {(SO_BEFORE_DISPATCH.includes(status) || status === 'on_hold') && (
        <Button variant="danger" onClick={() => setReason('cancel')} disabledReason={ro ?? (statusRequest ? `${approvalTypeLabel(statusRequest.type)} already pending` : undefined)}>
          Cancel order
        </Button>
      )}
      {reason && <ReasonDialog kind={reason} orderId={record.id} orderNo={String(record.orderNo)} onClose={() => setReason(null)} />}
      {dispatching && <DispatchDialog order={record} onClose={() => setDispatching(false)} />}
    </>
  );
}

const COPY: Record<Kind, { title: string; button: string; help: string; danger?: boolean }> = {
  submit: { title: 'Submit for approval', button: 'Submit', help: 'Goes to your reporting manager; a finance check is added when the advance is below policy or the customer has overdue amounts.' },
  hold: { title: 'Put order on hold', button: 'Request hold', help: 'Needs your reporting manager’s approval. The order resumes from the same status.' },
  resume: { title: 'Resume order', button: 'Request resume', help: 'Needs your reporting manager’s approval.' },
  cancel: { title: 'Cancel order', button: 'Request cancellation', help: 'Needs approval up to the division head. Dispatched orders cannot be cancelled.', danger: true },
};

function ReasonDialog({ kind, orderId, orderNo, onClose }: { kind: Kind; orderId: string; orderNo: string; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const c = COPY[kind];
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      role={c.danger ? 'alertdialog' : 'dialog'}
      title={`${c.title} · ${orderNo}`}
      description={c.help}
      footer={
        <>
          <Button onClick={onClose} data-autofocus={c.danger || undefined}>
            Keep as is
          </Button>
          <Button
            variant={c.danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const a = kind === 'submit' ? await submitOrderForApproval(actor, orderId, text) : await requestOrderStatusChange(actor, orderId, kind, text);
                toast(`${a.id} sent to ${a.levels.map((l) => l.label).join(' → ')}`);
                onClose();
              } catch (e) {
                setError(e instanceof ServiceError && e.fieldErrors?.reason ? e.fieldErrors.reason : errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {c.button}
          </Button>
        </>
      }
    >
      <Field id="so-reason" label={kind === 'submit' ? 'Note for the approver' : 'Reason'} required={kind !== 'submit'} error={error}>
        <textarea id="so-reason" className="input textarea" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} data-autofocus={!c.danger || undefined} />
      </Field>
    </Dialog>
  );
}

function DispatchDialog({ order, onClose }: { order: RecordExtensionProps['record']; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [f, setF] = useState({ dispatchDate: todayKey(), transporter: '', lrNumber: '', challanNo: '', invoiceRef: String(order.invoiceNo ?? ''), ewayBill: String(order.ewayBill ?? ''), expectedDelivery: addDays(todayKey(), order.orderKind === 'machine' ? 5 : 3), notifyCustomer: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState('');
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Record dispatch · ${order.orderNo}`}
      description="Creates the dispatch record, moves the order to Dispatched and (optionally) sends the dispatch intimation by WhatsApp / e-mail (simulated)."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setForm('');
              try {
                const d = await recordOrderDispatch(actor, order.id, f);
                toast(`Dispatched — LR ${d.lrNumber}`);
                onClose();
              } catch (e) {
                if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
                setForm(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Record dispatch
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field id="dp-date" label="Dispatch date" required error={errors.dispatchDate}>
          <DatePicker id="dp-date" label="Dispatch date" value={f.dispatchDate} onChange={(v) => set({ dispatchDate: v ?? '' })} invalid={!!errors.dispatchDate} />
        </Field>
        <Field id="dp-exp" label="Expected delivery" required error={errors.expectedDelivery}>
          <DatePicker id="dp-exp" label="Expected delivery" value={f.expectedDelivery} onChange={(v) => set({ expectedDelivery: v ?? '' })} invalid={!!errors.expectedDelivery} />
        </Field>
        <Field id="dp-tr" label="Transporter" required error={errors.transporter}>
          <input id="dp-tr" className="input" maxLength={80} value={f.transporter} onChange={(e) => set({ transporter: e.target.value })} placeholder="e.g. VRL Logistics" data-autofocus />
        </Field>
        <Field id="dp-lr" label="LR number" required error={errors.lrNumber}>
          <input id="dp-lr" className="input" maxLength={40} value={f.lrNumber} onChange={(e) => set({ lrNumber: e.target.value })} />
        </Field>
        <Field id="dp-ch" label="Delivery challan">
          <input id="dp-ch" className="input" maxLength={40} value={f.challanNo} onChange={(e) => set({ challanNo: e.target.value })} />
        </Field>
        <Field id="dp-inv" label="Invoice ref.">
          <input id="dp-inv" className="input" maxLength={40} value={f.invoiceRef} onChange={(e) => set({ invoiceRef: e.target.value })} />
        </Field>
        <Field id="dp-ewb" label="E-way bill no." error={errors.ewayBill} help="12 digits">
          <input id="dp-ewb" className="input" inputMode="numeric" maxLength={12} value={f.ewayBill} onChange={(e) => set({ ewayBill: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <label className="orders-check">
          <input type="checkbox" checked={f.notifyCustomer} onChange={(e) => set({ notifyCustomer: e.target.checked })} /> Send dispatch intimation to the customer
        </label>
      </div>
      {form && <InlineAlert tone="danger">{form}</InlineAlert>}
    </Dialog>
  );
}

export function ConfirmDeliveryDialog({ dispatch, onClose }: { dispatch: Record<string, unknown> & { id: string }; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  const [pod, setPod] = useState({ name: '', size: 0 });
  const [photo, setPhoto] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Confirm delivery · LR ${String(dispatch.lrNumber)}`}
      description="Records the actual delivery with signed proof of delivery. Machine orders get an installation job automatically."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await confirmOrderDelivery(actor, dispatch.id, { actualDelivery: date, podFileName: pod.name, podFileSize: pod.size, podPhotoName: photo });
                toast(r.installationId ? `Delivered — installation job ${r.installationId} created` : 'Delivery confirmed');
                onClose();
              } catch (e) {
                setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm delivery
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field id="dl-date" label="Delivered on" required error={errors.actualDelivery}>
          <DatePicker id="dl-date" label="Delivered on" value={date} onChange={(v) => setDate(v ?? '')} invalid={!!errors.actualDelivery} />
        </Field>
        <Field id="dl-pod" label="Signed proof of delivery" required error={errors.podFileName} wide>
          <FilePick id="dl-pod" value={pod.name} onPick={(name, size) => setPod({ name, size })} invalid={!!errors.podFileName} />
        </Field>
        <Field id="dl-photo" label="Delivery photo" wide>
          <FilePick id="dl-photo" value={photo} accept=".jpg,.jpeg,.png" onPick={(name) => setPhoto(name)} />
        </Field>
      </div>
      {errors.form && <InlineAlert tone="danger">{errors.form}</InlineAlert>}
    </Dialog>
  );
}

/** Banner: open approval / last rejection / hold / cancellation. */
export function OrderBanner({ record }: RecordExtensionProps) {
  const approvals = getDb().approvals.filter((a) => a.recordId === record.id && a.resource === 'salesOrders').sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const open = approvals.filter((a) => a.status === 'pending');
  if (open.length)
    return (
      <>
        {open.map((a) => {
          const level = a.levels[a.currentLevel];
          return (
            <InlineAlert key={a.id} tone="warning" title={`${approvalTypeLabel(a.type)} pending (${a.id})`}>
              Level {a.currentLevel + 1} of {a.levels.length}: {level.approverStaffId ? level.label : `${level.label} (${levelHolders(level.capability).join(' / ')})`}. Requested by {getUser(a.requestedBy)?.name}.{a.reason ? ` “${a.reason}”` : ''}
            </InlineAlert>
          );
        })}
      </>
    );
  if (record.status === 'on_hold') return <InlineAlert tone="danger" title="On hold">{String(record.holdReason ?? '')}</InlineAlert>;
  if (record.status === 'cancelled') return <InlineAlert tone="info" title="Cancelled">{String(record.cancelReason ?? '')}</InlineAlert>;
  const last = approvals[0];
  if (record.status === 'pending_approval' && last?.status === 'rejected')
    return (
      <InlineAlert tone="danger" title={`Rejected by ${getUser(last.decidedBy ?? '')?.name ?? 'approver'}`}>
        {last.decisionNote || 'No note.'} Edit the order if needed and submit again.
      </InlineAlert>
    );
  if (record.status === 'pending_approval') return <InlineAlert tone="info" title="Not submitted">No approval request is open. Submit the order for approval.</InlineAlert>;
  return null;
}

/** On a dispatch record: confirm delivery. */
export function DispatchActions({ actor, record }: RecordExtensionProps) {
  const [open, setOpen] = useState(false);
  if (record.status !== 'in_transit') return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabledReason={can(actor, 'orders.dispatch') ? undefined : 'Import/SCM or a coordinator confirms deliveries'}>
        Confirm delivery
      </Button>
      {open && <ConfirmDeliveryDialog dispatch={record} onClose={() => setOpen(false)} />}
    </>
  );
}

/** On a milestone record: record an ERP receipt. */
export function MilestoneActions({ actor, record }: RecordExtensionProps) {
  const [open, setOpen] = useState(false);
  if (record.status === 'received') return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabledReason={can(actor, 'orders.receipts') ? undefined : 'Accounts records ERP receipts'}>
        Record receipt
      </Button>
      {open && <ReceiptDialog milestone={record} onClose={() => setOpen(false)} />}
    </>
  );
}
