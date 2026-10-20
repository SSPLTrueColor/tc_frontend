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

/** Canonical drawer link: the resource's own list with the record peeked (pins, copied links). */
export const recordListPeekPath = (ws: string, resKey: string, id: string) => resourcePath(ws, resKey, { peek: id });

/** Query param of the record drawer that opens over any page: `?drawer=<slug>:<id>`. */
export const DRAWER_PARAM = 'drawer';
export function parseDrawerParam(v: string | null): { resKey: string; id: string } | null {
  const i = v ? v.indexOf(':') : -1;
  if (!v || i < 1) return null;
  const slug = v.slice(0, i);
  return { resKey: keyOfSlug(slug) ?? slug, id: v.slice(i + 1) };
}

/**
 * In-app link to a record: opens its drawer over the page the user is on, so the page behind never changes.
 * On the record's own list it peeks in place (row highlight, prev / next); anywhere else it adds `?drawer=`
 * to the current URL (rendered by GlobalRecordDrawer in the shell). Reads the live location at render time.
 */
export function recordPeekPath(ws: string, resKey: string, id: string) {
  if (typeof window === 'undefined') return recordListPeekPath(ws, resKey, id);
  const { pathname, search } = window.location;
  // Full-page create / edit forms are left behind after saving — never keep a form under the drawer.
  if (/\/(new|edit)$/.test(pathname)) return recordListPeekPath(ws, resKey, id);
  if (pathname === `/${slugOf(resKey)}`) {
    const qs = new URLSearchParams(search);
    qs.delete(DRAWER_PARAM);
    qs.set('peek', id);
    return `${pathname}?${qs.toString()}`;
  }
  const qs = new URLSearchParams(search);
  qs.set(DRAWER_PARAM, `${slugOf(resKey)}:${id}`);
  return `${pathname}?${qs.toString()}`;
}
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
