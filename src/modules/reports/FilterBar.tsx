import { useMemo, useState } from 'react';
import { L } from '../../constants/labels';
import { Button } from '../../components/primitives/Button';
import { DateRangePicker } from '../../components/primitives/DateRangePicker';
import { Icon } from '../../components/primitives/Icon';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { useActor } from '../../services/hooks';
import { activeMasterValues } from '../../services/registry';
import { queryRecords } from '../../services/runtime';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { todayKey } from '../../lib/dates';
import { formatReportDate } from '../../services/reports/format';
import { presetsFor } from '../../services/reports/periods';
import type { ReportState } from './useReportState';

const F = L.reports.page.filters;

/** Date presets + custom range, key filters, group-by, Reset and the chips of what is currently applied. */
export function FilterBar({ state }: { state: ReportState }) {
  const actor = useActor();
  const { view, preset, range, filters, set, reset, isDefault } = state;
  const kind = view.filters.date;
  const today = todayKey();
  // A half-picked custom range stays local until both ends exist, so the report does not run on a partial range.
  const [draft, setDraft] = useState<{ from?: string; to?: string } | null>(null);

  const people = useServiceQuery(
    () => queryRecords(actor, 'employees', { sort: [{ field: 'fullName', dir: 'asc' }] }).rows.filter((e) => e.status !== 'inactive').map((e) => ({ value: String(e.id), label: String(e.fullName) })),
    [actor.user.id],
  );
  const divisions = useMemo(() => activeMasterValues('division').map((v) => ({ value: v.key, label: v.label })), []);

  const presets = kind ? presetsFor(kind, today) : [];
  const presetLabel = presets.find((p) => p.id === preset)?.label;
  const rangeText = range.from || range.to ? `${range.from ? formatReportDate(range.from) : '…'} – ${range.to ? formatReportDate(range.to) : '…'}` : '';

  const chips: { id: string; label: string; clear: () => void }[] = [];
  if (kind && preset && preset !== presets.find((p) => p.id === (kind === 'future' ? 'next90' : '90d'))?.id) {
    chips.push({ id: 'period', label: F.chipPeriod(preset === 'custom' ? rangeText : presetLabel ?? ''), clear: () => set({ preset: kind === 'future' ? 'next90' : '90d' }) });
  }
  if (filters.division) chips.push({ id: 'division', label: F.chipDivision(divisions.find((d) => d.value === filters.division)?.label ?? filters.division), clear: () => set({ division: undefined }) });
  if (filters.owner) chips.push({ id: 'owner', label: F.chipUser(people.data?.find((p) => p.value === filters.owner)?.label ?? filters.owner), clear: () => set({ owner: undefined }) });

  return (
    <div className="rp-filterbar">
      <div className="rp-filters" role="group" aria-label={F.label}>
        {kind && (
          <>
            <span className="rp-filter-label">{view.dateLabel ?? F.period}</span>
            <SelectMenu
              label={F.period}
              value={preset}
              options={[...presets.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: F.custom }]}
              onChange={(v) => {
                setDraft(null);
                if (v === 'custom') set({ preset: 'custom', from: range.from, to: range.to });
                else set({ preset: v });
              }}
            />
            {preset === 'custom' ? (
              <span className="rp-date">
                <DateRangePicker
                  label={F.dateRange}
                  value={draft ?? range}
                  onChange={(v) => {
                    if (v.from && v.to) {
                      setDraft(null);
                      set({ preset: 'custom', from: v.from, to: v.to });
                    } else setDraft(v);
                  }}
                />
              </span>
            ) : (
              rangeText && <span className="rp-range muted small">{rangeText}</span>
            )}
          </>
        )}
        {view.filters.division && (
          <SelectMenu label={F.division} value={filters.division ?? ''} options={[{ value: '', label: F.allDivisions }, ...divisions]} onChange={(v) => set({ division: v || undefined })} />
        )}
        {view.filters.owner && (
          <SelectMenu label={F.user} searchable value={filters.owner ?? ''} options={[{ value: '', label: F.everyone }, ...(people.data ?? [])]} onChange={(v) => set({ owner: v || undefined })} />
        )}
        {view.groupOptions && <SelectMenu label={F.groupBy} value={state.group ?? ''} options={view.groupOptions} onChange={(v) => set({ group: v })} />}
        <Button variant="ghost" icon="reset" onClick={() => { setDraft(null); reset(); }} disabledReason={isDefault ? F.nothingToReset : undefined}>
          {F.reset}
        </Button>
      </div>
      {chips.length > 0 && (
        <ul className="filter-chips rp-chips" aria-label={F.active}>
          {chips.map((c) => (
            <li key={c.id} className="filter-chip">
              {c.label}
              <button type="button" aria-label={F.remove(c.label)} data-tooltip={F.remove(c.label)} onClick={c.clear}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
