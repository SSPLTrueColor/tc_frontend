import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';

const P = L.common.dealProgress;

export type StepKey = (typeof STEPS)[number];
export type StepState = 'done' | 'skipped' | 'current' | 'todo';
/** Quotation → order → delivery → installation, the BRD §3 sales-to-service cycle for one deal. */
const STEPS = ['approved', 'sent', 'accepted', 'order', 'orderApproved', 'payment', 'processing', 'dispatched', 'delivered', 'installed'] as const;

const SO_STEP: Record<string, StepKey> = {
  pending_approval: 'order',
  confirmed: 'orderApproved',
  payment_pending: 'orderApproved',
  payment_received: 'payment',
  processing: 'processing',
  ready_for_dispatch: 'processing',
  dispatched: 'dispatched',
  delivered: 'delivered',
  installation: 'delivered',
  completed: 'installed',
};
const QUOTE_STEP: Record<string, StepKey | null> = { draft: null, pending_approval: null, approved: 'approved', sent: 'sent', negotiation: 'sent', accepted: 'accepted' };

export interface DealProgressModel {
  steps: { key: StepKey; state: StepState }[];
  current?: StepKey;
  /** The record whose status decides the next step, and that status (used to pick the tab to open). */
  driver: { resource: 'quotations' | 'salesOrders'; status: string };
  next?: { who?: string; text: string };
  stopped?: string;
  complete: boolean;
}

/**
 * Where a deal stands: every step's state (done / skipped / current / to do), the next action and who takes it.
 * Driven by the sales order once there is one, else by the quotation. Null when there is neither.
 */
export function dealProgress(quote: RecordData | undefined, order: RecordData | undefined): DealProgressModel | null {
  if (!quote && !order) return null;
  // Consumables orders have no installation; repeat orders have no quotation steps.
  const keys = STEPS.filter((s) => (order?.orderKind === 'consumables' ? s !== 'installed' : true)).filter((s) => (quote ? true : !['approved', 'sent', 'accepted'].includes(s)));
  let done = -1;
  let next: DealProgressModel['next'];
  let stopped: string | undefined;
  let driver: DealProgressModel['driver'];
  if (order) {
    const st = String(order.status);
    driver = { resource: 'salesOrders', status: st };
    if (st === 'cancelled' || st === 'on_hold') {
      done = STEPS.indexOf('order');
      stopped = st === 'cancelled' ? P.stopped.cancelled : P.stopped.onHold;
    } else {
      done = STEPS.indexOf(SO_STEP[st] ?? 'order');
      const text = P.next[st as keyof typeof P.next];
      if (text) next = { who: P.who[st as keyof typeof P.who], text };
    }
  } else {
    const st = String(quote!.status);
    driver = { resource: 'quotations', status: st };
    if (st === 'rejected' || st === 'expired') stopped = st === 'rejected' ? P.stopped.rejected : P.stopped.expired;
    else {
      const step = QUOTE_STEP[st];
      done = step ? STEPS.indexOf(step) : -1;
      const text = P.quoteNext[st as keyof typeof P.quoteNext];
      if (text) next = { who: P.quoteWho[st as keyof typeof P.quoteWho], text };
    }
  }
  let current: StepKey | undefined;
  const steps = keys.map((key) => {
    const i = STEPS.indexOf(key);
    // Sending is optional (the order PO is the acceptance): a quotation ordered without being sent shows it as skipped.
    const skipped = key === 'sent' && i <= done && !!quote && !quote.sentAt;
    let state: StepState = skipped ? 'skipped' : i <= done ? 'done' : 'todo';
    if (state === 'todo' && !current && !stopped) {
      state = 'current';
      current = key;
    }
    return { key, state };
  });
  return { steps, current, driver, next, stopped, complete: !current && !stopped };
}
