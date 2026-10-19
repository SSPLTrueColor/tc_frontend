/**
 * Catalog demo data: ~40 products across all six divisions, one active price list per division for
 * the current financial year (plus an expired previous list for Textile) and notification templates.
 * Prices are fictional but realistic in ₹.
 */
import { addDays } from '../lib/dates';
import type { RecordData } from '../metadata/types';
import type { SeedContext } from './context';

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 2;

type P = [sku: string, name: string, division: string, type: string, subType: string | null, hsnSac: string, gst: number, price: number, extra?: Partial<Record<string, unknown>>];

const PRODUCTS: P[] = [
  // Textile machines + software + services
  ['TX-SUB-1900', 'ChromaJet S19 Sublimation Printer', 'TX', 'machine', 'textile', '84433290', 18, 2850000, { model: 'S19', printWidth: '1.9 m', printHeads: '4 × Epson i3200', warrantyMonths: 12, uom: 'nos' }],
  ['TX-SUB-3200', 'ChromaJet S32 High-speed Sublimation Printer', 'TX', 'machine', 'textile', '84433290', 18, 6450000, { model: 'S32', printWidth: '3.2 m', printHeads: '8 × Kyocera KJ4B', warrantyMonths: 12, uom: 'nos' }],
  ['TX-DTF-1800', 'FabriJet D18 Direct-to-Fabric Printer', 'TX', 'machine', 'textile', '84433290', 18, 4975000, { model: 'D18', printWidth: '1.8 m', printHeads: '6 × Ricoh Gen6', warrantyMonths: 12, uom: 'nos' }],
  ['TX-DTF-3400', 'FabriJet D34 Industrial Pigment Printer', 'TX', 'machine', 'textile', '84433290', 18, 12500000, { model: 'D34', printWidth: '3.4 m', printHeads: '16 × Kyocera KJ4B', warrantyMonths: 18, uom: 'nos' }],
  ['TX-CAL-1800', 'ThermoPress C18 Rotary Calender', 'TX', 'machine', 'textile', '84512900', 18, 1650000, { model: 'C18', printWidth: '1.8 m', warrantyMonths: 12, uom: 'nos' }],
  ['TX-RIP-PRO', 'ColorRIP Pro Textile Licence', 'TX', 'software', null, '997331', 18, 185000, { uom: 'licence' }],
  ['TX-INS-STD', 'Installation & commissioning – textile printer', 'TX', 'service', null, '998713', 18, 75000, { uom: 'visit' }],
  ['TX-TRN-OPR', 'Operator training (3 days)', 'TX', 'service', null, '999293', 18, 45000, { uom: 'visit' }],
  ['TX-AMC-STD', 'AMC – textile printer (labour, 4 PM visits)', 'TX', 'service', null, '998719', 18, 240000, { uom: 'year' }],
  ['TX-CMC-STD', 'CMC – textile printer (parts + labour)', 'TX', 'service', null, '998719', 18, 520000, { uom: 'year' }],
  ['TX-EXW-1Y', 'Extended warranty – 1 year', 'TX', 'service', null, '998719', 18, 195000, { uom: 'year' }],
  ['TX-SPK-I32', 'Spare-parts kit – i3200 head printer', 'TX', 'spares', 'textile', '84439959', 18, 165000, { uom: 'nos' }],
  // Ink
  ['INK-SUB-CMYK-1L', 'TrueSub Sublimation Ink CMYK (1 L)', 'INK', 'ink', null, '32151990', 18, 2450, { uom: 'litre' }],
  ['INK-SUB-FLU-1L', 'TrueSub Fluorescent Ink (1 L)', 'INK', 'ink', null, '32151990', 18, 3650, { uom: 'litre' }],
  ['INK-PIG-CMYK-1L', 'PigmentPro Textile Pigment Ink (1 L)', 'INK', 'ink', null, '32151990', 18, 3950, { uom: 'litre' }],
  ['INK-REA-CMYK-1L', 'ReactiveFlow Reactive Ink (1 L)', 'INK', 'ink', null, '32151990', 18, 4200, { uom: 'litre' }],
  ['INK-DIS-CMYK-1L', 'DisperseDirect Disperse Ink (1 L)', 'INK', 'ink', null, '32151990', 18, 4600, { uom: 'litre' }],
  ['INK-UV-LBL-1L', 'UV LED Label Ink (1 L)', 'INK', 'ink', null, '32151190', 18, 8900, { uom: 'litre' }],
  ['INK-CLN-5L', 'Head cleaning solution (5 L)', 'INK', 'ink', null, '38140010', 18, 3200, { uom: 'nos' }],
  // Commercial – POD
  ['POD-PB-500', 'PhotoBook P500 Print-on-demand Press', 'POD', 'machine', 'pod', '84433910', 18, 3850000, { model: 'P500', printWidth: 'A3+', printHeads: 'Laser, 4-colour', warrantyMonths: 12, uom: 'nos' }],
  ['POD-DT-330', 'DigiTee DTG 330 Garment Printer', 'POD', 'machine', 'pod', '84433290', 18, 1450000, { model: 'DTG 330', printWidth: '33 × 45 cm', printHeads: '2 × Epson i1600', warrantyMonths: 12, uom: 'nos' }],
  ['POD-INS-STD', 'Installation & training – POD press', 'POD', 'service', null, '998713', 18, 55000, { uom: 'visit' }],
  ['POD-AMC-STD', 'AMC – POD press', 'POD', 'service', null, '998719', 18, 180000, { uom: 'year' }],
  ['POD-SPK-STD', 'Spare-parts kit – POD press', 'POD', 'spares', 'pod', '84439959', 18, 85000, { uom: 'nos' }],
  // Commercial – Label
  ['LBL-NW-330', 'LabelJet N330 Narrow-web UV Press', 'LBL', 'machine', 'label', '84433290', 18, 7850000, { model: 'N330', printWidth: '330 mm', printHeads: '5 × Konica 1024i', warrantyMonths: 12, uom: 'nos' }],
  ['LBL-DF-350', 'DieFin 350 Digital Finishing Unit', 'LBL', 'machine', 'label', '84418000', 18, 3250000, { model: 'DF350', printWidth: '350 mm', warrantyMonths: 12, uom: 'nos' }],
  ['LBL-RIP-PRO', 'LabelRIP Workflow Licence', 'LBL', 'software', null, '997331', 18, 245000, { uom: 'licence' }],
  ['LBL-INS-STD', 'Installation & commissioning – label press', 'LBL', 'service', null, '998713', 18, 95000, { uom: 'visit' }],
  ['LBL-AMC-STD', 'AMC – label press', 'LBL', 'service', null, '998719', 18, 360000, { uom: 'year' }],
  // Paper
  ['PPR-SUB-90-1600', 'Sublimation paper 90 gsm, 1.6 m × 100 m', 'PPR', 'paper', null, '48025690', 12, 3150, { uom: 'roll' }],
  ['PPR-SUB-60-1900', 'Sublimation paper 60 gsm, 1.9 m × 200 m', 'PPR', 'paper', null, '48025690', 12, 4850, { uom: 'roll' }],
  ['PPR-TAC-100-1600', 'Tacky sublimation paper 100 gsm, 1.6 m', 'PPR', 'paper', null, '48025690', 12, 5600, { uom: 'roll' }],
  ['PPR-PHO-A3-260', 'Photo paper A3+ 260 gsm (100 sheets)', 'PPR', 'paper', null, '48101900', 12, 2750, { uom: 'ream' }],
  ['PPR-PRO-1100', 'Protection paper 30 gsm, 1.1 m', 'PPR', 'paper', null, '48025690', 12, 1950, { uom: 'roll' }],
  // Fabric
  ['FAB-POLY-SAT-58', 'Polyester satin 58" – print-ready', 'FAB', 'fabric', null, '54076190', 5, 115, { uom: 'metre' }],
  ['FAB-COT-CAM-44', 'Cotton cambric 44" – PFP', 'FAB', 'fabric', null, '52083990', 5, 95, { uom: 'metre' }],
  ['FAB-RAY-CRE-58', 'Rayon crepe 58" – PFP', 'FAB', 'fabric', null, '55161400', 5, 145, { uom: 'metre' }],
  ['FAB-LYC-JER-60', 'Poly-lycra jersey 60" (sportswear)', 'FAB', 'fabric', null, '60063200', 5, 210, { uom: 'metre' }],
  ['FAB-PRT-SVC', 'Fabric printing & processing (per metre)', 'FAB', 'service', null, '998821', 5, 65, { uom: 'metre' }],
];

