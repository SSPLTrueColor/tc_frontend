import type { RecordData } from '../metadata/types';
import { addDays, toDateKey, toLocalDateTime } from '../lib/dates';
import type { SeedContext } from './context';

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 1;

const OWNERS: Record<string, string[]> = { TX: ['u_rohan', 'u_karan'], INK: ['u_sneha'], POD: ['u_priya'], LBL: ['u_imran'], PPR: ['u_deepak'], FAB: ['u_pooja'] };
const SOURCES: [string, number][] = [
  ['exhibition', 18],
  ['website', 14],
  ['referral', 14],
  ['meta_ads', 8],
  ['google_ads', 8],
  ['indiamart', 9],
  ['cold_call', 10],
  ['walk_in', 7],
  ['dealer', 6],
  ['social', 3],
  ['agency', 3],
];
const EVENTS = ['Gartex Texprocess India 2026', 'India ITME 2026', 'Printpack India 2026', 'Labelexpo India 2026', 'ITMA ASIA + CITME 2026'];
const CAMPAIGNS: Record<string, string[]> = {
  meta_ads: ['Sublimation printer launch – Meta', 'Diwali ink offer – Meta'],
  google_ads: ['DTF textile printer – Search', 'Label press – Search'],
  agency: ['Q2 digital textile campaign'],
  website: ['Website enquiry form'],
};
const REQUIREMENTS: Record<string, string[]> = {
  machine: ['Needs a 3.2 m sublimation printer for sportswear', 'Upgrade from 4-head to 8-head machine', 'Second machine for a new unit', 'Direct-to-fabric printer for cotton kurtis', 'Short-run digital label press', 'Print-on-demand setup for photo books'],
  ink: ['Monthly sublimation ink supply for 3 machines', 'Trial of pigment ink for cotton', 'Switch from imported ink to cheaper option'],
  paper: ['Sublimation transfer paper, 90 gsm rolls', 'Regular paper supply for print bureau'],
  fabric: ['Printed polyester for school uniforms', 'Digital printed georgette, 2,000 m/month'],
  software: ['RIP software for existing printer'],
  spares: ['Print-head replacement kit'],
};
const ACT_SUBJECTS = ['Intro call', 'Shared brochure on WhatsApp', 'Discussed requirement', 'Site visit – checked space and power', 'Follow-up call on budget', 'Meeting with owner', 'Sent sample prints', 'Demo discussion'];

function pickWeighted<T>(rnd: SeedContext['rnd'], items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rnd.next() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[0][0];
}

const productFor = (div: string, rnd: SeedContext['rnd']): { productType: string; subType?: string } => {
  switch (div) {
    case 'TX':
      return rnd.chance(0.75) ? { productType: 'machine', subType: 'textile' } : { productType: rnd.pick(['software', 'spares', 'ink']), subType: 'textile' };
    case 'POD':
      return { productType: 'machine', subType: 'pod' };
    case 'LBL':
      return { productType: 'machine', subType: 'label' };
    case 'INK':
      return { productType: 'ink' };
    case 'PPR':
      return { productType: 'paper' };
    default:
      return { productType: 'fabric', subType: 'other' };
  }
};

const budgetFor = (type: string, rnd: SeedContext['rnd']) => {
  const range: Record<string, [number, number]> = { machine: [15, 90], ink: [1, 8], paper: [0.5, 5], fabric: [1, 15], software: [1, 4], spares: [0.5, 3] };
  const [a, b] = range[type] ?? [1, 5];
  return Math.round((a + rnd.next() * (b - a)) * 10) * 10_000; // lakhs → ₹, rounded to ₹10,000
};

