/**
 * Deterministic, referentially valid DEMO data for True Colors. All people, companies, phone
 * numbers and email addresses are fictional. Dates are generated relative to the day the
 * dataset is first seeded (simulated clock) so the demo always has overdue, today and upcoming work.
 * Module seeds run in business order; each reads what earlier modules created.
 */
import { prng } from '../lib/ids';
import { toDateKey } from '../lib/dates';
import { fyCode } from '../lib/fy';
import { demoUsers } from '../domain/pack';
import type { AppNotification, Approval } from '../services/types';
import type { RecordData } from '../metadata/types';
import type { SeedContext } from './context';
import { seedCore } from './core';
import * as catalog from './catalog';
import * as customers from './customers';
import * as leads from './leads';
import * as opportunities from './opportunities';
import * as quotations from './quotations';
import * as orders from './orders';
import * as installed from './installed';
import * as service from './service';
import * as spares from './spares';
import * as field from './field';
import * as reports from './reports';
import * as calendar from './calendar';
import { normaliseQuoteSelection } from '../services/quotations/normalise';

const MODULES = [catalog, customers, leads, opportunities, quotations, orders, installed, service, spares, field, reports, calendar];

/** Changes whenever any module bumps its seed `rev` → stored demo data is re-seeded. */
export const SEED_REVISION = MODULES.map((m) => m.rev).join('.');

export interface SeedResult {
  records: Record<string, RecordData[]>;
  counters: Record<string, number>;
  notifications: AppNotification[];
  approvals: Approval[];
}

export function seedApp(seed: number, now: Date): SeedResult {
  const counters: Record<string, number> = {};
  const ctx: SeedContext = {
    rnd: prng(seed),
    now,
    today: toDateKey(now),
    ws: 'tc',
    users: demoUsers,
    records: {},
    counters,
    notifications: [],
    approvals: [],
    base: (daysAgo = 120, createdBy = 'system') => {
      const at = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
      return { workspaceId: 'tc', version: 1, createdAt: at, updatedAt: at, createdBy };
    },
    nextId: (resKey, prefix, format = 'seq', at = now) => {
      if (format === 'fy') {
        const fy = fyCode(at);
        const k = `${resKey}:${fy}`;
        counters[k] = (counters[k] ?? 0) + 1;
        return `${prefix}-${fy}-${String(counters[k]).padStart(5, '0')}`;
      }
      counters[resKey] = Math.max(counters[resKey] ?? 1000, 1000) + 1;
      return `${prefix}-${counters[resKey]}`;
    },
    staff: (userId) => demoUsers.find((u) => u.id === userId)?.staffIds.tc ?? '',
  };
  seedCore(ctx);
  MODULES.forEach((m) => m.seed(ctx));
  // Quotation selection: Won / Lost opportunities have no open quotations (others are Not Selected).
  normaliseQuoteSelection(ctx.records, ctx.approvals, now.toISOString());
  return { records: ctx.records, counters, notifications: ctx.notifications, approvals: ctx.approvals };
}