/** Landed cost as a share of list price, by product type (fictional). */
const COST_SHARE: Record<string, number> = { machine: 0.74, software: 0.45, service: 0.5, spares: 0.62, ink: 0.58, paper: 0.7, fabric: 0.78 };

const TEMPLATES: [name: string, event: string, channel: string, subject: string | null, body: string][] = [
  ['Lead assigned (in-app)', 'lead_assigned', 'in_app', null, 'New lead {{record}} from {{customer}} has been assigned to you. First contact due within 24 hours.'],
  ['Follow-up reminder (WhatsApp)', 'followup_due', 'whatsapp', null, 'Reminder: follow up with {{contact}} ({{customer}}) today for {{record}}.'],
  ['Lead not attended – manager', 'lead_not_attended', 'email', 'Lead {{record}} not attended within SLA', 'Dear {{owner}}, lead {{record}} from {{customer}} has had no contact within the first-response SLA. Please review: {{link}}'],
  ['Approval requested', 'approval_requested', 'email', 'Approval needed: {{record}}', 'Dear approver, {{owner}} has requested your approval for {{record}} ({{amount}}). Approve or reject here: {{link}}'],
  ['Approval decided', 'approval_decided', 'in_app', null, 'Your request for {{record}} has been decided. Open the record for details.'],
  ['Quotation sent (email)', 'quotation_sent', 'email', 'Quotation {{record}} from True Colors Limited', 'Dear {{contact}}, please find attached our quotation {{record}} dated {{date}} for {{amount}}. We look forward to your valued order.'],
  ['Quotation sent (WhatsApp)', 'quotation_sent', 'whatsapp', null, 'Dear {{contact}}, our quotation {{record}} for {{amount}} is ready: {{link}} – True Colors Limited'],
  ['Payment due reminder', 'payment_due', 'email', 'Payment reminder for order {{record}}', 'Dear {{contact}}, a payment of {{amount}} against order {{record}} is due on {{date}}. Kindly arrange the transfer.'],
  ['Dispatch intimation', 'dispatch_intimation', 'whatsapp', null, 'Dear {{contact}}, your order {{record}} has been dispatched on {{date}}. Track LR details here: {{link}}'],
  ['Installation scheduled', 'installation_scheduled', 'sms', null, 'True Colors: installation for order {{record}} is scheduled on {{date}}. Engineer: {{owner}}.'],
  ['Service ticket logged', 'ticket_logged', 'whatsapp', null, 'Dear {{contact}}, your service ticket {{record}} is logged. Our engineer will contact you shortly.'],
  ['SLA breach escalation', 'sla_breach', 'email', 'SLA breached on service ticket {{record}}', 'Service ticket {{record}} for {{customer}} has breached its SLA. Escalated to {{owner}}. {{link}}'],
  ['Feedback request', 'feedback_request', 'whatsapp', null, 'Dear {{contact}}, service ticket {{record}} is resolved. Please rate our service (1–5): {{link}}'],
  ['AMC renewal reminder', 'renewal_reminder', 'email', 'Your AMC {{record}} expires on {{date}}', 'Dear {{contact}}, your maintenance contract {{record}} expires on {{date}}. Renew now to keep priority service.'],
];

