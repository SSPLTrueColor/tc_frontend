/**
 * Typed domain hooks for the Resource Runtime. Shared runtime code never branches on
 * resource names; domain packs register behaviour here (defaults, guards, hand-offs).
 * Hooks run inside the same commit as the write, so they are atomic with it.
 */
import type { RecordData } from '../metadata/types';
import type { Actor } from './authz';
import type { Db } from './types';

export interface HookContext {
  d: Db;
  actor: Actor;
  correlationId: string;
}

export interface ResourceHooks {
  /** Fill system values / defaults before validation. Mutate `candidate`. */
  beforeCreate?: (ctx: HookContext, candidate: Record<string, unknown>) => void;
  afterCreate?: (ctx: HookContext, record: RecordData) => void;
  /** Throw a ServiceError to refuse the change. */
  beforeUpdate?: (ctx: HookContext, before: RecordData, candidate: Record<string, unknown>) => void;
  afterUpdate?: (ctx: HookContext, before: RecordData, after: RecordData) => void;
  /** Throw a ServiceError to block the transition (e.g. missing data for the next stage). */
  beforeTransition?: (ctx: HookContext, record: RecordData, to: string) => void;
  afterTransition?: (ctx: HookContext, before: RecordData, after: RecordData) => void;
  /** Throw a ServiceError to refuse a (soft) delete, or repair related records inside the same commit. */
  beforeDelete?: (ctx: HookContext, record: RecordData) => void;
  /** Reason a lifecycle step is unavailable to this actor (shown on the disabled button), or undefined. Enforce the rule in beforeTransition too. */
  transitionBlocked?: (actor: Actor, record: RecordData, to: string) => string | undefined;
  /** Non-blocking warnings shown before saving (e.g. a similar company name); saving again with the same values proceeds. */
  saveWarnings?: (actor: Actor, values: Record<string, unknown>, recordId?: string) => string[];
  /** Reason the generic Edit action is unavailable for this record (e.g. a non-draft quotation), or undefined. */
  editBlocked?: (record: RecordData) => string | undefined;
  /** Display title when the title field alone is not enough. */
  title?: (record: RecordData) => string;
  /** Extra read rule on top of the role scope (e.g. a Knowledge Base draft is visible only to its author and approvers). Every registered rule must allow. */
  canRead?: (actor: Actor, record: RecordData) => boolean;
}

const registry = new Map<string, ResourceHooks[]>();
const composed = new Map<string, ResourceHooks>();

/**
 * Several modules may hook the same resource (e.g. leads and opportunities both react to new
 * activities). Hooks run in registration order; the first `title` (and the first `editBlocked` reason) wins.
 */
export function registerResourceHooks(resource: string, hooks: ResourceHooks) {
  registry.set(resource, [...(registry.get(resource) ?? []), hooks]);
  composed.delete(resource);
}

type AnyFn = (...args: never[]) => void;
function compose(list: ResourceHooks[]): ResourceHooks {
  const all = <K extends Exclude<keyof ResourceHooks, 'title' | 'editBlocked' | 'transitionBlocked' | 'saveWarnings' | 'canRead'>>(k: K) => {
    const fns = list.map((h) => h[k]).filter(Boolean) as AnyFn[];
    return fns.length ? (((...args: never[]) => fns.forEach((f) => f(...args))) as ResourceHooks[K]) : undefined;
  };
  return {
    beforeCreate: all('beforeCreate'),
    afterCreate: all('afterCreate'),
    beforeUpdate: all('beforeUpdate'),
    afterUpdate: all('afterUpdate'),
    beforeTransition: all('beforeTransition'),
    afterTransition: all('afterTransition'),
    beforeDelete: all('beforeDelete'),
    transitionBlocked: list.some((h) => h.transitionBlocked) ? (a: Actor, r: RecordData, to: string) => list.map((h) => h.transitionBlocked?.(a, r, to)).find(Boolean) : undefined,
    saveWarnings: list.some((h) => h.saveWarnings) ? (a: Actor, v: Record<string, unknown>, id?: string) => list.flatMap((h) => h.saveWarnings?.(a, v, id) ?? []) : undefined,
    editBlocked: list.some((h) => h.editBlocked) ? (r: RecordData) => list.map((h) => h.editBlocked?.(r)).find(Boolean) : undefined,
    title: list.find((h) => h.title)?.title,
    canRead: list.some((h) => h.canRead) ? (a: Actor, r: RecordData) => list.every((h) => h.canRead?.(a, r) ?? true) : undefined,
  };
}

export function hooksFor(resource: string): ResourceHooks {
  if (!composed.has(resource)) composed.set(resource, compose(registry.get(resource) ?? []));
  return composed.get(resource)!;
}
