import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { defaultPreset, presetsFor, type DateRange } from '../../services/reports/periods';
import { getSavedFilters, saveFilters, type StoredFilters } from '../../services/reports/prefs';
import type { ReportDef, ReportFilters, ReportViewDef } from '../../services/reports/types';

const KEYS = ['view', 'preset', 'from', 'to', 'division', 'owner', 'group'] as const;

export interface ReportState {
  view: ReportViewDef;
  /** Preset id, or 'custom'. Empty when the view has no date filter. */
  preset: string;
  range: DateRange;
  /** What the service is asked for. */
  filters: ReportFilters;
  group?: string;
  /** True when no filter differs from the report's defaults (group-by is a view option, not a filter). */
  isDefault: boolean;
  set: (patch: Partial<StoredFilters>) => void;
  reset: () => void;
}

/**
 * Filters of one report. The URL is the source of truth (shareable links); when it is empty the
 * filters last used on this report by this user are restored, so a report opens the way it was left.
 */
export function useReportState(def: ReportDef, userId: string, today: string): ReportState {
  const [params, setParams] = useSearchParams();
  const fromUrl = KEYS.some((k) => params.has(k));
  const paramsKey = params.toString();

  const raw: StoredFilters = useMemo(() => {
    if (fromUrl) return Object.fromEntries(KEYS.filter((k) => params.get(k)).map((k) => [k, params.get(k) as string]));
    return getSavedFilters(userId, def.id) ?? {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, fromUrl, userId, def.id]);

  const view = def.views.find((v) => v.id === raw.view) ?? def.views[0];
  const kind = view.filters.date;

  let preset = '';
  let range: DateRange = {};
  if (kind) {
    if (raw.preset === 'custom' && (raw.from || raw.to)) {
      preset = 'custom';
      range = { from: raw.from, to: raw.to };
    } else {
      const all = presetsFor(kind, today);
      const p = all.find((x) => x.id === raw.preset) ?? all.find((x) => x.id === defaultPreset(kind))!;
      preset = p.id;
      range = p.range;
    }
  }
  const division = view.filters.division ? raw.division : undefined;
  const owner = view.filters.owner ? raw.owner : undefined;
  const group = view.groupOptions ? (view.groupOptions.some((g) => g.value === raw.group) ? raw.group : view.groupOptions[0].value) : undefined;
  const filters: ReportFilters = { from: range.from, to: range.to, division, owner, group };
  const isDefault = !division && !owner && (!kind || preset === defaultPreset(kind));

  const write = useCallback(
    (next: StoredFilters) => {
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as StoredFilters;
      saveFilters(userId, def.id, clean);
      setParams(new URLSearchParams(Object.entries(clean) as [string, string][]), { replace: true });
    },
    [userId, def.id, setParams],
  );

  const set = useCallback(
    (patch: Partial<StoredFilters>) => {
      const switching = patch.view !== undefined && patch.view !== view.id;
      const base: StoredFilters = { view: view.id, preset: preset || undefined, from: preset === 'custom' ? range.from : undefined, to: preset === 'custom' ? range.to : undefined, division, owner, group: switching ? undefined : group };
      const next = { ...base, ...patch };
      // Picking a preset forgets any custom dates; a custom range needs its dates.
      if (patch.preset && patch.preset !== 'custom') {
        next.from = undefined;
        next.to = undefined;
      }
      if (switching) {
        next.preset = undefined;
        next.from = undefined;
        next.to = undefined;
      }
      write(next);
    },
    [view.id, preset, range.from, range.to, division, owner, group, write],
  );

  const reset = useCallback(() => write({ view: view.id, group }), [write, view.id, group]);

  return { view, preset, range, filters, group, isDefault, set, reset };
}
