import { organization } from '../domain/clinic/pack';
import { getResource } from '../services/registry';

export const wsBase = (ws: string) => `/o/${organization.slug}/w/${ws}`;

export function resourcePath(ws: string, resKey: string, params: Record<string, string | undefined> = {}) {
  const res = getResource(resKey);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  return `${wsBase(ws)}/${res.module}/${resKey}${qs ? `?${qs}` : ''}`;
}

export const recordPeekPath = (ws: string, resKey: string, id: string) => resourcePath(ws, resKey, { peek: id });
export const recordPagePath = (ws: string, resKey: string, id: string) => `${wsBase(ws)}/${getResource(resKey).module}/${resKey}/${id}`;
export const pagePath = (ws: string, module: string, page: string) => (page === 'dashboard' ? `${wsBase(ws)}/dashboard` : `${wsBase(ws)}/${module}/${page}`);
