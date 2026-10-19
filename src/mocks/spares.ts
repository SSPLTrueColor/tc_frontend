/**
 * Spares & consumables demo data: ~80 spare parts across the textile, POD and label machine
 * families (some below minimum), ~60 requisitions in every status linked to seeded tickets,
 * OEM warranty claims, ~30 customer rate contracts and ~25 sample / trial dispatches.
 * Upstream data (tickets, customers, products, machines) is optional — sections are skipped
 * when it is missing.
 */
import type { RecordData } from '../metadata/types';
import { addDays, toDateKey } from '../lib/dates';
import type { SeedContext } from './context';

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 1;

const FAMILIES = [
  { code: 'SUB', name: 'ChromaJet sublimation (Epson i3200)', head: 'Epson i3200-A1 print head', oem: 'epson', div: 'TX' },
  { code: 'DTF', name: 'ChromaJet direct-to-fabric (Kyocera KJ4)', head: 'Kyocera KJ4B print head', oem: 'kyocera', div: 'TX' },
  { code: 'POD', name: 'PrintBook POD (Ricoh Gen5)', head: 'Ricoh Gen5 print head', oem: 'ricoh', div: 'POD' },
  { code: 'LBL', name: 'LabelPro UV (Konica 1024i)', head: 'Konica Minolta 1024i print head', oem: 'konica', div: 'LBL' },
];

/** [suffix, description, category, hsn, base price ₹, warranty, returnable, critical] */
const PARTS: [string, string, string, string, number, boolean, boolean, boolean][] = [
  ['PH', 'print head', 'print_head', '84439990', 142000, true, true, true],
  ['DMP', 'damper set (8 pcs)', 'damper', '84439990', 6400, true, false, false],
  ['ENC', 'encoder strip', 'encoder', '90318000', 3800, true, false, false],
  ['ENS', 'encoder sensor', 'encoder', '90318000', 5200, true, true, false],
  ['PMP', 'ink supply pump', 'pump', '84138190', 11800, true, true, true],
  ['CAP', 'capping station assembly', 'capping', '84439990', 18500, true, true, false],
  ['WPR', 'wiper blade (pack of 4)', 'wiper', '40169990', 1200, false, false, false],
  ['BLT', 'carriage drive belt', 'belt', '40103999', 4600, true, false, false],
  ['MBD', 'main control board', 'board', '84439100', 64000, true, true, true],
  ['HBD', 'head driver board', 'board', '84439100', 38500, true, true, true],
  ['HTR', 'IR dryer heater element', 'heater', '85168000', 9200, true, false, false],
  ['TUB', 'ink tube set (2 m)', 'pump', '39173290', 2100, false, false, false],
  ['MSN', 'media sensor', 'encoder', '90318000', 4300, true, false, false],
  ['PRL', 'pinch roller set', 'belt', '84439990', 7800, true, false, false],
  ['FLT', 'ink filter (pack of 10)', 'pump', '84212300', 1900, false, false, false],
  ['CBL', 'head data cable', 'board', '85444299', 3300, true, false, false],
  ['MTR', 'carriage servo motor', 'belt', '85015290', 26500, true, true, true],
  ['SPN', 'capping sponge kit', 'wiper', '84439990', 950, false, false, false],
  ['CLN', 'cleaning solution 1 L', 'other', '34029099', 1450, false, false, false],
  ['FUS', 'power supply unit', 'board', '85044090', 15800, true, true, false],
];

const COURIERS = ['Blue Dart', 'DTDC', 'Delhivery', 'Professional Couriers', 'Hand delivery'];

