/**
 * Report data access: every resource is read through the Resource Runtime query service under
 * the actor's row scope and field access, so reports never show more than the lists do.
 */
import type { RecordData } from '../../metadata/types';
import { type Actor, canReadResource } from '../authz';
import { allResources } from '../registry';
import { queryRecords, recordTitle } from '../runtime';
import type { Dataset } from './types';

export function loadDataset(actor: Actor): Dataset {
  const cache = new Map<string, RecordData[]>();
  const known = new Set(allResources().map((r) => r.key));
  const get = (key: string) => {
    if (!cache.has(key)) cache.set(key, known.has(key) && canReadResource(actor, key) ? queryRecords(actor, key).rows : []);
    return cache.get(key)!;
  };
  return {
    get,
    // Names come from the record title service (scope-aware: hidden records show their id only).
    name: (resKey, id) => (id ? recordTitle(resKey, id, actor) : ''),
  };
}

