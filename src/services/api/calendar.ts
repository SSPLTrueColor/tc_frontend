/** Async calendar service (simulated network) used by the Calendar page. */
import type { Actor } from '../authz';
import { call } from './client';
import * as cal from '../calendar/events';

export const calendarService = {
  list: (actor: Actor) => call(() => cal.listCalendarItems(actor)),
  create: (actor: Actor, input: cal.EventInput) => call(() => cal.createEvent(actor, input)),
  update: (actor: Actor, id: string, patch: cal.EventInput, version: number) => call(() => cal.updateEvent(actor, id, patch, version)),
  move: (actor: Actor, id: string, next: { start: string; end: string; allDay: boolean }, version: number) => call(() => cal.moveEvent(actor, id, next, version)),
  shiftSeries: (actor: Actor, id: string, occurrence: { start: string; end: string }, next: { start: string; end: string; allDay: boolean }, version: number) => call(() => cal.shiftSeries(actor, id, occurrence, next, version)),
  updateOccurrence: (actor: Actor, id: string, occurrenceStart: string, patch: cal.EventInput, version: number) => call(() => cal.updateOccurrence(actor, id, occurrenceStart, patch, version)),
  updateFollowing: (actor: Actor, id: string, occurrenceStart: string, patch: cal.EventInput, version: number) => call(() => cal.updateFollowing(actor, id, occurrenceStart, patch, version)),
  deleteFollowing: (actor: Actor, id: string, occurrenceStart: string, version: number) => call(() => cal.deleteFollowing(actor, id, occurrenceStart, version)),
  restore: (actor: Actor, id: string, fields: cal.EventInput) => call(() => cal.restoreEvent(actor, id, fields), { fast: true }),
  undoOccurrence: (actor: Actor, seriesId: string, singleId: string, occurrenceStart: string) => call(() => cal.undoOccurrence(actor, seriesId, singleId, occurrenceStart), { fast: true }),
  deleteOccurrence: (actor: Actor, id: string, occurrenceStart: string, version: number) => call(() => cal.deleteOccurrence(actor, id, occurrenceStart, version)),
  remove: (actor: Actor, id: string) => call(() => cal.deleteEvent(actor, id)),
};
