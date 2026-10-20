import type { RecordData } from '../../metadata/types';
import { cx } from '../../lib/format';
import { getDb } from '../../services/db';
import { L } from '../../constants/labels';

const P = L.common.dealProgress;

type StepKey = (typeof STEPS)[number];
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

/** Index of the last completed step (-1 = none yet) and the next action, from the quotation and its sales order. */
function progressOf(quote: RecordData | undefined, order: RecordData | undefined): { done: number; next: string | null; stopped?: string } {
  if (order) {
    const st = String(order.status);
    if (st === 'cancelled') return { done: STEPS.indexOf('order'), next: null, stopped: P.stopped.cancelled };
    if (st === 'on_hold') return { done: STEPS.indexOf('order'), next: null, stopped: P.stopped.onHold };
    const done = STEPS.indexOf(SO_STEP[st] ?? 'order');
    return { done, next: P.next[st as keyof typeof P.next] ?? null };
  }
  if (!quote) return { done: -1, next: null };
  const st = String(quote.status);
  if (st === 'rejected' || st === 'expired') return { done: -1, next: null, stopped: st === 'rejected' ? P.stopped.rejected : P.stopped.expired };
  const step = QUOTE_STEP[st];
  return { done: step ? STEPS.indexOf(step) : -1, next: P.quoteNext[st as keyof typeof P.quoteNext] ?? null };
}

/**
 * Deal progress strip on quotations and sales orders: the whole quotation-to-installation cycle with the current
 * step highlighted and the next action (and who does it), so the way forward is never hidden behind tabs.
 */
export function DealProgress({ resource, record }: { resource: 'quotations' | 'salesOrders'; record: RecordData }) {
  const d = getDb().records;
  const quote = resource === 'quotations' ? record : (d.quotations ?? []).find((q) => q.id === record.quotationId);
  const order = resource === 'salesOrders' ? record : (d.salesOrders ?? []).find((o) => o.quotationId === record.id && o.status !== 'cancelled');
  if (resource === 'quotations' && !record.isLatest) return null;
  // Consumables orders have no installation; repeat orders have no quotation steps.
  const steps = STEPS.filter((s) => (order?.orderKind === 'consumables' ? s !== 'installed' : true)).filter((s) => (quote ? true : !['approved', 'sent', 'accepted'].includes(s)));
  const { done, next, stopped } = progressOf(quote, order);
  return (
    <section className="deal-progress" aria-label={P.title}>
      <ol className="deal-steps">
        {steps.map((s) => {
          const i = STEPS.indexOf(s);
          // Sending is optional (the order PO is the acceptance): a quotation ordered without being sent shows it as skipped.
          const skipped = s === 'sent' && i <= done && !!quote && !quote.sentAt;
          const state = skipped ? 'skipped' : i <= done ? 'done' : i === done + 1 && !stopped ? 'current' : 'todo';
          return (
            <li key={s} className={cx('deal-step', `is-${state}`)} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="deal-dot" aria-hidden="true" />
              <span className="deal-label">{skipped ? P.skipped(P.steps[s]) : P.steps[s]}</span>
            </li>
          );
        })}
      </ol>
      {(stopped || next) && (
        <p className={cx('deal-next', stopped && 'is-stopped')}>
          <strong>{stopped ? P.stoppedLabel : P.nextLabel}</strong> {stopped ?? next}
        </p>
      )}
    </section>
  );
}
