/** Small builders shared by every resource definition. */
import type { FieldCapabilities, FieldDefinition, FilterCondition, FilterGroup, ResourceDefinition, ViewDefinition } from '../metadata/types';

export const ALL: FieldCapabilities = { list: true, sort: true, filter: true, search: true, form: true, export: true };
export const NO_SEARCH: FieldCapabilities = { list: true, sort: true, filter: true, form: true, export: true };
export const FORM_ONLY: FieldCapabilities = { form: true, export: true };

export function field(resource: string, key: string, label: string, type: FieldDefinition['type'], extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return { id: `fld_${resource}_${key}`, key, label, type, capabilities: NO_SEARCH, ...extra };
}

let condSeq = 0;
export const cond = (fieldKey: string, operator: FilterCondition['operator'], value?: unknown): FilterCondition => ({
  kind: 'condition',
  id: `c${++condSeq}`,
  field: fieldKey,
  operator,
  value,
});
export const group = (join: 'and' | 'or', children: FilterGroup['children'] = []): FilterGroup => ({
  kind: 'group',
  id: `g${++condSeq}`,
  join,
  children,
});

type ViewSeed = Omit<ViewDefinition, 'resourceVersion' | 'order' | 'scope' | 'ownerId' | 'density'> & Partial<Pick<ViewDefinition, 'density' | 'scope'>>;
export const views = (list: ViewSeed[]): ResourceDefinition['views'] => list.map((x, i) => ({ density: 'compact', scope: 'org', ownerId: 'system', order: i, ...x }));

export const cols = (...keys: string[]) => keys.map((key) => ({ key }));
