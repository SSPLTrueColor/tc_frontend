import { keyOfSlug } from '../constants/routes';
import { sidebarModules } from '../domain/sidebar';
import { getResource } from '../services/registry';

/** Title of the page at a URL (sidebar page label, or a resource list's plural name); null when unknown. */
export function pageTitleForPath(pathname: string): string | null {
  const exact = sidebarModules.flatMap((m) => m.pages ?? []).find((p) => p.path === pathname);
  if (exact) return exact.label;
  const parts = pathname.split('/').filter(Boolean);
  const key = keyOfSlug(parts[0] === 'admin' ? `admin/${parts[1] ?? ''}` : (parts[0] ?? ''));
  return key ? getResource(key).labelPlural : null;
}
