import { createElement } from 'react';
import { injectQuotationLeadLookup } from '../modules/quotationComputed';
import { byId } from '../../services/lookups';
/** quotations module: runtime hooks, approval type, record actions/tabs and the expiry/reminder job. */
import { L } from '../../constants/labels';
import { registerRecordActions, registerRecordBanner, registerRecordTab, registerRecordTitleNote, registerStageMoveHandler } from '../../components/resource/extensions';
import { canUpdateRecord } from '../../services/authz';
import { nowIso } from '../../lib/clock';
import { getDb, subscribe } from '../../services/db';
import { quoteBlockReason, reopenBlockReason, reopenQuotesIn } from '../../services/quotations/selection';
import { registerResourceHooks } from '../../services/resourceHooks';
import { onDiscountApproved, onDiscountRejected, QUOTE_APPROVAL, quoteBeforeCreate, quoteBeforeUpdate, runQuotationSweep } from '../../services/quotations/workflow';
import { registerApprovalType } from '../../services/workflow';
import { AcceptDialog, RejectDialog, ApprovalTab, DocumentsTab, LinesTab, OpportunityQuotesTab, PricingTab, QuoteActions, QuoteBanner, QuoteTitleNote, RoiTab, TermsTab, VersionsTab } from '../../modules/quotations/RecordExtensions';

const T = L.quotations.tabs;
injectQuotationLeadLookup((id) => byId('opportunities', id)?.leadId ?? null);

registerResourceHooks('quotations', {
  beforeCreate: quoteBeforeCreate,
  beforeUpdate: quoteBeforeUpdate,
  title: (r) => String(r.quoteNo || r.id),
  // Quotation selection guard: Mark as Sent / Under Negotiation (record, bulk, board) refuse Not Selected quotations.
  transitionBlocked: (_actor, r) => quoteBlockReason(getDb(), r),
  editBlocked: (r) => (r.status === 'not_selected' ? quoteBlockReason(getDb(), r) : undefined),
  // Mark as Sent (manual): stamp the sent date like Send Quotation does, without a message.
  beforeTransition: (_ctx, r, to) => {
    if (to !== 'sent') return;
    const rec = r as Record<string, unknown>;
    if (!rec.sentAt) rec.sentAt = nowIso();
    if (!rec.sentVia) rec.sentVia = L.quotations.lifecycle.sentManually;
  },
});

// Accepted / Rejected from the list status chip or the board open the same dialogs as the record actions.
registerStageMoveHandler('quotations', {
  targets: ({ actor, res, record }) => (record.isLatest && canUpdateRecord(actor, res, record) && ['sent', 'negotiation'].includes(String(record.status)) && !quoteBlockReason(getDb(), record) ? ['accepted', 'rejected'] : []),
  Dialog: ({ record, to, onClose }) => createElement(to === 'accepted' ? AcceptDialog : RejectDialog, { record, onClose }),
});

// Re-opening a won opportunity is blocked while its sales order is live; once re-opened, its quotations open again.
registerResourceHooks('opportunities', {
  transitionBlocked: (_actor, r, to) => reopenBlockReason(getDb(), r, to),
  afterTransition: (ctx, before, after) => {
    if (after.stage === 'needs_assessment' && ['won', 'lost'].includes(String(before.stage))) reopenQuotesIn(ctx, before);
  },
});

// FR-040 / BR-17: multi-level discount approval; decisions happen on the Pending Approvals page.
registerApprovalType(QUOTE_APPROVAL, {
  label: L.quotations.approvalType,
  onApproved: (ctx, a) => onDiscountApproved(ctx, a.recordId),
  onRejected: (ctx, a) => onDiscountRejected(ctx, a.recordId, a.decisionNote ?? ''),
});

registerRecordActions('quotations', QuoteActions);
// Deal progress (whole quotation → installation cycle + next step) above the status banner.
// Deal progress and next step live in the Deal Journey card under the header (components/resource/DealChain).
registerRecordBanner('quotations', QuoteBanner);
registerRecordTitleNote('quotations', QuoteTitleNote);
// GLOSSARY §1.2 quotation record tabs, in order. "Activity History" is the shared activity tab of the record view.
registerRecordTab('quotations', { id: 'lines', label: T.lineItems, component: LinesTab });
registerRecordTab('quotations', { id: 'pricing', label: T.pricing, component: PricingTab });
registerRecordTab('quotations', { id: 'terms', label: T.terms, component: TermsTab });
registerRecordTab('quotations', { id: 'approval', label: T.approval, component: ApprovalTab });
registerRecordTab('quotations', { id: 'versions', label: T.versions, component: VersionsTab });
registerRecordTab('quotations', { id: 'roi', label: T.roi, component: RoiTab });
registerRecordTab('quotations', { id: 'documents', label: T.documents, component: DocumentsTab });
registerRecordTab('opportunities', { id: 'quotations', label: T.opportunityQuotations, component: OpportunityQuotesTab });

/**
 * Simulated server job (FR-044, QUO-06): expire quotations past validity, tidy withdrawn requests and
 * remind approvers after 24 h. Runs at start-up and after every store change (e.g. the demo clock
 * moving forward); it only writes when something is due, so it settles immediately.
 */
let queued = false;
const schedule = () => {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    try {
      runQuotationSweep();
    } catch {
      /* a sweep never blocks the UI; the next change retries */
    }
  }, 50);
};
if (typeof window !== 'undefined') {
  subscribe(schedule);
  schedule();
}
