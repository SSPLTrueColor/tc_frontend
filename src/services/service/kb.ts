/**
 * Knowledge Base (FR-090, SRV-16): one searchable list of knowledge articles by model, error code,
 * symptom or solution. Published articles are visible to everyone with access; drafts and articles
 * pending approval only to their author and to Service Leadership (approve.service).
 */
import type { RecordData } from '../../metadata/types';
import { type Actor, can } from '../authz';
import { byId } from '../lookups';
import { queryRecords } from '../runtime';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export type KbSort = 'title' | 'updated' | 'category';
export interface KbQuery {
  q?: string;
  category?: string;
  status?: string;
  sort?: KbSort;
  page?: number;
  size?: number;
}
export type KbRow = RecordData & { authorName: string };
export interface KbResult {
  rows: KbRow[];
  total: number;
  page: number;
  size: number;
}

export const KB_PAGE_SIZE = 20;

/** True when the actor may see this article (published, own, or reviewer). */
export const canSeeArticle = (actor: Actor, a: RecordData) => a.status === 'published' || a.authorId === actor.staffId || can(actor, 'approve.service');

/** Pure filter / sort / page step (unit-tested). Every search word must match one of the searchable fields. */
export function filterArticles(rows: KbRow[], q: KbQuery): KbResult {
  const words = s(q.q).toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (a: KbRow) => {
    const text = [a.id, a.title, a.models, a.errorCodes, a.symptoms, a.solution, a.authorName].map(s).join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  };
  const filtered = rows.filter((a) => (!q.category || a.category === q.category) && (!q.status || a.status === q.status) && hit(a));
  const sort = q.sort ?? 'title';
  const sorted = [...filtered].sort((a, b) =>
    sort === 'updated' ? s(b.updatedAt).localeCompare(s(a.updatedAt)) : sort === 'category' ? s(a.category).localeCompare(s(b.category)) || s(a.title).localeCompare(s(b.title)) : s(a.title).localeCompare(s(b.title)),
  );
  const size = q.size ?? KB_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const page = Math.min(Math.max(0, q.page ?? 0), pages - 1);
  return { rows: sorted.slice(page * size, page * size + size), total: sorted.length, page, size };
}

export function searchArticles(actor: Actor, q: KbQuery): KbResult {
  const rows = queryRecords(actor, 'knowledgeArticles', {})
    .rows.filter((a) => canSeeArticle(actor, a))
    .map((a): KbRow => ({ ...a, authorName: s(byId('employees', a.authorId)?.fullName) }));
  return filterArticles(rows, q);
}
