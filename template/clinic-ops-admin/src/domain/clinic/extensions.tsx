/** Clinic pack extensions, registered through the typed extension registry. */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { InfoTip } from '../../components/primitives/InfoTip';
import { registerRecordActions, registerRecordBanner, type RecordExtensionProps } from '../../components/resource/extensions';
import { formatMoney } from '../../lib/format';
import { uid } from '../../lib/ids';
import { wsBase } from '../../lib/routes';
import { can } from '../../services/authz';
import { getUser } from '../../services/registry';
import { recordPayment } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { pendingApprovalFor, requestWriteOff } from '../../services/workflow';

const OPEN = ['issued', 'partially_paid'];

function InvoiceActions({ actor, record }: RecordExtensionProps) {
  const [payOpen, setPayOpen] = useState(false);
  const [woOpen, setWoOpen] = useState(false);
  const isOpen = OPEN.includes(String(record.status));
  const balance = typeof record.balance === 'number' ? record.balance : null;
  const pending = pendingApprovalFor(record.id);
  return (
    <>
      <Button
        icon="receipt"
        onClick={() => setPayOpen(true)}
        disabledReason={!can(actor, 'billing.payment') ? 'Your role cannot record payments' : !isOpen ? 'Only issued invoices accept payments' : undefined}
      >
        Record payment
      </Button>
      <Button
        onClick={() => setWoOpen(true)}
        disabledReason={
          !can(actor, 'billing.writeoff.request') ? 'Your role cannot request write-offs' : !isOpen ? 'Only open invoices can be written off' : pending ? `Request ${pending.id} is already pending` : undefined
        }
      >
        Request write-off
      </Button>
      {String(record.status) === 'draft' && (
        <Link className="btn btn-secondary" to={`${wsBase(actor.workspaceId)}/billing/invoices/${record.id}/edit`}>
          <span className="btn-label">Edit line items</span>
        </Link>
      )}
      {payOpen && <PaymentDialog actor={actor} record={record} balance={balance} onClose={() => setPayOpen(false)} />}
      {woOpen && <WriteOffDialog actor={actor} record={record} balance={balance} onClose={() => setWoOpen(false)} />}
    </>
  );
}

function PaymentDialog({ actor, record, balance, onClose }: { actor: RecordExtensionProps['actor']; record: RecordExtensionProps['record']; balance: number | null; onClose: () => void }) {
  const [amount, setAmount] = useState(balance ? String(balance) : '');
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(uid('pay'));
  const toast = useToast();
  const submit = () => {
    if (busy) return;
    setBusy(true);
    try {
      recordPayment(actor, record.id, Number(amount), method, record.version, key.current);
      toast(`Payment of ${formatMoney(Number(amount))} recorded on ${record.id}`);
      onClose();
    } catch (e) {
      setError(e instanceof ServiceError ? e.message : 'Could not record payment');
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Record payment · ${record.id}`}
      description="Records a payment you already received (e.g. cash at the desk). No card, bank or payer is charged — this prototype has no payment processing."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {balance !== null && <p className="muted">Outstanding balance: {formatMoney(balance)}</p>}
        <div className="form-field">
          <label className="field-label" htmlFor="pay-amount">
            Amount <span className="req">*</span>
          </label>
          <div className="input-affix">
            <span className="affix">$</span>
            <input id="pay-amount" className="input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!error} data-autofocus />
          </div>
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="pay-method">
            Method
          </label>
          <SelectMenu
            id="pay-method"
            block
            label="Method"
            value={method}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'cheque', label: 'Cheque' },
              { value: 'card_terminal', label: 'Card terminal (external)' },
            ]}
            onChange={setMethod}
          />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function WriteOffDialog({ actor, record, balance, onClose }: { actor: RecordExtensionProps['actor']; record: RecordExtensionProps['record']; balance: number | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Request write-off · ${record.id}`}
      description="Starts an approval workflow. A practice manager (not you) must approve before the invoice changes."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              try {
                const a = requestWriteOff(actor, record.id, reason);
                toast(`Approval ${a.id} requested`);
                onClose();
              } catch (e) {
                setError(e instanceof ServiceError ? e.message : 'Request failed');
              }
            }}
          >
            Submit request
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {balance !== null && <p className="muted">Amount to write off: {formatMoney(balance)}</p>}
        <div className="form-field">
          <span className="field-label-row">
            <label className="field-label" htmlFor="wo-reason">
              Reason <span className="req">*</span>
            </label>
            <InfoTip text="At least 10 characters. Visible to approvers and recorded in the audit log." label="About the reason" />
          </span>
          <textarea id="wo-reason" className="input textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus aria-invalid={!!error} />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function InvoiceBanner({ actor, record }: RecordExtensionProps) {
  const pending = pendingApprovalFor(record.id);
  if (!pending) return null;
  return (
    <InlineAlert tone="warning" title={`Write-off pending approval (${pending.id})`}>
      Requested by {getUser(pending.requestedBy)?.name} — {formatMoney(pending.amount)}.{' '}
      {can(actor, 'approve.writeoff') && <Link to={`${wsBase(actor.workspaceId)}/work/inbox?tab=approvals`}>Review in Work inbox</Link>}
    </InlineAlert>
  );
}

registerRecordActions('invoices', InvoiceActions);
registerRecordBanner('invoices', InvoiceBanner);
