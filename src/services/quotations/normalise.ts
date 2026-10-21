/**
 * Quotation selection consistency for demo data (seed and data already stored in the browser).
 * Pure and dependency-light (no engine imports) so the seed builder and the store loader can call it
 * without import cycles. Idempotent: only open quotations change, so a second run changes nothing.
 *
 * - Won opportunity: the accepted (latest) quotation is the selected one — opportunity.selectedQuotationId
 *   and value (live sales order total, else the quotation total) are set; every other open quotation
 *   becomes Not Selected.
 * - Lost opportunity: every open quotation becomes Not Selected ("Opportunity lost").
 * Pending discount approvals of the closed quotations are withdrawn.
 */
import { L } from '../../constants/labels';
import type { RecordData } from '../../metadata/types';
import type { Approval } from '../types';

const OPEN = ['draft', 'pending_approval', 'approved', 'sent', 'negotiation'];
const S = L.quotations.selection;

export function normaliseQuoteSelection(records: Record<string, RecordData[] | undefined>, approvals: Approval[], fallbackAt: string): number {
  const quotes = records.quotations ?? [];
  const opps = records.opportunities ?? [];
  if (!quotes.length || !opps.length) return 0;
  const orders = records.salesOrders ?? [];
  const byOpp = new Map<string, RecordData[]>();
  quotes.forEach((q) => {
    if (!q.opportunityId) return;
    const k = String(q.opportunityId);
    byOpp.set(k, [...(byOpp.get(k) ?? []), q]);
  });
  let changed = 0;
  opps.forEach((o) => {
    if (o.stage !== 'won' && o.stage !== 'lost') return;
    const list = byOpp.get(String(o.id)) ?? [];
    const winner = o.stage === 'won' ? list.find((q) => q.id === o.selectedQuotationId && q.status === 'accepted') ?? list.find((q) => q.status === 'accepted' && q.isLatest !== false) : undefined;
    if (winner && o.selectedQuotationId !== winner.id) {
      const so = orders.find((x) => x.opportunityId === o.id && x.status !== 'cancelled');
      o.selectedQuotationId = winner.id;
      o.value = Number(so?.grandTotal) || Number(winner.grandTotal) || o.value;
      changed++;
    }
    const reason = winner ? S.reasonAccepted(String(winner.quoteNo ?? winner.id)) : o.stage === 'lost' ? S.reasonLost : S.reasonWon;
    const at = String((winner?.acceptedAt as string | undefined) ?? o.wonAt ?? o.stageChangedAt ?? o.updatedAt ?? fallbackAt);
    list.forEach((q) => {
      if (q.id === winner?.id || !OPEN.includes(String(q.status))) return;
      approvals.forEach((a) => {
        if (a.recordId === q.id && a.resource === 'quotations' && a.status === 'pending') {
          a.status = 'withdrawn';
          a.decidedAt = at;
          a.decisionNote = S.withdrawWhy(reason);
          a.version++;
        }
      });
      Object.assign(q, { previousStatus: q.status, status: 'not_selected', notSelectedAt: at, notSelectedReason: reason, selectedQuotationId: winner?.id ?? null });
      changed++;
    });
  });
  return changed;
}
