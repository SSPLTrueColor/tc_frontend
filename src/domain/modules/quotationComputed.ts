/** Deferred lookup keeps metadata independent of store initialization. */
let sourceLead: (opportunityId: unknown) => unknown = () => null;
export const injectQuotationLeadLookup = (lookup: typeof sourceLead) => { sourceLead = lookup; };
export const quotationLead = (record: Record<string, unknown>) => sourceLead(record.opportunityId);
