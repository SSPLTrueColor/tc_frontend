/**
 * Installed Base demo data: ~120 machines at machine customers, warranties (some expiring
 * within 90 days), AMC/CMC contracts in every state, PM visits, components, usage readings,
 * training records, a few resales/relocations, and installation jobs for delivered machine orders.
 * Tolerates missing upstream data (no customers or machine products → nothing is seeded).
 */
import { addDays, parseLocal, toDateKey } from '../lib/dates';
import { fyCode, fyLabel } from '../lib/fy';
import type { RecordData } from '../metadata/types';
import type { SeedContext } from './context';

export const rev = 4;

function addMonths(dateKey: string, months: number): string {
  const d = parseLocal(dateKey);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return toDateKey(d);
}
const daysBetween = (a: string, b: string) => Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 86_400_000);
const int = (v: unknown) => {
  const m = String(v ?? '').match(/(\d+)\s*×/) ?? String(v ?? '').match(/^(\d+)/);
  return m ? Number(m[1]) : null;
};
const metres = (v: unknown) => {
  const s = String(v ?? '');
  const m = s.match(/([\d.]+)\s*m\b/);
  if (m) return Number(m[1]);
  const mm = s.match(/(\d+)\s*mm/);
  return mm ? Number(mm[1]) / 1000 : null;
};

const STEPS = ['unpack', 'position', 'power_on', 'heads', 'ink_fill', 'rip', 'profile', 'test_print'];
const READY = ['rdPower', 'rdEarthing', 'rdUps', 'rdClimate', 'rdSpace', 'rdAir', 'rdNetwork'];
const TRAINEES = ['Ramesh Patil, Sunil Gawde', 'Mohan Lal, Arif Khan', 'Kiran Desai', 'Suresh Babu, Anil Kumar', 'Prakash Rao, Vinod Shetty', 'Jitendra Singh', 'Lata Pawar, Meena Joshi'];
const VERSIONS = ['RIP 9.2.1 / FW 3.14', 'RIP 9.4.0 / FW 3.20', 'RIP 10.0.2 / FW 4.02', 'RIP 8.7.5 / FW 2.88'];

