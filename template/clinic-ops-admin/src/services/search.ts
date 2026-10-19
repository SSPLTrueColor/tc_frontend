/** Global search: authorized resources, visible fields only, exact-ID boost. */
import { type Actor, canReadResource } from './authz';
import { allResources } from './registry';
import { queryRecords, recordTitle } from './runtime';

export interface SearchHit {
  resource: string;
  resourceLabel: string;
  id: string;
  title: string;
  exact: boolean;
}

export function searchRecords(actor: Actor, text: string, limit = 12): SearchHit[] {
  const q = text.trim();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const res of allResources()) {
    if (!canReadResource(actor, res.key)) continue;
    const { rows } = queryRecords(actor, res.key, { search: q, pageSize: 6 });
    rows.forEach((r) =>
      hits.push({ resource: res.key, resourceLabel: res.label, id: r.id, title: recordTitle(res.key, r.id, actor), exact: r.id.toLowerCase() === q.toLowerCase() }),
    );
  }
  return hits.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, limit);
}
