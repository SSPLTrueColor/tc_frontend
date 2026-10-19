/**
 * Calendar module pack: user-scheduled events (meetings, demos, visits, calls, service, internal)
 * with recurrence, attendees and a link to any CRM record. Tasks, demos, PM visits, installation
 * jobs and lead/opportunity follow-ups are shown read-only from their own modules (services/calendar).
 */
import type { MasterDefinition, MasterValue, ResourceDefinition, Tone } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';
import { p, type ModulePack } from './types';

const mv = (key: string, label: string, tone: Tone = 'neutral'): Omit<MasterValue, 'order'> => ({ key, label, tone, active: true });
const master = (key: string, label: string, values: Omit<MasterValue, 'order'>[]): MasterDefinition => ({ id: `mst_${key}`, key, label, version: 1, values: values.map((x, i) => ({ ...x, order: i })) });

/** Six event types — one template palette colour each (see calendar.css `.ev-<type>`). */
export const EVENT_TYPES = ['meeting', 'demo', 'customer_visit', 'follow_up', 'service', 'internal'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const masters: MasterDefinition[] = [
  master('calEventType', 'Event type', [
    mv('meeting', 'Meeting', 'accent'),
    mv('demo', 'Demo', 'info'),
    mv('customer_visit', 'Customer visit', 'success'),
    mv('follow_up', 'Call / follow-up', 'warning'),
    mv('service', 'Service / installation', 'danger'),
    mv('internal', 'Internal / training', 'neutral'),
  ]),
  master('calEventStatus', 'Event status', [mv('scheduled', 'Scheduled', 'info'), mv('completed', 'Completed', 'success'), mv('cancelled', 'Cancelled', 'neutral')]),
  master('calRecurrence', 'Repeats', [mv('none', 'Does not repeat'), mv('daily', 'Daily'), mv('weekly', 'Weekly'), mv('monthly', 'Monthly')]),
  master('calLinkType', 'Linked record type', [
    mv('customers', 'Customer'),
    mv('leads', 'Lead'),
    mv('opportunities', 'Opportunity'),
    mv('quotations', 'Quotation'),
    mv('salesOrders', 'Sales order'),
    mv('tickets', 'Service ticket'),
    mv('installations', 'Installation job'),
  ]),
];

const f = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('calendarEvents', key, label, type, extra);

export const calendarEvents: ResourceDefinition = {
  id: 'res_calendarEvents',
  key: 'calendarEvents',
  module: 'home',
  label: 'Calendar event',
  labelPlural: 'Calendar events',
  icon: 'calendar',
  version: 1,
  idPrefix: 'EV',
  titleField: 'title',
  subtitleFields: ['start', 'eventType'],
  ownerField: 'assigneeId',
  description: 'Meetings, demos, customer visits, calls, service visits and internal events. Start and end are India Standard Time.',
  status: 'published',
  fields: [
    f('title', 'Title', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 280, subFields: ['linkLabel'] }),
    f('eventType', 'Type', 'master', { master: 'calEventType', required: true, defaultValue: 'meeting', width: 150 }),
    f('allDay', 'All day', 'boolean', { defaultValue: false, width: 80 }),
    // Wall-clock IST: "YYYY-MM-DDTHH:mm" (timed) or "YYYY-MM-DD" (all day; end inclusive).
    f('start', 'Starts', 'datetime', { required: true, width: 160 }),
    f('end', 'Ends', 'datetime', { required: true, width: 160 }),
    f('recurrence', 'Repeats', 'master', { master: 'calRecurrence', defaultValue: 'none', width: 130 }),
    f('recurrenceUntil', 'Repeat until', 'date', { visibleWhen: { field: 'recurrence', op: 'neq', value: 'none' } }),
    f('assigneeId', 'Assigned to', 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    f('attendeeIds', 'Attendees', 'people', { relation: { resource: 'employees' }, width: 150, capabilities: { list: true, form: true, export: true } }),
    f('linkResource', 'Linked record type', 'master', { master: 'calLinkType' }),
    f('linkId', 'Linked record', 'text', { capabilities: { filter: true, search: true } }),
    f('linkLabel', 'Related to', 'text', { capabilities: { list: true, search: true, sort: true }, width: 220 }),
    f('customerId', 'Customer', 'relation', { relation: { resource: 'customers' }, width: 200 }),
    f('location', 'Location', 'text', { maxLength: 160, capabilities: ALL }),
    f('status', 'Status', 'master', { master: 'calEventStatus', defaultValue: 'scheduled', width: 120 }),
    f('notes', 'Notes', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
    // Recurrence bookkeeping: occurrences removed or moved individually ("this event" edits).
    f('exdates', 'Skipped occurrences', 'text', { capabilities: {} }),
    f('seriesId', 'Part of series', 'text', { capabilities: { filter: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['title', 'eventType', 'start', 'end', 'assigneeId'],
    sections: [{ id: 'main', title: 'Event', fields: ['title', 'eventType', 'allDay', 'start', 'end', 'recurrence', 'recurrenceUntil', 'assigneeId', 'attendeeIds', 'location', 'status', 'notes'], columns: 2 }],
  },
  views: views([
    { id: 'v_cal_upcoming', resource: 'calendarEvents', name: 'Upcoming', type: 'table', filter: group('and', [cond('status', 'eq', 'scheduled')]), sort: [{ field: 'start', dir: 'asc' }], columns: cols('start', 'title', 'eventType', 'assigneeId', 'linkLabel', 'recurrence', 'status') },
    { id: 'v_cal_recurring', resource: 'calendarEvents', name: 'Recurring', type: 'table', filter: group('and', [cond('recurrence', 'neq', 'none')]), sort: [{ field: 'start', dir: 'asc' }], columns: cols('title', 'recurrence', 'start', 'recurrenceUntil', 'assigneeId', 'attendeeIds') },
    { id: 'v_cal_all', resource: 'calendarEvents', name: 'All', type: 'table', filter: group('and'), sort: [{ field: 'start', dir: 'desc' }], columns: cols('start', 'end', 'title', 'eventType', 'assigneeId', 'status') },
  ]),
};

/** Everyone keeps their own calendar; managers see and plan for their team, heads for their division. */
export const calendarPack: ModulePack = {
  id: 'calendar',
  resources: [calendarEvents],
  masters,
  permissions: {
    admin: { calendarEvents: p('all', 'all', true, true, true) },
    management: { calendarEvents: p('all', 'all', true, true, true) },
    division_head: { calendarEvents: p('division', 'division', true, true, true) },
    sales_manager: { calendarEvents: p('team', 'team', true, true, true) },
    sales_exec: { calendarEvents: p('own', 'own', true, true) },
    service_head: { calendarEvents: p('team', 'team', true, true, true) },
    engineer: { calendarEvents: p('own', 'own', true, true) },
    coordinator: { calendarEvents: p('division', 'division', true, true) },
    scm: { calendarEvents: p('own', 'own', true, true) },
    store: { calendarEvents: p('own') },
    accounts: { calendarEvents: p('own', 'own', true, true) },
    profiling: { calendarEvents: p('own', 'own', true, true) },
  },
  extend: { home: { resources: ['calendarEvents'], pages: [{ id: 'calendar', label: 'Calendar', icon: 'calendar', path: 'calendar' }] } },
};
