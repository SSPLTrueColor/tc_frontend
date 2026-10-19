/**
 * Opportunities demo data: ~90 deals over the last 6 months (from qualified leads and directly
 * for existing customers), demo-centre machines, demos and sample print requests, plus the
 * activities that make some deals current and others stagnant. Fictional companies only.
 */
import { addDays } from '../lib/dates';
import type { RecordData } from '../metadata/types';
import type { SeedContext } from './context';

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 1;

// Copy of the default stage probabilities (policies are not readable while the store seeds).
const PROB: Record<string, number> = { needs_assessment: 10, demo: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };
const OWNERS: Record<string, string[]> = { TX: ['u_rohan', 'u_karan', 'u_karan'], INK: ['u_sneha'], POD: ['u_priya'], LBL: ['u_imran'], PPR: ['u_deepak'], FAB: ['u_pooja'] };
const COMPETITORS = ['Epson', 'Mimaki', 'Kornit', 'Durst', 'HP Indigo', 'Konica Minolta', 'Local importer', 'Atexco'];
const MACHINE_NAMES: Record<string, string[]> = {
  TX: ['Sublimation printer 1.9 m', 'Direct-to-fabric printer 1.8 m', 'Industrial textile printer 3.2 m', 'RIP software upgrade'],
  POD: ['POD production press', 'Wide-format POD printer'],
  LBL: ['Digital label press 330 mm', 'Label finishing line'],
  FAB: ['Pigment fabric printer 3.2 m', 'Fabric steamer & washer'],
  INK: ['Sublimation ink — annual supply', 'Reactive ink — quarterly contract'],
  PPR: ['Sublimation paper — annual supply', 'Transfer paper rolls'],
};
const MACHINE_DIVS = ['TX', 'POD', 'LBL', 'FAB'];

const pickWeighted = <T,>(rnd: SeedContext['rnd'], items: [T, number][]): T => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rnd.next() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1][0];
};

