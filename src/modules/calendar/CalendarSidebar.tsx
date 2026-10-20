import { L } from '../../constants/labels';
import { Button } from '../../components/primitives/Button';
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

/** Left panel: Create, mini month, "My calendars" (event-type colour legend + filter), people and status filters. */
export function CalendarSidebar(p: SidebarProps) {
  return (
    <aside className="cal-side-inner" aria-label={C.page.filters}>
      <Button variant="primary" size="default" icon="plus" className="cal-create" onClick={(e) => p.onCreate(e.currentTarget)} disabledReason={p.canCreate ? undefined : C.page.cannotCreate(p.roleLabel)}>
        {C.page.create}
      </Button>
      <MiniMonth selected={p.cursor} today={p.today} counts={p.counts} onPick={p.onPick} />
      <PeriodSummary counts={p.counts} month={p.cursor.slice(0, 7)} onPick={p.onPick} />
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
    </aside>
  );
}
