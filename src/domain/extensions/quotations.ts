import { injectQuotationLeadLookup } from '../modules/quotationComputed';
import { byId } from '../../services/lookups';
/** quotations module: runtime hooks, approval type, record actions/tabs and the expiry/reminder job. */
import { L } from '../../constants/labels';
import { registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { subscribe } from '../../services/db';
import { registerResourceHooks } from '../../services/resourceHooks';
import { onDiscountApproved, onDiscountRejected, QUOTE_APPROVAL, quoteBeforeCreate, quoteBeforeUpdate, runQuotationSweep } from '../../services/quotations/workflow';
import { registerApprovalType } from '../../services/workflow';
import { ApprovalTab, DocumentsTab, LinesTab, OpportunityQuotesTab, PricingTab, QuoteActions, QuoteBanner, RoiTab, TermsTab, VersionsTab } from '../../modules/quotations/RecordExtensions';

const T = L.quotations.tabs;
injectQuotationLeadLookup((id) => byId('opportunities', id)?.leadId ?? null);

registerResourceHooks('quotations', {
  beforeCreate: quoteBeforeCreate,
  beforeUpdate: quoteBeforeUpdate,
  title: (r) => String(r.quoteNo || r.id),
});

// FR-040 / BR-17: multi-level discount approval; decisions happen on the Pending Approvals page.
registerApprovalType(QUOTE_APPROVAL, {
  label: L.quotations.approvalType,
  onApproved: (ctx, a) => onDiscountApproved(ctx, a.recordId),
  onRejected: (ctx, a) => onDiscountRejected(ctx, a.recordId, a.decisionNote ?? ''),
});

registerRecordActions('quotations', QuoteActions);
registerRecordBanner('quotations', QuoteBanner);
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
