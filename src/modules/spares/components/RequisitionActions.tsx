import { useState } from 'react';
import { Button } from '../../../components/primitives/Button';
import { InlineAlert, useToast } from '../../../components/primitives/feedback';
import { Dialog } from '../../../components/primitives/overlay';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import type { RecordExtensionProps } from '../../../components/resource/extensions';
import { formatMoney } from '../../../lib/format';
import { errorMessage } from '../../../services/api/client';
import * as api from '../../../services/api/spares';
import { can, canUpdateRecord } from '../../../services/authz';
import { byId } from '../../../services/lookups';
import { activeMasterValues } from '../../../services/registry';
import { ServiceError } from '../../../services/types';

type Mode = 'reject' | 'issue' | 'consume' | 'return' | 'claim' | null;

/** Data-capturing requisition actions (SPR-03/04/05): reject, issue, consume, return, defective receipt, OEM claim. */
export function RequisitionActions({ res, actor, record }: RecordExtensionProps) {
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const status = String(record.status);
  const mayUpdate = canUpdateRecord(actor, res, record);
  const part = byId('spareParts', record.partId);

  const defectiveReceived = async () => {
    setBusy(true);
    try {
      await api.receiveDefective(actor, record.id, record.version);
      toast(`Defective ${part?.partNo ?? 'part'} received at store`);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {status === 'requested' && can(actor, 'approve.service') && (
        <Button onClick={() => setMode('reject')} disabledReason={record.engineerId === actor.staffId ? 'Separation of duties: you raised this requisition' : undefined}>
          Reject
        </Button>
      )}
      {status === 'approved' && can(actor, 'spares.issue') && (
        <Button variant="primary" icon="send" onClick={() => setMode('issue')} disabledReason={part && Number(part.stockMain ?? 0) < 1 ? 'No stock in the main store — see Stock alerts' : undefined}>
          Issue part
        </Button>
      )}
      {status === 'received' && mayUpdate && (
        <>
          <Button variant="primary" onClick={() => setMode('consume')}>
            Record consumption
          </Button>
          <Button onClick={() => setMode('return')}>Return unused</Button>
        </>
      )}
      {status === 'consumed' && record.defectiveReturn === 'pending' && can(actor, 'spares.issue') && (
        <Button loading={busy} onClick={defectiveReceived}>
          Defective part received
        </Button>
      )}
      {status === 'consumed' && record.basis === 'warranty' && actor.role.resources.warrantyClaims?.create && (
        <Button icon="shield" onClick={() => setMode('claim')}>
          Raise OEM claim
        </Button>
      )}
      {mode === 'reject' && <ReasonDialog title={`Reject ${record.id}?`} description="The engineer is notified with your reason. The ticket goes back to “In progress” if no other part is pending." label="Reason" danger confirm="Reject requisition" onClose={() => setMode(null)} onSubmit={(reason) => api.rejectRequisition(actor, record.id, reason, record.version).then(() => toast(`${record.id} rejected`))} />}
      {mode === 'return' && <ReasonDialog title={`Return ${record.id} unused?`} description="The part goes back to main-store stock and the requisition closes as Returned." label="Why is it not needed?" confirm="Return to store" onClose={() => setMode(null)} onSubmit={(reason) => api.returnRequisition(actor, record.id, reason, record.version).then(() => toast(`${record.id} returned to store`))} />}
      {mode === 'issue' && <IssueDialog props={{ res, actor, record }} stock={Number(part?.stockMain ?? 0)} onClose={() => setMode(null)} />}
      {mode === 'consume' && <ConsumeDialog props={{ res, actor, record }} returnable={!!part?.returnable} warrantyAllowed={part?.warrantyApplicable !== false} onClose={() => setMode(null)} />}
      {mode === 'claim' && <ClaimDialog props={{ res, actor, record }} onClose={() => setMode(null)} />}
    </>
  );
}

function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setErrors({});
    try {
      await op();
      onClose();
    } catch (e) {
      setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, run };
}

const Err = ({ msg }: { msg?: string }) =>
  msg ? (
    <p className="field-error" role="alert">
      {msg}
    </p>
  ) : null;

function ReasonDialog({ title, description, label, confirm, danger, onClose, onSubmit }: { title: string; description: string; label: string; confirm: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState('');
  const { busy, errors, run } = useSubmit(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      role={danger ? 'alertdialog' : 'dialog'}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose} data-autofocus={danger || undefined}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={() => run(() => onSubmit(reason))}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="req-reason">
          {label} <span className="req">*</span>
        </label>
        <textarea id="req-reason" className="input textarea" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason || undefined} data-autofocus={danger ? undefined : true} />
        <Err msg={errors.reason ?? errors.form} />
      </div>
    </Dialog>
  );
}