export function seed(ctx: SeedContext): void {
  const { rnd, today, now } = ctx;
  const at = (daysAgo: number, hour = 11) => {
    const d = new Date(now.getTime() - daysAgo * 86_400_000);
    d.setHours(hour, rnd.int(0, 59), 0, 0);
    return d.toISOString();
  };

  // ---------------------------------------------------------------- spare parts (~80)
  const parts: RecordData[] = [];
  for (const fam of FAMILIES) {
    for (const [suffix, desc, category, hsn, base, warranty, returnable, critical] of PARTS) {
      const minLevel = critical ? rnd.int(3, 6) : rnd.int(2, 10);
      const below = rnd.chance(0.15);
      const stock = below ? rnd.int(0, Math.max(0, minLevel - 1)) : rnd.int(minLevel, minLevel * 4 + 6);
      const price = Math.round((base * (0.85 + rnd.next() * 0.4)) / 50) * 50;
      parts.push({
        ...ctx.base(400),
        id: ctx.nextId('spareParts', 'SP'),
        partNo: `TC-${fam.code}-${suffix}-${String(rnd.int(100, 999))}`,
        description: suffix === 'PH' ? fam.head : `${fam.code === 'SUB' || fam.code === 'DTF' ? 'ChromaJet' : fam.code === 'POD' ? 'PrintBook' : 'LabelPro'} ${desc}`,
        category,
        compatibleModels: fam.name,
        hsn,
        price,
        uom: 'Nos',
        warrantyApplicable: warranty,
        returnable,
        stockMain: stock,
        minLevel,
        critical,
        erpSyncedAt: at(1, 7),
        status: rnd.chance(0.04) ? 'inactive' : 'active',
        family: fam.code,
        oem: fam.oem,
      });
    }
  }
  ctx.records.spareParts = parts;
  const activeParts = parts.filter((p) => p.status === 'active');

  // ---------------------------------------------------------------- requisitions (~60) on seeded tickets
  const tickets = ctx.records.tickets ?? [];
  const employees = ctx.records.employees ?? [];
  const engineers = employees.filter((e) => e.roleId === 'engineer');
  const requisitions: RecordData[] = [];
  const claims: RecordData[] = [];
  if (tickets.length && engineers.length) {
    const plan: string[] = [
      ...Array(8).fill('requested'),
      ...Array(7).fill('approved'),
      ...Array(3).fill('rejected'),
      ...Array(8).fill('issued'),
      ...Array(7).fill('received'),
      ...Array(22).fill('consumed'),
      ...Array(5).fill('returned'),
    ];
    const openFirst = (st: string) => {
      const prefer = ['requested', 'approved', 'issued'].includes(st) ? ['waiting_parts', 'in_progress', 'accepted'] : st === 'received' ? ['in_progress', 'waiting_parts'] : ['closed', 'resolved', 'customer_confirmation'];
      const pool = tickets.filter((t) => prefer.includes(String(t.status)));
      return rnd.pick(pool.length ? pool : tickets);
    };
    plan.forEach((status) => {
      const t = openFirst(status);
      const family = t.divisionId === 'POD' ? 'POD' : t.divisionId === 'LBL' ? 'LBL' : rnd.pick(['SUB', 'DTF']);
      const pool = activeParts.filter((p) => p.family === family);
      const part = rnd.pick(pool.length ? pool : activeParts);
      const engineer = engineers.find((e) => e.id === t.assigneeId) ?? rnd.pick(engineers);
      const ageDays = status === 'requested' ? rnd.int(0, 3) : status === 'approved' ? rnd.int(1, 5) : status === 'issued' ? rnd.int(2, 7) : rnd.int(5, 80);
      const created = new Date(now.getTime() - ageDays * 86_400_000);
      const qty = part.category === 'print_head' ? rnd.int(1, 2) : rnd.int(1, 4);
      const issuedQty = Math.min(qty, Math.max(1, qty - (rnd.chance(0.1) ? 1 : 0)));
      const basis = part.warrantyApplicable && rnd.chance(0.6) ? 'warranty' : 'chargeable';
      const r: RecordData = {
        ...ctx.base(ageDays),
        id: ctx.nextId('requisitions', 'REQ', 'fy', created),
        ticketId: t.id,
        partId: part.id,
        qty,
        urgency: t.priority === 'critical' || rnd.chance(0.2) ? 'urgent' : 'normal',
        engineerId: engineer.id,
        reason: rnd.pick(['Nozzle dropout after head strike', 'Ink starvation on two channels', 'Carriage skipping — belt worn', 'Board not powering up after voltage surge', 'Capping station not sealing', 'Encoder errors E-302 during printing', 'Customer reports banding; diagnosed head driver fault']),
        status,
        machineId: t.machineId ?? null,
        customerId: t.customerId ?? null,
        divisionId: t.divisionId ?? (engineer.divisionIds as string[])[0],
        unitPrice: part.price,
        stockWarning: qty > Number(part.stockMain),
        basis,
        defectiveReturn: 'not_required',
      };
      if (status === 'rejected') r.rejectReason = rnd.pick(['Swap from the demo machine instead', 'Duplicate of an earlier requisition', 'Fault resolved by cleaning — part not needed']);
      if (['issued', 'received', 'consumed', 'returned'].includes(status)) {
        Object.assign(r, { issuedQty, courier: rnd.pick(COURIERS), docketNo: `${rnd.pick(['BD', 'DT', 'DL', 'PC'])}${rnd.int(10000000, 99999999)}`, issuedAt: at(Math.max(0, ageDays - 1), 15) });
      }
      if (['received', 'consumed', 'returned'].includes(status)) r.receivedAt = at(Math.max(0, ageDays - 2), 10);
      if (status === 'consumed') {
        const pending = part.returnable && rnd.chance(0.35);
        Object.assign(r, { consumedQty: issuedQty, consumedAt: at(Math.max(0, ageDays - 3), 17), defectiveReturn: part.returnable ? (pending ? 'pending' : 'received') : 'not_required', defectiveReceivedAt: part.returnable && !pending ? at(Math.max(0, ageDays - 5), 12) : null });
      }
      if (status === 'returned') Object.assign(r, { returnReason: rnd.pick(['Fault was in the cable, not the board', 'Customer postponed the repair', 'Wrong variant dispatched']), returnedAt: at(Math.max(0, ageDays - 3), 16) });
      requisitions.push(r);
    });

    // OEM warranty claims for consumed warranty parts with a returned defective part.
    requisitions
      .filter((r) => r.status === 'consumed' && r.basis === 'warranty' && r.defectiveReturn === 'received')
      .slice(0, 12)
      .forEach((r, i) => {
        const part = parts.find((p) => p.id === r.partId)!;
        const status = ['raised', 'raised', 'accepted', 'credited', 'rejected'][i % 5];
        claims.push({
          ...ctx.base(rnd.int(3, 60)),
          id: ctx.nextId('warrantyClaims', 'WC'),
          partId: part.id,
          requisitionId: r.id,
          oem: part.oem,
          claimNo: status === 'raised' && i % 2 ? '' : `${String(part.oem).slice(0, 3).toUpperCase()}-${rnd.int(100000, 999999)}`,
          raisedOn: toDateKey(new Date(String(r.consumedAt))),
          qty: r.consumedQty,
          amount: Number(part.price) * Number(r.consumedQty),
          status,
          creditNoteNo: status === 'credited' ? `CN/${rnd.int(1000, 9999)}` : '',
          notes: String(r.reason),
        });
      });
  }
  ctx.records.requisitions = requisitions;
  ctx.records.warrantyClaims = claims;

  // ---------------------------------------------------------------- rate contracts (~30) and samples (~25)
  const customers = (ctx.records.customers ?? []).filter((c) => c.status !== 'inactive');
  const products = (ctx.records.products ?? []).filter((p) => ['ink', 'paper', 'fabric'].includes(String(p.productType)) && p.status !== 'inactive');
  const priceOf = (productId: string) => Number((ctx.records.priceListItems ?? []).find((i) => i.productId === productId)?.listPrice ?? 0);
  const contracts: RecordData[] = [];
  const samples: RecordData[] = [];
  if (customers.length && products.length) {
    const used = new Set<string>();
    for (let i = 0; i < 30 && contracts.length < 30; i++) {
      const c = rnd.pick(customers);
      const divs = (c.divisionIds as string[]) ?? [];
      const match = products.filter((p) => divs.includes(String(p.divisionId)));
      const p = rnd.pick(match.length ? match : products);
      const key = `${c.id}|${p.id}`;
      if (used.has(key)) continue;
      used.add(key);
      const phase = i % 6; // 0-3 valid, 4 expired, 5 upcoming
      const from = phase === 4 ? addDays(today, -rnd.int(400, 500)) : phase === 5 ? addDays(today, rnd.int(5, 25)) : addDays(today, -rnd.int(20, 300));
      const to = phase === 4 ? addDays(today, -rnd.int(20, 60)) : addDays(from, rnd.int(180, 365));
      const list = priceOf(p.id) || rnd.int(800, 6000);
      contracts.push({
        ...ctx.base(rnd.int(10, 300)),
        id: ctx.nextId('rateContracts', 'RC'),
        customerId: c.id,
        productId: p.id,
        rate: Math.round(list * (0.82 + rnd.next() * 0.13)),
        validFrom: from,
        validTo: to < from ? addDays(from, 180) : to,
        minQty: rnd.pick([0, 10, 20, 50, 100]),
        divisionId: p.divisionId,
        ownerId: c.ownerId,
        status: rnd.chance(0.07) ? 'inactive' : 'active',
        notes: '',
      });
    }

    const statuses = ['requested', 'dispatched', 'dispatched', 'trial', 'trial', 'results', 'results', 'results', 'cancelled'];
    for (let i = 0; i < 25; i++) {
      const c = rnd.pick(customers);
      const p = rnd.pick(products);
      const status = statuses[i % statuses.length];
      const dispatched = status === 'requested' || status === 'cancelled' ? null : addDays(today, -rnd.int(5, 70));
      const result = status === 'results' ? rnd.pick(['positive', 'positive', 'adjust', 'negative']) : null;
      samples.push({
        ...ctx.base(rnd.int(2, 80)),
        id: ctx.nextId('sampleDispatches', 'SD'),
        customerId: c.id,
        productId: p.id,
        qty: p.productType === 'ink' ? rnd.pick([1, 2, 5]) : p.productType === 'paper' ? rnd.pick([1, 2]) : rnd.pick([5, 10, 25]),
        uom: p.productType === 'ink' ? 'L' : p.productType === 'paper' ? 'roll' : 'm',
        status,
        dispatchedOn: dispatched,
        courier: dispatched ? `${rnd.pick(COURIERS)} ${rnd.int(1000000, 9999999)}` : '',
        trialDate: status === 'trial' || status === 'results' ? addDays(dispatched ?? today, rnd.int(3, 10)) : null,
        trialResult: result,
        feedback: result === 'positive' ? 'Colour density and wash fastness matched their current supplier.' : result === 'adjust' ? 'Good colours; needs a revised ICC profile for their polyester.' : result === 'negative' ? 'Ghosting on heavy fabrics — trial not accepted.' : '',
        followUpOn: status === 'trial' ? addDays(today, rnd.int(1, 10)) : null,
        divisionId: p.divisionId,
        ownerId: c.ownerId,
      });
    }
  }
  ctx.records.rateContracts = contracts;
  ctx.records.sampleDispatches = samples;
}