/** ~150 leads over the last 6 months + their activities, assignment rules and scoring rules. Needs customers/contacts. */
export function seed(ctx: SeedContext): void {
  const { rnd, now } = ctx;
  const staff = (u: string) => ctx.staff(u);

  // ---- assignment rules (BR-09) and scoring rules (LEAD-13) — independent of upstream data
  const rules: RecordData[] = (ctx.records.assignmentRules ??= []);
  const rule = (name: string, priority: number, divisionId: string, team: string[], extra: Record<string, unknown> = {}) =>
    rules.push({ ...ctx.base(200), id: ctx.nextId('assignmentRules', 'AR'), name, priority, divisionId, productType: null, territoryId: null, assigneeIds: team.map(staff), active: true, rrPointer: 0, ...extra });
  rule('Textile machines – West', 10, 'TX', ['u_rohan', 'u_karan'], { productType: 'machine' });
  rule('Textile – all other', 20, 'TX', ['u_karan']);
  rule('Ink', 10, 'INK', ['u_sneha']);
  rule('Commercial – POD', 10, 'POD', ['u_priya']);
  rule('Commercial – Label', 10, 'LBL', ['u_imran']);
  rule('Paper', 10, 'PPR', ['u_deepak']);
  rule('Fabric', 10, 'FAB', ['u_pooja']);

  const scoring: RecordData[] = (ctx.records.leadScoringRules ??= []);
  const sr = (label: string, factor: string, matchValue: string, points: number) => scoring.push({ ...ctx.base(200), id: ctx.nextId('leadScoringRules', 'LSR'), label, factor, matchValue, points, active: true });
  sr('Referral leads convert best', 'source', 'referral', 25);
  sr('Walk-in / demo centre visit', 'source', 'walk_in', 15);
  sr('Met at an exhibition', 'source', 'exhibition', 10);
  sr('Marketplace enquiry', 'source', 'indiamart', 5);
  sr('Mill / processing house', 'segment', 'mill', 10);
  sr('Job-work / print bureau', 'segment', 'job_work', 5);
  sr('Budget ₹10 lakh or more', 'budget', '1000000', 20);
  sr('Budget ₹50 lakh or more', 'budget', '5000000', 10);
  sr('Buying within a month', 'timeline', 'immediate', 25);
  sr('Buying in 1–3 months', 'timeline', '1_3m', 15);
  sr('Buying in 3–6 months', 'timeline', '3_6m', 5);
  sr('Engaged: 3+ activities', 'engagement', '3', 10);

  // ---- leads (need companies and contacts from the customers seed)
  const customers = (ctx.records.customers ?? []).filter((c) => c.status !== 'inactive');
  const contactsByCustomer = new Map<string, RecordData[]>();
  (ctx.records.contacts ?? []).forEach((c) => c.customerId && contactsByCustomer.set(String(c.customerId), [...(contactsByCustomer.get(String(c.customerId)) ?? []), c]));
  const candidates = customers.filter((c) => contactsByCustomer.has(c.id));
  if (!candidates.length) return;

  const leads: RecordData[] = (ctx.records.leads ??= []);
  const activities: RecordData[] = (ctx.records.activities ??= []);
  const engineers = (ctx.records.employees ?? []).filter((e) => e.roleId === 'engineer');
  const addressOf = (cid: string) => (ctx.records.addresses ?? []).find((a) => a.customerId === cid && a.addressType === 'billing');

  // Creation moments first, oldest → newest, so fy ids follow time.
  const moments = Array.from({ length: 150 }, () => {
    const days = rnd.chance(0.25) ? rnd.int(0, 6) : rnd.int(7, 180);
    return new Date(now.getTime() - days * 86_400_000 - rnd.int(0, 10) * 3_600_000);
  }).sort((a, b) => a.getTime() - b.getTime());

  for (const created of moments) {
    const cust = rnd.pick(candidates);
    const divs = ((cust.divisionIds as string[]) ?? []).filter((d) => OWNERS[d]);
    const div = divs.length ? rnd.pick(divs) : rnd.pick(Object.keys(OWNERS));
    const ownerUser = rnd.pick(OWNERS[div]);
    const contact = rnd.pick(contactsByCustomer.get(cust.id)!);
    const { productType, subType } = productFor(div, rnd);
    const source = pickWeighted(rnd, SOURCES);
    const ageDays = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
    const status =
      ageDays <= 5
        ? rnd.chance(0.6)
          ? 'new'
          : 'contacted'
        : ageDays <= 30
          ? pickWeighted(rnd, [
              ['contacted', 55],
              ['nurture', 10],
              ['qualified', 20],
              ['disqualified', 15],
            ])
          : pickWeighted(rnd, [
              ['qualified', 35],
              ['disqualified', 30],
              ['contacted', 20],
              ['nurture', 15],
            ]);
    const createdIso = created.toISOString();
    const id = ctx.nextId('leads', 'LD', 'fy', created);
    const addr = addressOf(cust.id);
    const ref: Record<string, unknown> = {};
    if (source === 'referral') {
      if (engineers.length && rnd.chance(0.5)) Object.assign(ref, { referrerType: 'engineer', referrerEmployeeId: rnd.pick(engineers).id });
      else {
        const other = rnd.pick(customers.filter((c) => c.id !== cust.id));
        Object.assign(ref, { referrerType: other?.category === 'dealer' ? 'dealer' : 'customer', referrerCustomerId: other?.id ?? null });
      }
    }
    const textile = subType === 'textile' && productType === 'machine';
    const lead: RecordData = {
      workspaceId: ctx.ws,
      version: 1,
      createdAt: createdIso,
      updatedAt: createdIso,
      createdBy: ownerUser,
      id,
      customerId: cust.id,
      contactId: contact.id,
      divisionId: div,
      ownerId: staff(ownerUser),
      sourceId: source,
      campaign: CAMPAIGNS[source] ? rnd.pick(CAMPAIGNS[source]) : null,
      eventName: source === 'exhibition' ? rnd.pick(EVENTS) : null,
      ...ref,
      productType,
      subType: subType ?? null,
      specPrintWidth: textile ? rnd.pick([1800, 2200, 2600, 3200]) : null,
      specPrintHeads: textile ? rnd.pick(['4h', '8h', '16h']) : null,
      specFabricType: textile ? rnd.pick(['polyester', 'cotton', 'blend', 'viscose']) : null,
      specCapacity: textile ? rnd.pick([2000, 5000, 8000, 15000]) : null,
      requirement: rnd.pick(REQUIREMENTS[productType] ?? REQUIREMENTS.machine),
      budget: rnd.chance(0.75) ? budgetFor(productType, rnd) : null,
      decisionMaker: rnd.chance(0.6) ? String(contact.name) : null,
      timeline: rnd.chance(0.7) ? rnd.pick(['immediate', '1_3m', '3_6m', '6_12m', '12m_plus']) : null,
      currentSetup: productType === 'machine' && rnd.chance(0.4) ? rnd.pick(['Screen printing', 'Older 4-head Chinese printer', 'Rotary printing (outsourced)', 'Competitor 8-head machine']) : null,
      city: addr?.city ?? null,
      state: cust.billingState ?? addr?.state ?? null,
      industry: cust.industry ?? null,
      segment: ((cust.segmentTags as string[]) ?? [])[0] ?? null,
      status,
      nextFollowUpAt: null,
      nurtureUntil: null,
      disqualifyReason: null,
      opportunityId: null,
      firstContactAt: null,
      lastActivityAt: null,
    };

    if (status !== 'new') {
      // First contact a few hours to a day after creation; then 0–3 more touches.
      let t = new Date(created.getTime() + rnd.int(2, 30) * 3_600_000);
      lead.firstContactAt = toLocalDateTime(t);
      const touches = 1 + rnd.int(0, Math.min(3, Math.floor(ageDays / 7)));
      for (let k = 0; k < touches && t < now; k++) {
        const at = toLocalDateTime(t);
        activities.push({
          ...ctx.base(0, ownerUser),
          createdAt: t.toISOString(),
          updatedAt: t.toISOString(),
          id: ctx.nextId('activities', 'ACT'),
          subject: k === 0 ? 'Intro call' : rnd.pick(ACT_SUBJECTS),
          activityType: k === 0 ? 'call' : rnd.pick(['call', 'whatsapp', 'meeting', 'visit', 'email']),
          at,
          byId: staff(ownerUser),
          parentResource: 'leads',
          parentId: id,
          parentLabel: `${id} · ${String(cust.name)}`,
          customerId: cust.id,
          nextFollowUpAt: null,
          notes: '',
        });
        lead.lastActivityAt = at;
        t = new Date(t.getTime() + rnd.int(2, 12) * 86_400_000);
      }
    }
    if (status === 'new' || status === 'contacted') lead.nextFollowUpAt = addDays(ctx.today, rnd.int(-6, 10));
    if (status === 'new' && ageDays === 0) lead.nextFollowUpAt = addDays(toDateKey(created), 1);
    if (status === 'nurture') {
      lead.nurtureUntil = addDays(ctx.today, rnd.int(-4, 75));
      lead.nextFollowUpAt = lead.nurtureUntil;
      lead.statusNote = rnd.pick(['Budget next financial year', 'Waiting for new factory shed', 'Will decide after Diwali season']);
    }
    if (status === 'disqualified') {
      lead.disqualifyReason = pickWeighted(rnd, [
        ['no_budget', 25],
        ['bought_competitor', 20],
        ['not_reachable', 20],
        ['not_relevant', 15],
        ['duplicate', 8],
        ['price', 12],
      ]);
    }
    if (status === 'qualified') {
      lead.decisionMaker ??= String(contact.name);
      lead.timeline ??= '3_6m';
      lead.budget ??= budgetFor(productType, rnd);
    }
    // Last-activity follow-up mirrors the lead.
    const last = [...activities].reverse().find((a) => a.parentId === id);
    if (last && lead.nextFollowUpAt) last.nextFollowUpAt = lead.nextFollowUpAt;
    if (lead.lastActivityAt) lead.updatedAt = new Date(String(lead.lastActivityAt)).toISOString();
    leads.push(lead);
  }
}
