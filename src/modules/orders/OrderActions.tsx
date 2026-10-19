/** Sales order record actions, banner and dialogs (approval, Hold Order / Cancel Order, Push to ERP, Record Dispatch, Confirm Delivery). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { addDays, todayKey } from '../../lib/dates';
import { recordEditPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { confirmOrderDelivery, pushOrderToErp, recordOrderDispatch, requestOrderStatusChange, submitOrderForApproval } from '../../services/api/orders';
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

const O = L.orders;
const D = L.dispatch;
const FD = D.fields.dispatches;

type Kind = 'hold' | 'resume' | 'cancel' | 'submit';

const pendingFor = (id: string) => getDb().approvals.filter((a) => a.recordId === id && a.resource === 'salesOrders' && a.status === 'pending');

export function OrderActions({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const [reason, setReason] = useState<Kind | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [pushing, setPushing] = useState(false);
  const status = String(record.status);
  const raw = getDb().records.salesOrders?.find((r) => r.id === record.id);
  const editable = !!raw && canUpdateRecord(actor, getResource('salesOrders'), raw);
  const pending = pendingFor(record.id);
  const openApproval = pending.find((a) => a.type === 'salesOrder.approval');
  const statusRequest = pending.find((a) => a.type !== 'salesOrder.approval');
  const ro = editable ? undefined : O.common.readOnly(actor.role.label);
  const busyReason = ro ?? (statusRequest ? O.dialogs.alreadyPending(approvalTypeLabel(statusRequest.type)) : undefined);

  return (
    <>
      {status === 'pending_approval' && !openApproval && (
        <Button variant="primary" onClick={() => setReason('submit')} disabledReason={ro}>
          {O.actions.submitForApproval}
        </Button>
      )}
      {SO_BEFORE_DISPATCH.includes(status) && editable && (
        <Link className="btn btn-secondary" to={recordEditPath('salesOrders', record.id)}>
          <span className="btn-label">{O.actions.editLines}</span>
        </Link>
      )}
      {status === 'ready_for_dispatch' && (
        <Button variant="primary" icon="send" onClick={() => setDispatching(true)} disabledReason={can(actor, 'orders.dispatch') ? undefined : O.disabled.dispatch}>
          {D.actions.recordDispatch}
        </Button>
      )}
      {!['pending_approval', 'cancelled'].includes(status) && !record.invoiceNo && (
        <Button
          icon="reset"
          loading={pushing}
          disabledReason={can(actor, 'orders.erp') ? undefined : O.disabled.erp}
          onClick={async () => {
            setPushing(true);
            try {
              const r = await pushOrderToErp(actor, record.id);
              toast(O.record.erpReceived(String(r.invoiceNo)));
            } catch (e) {
              toast(errorMessage(e), 'danger');
            } finally {
              setPushing(false);
            }
          }}
        >
          {O.actions.pushToErp}
        </Button>
      )}
      {record.orderKind === 'consumables' && status !== 'cancelled' && can(actor, 'orders.contract') && (
        <Link className="btn btn-secondary" to={toPath(ROUTES.salesOrderNew, {}, { repeatOf: record.id })}>
          <span className="btn-label">{O.actions.repeatOrder}</span>
        </Link>
      )}
      {SO_BEFORE_DISPATCH.includes(status) && (
        <Button onClick={() => setReason('hold')} disabledReason={busyReason}>
          {O.actions.holdOrder}
        </Button>
      )}
      {status === 'on_hold' && (
        <Button onClick={() => setReason('resume')} disabledReason={busyReason}>
          {O.actions.resumeOrder}
        </Button>
      )}
      {(SO_BEFORE_DISPATCH.includes(status) || status === 'on_hold') && (
        <Button variant="danger" onClick={() => setReason('cancel')} disabledReason={busyReason}>
          {O.actions.cancelOrder}
        </Button>
      )}
      {reason && <ReasonDialog kind={reason} orderId={record.id} orderNo={String(record.orderNo)} onClose={() => setReason(null)} />}
      {dispatching && <DispatchDialog order={record} onClose={() => setDispatching(false)} />}
    </>
  );
}

const COPY: Record<Kind, { title: string; button: string; help: string; danger?: boolean }> = {
  submit: { title: O.dialogs.submit.title, button: O.actions.submit, help: O.dialogs.submit.help },
  hold: { title: O.dialogs.hold.title, button: O.actions.requestHold, help: O.dialogs.hold.help },
  resume: { title: O.dialogs.resume.title, button: O.actions.requestResume, help: O.dialogs.resume.help },
  cancel: { title: O.dialogs.cancel.title, button: O.actions.requestCancellation, help: O.dialogs.cancel.help, danger: true },
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
      title={O.dialogs.titleFor(c.title, orderNo)}
      description={c.help}
      footer={
        <>
          <Button onClick={onClose} data-autofocus={c.danger || undefined}>
            {O.actions.keepAsIs}
          </Button>
          <Button
            variant={c.danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const a = kind === 'submit' ? await submitOrderForApproval(actor, orderId, text) : await requestOrderStatusChange(actor, orderId, kind, text);
                toast(O.dialogs.sentTo(a.id, a.levels.map((l) => l.label).join(' → ')));
                onClose();
              } catch (e) {
                setError(e instanceof ServiceError && e.fieldErrors?.reason ? e.fieldErrors.reason : errorMessage(e));
                toast(errorMessage(e), 'danger');
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
      <Field id="so-reason" label={kind === 'submit' ? O.dialogs.approverNote : O.dialogs.reason} required={kind !== 'submit'} error={error}>
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
      title={D.dialogs.recordTitle(String(order.orderNo))}
      description={D.dialogs.recordDescription}
      footer={
        <>
          <Button onClick={onClose}>{O.actions.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setForm('');
              try {
                const d = await recordOrderDispatch(actor, order.id, f);
                toast(D.messages.dispatched(String(d.lrNumber)));
                onClose();
              } catch (e) {
                if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
                setForm(errorMessage(e));
                toast(errorMessage(e), 'danger');
              } finally {
                setBusy(false);
              }
            }}
          >
            {D.actions.recordDispatch}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field id="dp-date" label={FD.dispatchDate} required error={errors.dispatchDate}>
          <DatePicker id="dp-date" label={FD.dispatchDate} value={f.dispatchDate} onChange={(v) => set({ dispatchDate: v ?? '' })} invalid={!!errors.dispatchDate} />
        </Field>
        <Field id="dp-exp" label={FD.expectedDelivery} required error={errors.expectedDelivery}>
          <DatePicker id="dp-exp" label={FD.expectedDelivery} value={f.expectedDelivery} onChange={(v) => set({ expectedDelivery: v ?? '' })} invalid={!!errors.expectedDelivery} />
        </Field>
        <Field id="dp-tr" label={FD.transporter} required error={errors.transporter}>
          <input id="dp-tr" className="input" maxLength={80} value={f.transporter} onChange={(e) => set({ transporter: e.target.value })} placeholder={FD.transporterPlaceholder} data-autofocus />
        </Field>
        <Field id="dp-lr" label={FD.lrNumber} required error={errors.lrNumber}>
          <input id="dp-lr" className="input" maxLength={40} value={f.lrNumber} onChange={(e) => set({ lrNumber: e.target.value })} />
        </Field>
        <Field id="dp-ch" label={FD.challanNo}>
          <input id="dp-ch" className="input" maxLength={40} value={f.challanNo} onChange={(e) => set({ challanNo: e.target.value })} />
        </Field>
        <Field id="dp-inv" label={FD.invoiceRef}>
          <input id="dp-inv" className="input" maxLength={40} value={f.invoiceRef} onChange={(e) => set({ invoiceRef: e.target.value })} />
        </Field>
        <Field id="dp-ewb" label={FD.ewayBill} error={errors.ewayBill} help={FD.ewayBillHelp}>
          <input id="dp-ewb" className="input" inputMode="numeric" maxLength={12} value={f.ewayBill} onChange={(e) => set({ ewayBill: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <label className="orders-check">
          <input type="checkbox" checked={f.notifyCustomer} onChange={(e) => set({ notifyCustomer: e.target.checked })} /> {FD.notifyCustomer}
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
      title={D.dialogs.deliveryTitle(String(dispatch.lrNumber))}
      description={D.dialogs.deliveryDescription}
      footer={
        <>
          <Button onClick={onClose}>{O.actions.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await confirmOrderDelivery(actor, dispatch.id, { actualDelivery: date, podFileName: pod.name, podFileSize: pod.size, podPhotoName: photo });
                toast(r.installationId ? D.messages.deliveredWithJob(r.installationId) : D.messages.delivered);
                onClose();
              } catch (e) {
                setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
                toast(errorMessage(e), 'danger');
              } finally {
                setBusy(false);
              }
            }}
          >
            {D.actions.confirmDelivery}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field id="dl-date" label={FD.actualDelivery} required error={errors.actualDelivery}>
          <DatePicker id="dl-date" label={FD.actualDelivery} value={date} onChange={(v) => setDate(v ?? '')} invalid={!!errors.actualDelivery} />
        </Field>
        <Field id="dl-pod" label={FD.podFileName} required error={errors.podFileName} wide>
          <FilePick id="dl-pod" value={pod.name} onPick={(name, size) => setPod({ name, size })} invalid={!!errors.podFileName} />
        </Field>
        <Field id="dl-photo" label={FD.podPhotoName} wide>
          <FilePick id="dl-photo" value={photo} accept=".jpg,.jpeg,.png" onPick={(name) => setPhoto(name)} />
        </Field>
      </div>
      {errors.form && <InlineAlert tone="danger">{errors.form}</InlineAlert>}
    </Dialog>
  );
}

/** Banner: open approval / last rejection / hold / cancellation. */
export function OrderBanner({ record }: RecordExtensionProps) {
  const B = O.banner;
  const approvals = getDb()
    .approvals.filter((a) => a.recordId === record.id && a.resource === 'salesOrders')
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const open = approvals.filter((a) => a.status === 'pending');
  if (open.length)
    return (
      <>
        {open.map((a) => {
          const level = a.levels[a.currentLevel];
          const who = level.approverStaffId ? level.label : `${level.label} (${levelHolders(level.capability).join(' / ')})`;
          return (
            <InlineAlert key={a.id} tone="warning" title={B.pending(approvalTypeLabel(a.type), a.id)}>
              {B.pendingBody(O.record.level(a.currentLevel + 1, a.levels.length, who), getUser(a.requestedBy)?.name ?? a.requestedBy, a.reason)}
            </InlineAlert>
          );
        })}
      </>
    );
  if (record.status === 'on_hold')
    return (
      <InlineAlert tone="danger" title={B.hold}>
        {String(record.holdReason ?? '')}
      </InlineAlert>
    );
  if (record.status === 'cancelled')
    return (
      <InlineAlert tone="info" title={B.cancelled}>
        {String(record.cancelReason ?? '')}
      </InlineAlert>
    );
  const last = approvals[0];
  if (record.status === 'pending_approval' && last?.status === 'rejected')
    return (
      <InlineAlert tone="danger" title={B.rejectedBy(getUser(last.decidedBy ?? '')?.name ?? B.approver)}>
        {last.decisionNote || B.noNote} {B.resubmit}
      </InlineAlert>
    );
  if (record.status === 'pending_approval')
    return (
      <InlineAlert tone="info" title={B.notSubmitted}>
        {B.notSubmittedBody}
      </InlineAlert>
    );
  return null;
}

/** On a dispatch record: Confirm Delivery. */
export function DispatchActions({ actor, record }: RecordExtensionProps) {
  const [open, setOpen] = useState(false);
  if (record.status !== 'in_transit') return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabledReason={can(actor, 'orders.dispatch') ? undefined : O.disabled.deliveries}>
        {D.actions.confirmDelivery}
      </Button>
      {open && <ConfirmDeliveryDialog dispatch={record} onClose={() => setOpen(false)} />}
    </>
  );
}

/** On a payment milestone record: record an ERP receipt. */
export function MilestoneActions({ actor, record }: RecordExtensionProps) {
  const [open, setOpen] = useState(false);
  if (record.status === 'received') return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabledReason={can(actor, 'orders.receipts') ? undefined : O.disabled.receipts}>
        {O.actions.recordReceipt}
      </Button>
      {open && <ReceiptDialog milestone={record} onClose={() => setOpen(false)} />}
    </>
  );
}
