import { L } from '../../constants/labels';
import { useRef, useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { Popover } from '../../components/primitives/overlay';
import { cx } from '../../lib/format';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { activeMasterValues, masterLabel } from '../../services/registry';
import type { EventType } from '../../services/calendar/events';
import { MiniMonth } from './MiniMonth';
import { PeriodSummary } from './CalendarChrome';
import type { DayCounts } from './dayLoad';
import { Checkbox } from '../../components/primitives/controls';

const C = L.calendar;
const STATUSES = ['scheduled', 'completed', 'cancelled'] as const;

export interface SidebarProps {
  canCreate: boolean;
  roleLabel: string;
  onCreate: (anchor: HTMLElement) => void;
  cursor: string;
  today: string;
  counts: DayCounts;
  onPick: (day: string) => void;
  types: Set<EventType>;
  onTypes: (next: Set<EventType>) => void;
  statuses: Set<string>;
  onStatuses: (next: Set<string>) => void;
  withModules: boolean;
  onWithModules: (v: boolean) => void;
  person: string;
  people: { value: string; label: string }[];
  onPerson: (v: string) => void;
}

const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
  const n = new Set(set);
  if (on) n.add(v);
  else n.delete(v);
  return n;
};

type FilterProps = Pick<SidebarProps, 'types' | 'onTypes' | 'statuses' | 'onStatuses' | 'withModules' | 'onWithModules' | 'person' | 'people' | 'onPerson'>;

/** How many filters differ from the default view (all types, scheduled + completed, everyone, own events only). */
export function activeFilterCount(p: FilterProps) {
  const allTypes = activeMasterValues('calEventType').every((t) => p.types.has(t.key as EventType));
  const defaultStatus = p.statuses.size === 2 && p.statuses.has('scheduled') && p.statuses.has('completed');
  return Number(!allTypes) + Number(!defaultStatus) + Number(p.person !== 'all') + Number(p.withModules);
}

/** Toolbar "Filters" button (used while the side panel is hidden): the same sections in a popover. */
export function CalendarFilters(p: FilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const n = activeFilterCount(p);
  return (
    <>
      <Button ref={ref} icon="filter" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label={C.page.filters} title={C.page.filtersShort} className={cx('cal-filter-btn', n > 0 && 'is-active')}>
        {C.page.filtersShort}
        {n > 0 && <span className="cal-filter-count">{n}</span>}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={C.page.filters} width={300} align="end">
        <div className="cal-filter-pop">
          <FilterSections {...p} />
        </div>
      </Popover>
    </>
  );
}

/** Left panel: Create, mini month, month summary, then the filters. */
export function CalendarSidebar(p: SidebarProps) {
  return (
    <aside className="cal-side-inner" aria-label={C.page.filters}>
      <Button variant="primary" size="default" icon="plus" className="cal-create" onClick={(e) => p.onCreate(e.currentTarget)} disabledReason={p.canCreate ? undefined : C.page.cannotCreate(p.roleLabel)}>
        {C.page.create}
      </Button>
      <MiniMonth selected={p.cursor} today={p.today} counts={p.counts} onPick={p.onPick} />
      <PeriodSummary counts={p.counts} month={p.cursor.slice(0, 7)} onPick={p.onPick} />
      <FilterSections {...p} />
    </aside>
  );
}

/** "My calendars" (event-type colour legend + filter), people and status filters. */
function FilterSections(p: FilterProps) {
  return (
    <>
      <section className="cal-filter">
        <h3 className="cal-filter-title">{C.page.myCalendars}</h3>
        <ul className="cal-legend">
          {activeMasterValues('calEventType').map((t) => (
            <li key={t.key}>
              <label className={`cal-check ev-${t.key}`}>
                <Checkbox checked={p.types.has(t.key as EventType)} onChange={(e) => p.onTypes(toggle(p.types, t.key as EventType, e.target.checked))} />
                <span className="cal-swatch" aria-hidden="true" />
                {t.label}
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="cal-filter">
        <h3 className="cal-filter-title">{C.page.people}</h3>
        <SelectMenu block searchable label={C.page.assignedUser} value={p.person} options={[{ value: 'all', label: C.page.everyone }, { value: 'me', label: C.page.onlyMe }, ...p.people]} onChange={p.onPerson} />
      </section>
      <section className="cal-filter">
        <h3 className="cal-filter-title">{C.page.show}</h3>
        <ul className="cal-legend">
          {STATUSES.map((st) => (
            <li key={st}>
              <label className="cal-check">
                <Checkbox checked={p.statuses.has(st)} onChange={(e) => p.onStatuses(toggle(p.statuses, st, e.target.checked))} />
                {masterLabel('calEventStatus', st)}
              </label>
            </li>
          ))}
          <li>
            <label className="cal-check">
              <Checkbox checked={p.withModules} onChange={(e) => p.onWithModules(e.target.checked)} />
              {C.page.withModules}
            </label>
          </li>
        </ul>
      </section>
    </>
  );
}
