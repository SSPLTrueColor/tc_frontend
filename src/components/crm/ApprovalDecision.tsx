import { useState } from 'react';
import { getDb } from '../../services/db';
import { useActor } from '../../services/hooks';
import { ServiceError } from '../../services/types';
import { canDecide, decideApproval } from '../../services/workflow';
import { Button } from '../primitives/Button';
import { useToast } from '../primitives/feedback';
import { Dialog } from '../primitives/overlay';
import { Textarea } from '../primitives/controls';
import { L } from '../../constants/labels';

const C = L.common;
const I = L.common.inbox;

/**
 * Approve / Reject on the record itself: shown only to the person who must decide the record's pending approval
 * (sales order, quotation discount, …), so the approver never has to go to the inbox to move the flow on.
 */
export function RecordApprovalActions({ resource, recordId }: { resource: string; recordId: string }) {
  const actor = useActor();
  const [deciding, setDeciding] = useState<null | 'approved' | 'rejected'>(null);
  const a = getDb().approvals.find((x) => x.resource === resource && x.recordId === recordId && x.status === 'pending');
  if (!a || !canDecide(actor, a)) return null;
  return (
    <>
      <Button variant="primary" icon="check" onClick={() => setDeciding('approved')}>
        {C.actions.approve}
      </Button>
      <Button onClick={() => setDeciding('rejected')}>{C.actions.reject}</Button>
      {deciding && <DecisionDialog approvalId={a.id} decision={deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

export function DecisionDialog({ approvalId, decision, onClose }: { approvalId: string; decision: 'approved' | 'rejected'; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const a = getDb().approvals.find((x) => x.id === approvalId)!;
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={I.decisionTitle(decision === 'approved', approvalId)}
      description={
        decision === 'approved'
          ? a.currentLevel < a.levels.length - 1
            ? I.approveLevel(a.currentLevel + 1, a.levels[a.currentLevel + 1].label)
            : I.approveFinal(a.summary)
          : I.rejectBody
      }
      footer={
        <>
          <Button onClick={onClose}>{C.actions.cancel}</Button>
          <Button
            variant={decision === 'approved' ? 'primary' : 'danger'}
            onClick={() => {
              try {
                decideApproval(actor, approvalId, decision, note, a.version);
                toast(C.toasts.decided(approvalId, (I.status[decision] ?? decision).toLowerCase()));
                onClose();
              } catch (e) {
                setError(e instanceof ServiceError ? e.message : C.toasts.failed);
              }
            }}
          >
            {decision === 'approved' ? C.actions.approve : C.actions.rejectRequest}
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="decision-note">
          {I.note} {decision === 'rejected' ? <span className="req">*</span> : <span className="optional">{L.common.form.optional}</span>}
        </label>
        <Textarea id="decision-note" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