export function seed(ctx: SeedContext): void {
  const { today } = ctx;
  const products: RecordData[] = PRODUCTS.map(([sku, name, division, type, sub, hsnSac, gst, , extra]) => ({
    ...ctx.base(400),
    id: ctx.nextId('products', 'PRD'),
    name,
    sku,
    divisionId: division,
    productType: type,
    subType: sub,
    hsnSac,
    gstRate: gst,
    uom: 'nos',
    status: 'active',
    specs: '',
    ...extra,
  }));
  // One retired product so the Active filter matters.
  products.push({ ...ctx.base(700), id: ctx.nextId('products', 'PRD'), name: 'ChromaJet S16 Sublimation Printer (discontinued)', sku: 'TX-SUB-1600', divisionId: 'TX', productType: 'machine', subType: 'textile', hsnSac: '84433290', gstRate: 18, uom: 'nos', model: 'S16', printWidth: '1.6 m', printHeads: '2 × Epson DX5', warrantyMonths: 12, status: 'inactive', specs: '' });
  ctx.records.products = products;

  // Current FY window (April → March) relative to the seed date.
  const y = ctx.now.getMonth() >= 3 ? ctx.now.getFullYear() : ctx.now.getFullYear() - 1;
  const fyStart = `${y}-04-01`;
  const fyEnd = `${y + 1}-03-31`;
  const DIV_NAMES: Record<string, string> = { TX: 'Textile', INK: 'Ink', POD: 'Commercial – POD', LBL: 'Commercial – Label', PPR: 'Paper', FAB: 'Fabric' };
  const lists: RecordData[] = [];
  const items: RecordData[] = [];
  const priceOf = new Map(PRODUCTS.map((p) => [p[0], p[7]]));
  for (const div of Object.keys(DIV_NAMES)) {
    const list: RecordData = { ...ctx.base(200), id: ctx.nextId('priceLists', 'PL'), name: `${DIV_NAMES[div]} Price List ${y}-${String(y + 1).slice(2)}`, divisionId: div, validFrom: fyStart, validTo: fyEnd, status: 'active', notes: '' };
    lists.push(list);
    for (const prod of products.filter((p) => p.divisionId === div && p.status === 'active')) {
      const listPrice = priceOf.get(String(prod.sku)) ?? 0;
      const share = COST_SHARE[String(prod.productType)] ?? 0.65;
      items.push({ ...ctx.base(200), id: ctx.nextId('priceListItems', 'PLI'), priceListId: list.id, productId: prod.id, listPrice, landedCost: Math.round(listPrice * share), divisionId: div });
    }
  }
  // Previous year's Textile list (expired) with lower prices, for history.
  const prev: RecordData = { ...ctx.base(560), id: ctx.nextId('priceLists', 'PL'), name: `Textile Price List ${y - 1}-${String(y).slice(2)}`, divisionId: 'TX', validFrom: `${y - 1}-04-01`, validTo: `${y}-03-31`, status: 'expired', notes: 'Replaced by the current year price list.' };
  lists.push(prev);
  products
    .filter((p) => p.divisionId === 'TX' && p.productType === 'machine')
    .forEach((prod) => {
      const listPrice = Math.round((priceOf.get(String(prod.sku)) ?? 2_000_000) * 0.94);
      items.push({ ...ctx.base(560), id: ctx.nextId('priceListItems', 'PLI'), priceListId: prev.id, productId: prod.id, listPrice, landedCost: Math.round(listPrice * 0.74), divisionId: 'TX' });
    });
  // A draft list for next quarter's Ink price update (not yet active).
  lists.push({ ...ctx.base(5), id: ctx.nextId('priceLists', 'PL'), name: 'Ink Price Update (Draft)', divisionId: 'INK', validFrom: addDays(today, 30), validTo: fyEnd, status: 'draft', notes: 'Proposed 4% increase — awaiting GM approval.' });
  ctx.records.priceLists = lists;
  ctx.records.priceListItems = items;

  ctx.records.notificationTemplates = TEMPLATES.map(([name, event, channel, subject, body]) => ({ ...ctx.base(300), id: ctx.nextId('notificationTemplates', 'NT'), name, event, channel, subject, body, status: 'active' }));
}
