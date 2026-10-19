import type { RecordData } from '../metadata/types';
import type { DemoUser } from '../domain/pack';
import type { AppNotification, Approval } from '../services/types';
import type { prng } from '../lib/ids';

/** Shared, mutable seed state. Modules append records and bump counters; later modules read earlier ones. */
export interface SeedContext {
  rnd: ReturnType<typeof prng>;
  now: Date;
  /** "YYYY-MM-DD" of `now` (simulated clock at first load). */
  today: string;
  ws: 'tc';
  users: DemoUser[];
  /** Records by resource key. Create arrays with `ctx.records[key] ??= []`. */
  records: Record<string, RecordData[]>;
  /** Id counters: `${resKey}` for seq ids (start 1000), `${resKey}:${fy}` for fy ids. */
  counters: Record<string, number>;
  notifications: AppNotification[];
  /** Pending/decided approvals (Workflow Runtime). Ids "APR-<n>" — use `ctx.counters.approvals`. */
  approvals: Approval[];
  /** Standard record envelope (workspace, version, timestamps) dated `daysAgo` before now. */
  base: (daysAgo?: number, createdBy?: string) => Pick<RecordData, 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'createdBy'>;
  /** Next id for a resource, matching the runtime's series ("C-1001" or "LD-2627-00001"). */
  nextId: (resKey: string, prefix: string, format?: 'seq' | 'fy', at?: Date) => string;
  /** Employee id of a demo user. */
  staff: (userId: string) => string;
}
