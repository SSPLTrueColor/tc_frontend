import { addDays } from '../lib/dates';
import type { RecordData } from '../metadata/types';
import type { SeedContext } from './context';

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 2;

type Draft = {
  title: string;
  eventType: 'meeting' | 'demo' | 'customer_visit' | 'follow_up' | 'service' | 'internal';
  day: number;
  /** "HH:mm" for timed events; omit for all-day. */
  at?: string;
  minutes?: number;
  /** All-day span in days (inclusive count). */
  days?: number;
  user: string;
  attendees?: string[];
  recurrence?: 'daily' | 'weekly' | 'monthly';
  untilDay?: number;
  link?: 'customer' | 'lead' | 'opportunity' | 'ticket';
  location?: string;
  notes?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const addMin = (hhmm: string, m: number) => {
  const t = +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5) + m;
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
};

/**
 * 50 demo events from last month to next month (IST wall clock): recurring team rituals,
 * customer meetings and demos, overlapping bookings, multi-day exhibitions and training,
 * holidays, past (completed) and today's events — linked to seeded customers, leads and deals.
 */
export function seed(ctx: SeedContext): void {
  const { rnd, today } = ctx;
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = (weekOffset: number) => -dow + 7 * weekOffset; // day offset of a Monday

  const pick = (rows: RecordData[] | undefined, i: number) => (rows?.length ? rows[i % rows.length] : undefined);
  const customers = ctx.records.customers?.filter((c) => c.status !== 'inactive');
  const leads = ctx.records.leads?.filter((l) => ['new', 'contacted', 'nurture'].includes(String(l.status)));
  const opps = ctx.records.opportunities?.filter((o) => !['won', 'lost'].includes(String(o.stage)));
  const tickets = ctx.records.tickets;

  const R = 'u_rohan';
  const K = 'u_karan';
  const S = 'u_suresh';
  const M = 'u_manoj';
  const SV = 'u_sanjay';
  const PR = 'u_priya';
  const SN = 'u_sneha';
  const RV = 'u_ravi';
  const AJ = 'u_ajay';
  const MI = 'u_meera';
  const V = 'u_vikram';

  const drafts: Draft[] = [
    // Recurring team rituals
    { title: 'Weekly sales review — Textile West', eventType: 'meeting', day: monday(-5), at: '10:00', minutes: 60, user: R, attendees: [K, S], recurrence: 'weekly', untilDay: 70, location: 'Mumbai office, Board room' },
    { title: 'Service desk stand-up', eventType: 'internal', day: monday(-3), at: '09:15', minutes: 15, user: M, attendees: [SV, MI, RV, AJ], recurrence: 'daily', untilDay: 45, location: 'Teams call' },
    { title: 'Monthly business review', eventType: 'meeting', day: -27, at: '15:00', minutes: 120, user: V, attendees: [S, M], recurrence: 'monthly', untilDay: 120, location: 'Head office' },
    { title: 'POD pipeline call', eventType: 'follow_up', day: monday(-2) + 2, at: '17:00', minutes: 30, user: PR, recurrence: 'weekly', untilDay: 60, location: 'Phone' },

    // Multi-day and all-day
    { title: 'Gartex Texprocess India — stall B-14', eventType: 'customer_visit', day: 9, days: 3, user: S, attendees: [R, K], location: 'Pragati Maidan, New Delhi', notes: 'Exhibition: capture leads by visiting-card scan.' },
    { title: 'Print Pack India — visitor', eventType: 'customer_visit', day: -18, days: 2, user: PR, location: 'Greater Noida' },
    { title: 'RIP software training (new engineers)', eventType: 'internal', day: 4, days: 2, user: M, attendees: [RV, AJ], location: 'Surat demo centre' },
    { title: 'Diwali — office closed', eventType: 'internal', day: 13, days: 1, user: V, location: 'All offices' },
    { title: 'Quarter-end closing (Accounts)', eventType: 'internal', day: -20, days: 1, user: 'u_swati' },
    { title: 'Ink stock audit', eventType: 'internal', day: 0, days: 1, user: SN, location: 'Bhiwandi warehouse' },

    // Today
    { title: 'Demo: sublimation printer', eventType: 'demo', day: 0, at: '11:00', minutes: 90, user: K, attendees: [R], link: 'opportunity', location: 'Surat demo centre' },
    { title: 'Price negotiation call', eventType: 'follow_up', day: 0, at: '11:30', minutes: 45, user: R, link: 'opportunity', location: 'Phone' },
    { title: 'Breakdown visit — print-head clog', eventType: 'service', day: 0, at: '14:00', minutes: 120, user: RV, link: 'ticket', location: 'Customer site' },
    { title: 'Follow-up: revised quotation', eventType: 'follow_up', day: 0, at: '16:30', minutes: 30, user: K, link: 'lead' },

    // Overlapping bookings for the same person (warning demo)
    { title: 'Site survey for installation', eventType: 'customer_visit', day: 1, at: '10:00', minutes: 120, user: K, link: 'customer', location: 'Customer site' },
    { title: 'Ink trial results review', eventType: 'meeting', day: 1, at: '11:00', minutes: 60, user: K, link: 'customer' },
    { title: 'Label press demo', eventType: 'demo', day: 2, at: '15:00', minutes: 90, user: 'u_imran', link: 'opportunity', location: 'Delhi demo centre' },
    { title: 'Label press — pricing discussion', eventType: 'meeting', day: 2, at: '15:30', minutes: 60, user: 'u_imran', link: 'opportunity' },
  ];

  // Spread customer meetings, demos, calls and service visits over last month → next month.
  const kinds: Pick<Draft, 'eventType' | 'link'>[] = [
    { eventType: 'customer_visit', link: 'customer' },
    { eventType: 'demo', link: 'opportunity' },
    { eventType: 'follow_up', link: 'lead' },
    { eventType: 'meeting', link: 'opportunity' },
    { eventType: 'service', link: 'ticket' },
  ];
  const owners: Record<string, string[]> = { customer_visit: [K, R, SN, 'u_deepak', 'u_pooja'], demo: [K, PR, 'u_imran'], follow_up: [K, R, SN, PR], meeting: [R, S, PR], service: [RV, AJ, 'u_lakshmi', 'u_farhan'] };
  const titles: Record<string, string[]> = {
    customer_visit: ['Account visit', 'Quarterly check-in visit', 'New contact introduction', 'Collection follow-up visit'],
    demo: ['Machine demo', 'Sample print review', 'Software walkthrough'],
    follow_up: ['Follow-up call', 'Quotation follow-up', 'Payment reminder call'],
    meeting: ['Proposal meeting', 'Commercial discussion', 'Decision-maker meeting'],
    service: ['Preventive maintenance', 'Breakdown visit', 'Calibration visit'],
  };
  const hours = ['10:00', '11:30', '12:00', '14:00', '15:30', '16:00'];
  for (let i = 0; i < 32; i++) {
    const k = kinds[i % kinds.length];
    const day = -30 + Math.round((i * 64) / 31) + rnd.int(-1, 1);
    if (day === 0) continue;
    drafts.push({ title: rnd.pick(titles[k.eventType]), eventType: k.eventType, day, at: rnd.pick(hours), minutes: k.eventType === 'service' ? 120 : k.eventType === 'demo' ? 90 : rnd.pick([30, 45, 60]), user: rnd.pick(owners[k.eventType]), link: k.link, location: k.eventType === 'follow_up' ? 'Phone' : 'Customer site' });
  }

  const rows: RecordData[] = [];
  const nowWall = `${today}T${pad(ctx.now.getHours())}:${pad(ctx.now.getMinutes())}`;
  drafts.forEach((d, i) => {
    const date = addDays(today, d.day);
    const allDay = !d.at;
    const start = allDay ? date : `${date}T${d.at}`;
    const end = allDay ? addDays(date, (d.days ?? 1) - 1) : `${date}T${addMin(d.at!, d.minutes ?? 60)}`;
    const linkRec = d.link === 'customer' ? pick(customers, i * 3) : d.link === 'lead' ? pick(leads, i * 5) : d.link === 'opportunity' ? pick(opps, i * 7) : d.link === 'ticket' ? pick(tickets, i * 11) : undefined;
    const linkResource = linkRec ? ({ customer: 'customers', lead: 'leads', opportunity: 'opportunities', ticket: 'tickets' } as const)[d.link!] : null;
    const customerId = linkRec ? (linkResource === 'customers' ? linkRec.id : (linkRec.customerId as string | undefined)) : undefined;
    const customerName = customerId ? String(customers?.find((c) => c.id === customerId)?.name ?? '') : '';
    const past = (allDay ? end : end) < (allDay ? today : nowWall);
    rows.push({
      ...ctx.base(Math.max(1, 40 - d.day), ctx.users.find((u) => u.id === d.user) ? d.user : 'system'),
      id: ctx.nextId('calendarEvents', 'EV'),
      title: customerName && !d.title.includes(customerName) && !d.recurrence ? `${d.title} — ${customerName}` : d.title,
      eventType: d.eventType,
      allDay,
      start,
      end,
      recurrence: d.recurrence ?? 'none',
      recurrenceUntil: d.recurrence ? addDays(today, d.untilDay ?? 60) : null,
      assigneeId: ctx.staff(d.user),
      attendeeIds: (d.attendees ?? []).map((u) => ctx.staff(u)).filter(Boolean),
      linkResource,
      linkId: linkRec?.id ?? null,
      linkLabel: linkRec ? `${linkRec.id}${customerName ? ` · ${customerName}` : ''}` : null,
      customerId: customerId ?? null,
      location: d.location ?? null,
      status: past && !d.recurrence ? (rnd.chance(0.85) ? 'completed' : 'cancelled') : 'scheduled',
      notes: d.notes ?? null,
      exdates: '',
      seriesId: null,
    });
  });
  ctx.records.calendarEvents = rows;
}
