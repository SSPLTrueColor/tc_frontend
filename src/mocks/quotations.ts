/**
 * Quotations demo data: per-division terms templates and ~70 quotations (incl. revisions) for the
 * seeded opportunities — drafts (some with discounts that need approval), approved, sent, under
 * negotiation, accepted with a customer PO, rejected and expired. Prices come from the seeded
 * price lists, so totals match what the editor would calculate.
 */
import { addDays, parseLocal } from '../lib/dates';
import { fyLabel } from '../lib/fy';
import type { RecordData } from '../metadata/types';
import type { QuoteLine } from '../services/quotations/pricing';
import { computeTotals } from '../services/quotations/pricing';
import type { SeedContext } from './context';

// Default policy values (policies are not readable while the store seeds): company GST state, validity days.
const COMPANY_STATE = '27';
const VALIDITY_DAYS = 30;

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 4;

// Default discount bands (BR-17), mirrored because policies are not readable while seeding.
const L1 = { capability: 'approve.l1', label: 'Sales manager' };
const L2 = { capability: 'approve.l2', label: 'Division head' };
const L3 = { capability: 'approve.l3', label: 'Management (MD)' };
const levelsFor = (pct: number) => (pct <= 5 ? [] : pct <= 10 ? [L1] : pct <= 15 ? [L1, L2] : [L1, L2, L3]);

const DIV_NAME: Record<string, string> = { TX: 'Textile', INK: 'Ink', POD: 'Commercial – POD', LBL: 'Commercial – Label', PPR: 'Paper', FAB: 'Fabric' };
const MACHINE_DIVS = ['TX', 'POD', 'LBL', 'FAB'];
const LINE_TYPE: Record<string, string> = { machine: 'machine', ink: 'ink', paper: 'consumable', fabric: 'consumable', spares: 'spares_kit', service: 'installation', software: 'software' };

function terms(div: string) {
  const machine = MACHINE_DIVS.includes(div);
  return machine
    ? {
        paymentTerms: '30% advance with purchase order, 60% against proforma before dispatch, 10% within 15 days of installation.',
        deliveryTerms: '8–10 weeks from receipt of advance and technically clear order (ex-works Bhiwandi).',
        warrantyTerms: '12 months from installation or 13 months from dispatch, whichever is earlier. Print heads covered for 6 months against manufacturing defects.',
        installationTerms: 'Installation, commissioning and 3 days of operator training included. Site readiness (power, earthing, UPS, AC) by the customer as per checklist.',
      }
    : {
        paymentTerms: '100% within 30 days of invoice for credit-approved customers; otherwise advance.',
        deliveryTerms: 'Dispatch within 3 working days from stock; freight extra at actuals.',
        warrantyTerms: 'Material replaced if found defective within the shelf life when stored as per guidelines.',
        installationTerms: '',
      };
}

