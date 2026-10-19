/** Calendar: server-side style validation of every event write (end after start, no past scheduling). */
import { registerResourceHooks } from '../../services/resourceHooks';
import { validateEvent } from '../../services/calendar/events';
import { ServiceError } from '../../services/types';
import { istNow } from '../../lib/clock';

const timeChanged = (before: Record<string, unknown>, after: Record<string, unknown>) => ['start', 'end', 'allDay'].some((k) => before[k] !== after[k]);

const check = (values: Record<string, unknown>, checkPast: boolean) => {
  const errors = validateEvent(values, { checkPast });
  if (Object.keys(errors).length) throw new ServiceError('validation', Object.values(errors)[0], { fieldErrors: errors });
};

registerResourceHooks('calendarEvents', {
  beforeCreate: (_ctx, c) => {
    if (c.allDay) {
      c.start = String(c.start ?? '').slice(0, 10);
      c.end = String(c.end ?? '').slice(0, 10);
    }
    if (!c.recurrence) c.recurrence = 'none';
    check(c, true);
  },
  beforeUpdate: (_ctx, before, c) => {
    if (c.allDay) {
      c.start = String(c.start ?? '').slice(0, 10);
      c.end = String(c.end ?? '').slice(0, 10);
    }
    // A series that already started keeps its first date in the past; shiftSeries checks the moved occurrence instead.
    const runningSeries = String(c.recurrence ?? 'none') !== 'none' && String(before.start) < istNow().slice(0, 16);
    check(c, timeChanged(before, c) && !runningSeries);
  },
});
