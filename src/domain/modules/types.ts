import type { FieldAccess, MasterDefinition, ModuleDefinition, ResourceDefinition, ResourcePermission, RowScope } from '../../metadata/types';

/** Permission shorthand: read/update scope plus create, delete and export flags. Contact data is visible to every role that can read. */
export const p = (read: RowScope, update: RowScope = 'none', create = false, del = false, exp = false): ResourcePermission => ({ read, update, create, delete: del, export: exp, sensitive_data: true });

/**
 * One business module's contribution to the domain pack. Each module owns exactly one
 * file in this folder; src/domain/pack.ts merges them. Never edit another module's pack.
 */
export interface ModulePack {
  /** Module id (also the nav id unless `nav` says otherwise). */
  id: string;
  /** Sidebar / icon-rail entry. Omit when the module only adds resources to another module's nav. */
  nav?: ModuleDefinition;
  resources: ResourceDefinition[];
  masters: MasterDefinition[];
  /** permissions[roleId][resourceKey]; roles without an entry get no access. */
  permissions: Record<string, Record<string, ResourcePermission>>;
  /** Extra capabilities per role, e.g. { sales_manager: ['quote.send'] }. */
  capabilities?: Record<string, string[]>;
  /** Field overrides per role: { accounts: { 'quotations.margin': 'view' } }. */
  fieldOverrides?: Record<string, Record<string, FieldAccess>>;
  /** Add pages/resources to another module's nav, e.g. { admin: { pages: [...] }, home: { resources: ['activities'] } }. */
  extend?: Record<string, { pages?: NonNullable<ModuleDefinition['pages']>; resources?: string[] }>;
}

export const emptyPack = (id: string): ModulePack => ({ id, resources: [], masters: [], permissions: {} });
