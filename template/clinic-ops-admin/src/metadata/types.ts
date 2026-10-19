/**
 * UAB 2.0 canonical metadata contracts (frontend prototype implementation).
 *
 * One ResourceDefinition feeds grid, form, filter, search, inspector, export
 * and reports. Forms/views control presentation only — they never redefine a
 * field's type or sensitivity.
 */

export type FieldType =
  | 'text'
  | 'longtext'
  | 'email'
  | 'phone'
  | 'identifier'
  | 'number'
  | 'money'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'master'
  | 'multimaster'
  | 'relation'
  | 'progress'
  | 'lineitems'
  /** Picture (data/URL) — thumbnail in grids, initials tile when empty. */
  | 'image'
  /** Several people (relation ids) — avatar stack with "+N" in grids. */
  | 'people';

/** Classification drives masking/hiding per role. Toggling column visibility never changes it. */
export type Sensitivity = 'none' | 'contact' | 'identifier' | 'health' | 'financial';

/** Declarative, typed condition — no customer-authored code is ever evaluated. */
export interface FieldCondition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'notIn' | 'truthy' | 'falsy';
  value?: unknown;
}

export interface FieldCapabilities {
  list?: boolean;
  sort?: boolean;
  filter?: boolean;
  search?: boolean;
  form?: boolean;
  export?: boolean;
}

export interface LineItemColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'master';
  master?: string;
  required?: boolean;
  min?: number;
}

