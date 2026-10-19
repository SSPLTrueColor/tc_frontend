/** quotations module: runtime hooks, approval type, record actions/tabs and the expiry/reminder job. */
import { registerRecordActions, registerRecordBanner, registerRecordTab } from '../../components/resource/extensions';
import { subscribe } from '../../services/db';
import { registerResourceHooks } from '../../services/resourceHooks';
import { onDiscountApproved, onDiscountRejected, QUOTE_APPROVAL, quoteBeforeCreate, quoteBeforeUpdate, runQuotationSweep } from '../../services/quotations/workflow';
import { registerApprovalType } from '../../services/workflow';
import { LinesTab, OpportunityQuotesTab, QuoteActions, QuoteBanner, RevisionsTab, RoiTab } from '../../modules/quotations/RecordExtensions';

registerResourceHooks('quotations', {
  beforeCreate: quoteBeforeCreate,
  beforeUpdate: quoteBeforeUpdate,
  title: (r) => String(r.quoteNo || r.id),
});

// FR-040 / BR-17: multi-level discount approval; decisions happen in the Work inbox.
registerApprovalType(QUOTE_APPROVAL, {
  label: 'Quotation discount',
  onApproved: (ctx, a) => onDiscountApproved(ctx, a.recordId),
  onRejected: (ctx, a) => onDiscountRejected(ctx, a.recordId, a.decisionNote ?? ''),
});

registerRecordActions('quotations', QuoteActions);
registerRecordBanner('quotations', QuoteBanner);
registerRecordTab('quotations', { id: 'lines', label: 'Lines', component: LinesTab });
registerRecordTab('quotations', { id: 'revisions', label: 'Revisions', component: RevisionsTab });
registerRecordTab('quotations', { id: 'roi', label: 'ROI', component: RoiTab });
registerRecordTab('opportunities', { id: 'quotations', label: 'Quotations', component: OpportunityQuotesTab });

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