export function seed(ctx: SeedContext): void {
  const { rnd, today } = ctx;
  const R = ctx.records;
  R.opportunities ??= [];
  R.demos ??= [];
  R.sampleRequests ??= [];
  R.activities ??= [];

  // ---- demo-centre machines
  const machines: [string, string, string][] = [
    ['TX sublimation 1.9 m · 8 heads', 'Mumbai demo centre', 'TX'],
    ['TX direct-to-fabric 1.8 m', 'Surat demo centre', 'TX'],
    ['POD production press', 'Bengaluru demo centre', 'POD'],
    ['Label press 330 mm', 'Delhi NCR demo centre', 'LBL'],
    ['Pigment fabric printer 3.2 m', 'Tiruppur demo centre', 'FAB'],
  ];
  R.demoMachines = machines.map(([name, location, divisionId]) => ({ ...ctx.base(400), id: ctx.nextId('demoMachines', 'DMC'), name, location, divisionId, status: 'active' }));

  const customers = R.customers ?? [];
  if (!customers.length) return; // upstream customers not seeded yet — nothing to link deals to.
  const contacts = R.contacts ?? [];
  const products = R.products ?? [];
  const employees = R.employees ?? [];
  const staffDivisions = (staffId: unknown) => (employees.find((e) => e.id === staffId)?.divisionIds as string[] | undefined) ?? [];

  const ownerFor = (division: string, customer: RecordData) => {
    if (customer.ownerId && staffDivisions(customer.ownerId).includes(division)) return String(customer.ownerId);
    return ctx.staff(rnd.pick(OWNERS[division] ?? OWNERS.TX));
  };
  const productFor = (division: string, type: string) => {
    const list = products.filter((p) => p.divisionId === division && (type === 'machine' ? p.productType === 'machine' : p.productType !== 'machine'));
    return list.length ? rnd.pick(list) : undefined;
  };
  const used = new Set<string>(); // demo machine slots "machineId|date|time"

  function addActivities(o: RecordData, createdDays: number, lastDaysAgo: number, open: boolean) {
    const count = rnd.int(1, 3);
    let last = '';
    for (let k = count - 1; k >= 0; k--) {
      const daysAgo = Math.min(createdDays, lastDaysAgo + k * rnd.int(3, 9));
      const at = `${addDays(today, -daysAgo)}T${String(rnd.int(10, 17)).padStart(2, '0')}:${rnd.pick(['00', '15', '30', '45'])}`;
      const isLast = k === 0;
      const next = isLast && open ? addDays(today, rnd.int(-2, 10)) : null;
      R.activities.push({
        ...ctx.base(daysAgo, 'system'),
        id: ctx.nextId('activities', 'ACT'),
        activityType: rnd.pick(['call', 'call', 'meeting', 'whatsapp', 'email', 'visit']),
        subject: rnd.pick(['Discussed configuration and budget', 'Shared brochure and sample prints', 'Follow-up call on quotation', 'Site visit with production head', 'Price negotiation call', 'Demo feedback discussion']),
        at,
        byId: o.ownerId,
        parentResource: 'opportunities',
        parentId: o.id,
        parentLabel: `${o.id} · ${String(o.name)}`,
        customerId: o.customerId,
        nextFollowUpAt: next && next >= today ? next : null,
        notes: '',
      });
      if (isLast) {
        last = at;
        if (next && next >= today) o.nextFollowUpAt = next;
      }
    }
    o.lastActivityAt = last;
  }

  function makeOpp(input: { customer: RecordData; division: string; oppType: string; productType: string; leadId?: string; contactId?: string | null; ownerId?: string; value?: number; createdDays: number }) {
    const { customer, division } = input;
    const stage = pickWeighted<string>(rnd, [
      ['needs_assessment', 18],
      ['demo', 15],
      ['proposal', 20],
      ['negotiation', 15],
      ['won', 18],
      ['lost', 14],
    ]);
    const machine = input.productType === 'machine';
    const product = productFor(division, input.productType);
    const value =
      input.value && input.value > 0
        ? input.value
        : Math.round((input.oppType === 'amc' || input.oppType === 'renewal' ? rnd.int(100, 500) : machine ? rnd.int(1500, 9000) : rnd.int(200, 1200)) * 1000);
    const createdDays = input.createdDays;
    const createdAt = new Date(ctx.now.getTime() - createdDays * 86_400_000);
    const baseName = product ? String(product.name) : rnd.pick(MACHINE_NAMES[division] ?? MACHINE_NAMES.TX);
    const o: RecordData = {
      ...ctx.base(createdDays, 'system'),
      id: ctx.nextId('opportunities', 'OPP', 'fy', createdAt),
      name: `${input.oppType === 'renewal' ? 'AMC renewal' : input.oppType === 'amc' ? 'AMC' : baseName} — ${String(customer.name)}`.slice(0, 120),
      customerId: customer.id,
      contactId: input.contactId ?? contacts.find((c) => c.customerId === customer.id)?.id ?? null,
      divisionId: division,
      oppType: input.oppType,
      productType: product?.productType ?? input.productType,
      productId: product?.id ?? null,
      value,
      stage,
      probability: PROB[stage],
      ownerId: input.ownerId ?? ownerFor(division, customer),
      territoryId: customer.territoryId ?? null,
      competitors: rnd.chance(0.6) ? `${rnd.pick(COMPETITORS)}${rnd.chance(0.4) ? `, ${rnd.pick(COMPETITORS)}` : ''}` : '',
      decisionMakers: rnd.chance(0.7) ? rnd.pick(['MD and production head', 'Owner', 'Purchase head and CFO', 'Partners']) : '',
      leadId: input.leadId ?? null,
      machineId: null,
      amcContractId: null,
      lostReason: null,
      lostToCompetitor: null,
      lostToPrice: null,
      wonAt: null,
      nextFollowUpAt: null,
      notes: '',
    };
    if (stage === 'won' || stage === 'lost') {
      const closedDays = Math.max(1, createdDays - rnd.int(10, Math.max(11, Math.min(90, createdDays - 1))));
      const closed = addDays(today, -closedDays);
      o.expectedCloseDate = closed;
      o.stageChangedAt = new Date(ctx.now.getTime() - closedDays * 86_400_000).toISOString();
      if (stage === 'won') o.wonAt = o.stageChangedAt;
      else {
        o.lostReason = rnd.pick(['bought_competitor', 'price', 'no_budget', 'postponed', 'not_reachable']);
        o.lostToCompetitor = o.lostReason === 'bought_competitor' || o.lostReason === 'price' ? rnd.pick(COMPETITORS) : 'None — project dropped';
        o.lostToPrice = o.lostReason === 'price' ? Math.round(value * (0.82 + rnd.next() * 0.1)) : null;
      }
      addActivities(o, createdDays, closedDays, false);
    } else {
      const stale = rnd.chance(0.15);
      o.expectedCloseDate = stale && rnd.chance(0.5) ? addDays(today, -rnd.int(3, 20)) : addDays(today, rnd.int(7, 150));
      o.stageChangedAt = new Date(ctx.now.getTime() - Math.min(createdDays, rnd.int(2, 40)) * 86_400_000).toISOString();
      addActivities(o, createdDays, stale ? rnd.int(20, 45) : rnd.int(0, 9), true);
    }
    R.opportunities.push(o);
    return o;
  }

  // ---- 1. Qualified leads become opportunities (lead → opportunity hand-off)
  for (const lead of R.leads ?? []) {
    if (lead.status !== 'qualified' || lead.opportunityId) continue;
    const customer = customers.find((c) => c.id === lead.customerId);
    if (!customer) continue;
    const division = String(lead.divisionId ?? (customer.divisionIds as string[] | undefined)?.[0] ?? 'TX');
    const productType = String(lead.productType ?? (MACHINE_DIVS.includes(division) ? 'machine' : 'ink'));
    const createdDays = Math.max(3, Math.round((ctx.now.getTime() - new Date(lead.updatedAt).getTime()) / 86_400_000) || rnd.int(10, 150));
    const o = makeOpp({ customer, division, oppType: productType === 'machine' ? 'new_machine' : 'consumables', productType, leadId: lead.id, contactId: (lead.contactId as string) ?? null, ownerId: lead.ownerId as string, value: Number(lead.budget) || undefined, createdDays });
    lead.opportunityId = o.id;
  }

  // ---- 2. Direct opportunities for existing customers up to ~90
  let guard = 0;
  while (R.opportunities.length < 90 && guard++ < 400) {
    const customer = rnd.pick(customers);
    const divs = ((customer.divisionIds as string[] | undefined) ?? []).filter((d) => OWNERS[d]);
    const division = divs.length ? rnd.pick(divs) : rnd.pick(Object.keys(OWNERS));
    const machineDiv = MACHINE_DIVS.includes(division);
    const oppType = machineDiv ? pickWeighted<string>(rnd, [['new_machine', 50], ['upgrade', 20], ['consumables', 10], ['amc', 12], ['renewal', 8]]) : 'consumables';
    const productType = oppType === 'new_machine' || oppType === 'upgrade' ? 'machine' : oppType === 'consumables' ? (division === 'PPR' ? 'paper' : division === 'FAB' ? 'fabric' : 'ink') : 'service';
    makeOpp({ customer, division, oppType, productType, createdDays: rnd.int(5, 180) });
  }

  // ---- 3. Demos for machine deals that reached the demo stage
  const demoable = R.opportunities.filter((o) => MACHINE_DIVS.includes(String(o.divisionId)) && o.productType === 'machine' && ['demo', 'proposal', 'negotiation', 'won'].includes(String(o.stage)));
  for (const o of demoable.slice(0, 28)) {
    const upcoming = o.stage === 'demo';
    const machine = R.demoMachines.find((m) => m.divisionId === o.divisionId);
    const atCentre = !!machine && rnd.chance(0.7);
    let date = upcoming ? addDays(today, rnd.int(-1, 10)) : addDays(today, -rnd.int(5, 60));
    let time = rnd.pick(['10:00', '14:30']);
    if (atCentre) {
      let tries = 0;
      while (used.has(`${machine!.id}|${date}|${time}`) && tries++ < 10) {
        date = addDays(date, 1);
        time = time === '10:00' ? '14:30' : '10:00';
      }
      used.add(`${machine!.id}|${date}|${time}`);
    }
    const done = date < today;
    R.demos.push({
      ...ctx.base(upcoming ? 3 : 70),
      id: ctx.nextId('demos', 'DEM'),
      opportunityId: o.id,
      customerId: o.customerId,
      location: atCentre ? 'centre' : 'site',
      demoMachineId: atCentre ? machine!.id : null,
      scheduledAt: `${date}T${time}`,
      durationMin: 120,
      status: done ? (rnd.chance(0.9) ? 'done' : 'cancelled') : rnd.chance(0.6) ? 'scheduled' : 'requested',
      ownerId: o.ownerId,
      divisionId: o.divisionId,
      agenda: 'Print quality, speed and running cost on customer fabric',
      results: done ? rnd.pick(['Customer satisfied with colour gamut and speed', 'Asked for a second demo with their own artwork', 'Good response; price discussion pending']) : '',
      customerFeedback: done ? rnd.pick(['Positive', 'Wants lower ink cost', 'Comparing with competitor demo']) : '',
    });
  }

  // ---- 4. Sample print requests to Profiling (Textile / Fabric)
  const profiling = ctx.staff('u_tanvi');
  const samplable = R.opportunities.filter((o) => ['TX', 'FAB'].includes(String(o.divisionId)) && ['needs_assessment', 'demo', 'proposal', 'won'].includes(String(o.stage)));
  for (const o of samplable.slice(0, 16)) {
    const open = o.stage !== 'won';
    const status = open ? rnd.pick(['requested', 'in_progress', 'results_shared']) : 'results_shared';
    R.sampleRequests.push({
      ...ctx.base(rnd.int(2, 40)),
      id: ctx.nextId('sampleRequests', 'SR'),
      title: rnd.pick(['Sample on polyester satin', 'Sample on cotton poplin', 'Sportswear print sample', 'Saree border design sample', 'Home furnishing print sample']),
      opportunityId: o.id,
      customerId: o.customerId,
      assigneeId: profiling,
      dueDate: status === 'results_shared' ? addDays(today, -rnd.int(1, 20)) : addDays(today, rnd.int(1, 10)),
      status,
      ownerId: o.ownerId,
      divisionId: o.divisionId,
      artwork: 'Customer artwork shared on WhatsApp: 3 designs (JPG, 150 dpi)',
      fabricDetails: rnd.pick(['100% polyester satin, 110 GSM', 'Cotton poplin, pre-treated', 'Lycra blend, 180 GSM']),
      results: status === 'results_shared' ? 'Colours matched within ΔE 2; slight bleeding on fine lines at 8 pass' : '',
      customerFeedback: status === 'results_shared' && rnd.chance(0.6) ? 'Approved colour; asked for faster mode test' : '',
    });
  }
}
