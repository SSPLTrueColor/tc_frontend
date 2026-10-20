/** Small builders shared by every resource definition. */
import { L } from '../constants/labels';
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
/**
 * Lists open with no filter applied: when the first preset is a filtered table, an unfiltered "All" table
 * (same columns and sort) leads — an existing one moves to the front, else one is added; filtered presets stay one click away.
 */
export const views = (list: ViewSeed[]): ResourceDefinition['views'] => {
  const first = list[0];
  let seeds = list;
  if (first && first.type === 'table' && first.filter.children.length > 0) {
    const all = list.find((v) => v.type === 'table' && !v.filter.children.length && !v.groupBy);
    seeds = all ? [all, ...list.filter((v) => v !== all)] : [{ ...first, id: `v_${first.resource}_all`, name: L.common.list.allView, filter: group('and'), groupBy: undefined }, ...list];
  }
  return seeds.map((x, i) => ({ density: 'compact', scope: 'org', ownerId: 'system', order: i, ...x }));
};

export const cols = (...keys: string[]) => keys.map((key) => ({ key }));
