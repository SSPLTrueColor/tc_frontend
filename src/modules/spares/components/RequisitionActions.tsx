import { useState } from 'react';
import { Button } from '../../../components/primitives/Button';
import { InlineAlert, useToast } from '../../../components/primitives/feedback';
import { Dialog } from '../../../components/primitives/overlay';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import type { RecordExtensionProps } from '../../../components/resource/extensions';
import { L } from '../../../constants/labels';
import { formatMoney } from '../../../lib/format';
import { errorMessage } from '../../../services/api/client';
import * as api from '../../../services/api/spares';
import { can, canUpdateRecord } from '../../../services/authz';
import { byId } from '../../../services/lookups';
import { activeMasterValues } from '../../../services/registry';
import { ServiceError } from '../../../services/types';

type Mode = 'reject' | 'issue' | 'consume' | 'return' | 'claim' | null;

const A = L.spares.actions;
const D = L.spares.dialogs;

/** Data-capturing Spares Requisition actions (SPR-03/04/05): reject, issue, consume, return, defective receipt, warranty claim (OEM). */
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
      toast(D.defectiveOk(String(part?.partNo ?? D.part)));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {status === 'requested' && can(actor, 'approve.service') && (
        <Button onClick={() => setMode('reject')} disabledReason={record.engineerId === actor.staffId ? D.separation : undefined}>
          {A.reject}
        </Button>
      )}
      {status === 'approved' && can(actor, 'spares.issue') && (
        <Button variant="primary" icon="send" onClick={() => setMode('issue')} disabledReason={part && Number(part.stockMain ?? 0) < 1 ? D.noStock : undefined}>
          {A.issue}
        </Button>
      )}
      {status === 'received' && mayUpdate && (
        <>
          <Button variant="primary" onClick={() => setMode('consume')}>
            {A.recordConsumption}
          </Button>
          <Button onClick={() => setMode('return')}>{A.returnUnused}</Button>
        </>
      )}
      {status === 'consumed' && record.defectiveReturn === 'pending' && can(actor, 'spares.issue') && (
        <Button loading={busy} onClick={defectiveReceived}>
          {A.defectiveReceived}
        </Button>
      )}
      {status === 'consumed' && record.basis === 'warranty' && actor.role.resources.warrantyClaims?.create && (
        <Button icon="shield" onClick={() => setMode('claim')}>
          {A.raiseClaim}
        </Button>
      )}
      {mode === 'reject' && <ReasonDialog title={D.rejectTitle(record.id)} description={D.rejectBody} label={D.rejectLabel} danger confirm={D.rejectConfirm} onClose={() => setMode(null)} onSubmit={(reason) => api.rejectRequisition(actor, record.id, reason, record.version).then(() => toast(D.rejected(record.id)))} />}
      {mode === 'return' && <ReasonDialog title={D.returnTitle(record.id)} description={D.returnBody} label={D.returnLabel} confirm={A.returnToStore} onClose={() => setMode(null)} onSubmit={(reason) => api.returnRequisition(actor, record.id, reason, record.version).then(() => toast(D.returned(record.id)))} />}
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
            {A.cancel}
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
      title={D.issueTitle(record.id)}
      description={D.issueBody}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.issueRequisition(actor, record.id, { issuedQty: Number(qty), courier, docketNo: docket }, record.version).then(() => toast(D.issued(record.id))))}>
            {A.issue}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {stock < Number(record.qty) && (
          <InlineAlert tone="warning" title={L.spares.banners.shortTitle}>
            {D.issueShort(String(record.qty), stock)}
          </InlineAlert>
        )}
        <div className="form-field">
          <label className="field-label" htmlFor="iss-qty">
            {D.issueQty} <span className="req">*</span>
          </label>
          <input id="iss-qty" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-invalid={!!errors.issuedQty || undefined} data-autofocus />
          <p className="muted small">{D.issueQtyHint(String(record.qty), stock)}</p>
          <Err msg={errors.issuedQty} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="iss-courier">
            {D.courier} <span className="req">*</span>
          </label>
          <input id="iss-courier" className="input" maxLength={60} placeholder={D.courierPlaceholder} value={courier} onChange={(e) => setCourier(e.target.value)} aria-invalid={!!errors.courier || undefined} />
          <Err msg={errors.courier} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="iss-docket">
            {D.docket} <span className="req">*</span>
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
      title={D.consumeTitle(record.id)}
      description={D.consumeBody}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.recordConsumption(actor, record.id, { consumedQty: Number(qty), basis, defectiveReturned: returned }, record.version).then(() => toast(D.consumed(record.id))))}>
            {A.saveConsumption}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <label className="field-label" htmlFor="con-qty">
            {D.consumeQty} <span className="req">*</span>
          </label>
          <input id="con-qty" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-invalid={!!errors.consumedQty || undefined} data-autofocus />
          <p className="muted small">{D.consumeHint(issued, unitPrice ? formatMoney(unitPrice * (Number(qty) || 0)) : '')}</p>
          <Err msg={errors.consumedQty} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="con-basis">
            {L.spares.fields.requisitions.basis} <span className="req">*</span>
          </label>
          <SelectMenu
            id="con-basis"
            block
            label={L.spares.fields.requisitions.basis}
            value={basis}
            options={activeMasterValues('partBasis').map((v) => ({ value: v.key, label: v.key === 'warranty' && !warrantyAllowed ? D.notCovered(v.label) : v.label, disabled: v.key === 'warranty' && !warrantyAllowed }))}
            onChange={setBasis}
          />
          <Err msg={errors.basis} />
        </div>
        {returnable && (
          <label className="check">
            <input type="checkbox" checked={returned} onChange={(e) => setReturned(e.target.checked)} /> {D.handedBack}
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
      title={D.claimTitle(record.id)}
      description={D.claimBody}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.raiseClaimFromRequisition(actor, record.id, oem).then((c) => toast(D.claimRaised((c as { id: string }).id))))}>
            {A.raiseClaim}
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="claim-oem">
          {L.spares.fields.warrantyClaims.oem} <span className="req">*</span>
        </label>
        <SelectMenu id="claim-oem" block label={L.spares.fields.warrantyClaims.oem} placeholder={D.chooseOem} value={oem} options={activeMasterValues('oem').map((v) => ({ value: v.key, label: v.label }))} onChange={setOem} />
        <Err msg={errors.oem ?? errors.form} />
      </div>
    </Dialog>
  );
}