export function seed(ctx: SeedContext): void {
  const { rnd, today, records: R } = ctx;
  const customers = R.customers ?? [];
  const products = (R.products ?? []).filter((p) => p.productType === 'machine');
  if (!customers.length || !products.length) return;

  const machineDivs = ['TX', 'POD', 'LBL'];
  const buyers = customers.filter((c) => ((c.divisionIds as string[]) ?? []).some((d) => machineDivs.includes(d)) && ['active', 'inactive', 'dealer', 'distributor'].includes(String(c.category)));
  if (!buyers.length) return;
  const addresses = R.addresses ?? [];
  const siteOf = (customerId: string) => (addresses.find((a) => a.customerId === customerId && a.addressType === 'installation') ?? addresses.find((a) => a.customerId === customerId))?.id ?? null;
  const staffIn = (roleId: string, div: string) => ctx.users.filter((u) => u.roleId === roleId && u.divisions.includes(div)).map((u) => ctx.staff(u.id));
  const engineerFor = (div: string) => rnd.pick(staffIn('engineer', div).length ? staffIn('engineer', div) : staffIn('service_head', div));
  const coordinatorFor = (div: string) => rnd.pick(staffIn('coordinator', div).length ? staffIn('coordinator', div) : staffIn('service_head', div));
  const productsFor = (c: RecordData) => {
    const divs = ((c.divisionIds as string[]) ?? []).filter((d) => machineDivs.includes(d));
    const list = products.filter((p) => divs.includes(String(p.divisionId)) && p.status !== 'inactive');
    return list.length ? list : products.filter((p) => p.status !== 'inactive');
  };

  const machines: RecordData[] = (R.machines ??= []);
  const warranties: RecordData[] = (R.warranties ??= []);
  const contracts: RecordData[] = (R.amcContracts ??= []);
  const components: RecordData[] = (R.machineComponents ??= []);
  const readings: RecordData[] = (R.machineReadings ??= []);
  const moves: RecordData[] = (R.machineMoves ??= []);
  const training: RecordData[] = (R.trainingRecords ??= []);
  const installs: RecordData[] = (R.installations ??= []);
  // pmVisits belongs to the service module (CONTRACTS §3); installed creates the visits it schedules.
  const pmOn = true;
  const pmVisits: RecordData[] = (R.pmVisits ??= []);
  const oppOn = Array.isArray(R.opportunities);
  const serials = new Set<string>();

  const contractNo = (start: string) => {
    const key = `amcContracts:no:${fyCode(parseLocal(start))}`;
    ctx.counters[key] = (ctx.counters[key] ?? 0) + 1;
    return `AMC/${fyLabel(parseLocal(start))}/${String(ctx.counters[key]).padStart(4, '0')}`;
  };
  const serialFor = (p: RecordData, installDate: string) => {
    let s = '';
    do s = `${String(p.model ?? 'TC').replace(/[^A-Z0-9]/gi, '').toUpperCase()}-${installDate.slice(0, 4)}-${String(rnd.int(1, 9999)).padStart(4, '0')}`;
    while (serials.has(s));
    serials.add(s);
    return s;
  };

  const addPm = (m: RecordData, start: string, end: string, perYear: number, amcContractId: string | null) => {
    if (!pmOn || perYear <= 0) return;
    const step = Math.max(1, Math.round(12 / perYear));
    for (let due = addMonths(start, step); due <= end; due = addMonths(due, step)) {
      const age = daysBetween(due, today);
      const status = age > 30 ? (rnd.chance(0.88) ? 'done' : 'missed') : age > 0 ? (rnd.chance(0.5) ? 'done' : 'overdue') : 'due';
      pmVisits.push({ ...ctx.base(Math.max(age, 1)), id: ctx.nextId('pmVisits', 'PMV'), machineId: m.id, customerId: m.customerId, amcContractId, dueDate: due, status, engineerId: engineerFor(String(m.divisionId)), ticketId: null });
    }
  };

  /** A machine with warranty, components, readings and an installation-time training record. */
  const makeMachine = (c: RecordData, p: RecordData, installDate: string, extra: Partial<RecordData> = {}): RecordData => {
    const div = String(p.divisionId);
    const m: RecordData = {
      ...ctx.base(daysBetween(installDate, today)),
      id: ctx.nextId('machines', 'M'),
      serialNo: serialFor(p, installDate),
      productId: p.id,
      model: String(p.model ?? p.name),
      customerId: c.id,
      siteAddressId: siteOf(c.id),
      divisionId: div,
      printHeads: int(p.printHeads),
      printWidth: metres(p.printWidth),
      softwareVersion: rnd.pick(VERSIONS),
      installDate,
      purchaseDate: addDays(installDate, -rnd.int(20, 75)),
      salesOrderId: null,
      installationId: null,
      status: 'active',
      ...extra,
    };
    machines.push(m);
    const wEnd = addDays(addMonths(installDate, Number(p.warrantyMonths) || 12), -1);
    warranties.push({ ...ctx.base(daysBetween(installDate, today)), id: ctx.nextId('warranties', 'W'), machineId: m.id, customerId: c.id, coverageType: 'parts_labour', startDate: installDate, endDate: wEnd, exclusions: 'Consumables, print-head damage from non-approved ink, physical damage and power surges.', divisionId: div });
    addPm(m, installDate, wEnd, 2, null);
    const heads = Math.min(m.printHeads ? Number(m.printHeads) : 0, 8);
    for (let h = 1; h <= heads; h++) {
      const fitted = installDate;
      const replaced = rnd.chance(0.12) && daysBetween(installDate, today) > 200;
      const first: RecordData = { ...ctx.base(daysBetween(fitted, today)), id: ctx.nextId('machineComponents', 'MC'), machineId: m.id, componentType: 'print_head', position: `H${h}`, serialNo: `PH${String(rnd.int(100000, 999999))}${h}`, installedAt: fitted, status: 'in_service', replacedAt: null, replacedById: null, replacementReason: null, divisionId: div };
      components.push(first);
      if (replaced) {
        const on = addDays(fitted, rnd.int(120, daysBetween(installDate, today) - 10));
        const fresh: RecordData = { ...ctx.base(daysBetween(on, today)), id: ctx.nextId('machineComponents', 'MC'), machineId: m.id, componentType: 'print_head', position: `H${h}`, serialNo: `PH${String(rnd.int(100000, 999999))}${h}R`, installedAt: on, status: 'in_service', replacedAt: null, replacedById: null, replacementReason: null, divisionId: div };
        Object.assign(first, { status: 'replaced', replacedAt: on, replacedById: fresh.id, replacementReason: rnd.pick(['Nozzle dropout after head strike', 'Clogging not cleared by maintenance', 'Electrical failure']) });
        components.push(fresh);
      }
    }
    if (div === 'TX' || rnd.chance(0.5)) {
      let counter = 0;
      const n = rnd.int(2, 4);
      for (let k = n; k >= 1; k--) {
        const on = addDays(today, -k * rnd.int(60, 95));
        if (on <= installDate) continue;
        counter += rnd.int(4000, 26000);
        readings.push({ ...ctx.base(daysBetween(on, today)), id: ctx.nextId('machineReadings', 'MR'), machineId: m.id, readingDate: on, printCounter: counter, inkConsumptionMl: rnd.int(8000, 60000), source: rnd.pick(['visit', 'visit', 'remote', 'customer']), recordedById: engineerFor(div), notes: '', divisionId: div });
      }
    }
    const trainer = engineerFor(div);
    const retrain = rnd.chance(0.08) ? 'requested' : rnd.chance(0.05) ? 'scheduled' : 'none';
    training.push({
      ...ctx.base(daysBetween(installDate, today)),
      id: ctx.nextId('trainingRecords', 'TR'),
      customerId: c.id,
      machineId: m.id,
      date: installDate,
      topics: ['operation', 'maintenance', 'rip', ...(rnd.chance(0.5) ? ['colour'] : [])],
      trainees: rnd.pick(TRAINEES),
      trainerId: trainer,
      retrainingStatus: retrain,
      retrainingNotes: retrain === 'none' ? null : rnd.pick(['New operators joined the night shift', 'Colour matching issues on polyester', 'Operator turnover — need a refresher on head cleaning']),
      installationId: null,
      divisionId: div,
    });
    return m;
  };

  // ---- historic installed base (installed 1 month to ~7 years ago)
  const TARGET = 118;
  for (let i = 0; i < TARGET; i++) {
    const c = rnd.pick(buyers);
    const p = rnd.pick(productsFor(c));
    // ~12% inside the last year's last quarter of warranty so "expiring ≤ 90 days" is populated.
    const age = rnd.chance(0.12) ? rnd.int(280, 355) : rnd.int(30, 2500);
    const m = makeMachine(c, p, addDays(today, -age));
    if (rnd.chance(0.03)) m.status = 'scrapped';
  }

  // ---- AMC / CMC history and current contracts (after warranty)
  const ownerOf = (c: RecordData) => (c.ownerId as string) ?? ctx.staff('u_rohan');
  const reminderMarks = (left: number) => [90, 60, 30].filter((d) => left <= d).join(',');
  for (const m of machines) {
    if (m.status === 'scrapped') continue;
    const w = warranties.find((x) => x.machineId === m.id)!;
    if (String(w.endDate) >= today || !rnd.chance(0.62)) continue;
    const c = customers.find((x) => x.id === m.customerId)!;
    const type = rnd.chance(0.35) ? 'cmc' : 'amc';
    const baseValue = Math.round((type === 'cmc' ? rnd.int(180, 420) : rnd.int(80, 190)) * 1000);
    let start = addDays(String(w.endDate), 1);
    let prev: RecordData | null = null;
    const lapse = rnd.chance(0.2);
    // Walk forward year by year; earlier years renewed, the current one active / due / lapsed / lost.
    while (addDays(addMonths(start, 12), -1) < today && daysBetween(start, today) > 365) {
      const end = addDays(addMonths(start, 12), -1);
      const row: RecordData = {
        ...ctx.base(daysBetween(start, today) + 20),
        id: ctx.nextId('amcContracts', 'AMC', 'fy', parseLocal(start)),
        contractNo: contractNo(start),
        customerId: m.customerId,
        machineId: m.id,
        contractType: type,
        startDate: start,
        endDate: end,
        pmVisitsPerYear: type === 'cmc' ? 4 : 2,
        value: baseValue,
        billingFrequency: rnd.pick(['annual', 'annual', 'half_yearly', 'quarterly']),
        slaTerms: type === 'cmc' ? 'Critical calls: response 1 h, on site 4 h, resolution 8 h. Parts and labour included.' : 'Critical calls: response 1 h, on site 4 h, resolution 8 h. Labour and PM visits included; parts chargeable.',
        status: 'renewed',
        ownerId: ownerOf(c),
        serviceOwnerId: coordinatorFor(String(m.divisionId)),
        divisionId: m.divisionId,
        lostReason: null,
        renewalOfId: prev?.id ?? null,
        renewedById: null,
        renewalOpportunityId: null,
        remindersSent: '90,60,30',
      };
      if (prev) prev.renewedById = row.id;
      contracts.push(row);
      prev = row;
      start = addDays(end, 1);
    }
    // Some customers stopped renewing: the last contract ended recently (lapsed or lost).
    if (lapse && prev && daysBetween(String(prev.endDate), today) <= 150) {
      const lost = rnd.chance(0.5);
      Object.assign(prev, { status: lost ? 'lost' : 'expired', renewedById: null, lostReason: lost ? rnd.pick(['price', 'bought_competitor', 'no_budget']) : null });
      continue;
    }
    // The contract running today (or that just ended).
    const end = addDays(addMonths(start, 12), -1);
    const left = daysBetween(today, end);
    const roll = rnd.next();
    const status = left < 0 ? (roll < 0.5 ? 'expired' : 'lost') : left <= 90 ? 'due_for_renewal' : 'active';
    if (left < 0 && daysBetween(end, today) > 120) continue;
    const row: RecordData = {
      ...ctx.base(Math.max(1, daysBetween(start, today) + 15)),
      id: ctx.nextId('amcContracts', 'AMC', 'fy', parseLocal(start)),
      contractNo: contractNo(start),
      customerId: m.customerId,
      machineId: m.id,
      contractType: type,
      startDate: start,
      endDate: end,
      pmVisitsPerYear: type === 'cmc' ? 4 : 2,
      value: Math.round(baseValue * 1.05),
      billingFrequency: 'annual',
      slaTerms: type === 'cmc' ? 'Critical calls: response 1 h, on site 4 h, resolution 8 h. Parts and labour included.' : 'Critical calls: response 1 h, on site 4 h, resolution 8 h. Labour and PM visits included; parts chargeable.',
      status,
      ownerId: ownerOf(c),
      serviceOwnerId: coordinatorFor(String(m.divisionId)),
      divisionId: m.divisionId,
      lostReason: status === 'lost' ? rnd.pick(['price', 'bought_competitor', 'no_budget']) : null,
      renewalOfId: prev?.id ?? null,
      renewedById: null,
      renewalOpportunityId: null,
      remindersSent: status === 'active' ? '' : left < 0 ? '90,60,30' : reminderMarks(left),
    };
    if (prev) prev.renewedById = row.id;
    contracts.push(row);
    if (['active', 'due_for_renewal'].includes(status)) addPm(m, start, end, Number(row.pmVisitsPerYear), row.id);
    if (status === 'due_for_renewal' && oppOn) {
      const opp: RecordData = {
        ...ctx.base(Math.max(1, 90 - left)),
        id: ctx.nextId('opportunities', 'OPP', 'fy'),
        name: `${type.toUpperCase()} renewal – ${m.serialNo} – ${c.name}`,
        customerId: m.customerId,
        divisionId: m.divisionId,
        oppType: 'renewal',
        productId: m.productId,
        value: row.value,
        expectedCloseDate: end,
        stage: left <= 30 ? 'negotiation' : 'needs_assessment',
        probability: left <= 30 ? 75 : 10,
        ownerId: row.ownerId,
        machineId: m.id,
        amcContractId: row.id,
        competitors: '',
        lastActivityAt: null,
      };
      R.opportunities.push(opp);
      row.renewalOpportunityId = opp.id;
    }
  }

  // ---- a few resales and relocations
  const movable = machines.filter((m) => m.status === 'active' && daysBetween(String(m.installDate), today) > 400);
  for (let i = 0; i < Math.min(5, movable.length); i++) {
    const m = movable[i * 7 % movable.length];
    const resale = i % 2 === 0;
    const to = resale ? rnd.pick(buyers.filter((b) => b.id !== m.customerId && ((b.divisionIds as string[]) ?? []).includes(String(m.divisionId)))) ?? null : null;
    if (resale && !to) continue;
    const on = addDays(today, -rnd.int(20, 200));
    const toCustomer = to?.id ?? m.customerId;
    moves.push({
      ...ctx.base(daysBetween(on, today)),
      id: ctx.nextId('machineMoves', 'MV'),
      machineId: m.id,
      moveType: resale ? 'resale' : 'relocation',
      moveDate: on,
      fromCustomerId: m.customerId,
      toCustomerId: toCustomer,
      fromSiteAddressId: m.siteAddressId,
      toSiteAddressId: siteOf(String(toCustomer)),
      reason: resale ? 'Sold to another print house after capacity upgrade' : 'Moved to the new plant',
      divisionId: m.divisionId,
    });
    m.customerId = toCustomer;
    m.siteAddressId = siteOf(String(toCustomer));
    if (!resale) m.status = 'relocated';
    warranties.filter((w) => w.machineId === m.id).forEach((w) => (w.customerId = toCustomer));
    // Open contracts follow the machine to its new owner (closed ones stay as history).
    contracts.filter((c) => c.machineId === m.id && ['draft', 'active', 'due_for_renewal'].includes(String(c.status))).forEach((c) => (c.customerId = toCustomer));
    (R.opportunities ?? []).filter((o) => o.machineId === m.id && o.oppType === 'renewal').forEach((o) => (o.customerId = toCustomer));
  }

  // ---- installation jobs for machine sales orders (when the orders module is present)
  const orders = (R.salesOrders ?? []).filter((o) => o.orderKind === 'machine' && !['cancelled', 'pending_approval'].includes(String(o.status)));
  const covered = new Set(installs.map((x) => x.salesOrderId));
  const statusFor = ['scheduled', 'site_ready', 'in_progress', 'trial_training'];
  let k = 0;
  for (const o of orders) {
    if (covered.has(o.id)) continue;
    const c = customers.find((x) => x.id === o.customerId);
    const p = products.find((x) => x.id === o.productId) ?? (c ? rnd.pick(productsFor(c)) : undefined);
    if (!c || !p) continue;
    const div = String(o.divisionId ?? p.divisionId);
    const eng = engineerFor(div);
    const s = String(o.status);
    if (['delivered', 'installation'].includes(s)) {
      const st = statusFor[k++ % statusFor.length];
      const idx = statusFor.indexOf(st);
      const when = addDays(today, idx === 0 ? rnd.int(2, 10) : -rnd.int(0, 4));
      const ins: RecordData = {
        ...ctx.base(rnd.int(3, 20)),
        id: ctx.nextId('installations', 'INS', 'fy'),
        customerId: c.id,
        salesOrderId: o.id,
        productId: p.id,
        siteAddressId: o.siteAddressId ?? siteOf(c.id),
        divisionId: div,
        engineerId: idx === 0 && rnd.chance(0.3) ? null : eng,
        scheduledAt: `${when}T10:30`,
        status: st,
        readinessSharedAt: `${addDays(today, -rnd.int(3, 12))}T11:00`,
        readinessVerifiedAt: idx >= 1 ? `${addDays(today, -rnd.int(1, 4))}T15:00` : null,
        hoExpectations: idx >= 1 ? 'Production of 1,500 m/day on polyester within the first month; colour match to existing screen-print shades.' : null,
        hoCommitments: idx >= 1 ? 'Two extra days of colour-profile support; one spare head kept at Surat hub for 6 months.' : null,
        hoKeyContacts: idx >= 1 ? 'Production head (site), owner (commercial), maintenance supervisor (power & air).' : null,
        handoverAt: idx >= 1 ? `${addDays(today, -rnd.int(1, 5))}T16:00` : null,
        jcSteps: idx >= 3 ? STEPS : idx === 2 ? STEPS.slice(0, rnd.int(2, 6)) : [],
        trialResults: idx >= 3 ? 'Test chart printed at 600×600 dpi; colour ΔE < 2 against target; no banding.' : null,
        parameters: idx >= 3 ? 'Head voltage 21.5 V; head temp 32 °C; humidity 55%; ICC profile TC-POLY-v3.' : null,
        mediaFiles: idx >= 2 ? 'site-before.jpg, test-print.jpg' : null,
        trainingTopics: idx >= 3 ? ['operation', 'maintenance', 'rip'] : [],
        trainees: idx >= 3 ? rnd.pick(TRAINEES) : null,
        serialNo: idx >= 3 ? serialFor(p, today) : null,
        printHeads: int(p.printHeads),
        printWidth: metres(p.printWidth),
        softwareVersion: idx >= 3 ? rnd.pick(VERSIONS) : null,
        signOffMethod: null,
        signedOffBy: null,
        signatureData: null,
        signedOffAt: null,
        machineId: null,
      };
      READY.forEach((f) => (ins[f] = idx >= 1 ? true : rnd.chance(0.5)));
      installs.push(ins);
    } else if (s === 'completed') {
      const installed = String(o.completedAt ?? o.deliveredAt ?? addDays(today, -rnd.int(20, 200))).slice(0, 10);
      const m = makeMachine(c, p, installed <= today ? installed : today, { salesOrderId: o.id, siteAddressId: o.siteAddressId ?? siteOf(c.id) });
      const ins: RecordData = {
        ...ctx.base(daysBetween(String(m.installDate), today) + 5),
        id: ctx.nextId('installations', 'INS', 'fy', parseLocal(String(m.installDate))),
        customerId: c.id,
        salesOrderId: o.id,
        productId: p.id,
        siteAddressId: m.siteAddressId,
        divisionId: div,
        engineerId: eng,
        scheduledAt: `${addDays(String(m.installDate), -3)}T10:00`,
        status: 'signed_off',
        readinessSharedAt: `${addDays(String(m.installDate), -12)}T11:00`,
        readinessVerifiedAt: `${addDays(String(m.installDate), -4)}T15:00`,
        hoExpectations: 'Stable production within two weeks.',
        hoCommitments: 'Standard installation and 2-day training.',
        hoKeyContacts: 'Owner and production head.',
        handoverAt: `${addDays(String(m.installDate), -5)}T16:00`,
        jcSteps: STEPS,
        trialResults: 'Trial prints approved by the customer.',
        parameters: 'Factory defaults; ICC profile applied.',
        mediaFiles: 'installation-complete.jpg',
        trainingTopics: ['operation', 'maintenance', 'rip'],
        trainees: rnd.pick(TRAINEES),
        serialNo: m.serialNo,
        printHeads: m.printHeads,
        printWidth: m.printWidth,
        softwareVersion: m.softwareVersion,
        signOffMethod: rnd.pick(['otp', 'signature']),
        signedOffBy: rnd.pick(['Mr. Patel (owner)', 'Ms. Iyer (production head)', 'Mr. Agarwal (director)']),
        signatureData: null,
        signedOffAt: `${m.installDate}T17:30`,
        machineId: m.id,
      };
      READY.forEach((f) => (ins[f] = true));
      installs.push(ins);
      m.installationId = ins.id;
      const t = training.find((x) => x.machineId === m.id);
      if (t) t.installationId = ins.id;
    }
  }
}
