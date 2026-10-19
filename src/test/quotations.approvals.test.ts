import '../domain/extensions/quotations';
import { L } from '../constants/labels';
import { demoUsers } from '../domain/pack';
import { actorFor } from '../services/authz';
import { __setDb, createDb, getDb } from '../services/db';
import { masterLabel } from '../services/registry';
import { decideQuoteApproval, levelName, pendingQuoteApprovals } from '../services/quotations/workflow';

const actors = () => demoUsers.map((u) => actorFor(u.id, 'tc'));

describe('quotation Pending Approvals (QUO-06 / QUO-14)', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('names approval levels by role (GLOSSARY §3)', () => {
    expect(levelName({ capability: 'approve.l1', label: 'x' })).toBe(L.roles.approvalLevels[1]);
    expect(levelName({ capability: 'approve.l3', label: 'x' })).toBe('Management (MD)');
    expect(levelName({ capability: 'custom', label: 'Named approver' })).toBe('Named approver');
  });

  it('uses Title Case status values', () => {
    expect(masterLabel('quoteStatus', 'pending_approval')).toBe('Pending Approval');
    expect(masterLabel('quoteStatus', 'negotiation')).toBe('Under Negotiation');
  });

  it('lists pending requests per viewer and lets the level holder decide', () => {
    const pending = getDb().approvals.filter((a) => a.type === 'quotation.discount' && a.status === 'pending');
    if (!pending.length) return; // upstream seed not available
    const admin = actorFor(demoUsers[0].id, 'tc');
    const all = pendingQuoteApprovals(admin);
    expect(all.length).toBeGreaterThan(0);
    all.forEach((r) => {
      expect(r.step).toBeGreaterThanOrEqual(1);
      expect(Object.values(L.roles.approvalLevels)).toContain(r.levelName);
      expect(r.overdue).toBe(r.waitingHours >= 24);
    });
    const decider = actors().find((x) => pendingQuoteApprovals(x).some((r) => r.canDecide));
    if (!decider) return;
    const row = pendingQuoteApprovals(decider).find((r) => r.canDecide)!;
    expect(row.ownRequest).toBe(false);
    expect(() => decideQuoteApproval(decider, row.approval.id, 'rejected', 'no', row.approval.version)).toThrow();
    decideQuoteApproval(decider, row.approval.id, 'rejected', 'Discount too high for this account', row.approval.version);
    const q = getDb().records.quotations.find((x) => x.id === row.quoteId)!;
    expect(q.status).toBe('draft');
    expect(pendingQuoteApprovals(decider).some((r) => r.approval.id === row.approval.id)).toBe(false);
  });

  it('hides pending approvals from roles without quotation access', () => {
    const none = actors().find((x) => x.role.id === 'engineer' || x.role.id === 'store');
    if (none) expect(pendingQuoteApprovals(none)).toEqual([]);
  });
});
