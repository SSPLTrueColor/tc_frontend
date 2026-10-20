/** Shared display atoms: the empty-value placeholder and the date/time text. */
import { formatDate, formatWeekdayFull } from '../../lib/dates';
import { L } from '../../constants/labels';

/** The ONE way to show a missing value: italic muted "N/A" by default, or the caller's wording (e.g. "Not recorded", "On time") when given. */
export function EmptyValue({ label }: { label?: string }) {
  if (label) return <span className="empty-value">{label}</span>;
  return (
    <span className="empty-value" aria-label={L.common.states.notAvailable}>
      <span aria-hidden="true">N/A</span>
    </span>
  );
}

/**
 * Dates always display as "16 Oct, 2026" (date only, also for date-time values).
 * Hover/focus shows the full weekday + date (+ time when known): "Fri, 16 Oct 2026 08:30 AM".
 * `showTime` is accepted for compatibility; time is revealed via the tooltip.
 */
export function DateText({ value }: { value: string | null | undefined; showTime?: boolean }) {
  if (!value) return <EmptyValue />;
  return (
    <time className="date-text" dateTime={value} data-tooltip={formatWeekdayFull(value)}>
      {formatDate(value)}
    </time>
  );
}
