/** Shared display atoms: the empty-value placeholder and the date/time text. */
import { formatDate, formatWeekdayFull } from '../../lib/dates';

/** The ONE way to show a missing value: small icon + italic "N/A" in light muted text. */
export function EmptyValue({ label = 'Not available' }: { label?: string }) {
  return (
    <span className="empty-value" aria-label={label}>
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
