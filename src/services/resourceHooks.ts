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
  /** Display title when the title field alone is not enough. */
  title?: (record: RecordData) => string;
}

const registry = new Map<string, ResourceHooks[]>();
const composed = new Map<string, ResourceHooks>();

/**
 * Several modules may hook the same resource (e.g. leads and opportunities both react to new
 * activities). Hooks run in registration order; the first `title` wins.
 */
export function registerResourceHooks(resource: string, hooks: ResourceHooks) {
  registry.set(resource, [...(registry.get(resource) ?? []), hooks]);
  composed.delete(resource);
}

type AnyFn = (...args: never[]) => void;
function compose(list: ResourceHooks[]): ResourceHooks {
  const all = <K extends Exclude<keyof ResourceHooks, 'title'>>(k: K) => {
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
    title: list.find((h) => h.title)?.title,
  };
}

export function hooksFor(resource: string): ResourceHooks {
  if (!composed.has(resource)) composed.set(resource, compose(registry.get(resource) ?? []));
  return composed.get(resource)!;
}
