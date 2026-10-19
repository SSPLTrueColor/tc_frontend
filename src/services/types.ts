import type { FieldDefinition, MasterDefinition, RecordData, ViewDefinition } from '../metadata/types';

/** Communication Service — record comments (internal only in this prototype). */
export interface Comment {
  id: string;
  workspaceId: string;
  resource: string;
  recordId: string;
  body: string;
  authorId: string;
  createdAt: string;
  mentions: string[];
  visibility: 'internal';
}

/** One approval level: who may decide it (capability) and a readable label. */
export interface ApprovalLevel {
  capability: string;
  label: string;
  /** Optional named approver (employee id), e.g. the requester's reporting manager. Only they may decide this level. */
  approverStaffId?: string;
}

/** Workflow Runtime — owns formal approval decisions (multi-level, separation of duties). */
export interface Approval {
  id: string;
  /** Registered approval type, e.g. "quotation.discount" (see workflow.ts registerApprovalType). */
  type: string;
  workspaceId: string;
  resource: string;
  recordId: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  /** Short text shown in the inbox, e.g. "Discount 12% on QT/TX/26-27/0004". */
  summary: string;
  amount?: number;
  /** Division of the subject record — approvers outside it are not asked (division heads). */
  divisionIds?: string[];
  levels: ApprovalLevel[];
  currentLevel: number;
  decisions: { level: number; by: string; at: string; decision: 'approved' | 'rejected'; note: string }[];
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  remindedAt?: string;
  version: number;
}

/** Simulated external message (email / WhatsApp / SMS / push). Nothing leaves the browser. */
export interface OutboxMessage {
  id: string;
  workspaceId: string;
  channel: 'email' | 'whatsapp' | 'sms' | 'push';
  to: string;
  subject?: string;
  body: string;
  templateId?: string;
  related?: { resource: string; recordId: string };
  createdAt: string;
  createdBy: string;
  status: 'simulated';
}

/** Soft-deleted record (COM-10): restorable by an administrator. */
export interface RecycleEntry {
  id: string;
  workspaceId: string;
  resource: string;
  record: RecordData;
  deletedAt: string;
  deletedBy: string;
}

/** Demo controls (admin settings). */
export interface DemoSettings {
  latencyMin: number;
  latencyMax: number;
  /** 0–1 chance that a simulated service call fails, to show error states. */
  failureRate: number;
  /** Idle minutes before the simulated session locks (NFR-08). */
  idleTimeoutMin: number;
}

/** Notification Service — delivery/inbox state only; reading never approves or completes. */
export interface AppNotification {
  id: string;
  userId: string;
  workspaceId: string;
  kind: 'mention' | 'assignment' | 'approval_request' | 'approval_decision' | 'exception' | 'reminder' | 'escalation' | 'info';
  title: string;
  link?: { resource: string; recordId: string } | { page: string };
  createdAt: string;
  readAt?: string;
  snoozedUntil?: string;
}

/** Audit Ledger — append-only evidence (local simulation; not tamper-evident). */
export interface AuditEntry {
  id: string;
  at: string;
  workspaceId: string;
  actorId: string;
  actorRole: string;
  actorType: 'user' | 'workflow' | 'system';
  action: string;
  resource?: string;
  recordId?: string;
  summary: string;
  changes?: { field: string; label: string; before: string; after: string }[];
  correlationId: string;
}

/** Versioned domain-event envelope (UAB §13), written to a simulated outbox. */
export interface DomainEvent<T = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  tenantId: string;
  workspaceId: string;
  actorId: string;
  actorType: 'user' | 'service' | 'agent';
  resourceId?: string;
  recordId?: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  classification?: string;
  payload: T;
  delivery: 'simulated';
}

export interface ConfigDraft {
  id: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  masters: Record<string, MasterDefinition>;
  newFields: { resource: string; field: FieldDefinition }[];
}

export interface ConfigVersion {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy: string;
  summary: string[];
}

export interface PersonalSettings {
  theme: 'system' | 'light' | 'dark';
  railSkin: 'softCharcoal' | 'midnightNavy' | 'graphiteBlack' | 'softLight';
  navDensity: 'balanced' | 'compact';
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  pins: { label: string; path: string }[];
  favorites: { label: string; path: string; icon?: string }[];
  /** Colour theme (palette id) and the user's own saved palettes. */
  palette: string;
  customPalettes: { id: string; name: string; accent: string; sidebar: string; rail: string; custom?: boolean }[];
  recents: { label: string; path: string; at: string }[];
  defaultViews: Record<string, string>;
}

export interface Db {
  schemaVersion: string;
  seed: number;
  seededAt: string;
  records: Record<string, RecordData[]>;
  counters: Record<string, number>;
  comments: Comment[];
  approvals: Approval[];
  notifications: AppNotification[];
  outbox: OutboxMessage[];
  recycle: RecycleEntry[];
  demo: DemoSettings;
  audit: AuditEntry[];
  events: DomainEvent[];
  views: ViewDefinition[];
  config: {
    version: number;
    masters: Record<string, MasterDefinition>;
    customFields: Record<string, FieldDefinition[]>;
    resourceVersions: Record<string, number>;
    history: ConfigVersion[];
    draft: ConfigDraft | null;
    /** Admin-edited business policies (see services/policies.ts); missing keys use defaults. */
    policies?: Record<string, unknown>;
  };
  idempotency: Record<string, string>;
  /** Simulated sign-in: no passwords; MFA roles confirm a displayed one-time code. */
  session: { userId: string; workspaceId: string; signedIn: boolean; lastActiveAt: string };
  settings: Record<string, PersonalSettings>;
  commentDrafts: Record<string, string>;
  formDrafts: Record<string, Record<string, unknown>>;
}

export type ServiceErrorCode = 'forbidden' | 'validation' | 'conflict' | 'version_conflict' | 'not_found' | 'invalid_state';

export interface ScheduleConflict {
  kind: string;
  message: string;
  recordId?: string;
  overridable: boolean;
}

export class ServiceError extends Error {
  code: ServiceErrorCode;
  fieldErrors?: Record<string, string>;
  conflicts?: ScheduleConflict[];
  constructor(code: ServiceErrorCode, message: string, extra?: { fieldErrors?: Record<string, string>; conflicts?: ScheduleConflict[] }) {
    super(message);
    this.code = code;
    this.fieldErrors = extra?.fieldErrors;
    this.conflicts = extra?.conflicts;
  }
}
