/** Sales Orders & Contracts: lifecycle guards, approval types, hand-off hooks and record extensions (tabs per GLOSSARY §1.2). */
import { useState } from 'react';
import { registerRecordActions, registerRecordBanner, registerRecordTab, type RecordExtensionProps } from '../../components/resource/extensions';
import { Button } from '../../components/primitives/Button';
import { useToast } from '../../components/primitives/feedback';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
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
import { ApprovalTab, ContractTab, DispatchTab, ErpInvoiceTab, HoldCancelTab, LinesTab, PaymentsTab, ProcessingTab, SignDialog } from '../../modules/orders/OrderTabs';
import { LinkButton } from '../../components/primitives/controls';
import { DealProgress } from '../../components/crm/DealProgress';

const O = L.orders;
const E = O.errors;
const N = O.notices;

registerApprovalType(APPROVAL, { label: O.approvals.types.approval, onApproved: onOrderApproved });
registerApprovalType(HOLD, { label: O.approvals.types.hold, onApproved: onHoldApproved });
registerApprovalType(RESUME, { label: O.approvals.types.resume, onApproved: onResumeApproved });
registerApprovalType(CANCEL, { label: O.approvals.types.cancel, onApproved: onCancelApproved });

const fieldLabel = (k: string) => (O.fields.salesOrders as Record<string, string>)[k] ?? k;

registerResourceHooks(SO, {
  // Commercial fields freeze after approval; lines change only via "Edit Lines" (BR-22).
  beforeUpdate: (_ctx, before, candidate) => {
    if (['completed', 'cancelled'].includes(String(before.status))) throw new ServiceError('invalid_state', E.closedOrder);
    if (before.status === 'pending_approval') return;
    const changed = COMMERCIAL_FIELDS.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(candidate[k] ?? null));
    if (changed.length) throw new ServiceError('invalid_state', E.commercialFrozen(changed.map(fieldLabel).join(', ')));
  },
  beforeTransition: ({ d }, r, to) => {
    if (to === 'processing') {
      const advance = milestonesOf(d, r.id)[0];
      if (advance && Number(advance.percent) < 100 && (Number(advance.receivedAmount) || 0) < Number(advance.amount) - 0.01) throw new ServiceError('invalid_state', E.advanceNotReceived);
    }
    if (to === 'ready_for_dispatch' && r.orderKind === 'machine' && !(r.machineReady && r.pdiDone)) throw new ServiceError('invalid_state', E.readinessFirst);
    if (to === 'installation' && r.orderKind !== 'machine') throw new ServiceError('invalid_state', E.installationMachineOnly);
  },
  afterTransition: (ctx, _before, after) => {
    if (after.status === 'completed') patchRecordIn(ctx, SO, after.id, { completedAt: todayKey() });
  },
});

// Guard: from Delivered, only consumables orders complete directly (machines go through installation).
registerResourceHooks(SO, {
  beforeTransition: (_ctx, r, to) => {
    const current = getDb().records[SO]?.find((x) => x.id === r.id);
    if (to === 'completed' && current?.status === 'delivered' && r.orderKind === 'machine') throw new ServiceError('invalid_state', E.machineCompletesOnSignOff);
  },
});

registerResourceHooks('salesContracts', {
  beforeUpdate: (_ctx, before) => {
    if (before.status !== 'draft') throw new ServiceError('invalid_state', E.contractDraftOnly);
  },
});

// Hand-off back from installation jobs (installed module's resource): Delivered → Installation → Completed.
registerResourceHooks('installations', {
  afterTransition: (ctx, _before, after) => {
    const order = ctx.d.records[SO]?.find((o) => o.id === after.salesOrderId);
    if (!order) return;
    if (['site_ready', 'in_progress', 'trial_training'].includes(String(after.status)) && order.status === 'delivered') patchRecordIn(ctx, SO, order.id, { status: 'installation' }, N.installationStarted(after.id));
    if (after.status === 'signed_off' && !['completed', 'cancelled'].includes(String(order.status))) patchRecordIn(ctx, SO, order.id, { status: 'completed', completedAt: todayKey() }, N.installationSignedOff(after.id));
  },
});

registerRecordActions(SO, OrderActions);
// Deal progress (whole quotation → installation cycle + next step) above the status banner.
registerRecordBanner(SO, (p) => (
  <>
    <DealProgress resource="salesOrders" record={p.record} />
    <OrderBanner {...p} />
  </>
));
// Sales order tabs (GLOSSARY §1.2): Details, Changes vs Quotation, Approval, Payment Schedule, Order Processing,
// ERP Invoice, Dispatch & Delivery, Sales Contract, Hold / Cancellation, then the shared Activity tabs.
registerRecordTab(SO, { id: 'changes', label: O.tabs.changes, component: LinesTab });
registerRecordTab(SO, { id: 'approval', label: O.tabs.approval, component: ApprovalTab, count: ({ record }) => getDb().approvals.filter((a) => a.recordId === record.id && a.resource === SO && a.type === APPROVAL && a.status === 'pending').length || undefined });
registerRecordTab(SO, { id: 'payments', label: O.tabs.paymentSchedule, component: PaymentsTab, count: ({ record }) => milestonesOf(getDb(), record.id).filter((m) => m.status === 'overdue').length || undefined });
registerRecordTab(SO, { id: 'processing', label: O.tabs.processing, component: ProcessingTab });
registerRecordTab(SO, { id: 'erp', label: O.tabs.erpInvoice, component: ErpInvoiceTab });
registerRecordTab(SO, { id: 'dispatch', label: O.tabs.dispatch, component: DispatchTab });
registerRecordTab(SO, { id: 'contract', label: O.tabs.contract, component: ContractTab });
registerRecordTab(SO, { id: 'holdCancel', label: O.tabs.holdCancel, component: HoldCancelTab });
registerRecordActions('dispatches', DispatchActions);
registerRecordActions('paymentMilestones', MilestoneActions);

function ContractActions({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const [otp, setOtp] = useState<string | null>(null);
  return (
    <>
      <LinkButton to={toPath(ROUTES.salesContractPdf, { recordId: String(record.salesOrderId) })}>{O.actions.viewPdf}</LinkButton>
      {['draft', 'sent_for_signature'].includes(String(record.status)) && (
        <Button
          disabledReason={can(actor, 'orders.contract') ? undefined : O.disabled.sendContract}
          onClick={async () => {
            try {
              const r = await sendContractForSignature(actor, record.id);
              setOtp(r.otp);
            } catch (e) {
              toast(errorMessage(e), 'danger');
            }
          }}
        >
          {O.actions.sendForSignature}
        </Button>
      )}
      {otp && <SignDialog contractId={record.id} otp={otp} onClose={() => setOtp(null)} />}
    </>
  );
}
registerRecordActions('salesContracts', ContractActions);
