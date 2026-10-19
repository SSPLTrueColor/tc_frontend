/**
 * URL contract (REQUIREMENTS §3): flat, readable routes.
 * Resource URLs use the kebab-case slug from src/constants/routes.ts, never the engine key.
 *   /<resource>                list        e.g. /tasks?view=v_tasks_open&peek=T-1004
 *   /<resource>/new            full-page create
 *   /<resource>/<id>           record page
 *   /<resource>/<id>/edit      full-page edit
 *   /<page>                    module pages (dashboard, inbox …)
 *   /admin/<page>              administration pages
 * The single workspace adds no prefix; `ws` arguments are kept so the engine signatures stay stable.
 */
import { keyOfSlug, slugOf } from '../constants/routes';

export const wsBase = (_ws: string) => '';

export function resourcePath(_ws: string, resKey: string, params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  return `/${slugOf(resKey)}${qs ? `?${qs}` : ''}`;
}

export const recordPeekPath = (ws: string, resKey: string, id: string) => resourcePath(ws, resKey, { peek: id });
export const recordPagePath = (_ws: string, resKey: string, id: string) => `/${slugOf(resKey)}/${encodeURIComponent(id)}`;
/** Full-page create / edit form for a resource. */
export const recordNewPath = (resKey: string) => `/${slugOf(resKey)}/new`;
export const recordEditPath = (resKey: string, id: string) => `/${slugOf(resKey)}/${encodeURIComponent(id)}/edit`;

/** Resource key of the current route: `/:resource` or `/admin/:adminResource` carry the URL slug. */
export function resourceKeyFromParams(params: { resource?: string; adminResource?: string }): string {
  const slug = params.adminResource ? `admin/${params.adminResource}` : params.resource ?? '';
  return keyOfSlug(slug) ?? slug;
}
/** Page paths are absolute (src/constants/routes.ts); relative ones are kept for older callers. */
export const pagePath = (_ws: string, module: string, page: string) => (page.startsWith('/') ? page : module === 'admin' ? `/admin/${page}` : `/${page}`);