export interface FieldDefinition {
  /** Immutable stable id — survives label changes. */
  id: string;
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  placeholder?: string;
  required?: boolean;
  requiredWhen?: FieldCondition;
  visibleWhen?: FieldCondition;
  /** Declared policy: clear the stored value when the field becomes hidden. */
  clearWhenHidden?: boolean;
  master?: string;
  /** Dependent master: only values whose `parent` equals the value of this field. */
  masterParentField?: string;
  relation?: {
    resource: string;
    /** Dependent lookup: options where option[field] === form[fromField]. */
    filterBy?: { field: string; fromField: string };
    /** Static option restriction, e.g. only clinical staff. */
    where?: FieldCondition;
  };
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: { regex: string; message: string };
  currency?: string;
  unit?: string;
  defaultValue?: unknown;
  /** Pack-authored derivation (shipped code, not runtime-configured script). */
  computed?: (record: Record<string, unknown>) => unknown;
  readOnly?: boolean;
  system?: boolean;
  sensitivity?: Sensitivity;
  capabilities: FieldCapabilities;
  lineItemColumns?: LineItemColumn[];
  /** Cross-field validation (declarative compare). */
  compare?: { op: 'gte' | 'lte'; field: string; message: string };
  /** Date must be in the past (e.g. date of birth). */
  dateRule?: 'past';
  width?: number;
  /** Multi-line rows: fields shown as line 2 and line 3 under this field's value. */
  subFields?: string[];
  /** Leading visual before the value: an image field key, or 'initials' for an initials tile. */
  leadingImage?: string;
  /** Show the leading visual only from this many lines per row (e.g. 3 = only in three-line rows). Default 2. */
  leadingImageMinLines?: 2 | 3;
  /** Relation to people shown as avatar + name (multi-line views only). */
  display?: 'person';
  /** Field of the related person shown under their name (e.g. staffRole), in multi-line views and the people card. */
  personSubtitle?: string;
  /** True when the field was added through the Configuration Studio. */
  custom?: boolean;
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface MasterValue {
  key: string; // immutable
  label: string;
  tone?: Tone;
  parent?: string;
  active: boolean;
  order: number;
}

export interface MasterDefinition {
  id: string;
  key: string;
  label: string;
  description?: string;
  version: number;
  values: MasterValue[];
}

export interface Transition {
  from: string[];
  to: string;
  action: string;
  /** Capability required in addition to resource update permission. */
  capability?: string;
  confirm?: string;
}

export interface LifecycleDefinition {
  field: string;
  initial: string;
  transitions: Transition[];
  terminal: string[];
}

export interface RelationshipDefinition {
  id: string;
  label: string;
  resource: string;
  foreignKey: string;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  fields: string[];
  columns?: 1 | 2;
}

export interface FormDefinition {
  quickCreate: string[];
  sections: FormSection[];
  wizard?: { id: string; title: string; sections: string[] }[];
}

export type ViewType = 'table' | 'board' | 'calendar';
export type ViewScope = 'personal' | 'team' | 'org';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'empty'
  | 'notEmpty'
  | 'today'
  | 'next7'
  | 'last30'
  | 'past'
  | 'future';

export interface FilterCondition {
  kind: 'condition';
  id: string;
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface FilterGroup {
  kind: 'group';
  id: string;
  join: 'and' | 'or';
  children: (FilterCondition | FilterGroup)[];
}

export interface ColumnState {
  key: string;
  hidden?: boolean;
  width?: number;
  pinned?: boolean;
}

export interface ViewDefinition {
  id: string;
  resource: string;
  name: string;
  type: ViewType;
  scope: ViewScope;
  ownerId: string;
  filter: FilterGroup;
  sort: { field: string; dir: 'asc' | 'desc' }[];
  groupBy?: string;
  columns: ColumnState[];
  density: 'compact' | 'comfortable';
  /** Lines per table row: 1 = one-line, 2 = two-line, 3 = three-line (sub fields). */
  rowLines?: 1 | 2 | 3;
  boardField?: string;
  isDefault?: boolean;
  order: number;
  workspaceId?: string;
  /** Resource schema version this view was validated against. */
  resourceVersion: number;
}

export interface ResourceDefinition {
  id: string;
  key: string;
  module: string;
  label: string;
  labelPlural: string;
  icon: string;
  version: number;
  idPrefix: string;
  titleField: string;
  subtitleFields: string[];
  fields: FieldDefinition[];
  relationships: RelationshipDefinition[];
  lifecycle?: LifecycleDefinition;
  form: FormDefinition;
  views: Omit<ViewDefinition, 'resourceVersion'>[];
  /** Calendar presentation: start/duration fields and lane groupings (resource timeline). */
  calendar?: {
    startField: string;
    durationField: string;
    lanes: { field: string; label: string; laneFilter?: FieldCondition; emptyLaneLabel?: string }[];
  };
  /** Owner-scoped row access: field linking to the actor's staff id. */
  ownerField?: string;
  description: string;
  status: 'draft' | 'published' | 'deprecated';
}

export type FieldAccess = 'edit' | 'view' | 'mask' | 'hide';
export type RowScope = 'all' | 'own' | 'none';

export interface ResourcePermission {
  read: RowScope;
  create: boolean;
  update: RowScope;
  delete: boolean;
  export: boolean;
  /** Per-module PHI flag (phi-masking contract): raw contact values only when true. */
  sensitive_data?: boolean;
}

export interface RoleDefinition {
  id: string;
  label: string;
  description: string;
  resources: Record<string, ResourcePermission>;
  /**
   * Field access by sensitivity class; overridden by fieldOverrides.
   * `contact` fields are governed by the per-module `sensitive_data` flag instead
   * (phi-masking contract): raw only when granted, masked otherwise.
   */
  sensitivity: Record<Exclude<Sensitivity, 'none' | 'contact'>, FieldAccess>;
  fieldOverrides?: Record<string, FieldAccess>; // `${resource}.${field}`
  capabilities: string[];
}

export interface ModuleDefinition {
  id: string;
  label: string;
  icon: string;
  resources: string[];
  pages?: { id: string; label: string; icon: string; path: string; capability?: string }[];
  /** Resource groups whose child rows show icons (default: text-only indented children). */
  navChildIcons?: string[];
}

export interface DomainPack {
  id: string;
  version: string;
  label: string;
  description: string;
  modules: ModuleDefinition[];
  resources: ResourceDefinition[];
  masters: MasterDefinition[];
  roles: RoleDefinition[];
}

export type RecordData = Record<string, unknown> & {
  id: string;
  workspaceId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};
