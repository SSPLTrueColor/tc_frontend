/**
 * One meaning per colour, everywhere (StatusChip / Badge tone):
 *   success  finished, approved, within target
 *   warning  waiting, pending, due soon, at risk
 *   danger   failed, rejected, breached, overdue
 *   info     in progress, running
 *   neutral  inactive, withdrawn, not applicable, upcoming
 * Master values carry their own tone (Administration → Masters); these maps cover the states the code defines itself.
 * Never write a local status → tone map in a page: add it here.
 */
import type { Tone } from '../metadata/types';

const SUCCESS: Tone = 'success';
const WARNING: Tone = 'warning';
const DANGER: Tone = 'danger';
const INFO: Tone = 'info';
const NEUTRAL: Tone = 'neutral';

/** Approval requests (quotation, order, leave, expense). */
export const APPROVAL_TONE = { pending: WARNING, approved: SUCCESS, rejected: DANGER, withdrawn: NEUTRAL } as const;

/** Data-protection requests. */
export const REQUEST_TONE = { open: WARNING, done: SUCCESS, rejected: DANGER } as const;

/** Service SLA clock. */
export const CLOCK_TONE = { met: SUCCESS, breached_met: WARNING, breached: DANGER, at_risk: WARNING, running: INFO, paused: NEUTRAL, not_applicable: NEUTRAL } as const;

/** Field access on a record's fields. */
export const FIELD_ACCESS_TONE = { edit: SUCCESS, view: INFO, mask: WARNING, hide: NEUTRAL } as const;

/** Attendance exceptions. */
export const EXCEPTION_TONE = { no_check_in: DANGER, late: WARNING, early_exit: WARNING, no_visits: INFO, mock_location: DANGER, not_checked_out: WARNING } as const;

/** Consumables re-order state. */
export const REORDER_TONE = { missed: DANGER, due: WARNING, upcoming: NEUTRAL } as const;

/** Extra access that is about to end. */
export const ENDS_SOON_TONE = (daysLeft: number): Tone => (daysLeft <= 7 ? WARNING : NEUTRAL);
