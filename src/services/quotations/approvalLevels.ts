/**
 * QUO-06 / BR-17 approver resolution for quotation discount requests. PURE (labels and types only), so the
 * workflow service and the seed share it.
 *
 * REQUIREMENTS §2.2 gives quotation approval (A) to Sales Manager (level 1, own team), Division Head (level 2)
 * and Management (level 3). Other roles that happen to hold an approve.l1 capability for their own area
 * (e.g. Service Head for service approvals) must not decide sales discounts, so:
 * - Level 1 is a named approver: the quotation owner's reporting manager when that person is a Sales Manager.
 * - A level nobody can decide (no Sales Manager over the owner, the requester is the only Division Head …)
 *   moves up to the next level, so a request is never stuck and never decided by the requester.
 * - ADM-02: capabilities an administrator grants in Roles › "Approvals and special actions" (e.g. approve.l2 for
 *   another role) also count, and a level taken away from its hard-wired role no longer counts for that role.
 */
import { L } from '../../constants/labels';
import type { ApprovalLevel } from '../types';

export interface ApproverUser {
  id: string;
  name: string;
  roleId: string;
  staffIds: Record<string, string>;
  managerId?: string;
  divisions: string[];
}

/** Role that holds each quotation approval level (REQUIREMENTS §2.2 "Quotations" column). */
export const QUOTE_LEVEL_ROLE: Record<string, string> = { 'approve.l1': 'sales_manager', 'approve.l2': 'division_head', 'approve.l3': 'management' };
const ORDER = ['approve.l1', 'approve.l2', 'approve.l3'];
const LABEL: Record<string, string> = { 'approve.l1': L.roles.approvalLevels[1], 'approve.l2': L.roles.approvalLevels[2], 'approve.l3': L.roles.approvalLevels[3] };

/** Administrator edits of role capabilities, per role (Roles › Approvals and special actions). */
export type CapabilityGrants = Record<string, { add: string[]; remove: string[] } | undefined>;

export interface ResolveInput {
  ownerStaffId: unknown;
  requesterUserId: string;
  divisionId: unknown;
  users: ApproverUser[];
  workspaceId?: string;
  grants?: CapabilityGrants;
}

/** Does a role hold a quotation approval level: its hard-wired role (unless removed) or granted by an administrator. */
export function roleHoldsQuoteLevel(roleId: string, cap: string, grants: CapabilityGrants = {}): boolean {
  const g = grants[roleId];
  if (g?.add.includes(cap)) return true;
  return QUOTE_LEVEL_ROLE[cap] === roleId && !g?.remove.includes(cap);
}

export function resolveQuoteLevels(levels: ApprovalLevel[], input: ResolveInput): ApprovalLevel[] {
  const ws = input.workspaceId ?? 'tc';
  const div = String(input.divisionId ?? '');
  const others = input.users.filter((u) => u.id !== input.requesterUserId);
  const resolve = (cap: string): ApprovalLevel | null => {
    const base = { capability: cap, label: LABEL[cap] };
    if (cap === 'approve.l1') {
      const owner = input.users.find((u) => u.staffIds[ws] === String(input.ownerStaffId ?? ''));
      const mgr = owner && others.find((u) => u.id === owner.managerId && roleHoldsQuoteLevel(u.roleId, cap, input.grants));
      return mgr ? { ...base, label: `${base.label} — ${mgr.name}`, approverStaffId: mgr.staffIds[ws] } : null;
    }
    const any = others.some((u) => roleHoldsQuoteLevel(u.roleId, cap, input.grants) && (cap === 'approve.l3' || u.divisions.includes(div)));
    return any || cap === 'approve.l3' ? base : null;
  };
  const out: ApprovalLevel[] = [];
  for (const lv of levels) {
    let i = ORDER.indexOf(lv.capability);
    if (i < 0) {
      out.push(lv); // custom capability configured by the administrator: used as configured
      continue;
    }
    for (; i < ORDER.length; i++) {
      if (out.some((x) => x.capability === ORDER[i])) break;
      const r = resolve(ORDER[i]);
      if (r) {
        out.push(r);
        break;
      }
    }
  }
  return out;
}

/** May this role decide a quotation level? Named levels are checked by the shared canDecide; capability levels need the matching role. */
export const roleMayDecideQuoteLevel = (roleId: string, level?: ApprovalLevel, grants?: CapabilityGrants) =>
  !!level && (!!level.approverStaffId || !QUOTE_LEVEL_ROLE[level.capability] || roleHoldsQuoteLevel(roleId, level.capability, grants));
