/** Async boundary for opportunity pages (simulated network latency / failures). Same signatures a real API would have. */
import type { Actor } from '../authz';
import { call } from './client';
import {
  computeForecast,
  demoMachineCalendar,
  type DemoMachineCalendarFilter,
  type ForecastGroup,
  type ForecastPeriod,
  type LostInput,
  markLost,
  type PipelineFilter,
  pipelineRows,
  sweepStagnation,
} from '../opportunities';

export const fetchPipeline = (actor: Actor, filter: PipelineFilter) => call(() => pipelineRows(actor, filter));
export const fetchForecast = (actor: Actor, opts: { period: ForecastPeriod; groupBy: ForecastGroup; horizon: number; divisionId?: string }) => call(() => computeForecast(actor, opts));
export const fetchDemoMachineCalendar = (actor: Actor, filter: DemoMachineCalendarFilter) => call(() => demoMachineCalendar(actor, filter));
export const markOpportunityLost = (actor: Actor, id: string, input: LostInput, version: number) => call(() => markLost(actor, id, input, version));
export const runStagnationSweep = (actor: Actor) => call(() => sweepStagnation(actor), { fast: true });
