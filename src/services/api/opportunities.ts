/** Async boundary for opportunity pages (simulated network latency / failures). */
import type { Actor } from '../authz';
import { call } from './client';
import { calendarItems, computeForecast, type ForecastGroup, type ForecastPeriod, type LostInput, markLost, sweepStagnation } from '../opportunities';

export const fetchForecast = (actor: Actor, opts: { period: ForecastPeriod; groupBy: ForecastGroup; horizon: number; divisionId?: string }) => call(() => computeForecast(actor, opts));
export const fetchCalendar = (actor: Actor, from: string, to: string, mineOnly: boolean) => call(() => calendarItems(actor, from, to, mineOnly));
export const markOpportunityLost = (actor: Actor, id: string, input: LostInput, version: number) => call(() => markLost(actor, id, input, version));
export const runStagnationSweep = (actor: Actor) => call(() => sweepStagnation(actor), { fast: true });