export function seed(ctx: SeedContext): void {
  const { rnd, today } = ctx;
  const R = ctx.records;
  R.termsTemplates ??= [];
  R.quotations ??= [];

  // ---- 1. Terms templates: one default per division, plus an export variant for Textile.
  const tplByDiv = new Map<string, RecordData>();
  Object.keys(DIV_NAME).forEach((div) => {
    const t: RecordData = { ...ctx.base(300), id: ctx.nextId('termsTemplates', 'TT'), name: `${DIV_NAME[div]} — standard terms`, divisionId: div, isDefault: true, status: 'active', ...terms(div) };
    R.termsTemplates.push(t);
    tplByDiv.set(div, t);
  });
  R.termsTemplates.push({ ...ctx.base(200), id: ctx.nextId('termsTemplates', 'TT'), name: 'Textile — key account (extended credit)', divisionId: 'TX', isDefault: false, status: 'active', ...terms('TX'), paymentTerms: '20% advance, 70% before dispatch, 10% after 30 days of installation (key accounts only).' });

  const opps = (R.opportunities ?? []).filter((o) => ['proposal', 'negotiation', 'won', 'lost'].includes(String(o.stage)));
  const products = (R.products ?? []).filter((p) => p.status !== 'inactive');
  if (!opps.length || !products.length) return;

  // Current price-list item per product (active list covering today).
  const lists = new Map((R.priceLists ?? []).filter((l) => l.status === 'active' && String(l.validFrom) <= today && String(l.validTo) >= today).map((l) => [l.id, l]));
  const price = new Map<string, { listPrice: number; landedCost: number }>();
  (R.priceListItems ?? []).forEach((i) => {
    if (lists.has(String(i.priceListId))) price.set(String(i.productId), { listPrice: Number(i.listPrice), landedCost: Number(i.landedCost) });
  });
  const priced = products.filter((p) => price.has(p.id));
  const ofDiv = (div: string, type?: string) => priced.filter((p) => p.divisionId === div && (!type || p.productType === type));

  const line = (p: RecordData, qty: number, discountPct = 0): QuoteLine => {
    const pr = price.get(p.id)!;
    return {
      productId: p.id,
      description: `${p.name}${p.model ? ` — ${p.model}` : ''}`,
      lineType: LINE_TYPE[String(p.productType)] ?? 'accessory',
      qty,
      listPrice: pr.listPrice,
      discountPct,
      discountAmt: 0,
      hsnSac: String(p.hsnSac),
      gstRate: Number(p.gstRate),
      landedCost: pr.landedCost,
      priceLocked: true,
    };
  };

  const buildLines = (o: RecordData, discount: number): QuoteLine[] => {
    const div = String(o.divisionId);
    const lines: QuoteLine[] = [];
    const isMachine = MACHINE_DIVS.includes(div) && (o.oppType === 'new_machine' || o.oppType === 'upgrade' || o.productType === 'machine');
    if (isMachine) {
      const main = priced.find((p) => p.id === o.productId && p.productType === 'machine') ?? rnd.pick(ofDiv(div, 'machine').length ? ofDiv(div, 'machine') : priced.filter((p) => p.productType === 'machine'));
      if (main) lines.push(line(main, 1, discount));
      const rip = priced.find((p) => p.productType === 'software' && (p.divisionId === div || p.divisionId === 'TX'));
      if (rip && rnd.chance(0.7)) lines.push(line(rip, 1, Math.min(discount, 5)));
      const svc = priced.filter((p) => p.productType === 'service');
      if (svc.length) lines.push(line(rnd.pick(svc), 1));
      const consumable = priced.filter((p) => ['ink', 'paper'].includes(String(p.productType)));
      if (consumable.length && rnd.chance(0.6)) lines.push(line(rnd.pick(consumable), rnd.int(4, 12), 3));
    } else {
      // Consumable quotations only: machines, software and services never get bulk quantities.
      const consumables = (rows: RecordData[]) => rows.filter((p) => !['machine', 'software', 'service'].includes(String(p.productType)));
      const pool = consumables(ofDiv(div)).length ? consumables(ofDiv(div)) : priced.filter((p) => ['ink', 'paper', 'fabric'].includes(String(p.productType)));
      const n = Math.min(pool.length, rnd.int(1, 3));
      const picked = new Set<string>();
      for (let k = 0; k < n; k++) {
        const p = rnd.pick(pool);
        if (picked.has(p.id)) continue;
        picked.add(p.id);
        lines.push(line(p, rnd.int(10, 120), discount));
      }
    }
    return lines.length ? lines : [line(priced[0], 1, discount)];
  };

  const customers = new Map((R.customers ?? []).map((c) => [c.id, c]));
  const contacts = new Map((R.contacts ?? []).map((c) => [c.id, c]));

  const make = (o: RecordData, opts: { quoteDate: string; status: string; revision: number; root?: RecordData; isLatest: boolean; discount: number; note?: string; lines?: QuoteLine[] }): RecordData => {
    const div = String(o.divisionId);
    const customer = customers.get(String(o.customerId));
    const pos = String(customer?.billingState ?? COMPANY_STATE);
    const lines = opts.lines ?? buildLines(o, opts.discount);
    const freight = MACHINE_DIVS.includes(div) ? rnd.pick([0, 25000, 40000]) : rnd.pick([0, 0, 2500]);
    const insurance = MACHINE_DIVS.includes(div) && freight ? Math.round(lines[0].listPrice * 0.002) : 0;
    const t = computeTotals(lines, pos, freight, insurance, COMPANY_STATE);
    const at = parseLocal(opts.quoteDate);
    let quoteNo: string;
    if (opts.root) quoteNo = `${String(opts.root.quoteNo).replace(/-R\d+$/, '')}-R${opts.revision}`;
    else {
      const key = `quoteNo:${div}:${fyLabel(at)}`;
      ctx.counters[key] = (ctx.counters[key] ?? 0) + 1;
      quoteNo = `QT/${div}/${fyLabel(at)}/${String(ctx.counters[key]).padStart(4, '0')}`;
    }
    const tpl = tplByDiv.get(div);
    const daysAgo = Math.max(0, Math.round((ctx.now.getTime() - at.getTime()) / 86_400_000));
    const contact = contacts.get(String(o.contactId));
    const q: RecordData = {
      ...ctx.base(daysAgo, ctx.users.find((u) => u.staffIds.tc === o.ownerId)?.id ?? 'system'),
      id: ctx.nextId('quotations', 'QT', 'fy', at),
      quoteNo,
      opportunityId: o.id,
      customerId: o.customerId,
      contactId: o.contactId ?? null,
      divisionId: div,
      ownerId: o.ownerId,
      quoteDate: opts.quoteDate,
      validUntil: addDays(opts.quoteDate, VALIDITY_DAYS),
      placeOfSupply: pos,
      status: opts.status,
      revision: opts.revision,
      isLatest: opts.isLatest,
      rootId: opts.root ? String(opts.root.rootId || opts.root.id) : '',
      revisionNote: opts.note ?? '',
      lines,
      subtotal: t.subtotal,
      discountTotal: t.discountTotal,
      freight: t.freight,
      insurance: t.insurance,
      taxable: t.taxable,
      cgst: t.cgst,
      sgst: t.sgst,
      igst: t.igst,
      grandTotal: t.grandTotal,
      amountInWords: t.amountInWords,
      maxDiscountPct: t.maxDiscountPct,
      landedCostTotal: t.landedCostTotal,
      marginPct: t.marginPct,
      termsTemplateId: tpl?.id ?? null,
      paymentTerms: tpl?.paymentTerms ?? '',
      deliveryTerms: tpl?.deliveryTerms ?? '',
      warrantyTerms: tpl?.warrantyTerms ?? '',
      installationTerms: tpl?.installationTerms ?? '',
      roiOutputPerDay: MACHINE_DIVS.includes(div) ? rnd.pick([400, 600, 900]) : null,
      roiPricePerUnit: MACHINE_DIVS.includes(div) ? rnd.pick([95, 120, 160]) : null,
      roiCostPerUnit: MACHINE_DIVS.includes(div) ? rnd.pick([38, 45, 60]) : null,
      roiWorkingDays: MACHINE_DIVS.includes(div) ? 25 : null,
    };
    if (!['draft', 'approved'].includes(opts.status)) {
      q.sentAt = new Date(at.getTime() + 2 * 86_400_000 + 11 * 3_600_000).toISOString();
      q.sentVia = contact?.email && contact.consentEmail !== false ? `Email · ${contact.email}` : `WhatsApp · ${contact?.mobile ?? customer?.phone ?? '98200 00000'}`;
    }
    R.quotations.push(q);
    return q;
  };

  const ago = (days: number) => addDays(today, -days);
  let pendingSeeded = 0;
  opps.forEach((o, i) => {
    const stage = String(o.stage);
    const machine = MACHINE_DIVS.includes(String(o.divisionId));
    const disc = machine ? rnd.pick([0, 3, 5, 7, 9, 12, 14]) : rnd.pick([0, 2, 4, 6]);
    if (stage === 'proposal') {
      const roll = i % 4;
      if (roll === 0) {
        const q = make(o, { quoteDate: ago(rnd.int(0, 6)), status: 'draft', revision: 0, isLatest: true, discount: machine ? rnd.pick([8, 12, 16]) : 8 });
        const levels = levelsFor(Number(q.maxDiscountPct));
        // Every other high-discount draft is already waiting for approval (QUO-06 demo data).
        if (levels.length && pendingSeeded++ % 2 === 0) {
          q.status = 'pending_approval';
          ctx.counters.approvals = (ctx.counters.approvals ?? 1000) + 1;
          const owner = ctx.users.find((u) => u.staffIds.tc === o.ownerId);
          const requestedAt = new Date(ctx.now.getTime() - rnd.int(2, 40) * 3_600_000).toISOString();
          ctx.approvals.push({
            id: `APR-${ctx.counters.approvals}`,
            type: 'quotation.discount',
            workspaceId: 'tc',
            resource: 'quotations',
            recordId: q.id,
            requestedBy: owner?.id ?? 'u_rahul',
            requestedAt,
            reason: rnd.pick(['Competitor offer from local importer', 'Repeat customer — second machine', 'Exhibition special pricing agreed by the GM', 'Price match against Epson quote']),
            summary: `Discount ${q.maxDiscountPct}% on ${q.quoteNo}`,
            amount: Number(q.grandTotal),
            divisionIds: [String(o.divisionId)],
            levels,
            currentLevel: 0,
            decisions: [],
            status: 'pending',
            version: 1,
          });
        }
      }
      else if (roll === 1) make(o, { quoteDate: ago(rnd.int(2, 10)), status: 'approved', revision: 0, isLatest: true, discount: Math.min(disc, 5) });
      else if (roll === 2) make(o, { quoteDate: ago(rnd.int(3, 25)), status: 'sent', revision: 0, isLatest: true, discount: disc });
      else make(o, { quoteDate: ago(rnd.int(35, 60)), status: 'expired', revision: 0, isLatest: true, discount: disc });
    } else if (stage === 'negotiation') {
      const r0 = make(o, { quoteDate: ago(rnd.int(28, 45)), status: 'superseded', revision: 0, isLatest: false, discount: Math.min(disc, 5) });
      const lines = (r0.lines as QuoteLine[]).map((l, k) => (k === 0 ? { ...l, discountPct: Math.max(l.discountPct, disc) } : l));
      make(o, { quoteDate: ago(rnd.int(1, 20)), status: rnd.chance(0.5) ? 'negotiation' : 'sent', revision: 1, root: r0, isLatest: true, discount: disc, note: 'Revised discount on the machine after the customer’s counter-offer', lines });
    } else if (stage === 'won') {
      const wonDay = o.wonAt ? Math.max(1, Math.round((ctx.now.getTime() - new Date(String(o.wonAt)).getTime()) / 86_400_000)) : rnd.int(5, 60);
      let root: RecordData | undefined;
      if (rnd.chance(0.35)) root = make(o, { quoteDate: ago(wonDay + rnd.int(18, 30)), status: 'superseded', revision: 0, isLatest: false, discount: Math.min(disc, 5) });
      const q = make(o, { quoteDate: ago(wonDay + rnd.int(4, 12)), status: 'accepted', revision: root ? 1 : 0, root, isLatest: true, discount: disc, note: root ? 'Final price agreed with the customer' : '' });
      const n = 4500 + i * 37;
      Object.assign(q, { acceptanceMethod: 'po', acceptedAt: o.wonAt ?? new Date(ctx.now.getTime() - wonDay * 86_400_000).toISOString(), customerPoNo: `PO/${String(customers.get(String(o.customerId))?.name ?? 'CUS').slice(0, 3).toUpperCase()}/${n}`, customerPoDate: ago(wonDay), poFileName: `PO-${n}.pdf` });
    } else if (stage === 'lost') {
      if (rnd.chance(0.6)) {
        const q = make(o, { quoteDate: ago(rnd.int(30, 90)), status: 'rejected', revision: 0, isLatest: true, discount: disc });
        q.rejectReason = o.lostReason ?? 'price';
        q.rejectNote = o.lostToCompetitor ? `Lost to ${o.lostToCompetitor}` : '';
      } else make(o, { quoteDate: ago(rnd.int(45, 100)), status: 'expired', revision: 0, isLatest: true, discount: disc });
    }
  });
}
