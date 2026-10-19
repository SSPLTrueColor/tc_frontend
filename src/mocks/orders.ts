/**
 * Orders demo data: machine orders from the seeded accepted quotations, spread across every status
 * (pending approval → completed, plus holds and a cancellation), with payment milestones (some
 * overdue), dispatches (some delayed), processing details and contracts; and 6 months of repeat
 * consumables orders for ink / paper / fabric customers (reorder prediction, achievement).
 * Imports only lib/* (no services: the store seeds before services are ready).
 */
import { addDays } from '../lib/dates';
import { fyLabel } from '../lib/fy';
import type { RecordData } from '../metadata/types';
import type { SeedContext } from './context';

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 2;

/** Same default as policies.companyGstState (seeds may not import services). */
const COMPANY_GST_STATE = '27';
const CONSUMABLE_TYPES = ['ink', 'paper', 'fabric'];
const TRANSPORTERS = ['VRL Logistics', 'Gati Ltd', 'Safexpress', 'TCI Freight', 'Om Logistics', 'Delhivery Freight'];

interface Line {
  productId: string;
  description: string;
  lineType?: string;
  qty: number;
  listPrice: number;
  discountPct?: number;
  discountAmt?: number;
  hsnSac?: string;
  gstRate: number;
  landedCost?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const gross = (l: Line) => r2(l.qty * l.listPrice);
const disc = (l: Line) => r2(Number(l.discountAmt) > 0 ? Number(l.discountAmt) : (gross(l) * (Number(l.discountPct) || 0)) / 100);

function totals(lines: Line[], pos: string, freight = 0, insurance = 0) {
  let subtotal = 0;
  let discountTotal = 0;
  let tax = 0;
  let mainRate = 0;
  let mainNet = -1;
  for (const l of lines) {
    const net = gross(l) - disc(l);
    subtotal += gross(l);
    discountTotal += disc(l);
    tax += r2((net * l.gstRate) / 100);
    if (net > mainNet) {
      mainNet = net;
      mainRate = l.gstRate;
    }
  }
  tax += r2(((freight + insurance) * mainRate) / 100);
  const intra = pos === COMPANY_GST_STATE;
  const taxable = r2(subtotal - discountTotal + freight + insurance);
  const half = r2(tax / 2);
  return {
    subtotal: r2(subtotal),
    discountTotal: r2(discountTotal),
    freight,
    insurance,
    taxable,
    cgst: intra ? half : 0,
    sgst: intra ? r2(tax - half) : 0,
    igst: intra ? 0 : r2(tax),
    grandTotal: r2(taxable + tax),
    maxDiscountPct: lines.reduce((m, l) => Math.max(m, gross(l) ? r2((disc(l) / gross(l)) * 100) : 0), 0),
  };
}

/** Machine order statuses, oldest order first (spread evenly over the available quotations). */
const MACHINE_PRIORITY = ['completed', 'installation', 'delivered', 'dispatched', 'processing', 'pending_approval', 'payment_pending', 'ready_for_dispatch', 'on_hold', 'payment_received', 'confirmed'];
const FLOW_ORDER = ['completed', 'installation', 'delivered', 'dispatched', 'ready_for_dispatch', 'processing', 'on_hold', 'payment_received', 'payment_pending', 'confirmed', 'pending_approval'];
/** Consumables orders that came from a quotation. */
const QUOTE_CONSUMABLE_FLOW = ['completed', 'completed', 'delivered', 'processing', 'cancelled', 'confirmed', 'dispatched'];
const RANK: Record<string, number> = { pending_approval: 0, confirmed: 1, payment_pending: 2, payment_received: 3, processing: 4, ready_for_dispatch: 5, dispatched: 6, delivered: 7, installation: 8, completed: 9 };
/** Typical age (days since order) per status so dates stay plausible. */
const AGE: Record<string, number> = { completed: 140, installation: 95, delivered: 80, dispatched: 62, ready_for_dispatch: 52, processing: 40, payment_received: 26, payment_pending: 16, confirmed: 6, pending_approval: 2, on_hold: 30, cancelled: 45 };

export function seed(ctx: SeedContext): void {
  const { rnd, today } = ctx;
  const R = ctx.records;
  const customers = R.customers ?? [];
  if (!customers.length) return;
  const products = R.products ?? [];
  const orders: RecordData[] = (R.salesOrders ??= []);
  const milestones: RecordData[] = (R.paymentMilestones ??= []);
  const dispatches: RecordData[] = (R.dispatches ??= []);
  const contracts: RecordData[] = (R.salesContracts ??= []);
  const clamp = (d: string) => (d > today ? today : d);
  const byId = (key: string, id: unknown) => (R[key] ?? []).find((r) => r.id === id);

  const orderNo = (div: string, date: string) => {
    const fy = fyLabel(new Date(`${date}T10:00:00`));
    const k = `soNo:${div}:${fy}`;
    ctx.counters[k] = (ctx.counters[k] ?? 0) + 1;
    return `SO/${div}/${fy}/${String(ctx.counters[k]).padStart(4, '0')}`;
  };
  const contractNo = (div: string, date: string) => {
    const fy = fyLabel(new Date(`${date}T10:00:00`));
    const k = `scNo:${div}:${fy}`;
    ctx.counters[k] = (ctx.counters[k] ?? 0) + 1;
    return `SC/${div}/${fy}/${String(ctx.counters[k]).padStart(4, '0')}`;
  };
  const invoiceNo = (div: string, date: string) => {
    const fy = fyLabel(new Date(`${date}T10:00:00`));
    const k = `invoice:${div}:${fy}`;
    ctx.counters[k] = (ctx.counters[k] ?? 0) + 1;
    return `INV/${div}/${fy}/${String(ctx.counters[k]).padStart(5, '0')}`;
  };

  function addMilestones(order: RecordData, schedule: [string, number, number][], paidUpTo: number, unpaidOverdue = false) {
    let allocated = 0;
    schedule.forEach(([label, pct, dueIn], i) => {
      const amount = i === schedule.length - 1 ? r2(Number(order.grandTotal) - allocated) : r2((Number(order.grandTotal) * pct) / 100);
      allocated += amount;
      const dueDate = addDays(String(order.orderDate), dueIn);
      const paid = i < paidUpTo && !(unpaidOverdue && i === schedule.length - 1);
      milestones.push({
        ...ctx.base(0),
        createdAt: `${order.orderDate}T11:00:00.000Z`,
        updatedAt: `${order.orderDate}T11:00:00.000Z`,
        id: ctx.nextId('paymentMilestones', 'PM'),
        label,
        salesOrderId: order.id,
        customerId: order.customerId,
        ownerId: order.ownerId,
        divisionId: order.divisionId,
        percent: pct,
        amount,
        dueDate,
        receivedAmount: paid ? amount : 0,
        receivedAt: paid ? clamp(addDays(dueDate, rnd.int(-3, 6))) : null,
        status: paid ? 'received' : dueDate < today ? 'overdue' : 'due',
      });
    });
  }

  function addDispatch(order: RecordData, status: string) {
    const dispatchDate = clamp(addDays(String(order.orderDate), order.orderKind === 'machine' ? rnd.int(48, 58) : rnd.int(2, 5)));
    const delayed = status === 'dispatched' && rnd.chance(0.5);
    const expected = delayed ? addDays(today, -rnd.int(2, 6)) : addDays(dispatchDate, order.orderKind === 'machine' ? 6 : 3);
    const delivered = RANK[status] >= RANK.delivered;
    const actual = delivered ? clamp(addDays(expected, rnd.int(-1, 3))) : null;
    dispatches.push({
      ...ctx.base(0),
      createdAt: `${dispatchDate}T12:00:00.000Z`,
      updatedAt: `${actual ?? dispatchDate}T12:00:00.000Z`,
      id: ctx.nextId('dispatches', 'DSP'),
      salesOrderId: order.id,
      customerId: order.customerId,
      ownerId: order.ownerId,
      divisionId: order.divisionId,
      dispatchDate,
      transporter: rnd.pick(TRANSPORTERS),
      lrNumber: `LR${rnd.int(100000, 999999)}`,
      challanNo: `DC/${rnd.int(1000, 9999)}`,
      invoiceRef: order.invoiceNo ?? null,
      ewayBill: String(rnd.int(100000, 999999)) + String(rnd.int(100000, 999999)),
      expectedDelivery: expected < dispatchDate ? dispatchDate : expected,
      actualDelivery: actual,
      podFileName: delivered ? `POD-${order.id}.pdf` : null,
      podPhotoName: delivered && rnd.chance(0.6) ? `delivery-${order.id}.jpg` : null,
      status: delivered ? 'delivered' : 'in_transit',
    });
    if (delivered) order.deliveredAt = actual;
  }

  // ---------------------------------------------------------------- machine orders from accepted quotations
  const isMachine = (q: RecordData) => (q.lines as Line[]).some((l) => l.lineType === 'machine' || byId('products', l.productId)?.productType === 'machine');
  const accepted = (R.quotations ?? [])
    .filter((q) => q.status === 'accepted' && q.isLatest !== false && Array.isArray(q.lines) && (q.lines as Line[]).length)
    .sort((a, b) => String(a.acceptedAt ?? a.quoteDate).localeCompare(String(b.acceptedAt ?? b.quoteDate)));
  const machineQs = accepted.filter(isMachine);
  // Keep the newest accepted machine quotation without an order so "Generate sales order" can be demoed.
  if (machineQs.length >= 5) machineQs.pop();
  const otherQs = accepted.filter((q) => !isMachine(q));
  const statusOf = new Map<string, string>();
  // Few quotations → cover the most demo-worthy statuses first; oldest quotation gets the most advanced status.
  const picked = Array.from({ length: machineQs.length }, (_, i) => MACHINE_PRIORITY[i % MACHINE_PRIORITY.length]).sort((a, b) => FLOW_ORDER.indexOf(a) - FLOW_ORDER.indexOf(b));
  machineQs.forEach((q, i) => statusOf.set(q.id, picked[i]));
  otherQs.forEach((q, i) => statusOf.set(q.id, QUOTE_CONSUMABLE_FLOW[i % QUOTE_CONSUMABLE_FLOW.length]));

  [...machineQs, ...otherQs].forEach((q, i) => {
    const lines = (q.lines as Line[]).map((l) => ({ ...l }));
    const machine = isMachine(q);
    const status = statusOf.get(q.id) ?? 'confirmed';
    const acceptedOn = String(q.acceptedAt ?? q.quoteDate ?? today).slice(0, 10);
    const orderDate = clamp(addDays(today, -AGE[status]) < acceptedOn ? acceptedOn : addDays(today, -AGE[status]));
    const pos = String(q.placeOfSupply ?? byId('customers', q.customerId)?.billingState ?? COMPANY_GST_STATE);
    const t = totals(lines, pos, Number(q.freight) || 0, Number(q.insurance) || 0);
    const div = String(q.divisionId);
    const site = (R.addresses ?? []).find((a) => a.customerId === q.customerId && a.addressType === 'installation') ?? (R.addresses ?? []).find((a) => a.customerId === q.customerId);
    const machineLine = lines.find((l) => l.lineType === 'machine' || byId('products', l.productId)?.productType === 'machine') ?? lines[0];
    const rank = RANK[status] ?? (status === 'on_hold' ? 3 : 1);
    const order: RecordData = {
      ...ctx.base(0, String(q.createdBy ?? 'system')),
      createdAt: `${orderDate}T10:30:00.000Z`,
      updatedAt: `${orderDate}T10:30:00.000Z`,
      id: ctx.nextId('salesOrders', 'SO', 'fy', new Date(`${orderDate}T10:00:00`)),
      orderNo: orderNo(div, orderDate),
      customerId: q.customerId,
      orderKind: machine ? 'machine' : 'consumables',
      divisionId: div,
      ownerId: q.ownerId,
      orderDate,
      quotationId: q.id,
      opportunityId: q.opportunityId ?? null,
      repeatOfId: null,
      customerPoNo: String(q.customerPoNo ?? `PO/${rnd.int(1000, 9999)}/${orderDate.slice(2, 4)}`),
      customerPoDate: String(q.customerPoDate ?? acceptedOn) > orderDate ? orderDate : String(q.customerPoDate ?? acceptedOn),
      poFileName: String(q.poFileName ?? `PO-${q.customerId}.pdf`),
      productId: machineLine.productId,
      siteAddressId: site?.id ?? null,
      placeOfSupply: pos,
      ...t,
      changeSummary: 'Same as quotation',
      paymentTerms: q.paymentTerms ?? null,
      deliveryTerms: q.deliveryTerms ?? null,
      warrantyTerms: q.warrantyTerms ?? null,
      installationTerms: q.installationTerms ?? null,
      status,
      financeCheck: false,
      erpPushedAt: rank >= 1 && status !== 'cancelled' ? `${addDays(orderDate, 1)}T09:00:00.000Z` : null,
      invoiceNo: rank >= RANK.dispatched ? invoiceNo(div, addDays(orderDate, 50)) : null,
      invoiceDate: rank >= RANK.dispatched ? clamp(addDays(orderDate, 50)) : null,
      ewayBill: rank >= RANK.dispatched ? String(rnd.int(100000, 999999)) + String(rnd.int(100000, 999999)) : null,
      poToPrincipalNo: rank >= RANK.processing && machine ? `TCL/IMP/${orderDate.slice(2, 4)}/${rnd.int(100, 999)}` : null,
      poToPrincipalDate: rank >= RANK.processing && machine ? clamp(addDays(orderDate, 28)) : null,
      shipmentEta: rank >= RANK.processing && machine ? addDays(orderDate, rnd.int(42, 55)) : null,
      customsStatus: machine ? (rank >= RANK.ready_for_dispatch ? 'cleared' : rank >= RANK.processing ? rnd.pick(['pending', 'filed']) : 'not_applicable') : 'not_applicable',
      machineReady: rank >= RANK.ready_for_dispatch,
      pdiDone: rank >= RANK.ready_for_dispatch,
      processingNotes: rank === RANK.processing && machine ? 'Container booked; awaiting vessel arrival at Nhava Sheva.' : null,
      holdReason: status === 'on_hold' ? 'Customer requested to delay delivery until the new shed is ready.' : null,
      statusBeforeHold: status === 'on_hold' ? 'payment_received' : null,
      cancelReason: status === 'cancelled' ? 'Customer funding fell through; advance to be refunded via ERP.' : null,
      deliveredAt: null,
      completedAt: status === 'completed' ? clamp(addDays(orderDate, rnd.int(85, 110))) : null,
      lines,
    };
    orders.push(order);
    const paidUpTo = status === 'completed' ? 3 : rank >= RANK.dispatched ? 2 : rank >= RANK.payment_received || status === 'on_hold' ? 1 : 0;
    addMilestones(
      order,
      machine
        ? [
            ['Advance', 30, 7],
            ['Before dispatch', 60, 45],
            ['On installation', 10, 75],
          ]
        : [['Payment (30-day credit)', 100, 30]],
      machine ? paidUpTo : status === 'completed' ? 1 : 0,
      status === 'completed' && i % 3 === 0,
    );
    if (rank >= RANK.dispatched && status !== 'cancelled' && status !== 'on_hold') addDispatch(order, status);
    if (machine && rank >= RANK.confirmed && status !== 'cancelled') {
      contracts.push({
        ...ctx.base(0),
        createdAt: `${addDays(orderDate, 2)}T10:00:00.000Z`,
        updatedAt: `${addDays(orderDate, 4)}T10:00:00.000Z`,
        id: ctx.nextId('salesContracts', 'SC'),
        contractNo: contractNo(div, orderDate),
        salesOrderId: order.id,
        customerId: order.customerId,
        ownerId: order.ownerId,
        divisionId: div,
        version: 1,
        status: rank >= RANK.processing ? 'signed' : 'draft',
        contractValue: order.grandTotal,
        paymentTerms: order.paymentTerms ?? 'As per the payment schedule of the sales order.',
        deliveryTerms: order.deliveryTerms ?? 'Delivery within 8–10 weeks of advance receipt.',
        loadingTerms: 'Unloading, crane / hydra and positioning at site are in the customer’s scope and cost.',
        installationTerms: order.installationTerms ?? 'Installation and commissioning by True Colors engineers.',
        warrantyTerms: order.warrantyTerms ?? '12 months from installation sign-off.',
        sparesTerms: 'Spare parts supplied at the prevailing price list for 7 years from installation.',
        inkCommitment: 'Genuine True Colors inks during warranty at contract prices.',
        amcTerms: 'AMC offered after warranty at 8% of machine value per year.',
        sentAt: rank >= RANK.processing ? `${addDays(orderDate, 3)}T10:00:00.000Z` : null,
        signedAt: rank >= RANK.processing ? `${addDays(orderDate, 4)}T15:00:00.000Z` : null,
        signedBy: rank >= RANK.processing ? 'Customer director' : null,
      });
    }
  });

  // ---------------------------------------------------------------- repeat consumables orders (6 months)
  const priced = new Map<string, { listPrice: number; landedCost?: number }>();
  (R.priceListItems ?? []).forEach((i) => {
    if (!priced.has(String(i.productId))) priced.set(String(i.productId), { listPrice: Number(i.listPrice), landedCost: i.landedCost === undefined ? undefined : Number(i.landedCost) });
  });
  const consumables = products.filter((p) => CONSUMABLE_TYPES.includes(String(p.productType)) && p.status !== 'inactive' && (priced.has(p.id) || Number(p.listPrice) > 0));
  const buyers = (consumables.length ? customers : [])
    .filter((c) => ((c.divisionIds as string[]) ?? []).some((d) => ['INK', 'PPR', 'FAB'].includes(d)) && c.category !== 'prospect')
    .slice(0, 12);
  buyers.forEach((c, ci) => {
    const divs = ((c.divisionIds as string[]) ?? []).filter((d) => ['INK', 'PPR', 'FAB'].includes(d));
    const div = divs[ci % divs.length];
    const pool = consumables.filter((p) => p.divisionId === div);
    const chosen = (pool.length ? pool : consumables).slice(0, 6);
    const items = [rnd.pick(chosen), ...(rnd.chance(0.5) ? [rnd.pick(chosen)] : [])].filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
    const interval = rnd.int(25, 40);
    const count = rnd.int(3, 6);
    // A few customers stop ordering (missed reorders for the consumables module).
    const lastAgo = ci % 4 === 3 ? interval + rnd.int(15, 30) : rnd.int(3, 15);
    let prev: RecordData | undefined;
    for (let k = count - 1; k >= 0; k--) {
      const orderDate = addDays(today, -(lastAgo + k * interval + rnd.int(-3, 3)));
      if (orderDate < addDays(today, -185)) continue;
      const lines: Line[] = items.map((p) => {
        const price = priced.get(p.id) ?? { listPrice: Number(p.listPrice) };
        return { productId: p.id, description: String(p.name), lineType: p.productType === 'ink' ? 'ink' : 'consumable', qty: rnd.int(5, 40), listPrice: price.listPrice, discountPct: rnd.pick([0, 0, 2, 5]), discountAmt: 0, hsnSac: String(p.hsnSac ?? ''), gstRate: Number(p.gstRate) || 18, landedCost: price.landedCost };
      });
      const pos = String(c.billingState ?? COMPANY_GST_STATE);
      const t = totals(lines, pos, rnd.pick([0, 1500, 2500]), 0);
      const latest = k === 0;
      const status = latest ? rnd.pick(['pending_approval', 'confirmed', 'processing', 'dispatched', 'delivered', 'completed']) : 'completed';
      const order: RecordData = {
        ...ctx.base(0),
        createdAt: `${orderDate}T11:00:00.000Z`,
        updatedAt: `${orderDate}T11:00:00.000Z`,
        id: ctx.nextId('salesOrders', 'SO', 'fy', new Date(`${orderDate}T10:00:00`)),
        orderNo: orderNo(div, orderDate),
        customerId: c.id,
        orderKind: 'consumables',
        divisionId: div,
        ownerId: c.ownerId,
        orderDate,
        quotationId: null,
        opportunityId: null,
        repeatOfId: prev?.id ?? null,
        customerPoNo: `PO-${String(c.name).slice(0, 3).toUpperCase()}-${rnd.int(100, 999)}`,
        customerPoDate: orderDate,
        poFileName: `PO-${c.id}-${orderDate}.pdf`,
        productId: lines[0].productId,
        siteAddressId: null,
        placeOfSupply: pos,
        ...t,
        changeSummary: prev ? 'Repeat order' : 'First consumables order',
        paymentTerms: '100% within 30 days of invoice.',
        deliveryTerms: 'Dispatch within 3 working days from stock.',
        status,
        financeCheck: false,
        erpPushedAt: status !== 'pending_approval' ? `${addDays(orderDate, 1)}T09:00:00.000Z` : null,
        invoiceNo: RANK[status] >= RANK.dispatched ? invoiceNo(div, addDays(orderDate, 2)) : null,
        invoiceDate: RANK[status] >= RANK.dispatched ? clamp(addDays(orderDate, 2)) : null,
        ewayBill: null,
        customsStatus: 'not_applicable',
        machineReady: false,
        pdiDone: false,
        deliveredAt: null,
        completedAt: status === 'completed' ? clamp(addDays(orderDate, rnd.int(5, 9))) : null,
        lines,
      };
      orders.push(order);
      addMilestones(order, [['Payment (30-day credit)', 100, 30]], status === 'completed' && !(ci % 5 === 2 && k === 0) ? 1 : 0);
      if (RANK[status] >= RANK.dispatched) addDispatch(order, status);
      prev = order;
    }
  });

  // ---------------------------------------------------------------- open approvals for pending orders (SO-04)
  const employees = R.employees ?? [];
  const LEVEL: Record<string, { capability: string; label: string }> = {
    sales_manager: { capability: 'orders.approve.manager', label: 'Reporting manager (Sales manager)' },
    division_head: { capability: 'approve.l2', label: 'Division head' },
    management: { capability: 'approve.l3', label: 'Management (MD)' },
  };
  orders
    .filter((o) => o.status === 'pending_approval')
    .forEach((o) => {
      const mgr = employees.find((e) => e.id === employees.find((x) => x.id === o.ownerId)?.managerId);
      const base = LEVEL[String(mgr?.roleId)] ?? LEVEL.management;
      const requester = ctx.users.find((u) => u.staffIds.tc === o.ownerId);
      if (!requester) return;
      ctx.counters.approvals = (ctx.counters.approvals ?? 1000) + 1;
      ctx.approvals.push({
        id: `APR-${ctx.counters.approvals}`,
        type: 'salesOrder.approval',
        workspaceId: 'tc',
        resource: 'salesOrders',
        recordId: o.id,
        requestedBy: requester.id,
        requestedAt: String(o.createdAt),
        reason: o.repeatOfId ? 'Repeat consumables order' : 'New order from accepted quotation.',
        summary: `Sales order ${o.orderNo} · ₹${Number(o.grandTotal).toLocaleString('en-IN')}`,
        amount: Number(o.grandTotal),
        divisionIds: [String(o.divisionId)],
        levels: [mgr && LEVEL[String(mgr.roleId)] ? { ...base, label: `${base.label.replace(/ \(.*\)$/, '')} — ${mgr.fullName}`, approverStaffId: mgr.id } : base],
        currentLevel: 0,
        decisions: [],
        status: 'pending',
        version: 1,
      });
    });
}