function IssueDialog({ props, stock, onClose }: { props: RecordExtensionProps; stock: number; onClose: () => void }) {
  const { actor, record } = props;
  const toast = useToast();
  const [qty, setQty] = useState(String(Math.min(Number(record.qty), stock)));
  const [courier, setCourier] = useState('');
  const [docket, setDocket] = useState('');
  const { busy, errors, run } = useSubmit(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Issue ${record.id}`}
      description="Stock is reduced in the main store and the engineer is notified to acknowledge receipt."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.issueRequisition(actor, record.id, { issuedQty: Number(qty), courier, docketNo: docket }, record.version).then(() => toast(`${record.id} issued`)))}>
            Issue part
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {stock < Number(record.qty) && (
          <InlineAlert tone="warning" title="Short at main store">
            Requested {String(record.qty)}, in stock {stock}. Issue what is available; SCM sees the import requirement.
          </InlineAlert>
        )}
        <div className="form-field">
          <label className="field-label" htmlFor="iss-qty">
            Quantity to issue <span className="req">*</span>
          </label>
          <input id="iss-qty" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-invalid={!!errors.issuedQty || undefined} data-autofocus />
          <p className="muted small">Requested {String(record.qty)} · in stock {stock}</p>
          <Err msg={errors.issuedQty} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="iss-courier">
            Courier / mode <span className="req">*</span>
          </label>
          <input id="iss-courier" className="input" maxLength={60} placeholder="e.g. Blue Dart, hand delivery" value={courier} onChange={(e) => setCourier(e.target.value)} aria-invalid={!!errors.courier || undefined} />
          <Err msg={errors.courier} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="iss-docket">
            Docket / challan no. <span className="req">*</span>
          </label>
          <input id="iss-docket" className="input" maxLength={40} value={docket} onChange={(e) => setDocket(e.target.value)} aria-invalid={!!errors.docketNo || undefined} />
          <Err msg={errors.docketNo} />
        </div>
        <Err msg={errors.form} />
      </div>
    </Dialog>
  );
}

function ConsumeDialog({ props, returnable, warrantyAllowed, onClose }: { props: RecordExtensionProps; returnable: boolean; warrantyAllowed: boolean; onClose: () => void }) {
  const { actor, record } = props;
  const toast = useToast();
  const issued = Number(record.issuedQty ?? record.qty);
  const [qty, setQty] = useState(String(issued));
  const [basis, setBasis] = useState(String(warrantyAllowed ? (record.basis ?? 'chargeable') : 'chargeable'));
  const [returned, setReturned] = useState(false);
  const { busy, errors, run } = useSubmit(onClose);
  const unitPrice = Number(record.unitPrice ?? 0);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Record consumption · ${record.id}`}
      description="Records the part against the ticket and machine. Unused quantity goes back to store stock."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.recordConsumption(actor, record.id, { consumedQty: Number(qty), basis, defectiveReturned: returned }, record.version).then(() => toast(`${record.id} consumption recorded`)))}>
            Save consumption
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label className="field-label" htmlFor="con-qty">
            Quantity used <span className="req">*</span>
          </label>
          <input id="con-qty" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-invalid={!!errors.consumedQty || undefined} data-autofocus />
          <p className="muted small">
            Issued {issued}
            {unitPrice ? ` · value ${formatMoney(unitPrice * (Number(qty) || 0))}` : ''}
          </p>
          <Err msg={errors.consumedQty} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="con-basis">
            Basis <span className="req">*</span>
          </label>
          <SelectMenu
            id="con-basis"
            block
            label="Basis"
            value={basis}
            options={activeMasterValues('partBasis').map((v) => ({ value: v.key, label: v.key === 'warranty' && !warrantyAllowed ? `${v.label} (not covered)` : v.label, disabled: v.key === 'warranty' && !warrantyAllowed }))}
            onChange={setBasis}
          />
          <Err msg={errors.basis} />
        </div>
        {returnable && (
          <label className="check">
            <input type="checkbox" checked={returned} onChange={(e) => setReturned(e.target.checked)} /> Defective part handed back to the store already
          </label>
        )}
        <Err msg={errors.form} />
      </div>
    </Dialog>
  );
}

function ClaimDialog({ props, onClose }: { props: RecordExtensionProps; onClose: () => void }) {
  const { actor, record } = props;
  const toast = useToast();
  const [oem, setOem] = useState('');
  const { busy, errors, run } = useSubmit(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Raise OEM warranty claim for ${record.id}`}
      description="Creates a claim with the part, quantity and value from this requisition. Add the OEM claim number when it arrives."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.raiseClaimFromRequisition(actor, record.id, oem).then((c) => toast(`Claim ${(c as { id: string }).id} raised`)))}>
            Raise claim
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="claim-oem">
          OEM / principal <span className="req">*</span>
        </label>
        <SelectMenu id="claim-oem" block label="OEM / principal" placeholder="Choose OEM" value={oem} options={activeMasterValues('oem').map((v) => ({ value: v.key, label: v.label }))} onChange={setOem} />
        <Err msg={errors.oem ?? errors.form} />
      </div>
    </Dialog>
  );
}
