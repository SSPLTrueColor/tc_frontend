/**
 * URL contract (REQUIREMENTS §3): flat, readable routes.
 *   /<resource>                list        e.g. /tasks?view=v_tasks_open&peek=T-1004
 *   /<resource>/new            full-page create
 *   /<resource>/<id>           record page
 *   /<resource>/<id>/edit      full-page edit
 *   /<page>                    module pages (dashboard, inbox …)
 *   /admin/<page>              administration pages
 * The single workspace adds no prefix; `ws` arguments are kept so the engine signatures stay stable.
 */
export const wsBase = (_ws: string) => '';

export function resourcePath(_ws: string, resKey: string, params: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  return `/${resKey}${qs ? `?${qs}` : ''}`;
}

export const recordPeekPath = (ws: string, resKey: string, id: string) => resourcePath(ws, resKey, { peek: id });
export const recordPagePath = (_ws: string, resKey: string, id: string) => `/${resKey}/${encodeURIComponent(id)}`;
export const pagePath = (_ws: string, module: string, page: string) => (module === 'admin' ? `/admin/${page}` : `/${page}`);
