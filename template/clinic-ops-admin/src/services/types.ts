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

/** Workflow Runtime — owns formal approval decisions. */
export interface Approval {
  id: string;
  type: 'invoice.writeoff';
  workspaceId: string;
  resource: string;
  recordId: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  taskId?: string;
  version: number;
}

/** Notification Service — delivery/inbox state only; reading never approves or completes. */
export interface AppNotification {
  id: string;
  userId: string;
  workspaceId: string;
  kind: 'mention' | 'assignment' | 'approval_request' | 'approval_decision' | 'exception' | 'reminder';
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
  schemaVersion: number;
  seed: number;
  seededAt: string;
  records: Record<string, RecordData[]>;
  counters: Record<string, number>;
  comments: Comment[];
  approvals: Approval[];
  notifications: AppNotification[];
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
  };
  idempotency: Record<string, string>;
  session: { userId: string; workspaceId: string };
  settings: Record<string, PersonalSettings>;
  commentDrafts: Record<string, string>;
  formDrafts: Record<string, Record<string, unknown>>;
}

export type ServiceErrorCode = 'forbidden' | 'validation' | 'conflict' | 'version_conflict' | 'not_found' | 'invalid_state';

export interface ScheduleConflict {
  kind: 'room' | 'clinician' | 'room_status' | 'working_day';
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
