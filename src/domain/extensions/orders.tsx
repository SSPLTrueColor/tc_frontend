/** Orders module: lifecycle guards, approval types, hand-off hooks and record extensions. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { registerRecordActions, registerRecordBanner, registerRecordTab, type RecordExtensionProps } from '../../components/resource/extensions';
import { Button } from '../../components/primitives/Button';
import { useToast } from '../../components/primitives/feedback';
import { todayKey } from '../../lib/dates';
import { errorMessage } from '../../services/api/client';
import { sendContractForSignature } from '../../services/api/orders';
import { can } from '../../services/authz';
import { getDb } from '../../services/db';
import { registerResourceHooks } from '../../services/resourceHooks';
import { patchRecordIn } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { registerApprovalType } from '../../services/workflow';
import { APPROVAL, CANCEL, HOLD, milestonesOf, onCancelApproved, onHoldApproved, onOrderApproved, onResumeApproved, RESUME, SO } from '../../services/orders/orders';
import { COMMERCIAL_FIELDS } from '../modules/orders';
import { DispatchActions, MilestoneActions, OrderActions, OrderBanner } from '../../modules/orders/OrderActions';
import { ContractTab, DispatchTab, LinesTab, PaymentsTab, ProcessingTab, SignDialog } from '../../modules/orders/OrderTabs';

registerApprovalType(APPROVAL, { label: 'Sales order approval', onApproved: onOrderApproved });
registerApprovalType(HOLD, { label: 'Order hold', onApproved: onHoldApproved });
registerApprovalType(RESUME, { label: 'Order resume', onApproved: onResumeApproved });
registerApprovalType(CANCEL, { label: 'Order cancellation', onApproved: onCancelApproved });

registerResourceHooks(SO, {
  // Commercial fields freeze after approval; lines change only via "Edit lines" (BR-22).
  beforeUpdate: (_ctx, before, candidate) => {
    if (['completed', 'cancelled'].includes(String(before.status))) throw new ServiceError('invalid_state', 'Closed orders cannot be edited.');
    if (before.status === 'pending_approval') return;
    const changed = COMMERCIAL_FIELDS.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(candidate[k] ?? null));
    if (changed.length) throw new ServiceError('invalid_state', `The order is approved: ${changed.join(', ')} can no longer change. Use “Edit lines” (re-approval) or cancel and re-order.`);
  },
  beforeTransition: ({ d }, r, to) => {
    if (to === 'processing') {
      const advance = milestonesOf(d, r.id)[0];
      if (advance && Number(advance.percent) < 100 && (Number(advance.receivedAmount) || 0) < Number(advance.amount) - 0.01) throw new ServiceError('invalid_state', 'The advance has not been received yet.');
    }
    if (to === 'ready_for_dispatch' && r.orderKind === 'machine' && !(r.machineReady && r.pdiDone)) throw new ServiceError('invalid_state', 'Machine readiness and pre-dispatch inspection must be confirmed on the Processing tab first.');
    if (to === 'installation' && r.orderKind !== 'machine') throw new ServiceError('invalid_state', 'Only machine orders have an installation step.');
  },
  afterTransition: (ctx, _before, after) => {
    if (after.status === 'completed') patchRecordIn(ctx, SO, after.id, { completedAt: todayKey() });
  },
});

// Guard: from Delivered, only consumables orders complete directly (machines go through installation).
registerResourceHooks(SO, {
  beforeTransition: (_ctx, r, to) => {
    const current = getDb().records[SO]?.find((x) => x.id === r.id);
    if (to === 'completed' && current?.status === 'delivered' && r.orderKind === 'machine') throw new ServiceError('invalid_state', 'Machine orders complete when the installation is signed off.');
  },
});

registerResourceHooks('salesContracts', {
  beforeUpdate: (_ctx, before) => {
    if (before.status !== 'draft') throw new ServiceError('invalid_state', 'Only draft contracts can be edited. Generate a new version to change terms.');
  },
});

// Hand-off back from installations (installed module's resource): Delivered → Installation → Completed.
registerResourceHooks('installations', {
  afterTransition: (ctx, _before, after) => {
    const order = ctx.d.records[SO]?.find((o) => o.id === after.salesOrderId);
    if (!order) return;
    if (['site_ready', 'in_progress', 'trial_training'].includes(String(after.status)) && order.status === 'delivered') patchRecordIn(ctx, SO, order.id, { status: 'installation' }, `Installation ${after.id} started`);
    if (after.status === 'signed_off' && !['completed', 'cancelled'].includes(String(order.status))) patchRecordIn(ctx, SO, order.id, { status: 'completed', completedAt: todayKey() }, `Installation ${after.id} signed off`);
  },
});

registerRecordActions(SO, OrderActions);
registerRecordBanner(SO, OrderBanner);
registerRecordTab(SO, { id: 'lines', label: 'Lines', component: LinesTab });
registerRecordTab(SO, { id: 'payments', label: 'Payments', component: PaymentsTab, count: ({ record }) => milestonesOf(getDb(), record.id).filter((m) => m.status === 'overdue').length || undefined });
registerRecordTab(SO, { id: 'processing', label: 'Processing', component: ProcessingTab });
registerRecordTab(SO, { id: 'dispatch', label: 'Dispatch', component: DispatchTab });
registerRecordTab(SO, { id: 'contract', label: 'Contract', component: ContractTab });
registerRecordActions('dispatches', DispatchActions);
registerRecordActions('paymentMilestones', MilestoneActions);

function ContractActions({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const [otp, setOtp] = useState<string | null>(null);
  return (
    <>
      <Link className="btn btn-secondary" to={`/orders/${encodeURIComponent(String(record.salesOrderId))}/contract/print`}>
        <span className="btn-label">Print / PDF</span>
      </Link>
      {['draft', 'sent_for_signature'].includes(String(record.status)) && (
        <Button
          disabledReason={can(actor, 'orders.contract') ? undefined : 'Your role cannot send contracts'}
          onClick={async () => {
            try {
              const r = await sendContractForSignature(actor, record.id);
              setOtp(r.otp);
            } catch (e) {
              toast(errorMessage(e), 'danger');
            }
          }}
        >
          Send for e-signature
        </Button>
      )}
      {otp && <SignDialog contractId={record.id} otp={otp} onClose={() => setOtp(null)} />}
    </>
  );
}
registerRecordActions('salesContracts', ContractActions);
