import { forwardRef, type ReactNode } from 'react';
import { L } from '../../constants/labels';
import { Button, IconButton } from '../../components/primitives/Button';
import { Icon } from '../../components/primitives/Icon';
import { SearchInput, SegmentedControl } from '../../components/primitives/controls';
import type { ViewId } from './calendarUtils';
import { dayLabel, monthSummary, type DayCounts } from './dayLoad';
import { TodayAgenda, type TodayInfo } from './TodayAgenda';

const C = L.calendar;
const D = C.load;

export const CAL_VIEWS: { id: ViewId; label: string; key: string }[] = [
  { id: 'dayGridMonth', label: C.page.views.dayGridMonth, key: 'M' },
  { id: 'timeGridWeek', label: C.page.views.timeGridWeek, key: 'W' },
  { id: 'timeGridDay', label: C.page.views.timeGridDay, key: 'D' },
  { id: 'agenda', label: C.page.views.agenda, key: 'A' },
];

/** Today chip and the search box — rendered inline in the toolbar (one row, no separate strip). */
export const CalendarHead = forwardRef<HTMLInputElement, { info: TodayInfo; countText?: string; onToday: () => void; search: string; onSearch: (v: string) => void; searchLabel?: string; placeholder?: string }>(function CalendarHead(
  { info, countText, onToday, search, onSearch, searchLabel = C.page.search, placeholder = C.page.searchPlaceholder },
  ref,
) {
  return (
    <div className="cal-head">
      <TodayAgenda info={info} countText={countText} onOpen={onToday} />
      <div className="cal-search">
        <Icon name="search" size={14} />
        <SearchInput ref={ref} aria-label={searchLabel} placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (onSearch(''), e.currentTarget.blur())} />
        {search && <IconButton icon="x" label={C.page.clearSearch} onClick={() => onSearch('')} />}
      </div>
    </div>
  );
});

/** One row: panel toggle · [primary action] · Today · ‹ › · range title · [today chip · search · filters] · Month / Week / Day / Agenda. */
export function CalendarToolbar({ sideOpen, onSide, title, onToday, onPrev, onNext, view, onView, action, children }: { sideOpen: boolean; onSide: () => void; title: string; onToday: () => void; onPrev: () => void; onNext: () => void; view: ViewId; onView: (v: ViewId) => void; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="cal-toolbar">
      <IconButton icon="panel-left" label={sideOpen ? C.page.hidePanel : C.page.showPanel} aria-pressed={sideOpen} onClick={onSide} />
      {action}
      <Button onClick={onToday} title={C.page.shortcutHint(C.page.today, 'T')}>
        {C.page.today}
      </Button>
      <IconButton icon="chevron-left" label={C.page.shortcutHint(C.page.previous, '←')} onClick={onPrev} />
      <IconButton icon="chevron-right" label={C.page.shortcutHint(C.page.next, '→')} onClick={onNext} />
      <h2 className="cal-title" aria-live="polite">
        {title}
      </h2>
      {children}
      <SegmentedControl label={C.page.viewGroup} value={view} onChange={onView} options={CAL_VIEWS.map((v) => ({ value: v.id, label: v.label, title: C.page.shortcutHint(v.label, v.key) }))} />
    </div>
  );
}

/** Left panel summary: how many activities this month and which day is busiest (click to go there). */
export function PeriodSummary({ counts, month, noun, onPick }: { counts: DayCounts; month: string; noun?: (n: number) => string; onPick: (day: string) => void }) {
  const { total, busiest } = monthSummary(counts, month);
  const word = noun ?? D.activities;
  return (
    <div className="cal-summary" aria-label={D.thisMonth}>
      {total === 0 ? (
        <p className="muted small">{D.quiet}</p>
      ) : (
        <>
          <div className="cal-summary-row">
            <span className="muted">{D.thisMonth}</span>
            <strong>{word(total)}</strong>
          </div>
          {busiest && (
            <button type="button" className="cal-summary-row is-link" onClick={() => onPick(busiest.day)}>
              <span className="muted">{D.busiest}</span>
              <strong>
                {dayLabel(busiest.day)} · {busiest.n}
              </strong>
            </button>
          )}
        </>
      )}
    </div>
  );
}
