/**
 * Stock read models (BRD 4.9): Main Store Stock (SPR-02) and Engineer Stock (4.9 title, GLOSSARY G-A1).
 * Engineer stock is computed from Spares Requisitions — no separate van-stock ledger:
 *   issued   = quantity the store issued (Issued/Dispatched and every later state)
 *   in transit = issued, not yet received
 *   received = issued quantity the engineer acknowledged
 *   consumed = quantity used on the job; returned = sent back unused
 *   in hand  = received, not yet consumed or returned
 *   defective to return = consumed quantity whose failed part has not reached the store
 */
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { type Actor, can } from '../authz';
import { getDb } from '../db';
import { masterValue } from '../registry';
import { ServiceError } from '../types';

const E = L.spares.errors;
const MOVED = ['issued', 'received', 'consumed', 'returned'];
const num = (v: unknown) => Number(v ?? 0) || 0;
const issuedOf = (r: RecordData) => num(r.issuedQty ?? r.qty);

export interface MainStoreRow {
  id: string;
  partNo: string;
  description: string;
  category: string;
  categoryLabel: string;
  critical: boolean;
  stockMain: number;
  minLevel: number;
  inTransit: number;
  withEngineers: number;
  price: number;
  value: number;
  belowMin: boolean;
}

/** SPR-02: on-hand, minimum level, in transit to engineers and value per active part. */
export function mainStoreStock(actor: Actor): { rows: MainStoreRow[]; lastSync: string | null; totalValue: number; below: number; categories: { value: string; label: string }[] } {
  if (!can(actor, 'spares.stock')) throw new ServiceError('forbidden', E.stockForbidden);
  const d = getDb();
  const parts = (d.records.spareParts ?? []).filter((p) => p.status !== 'inactive');
  const transit = new Map<string, number>();
  const withEng = new Map<string, number>();
  (d.records.requisitions ?? []).forEach((r) => {
    const k = String(r.partId);
    if (r.status === 'issued') transit.set(k, (transit.get(k) ?? 0) + issuedOf(r));
    if (r.status === 'received') withEng.set(k, (withEng.get(k) ?? 0) + issuedOf(r));
  });
  const rows = parts.map((p): MainStoreRow => {
    const stockMain = num(p.stockMain);
    const minLevel = num(p.minLevel);
    const price = num(p.price);
    return {
      id: p.id,
      partNo: String(p.partNo ?? ''),
      description: String(p.description ?? ''),
      category: String(p.category ?? ''),
      categoryLabel: masterValue('spareCategory', p.category)?.label ?? String(p.category ?? ''),
      critical: !!p.critical,
      stockMain,
      minLevel,
      inTransit: transit.get(p.id) ?? 0,
      withEngineers: withEng.get(p.id) ?? 0,
      price,
      value: stockMain * price,
      belowMin: stockMain < minLevel,
    };
  });
  const lastSync = parts.map((p) => String(p.erpSyncedAt ?? '')).sort().pop() || null;
  const seen = new Map<string, string>();
  rows.forEach((r) => r.category && seen.set(r.category, r.categoryLabel));
  return {
    rows,
    lastSync,
    totalValue: rows.reduce((s, r) => s + r.value, 0),
    below: rows.filter((r) => r.belowMin).length,
    categories: [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export interface StockFigures {
  issued: number;
  inTransit: number;
  received: number;
  consumed: number;
  returned: number;
  inHand: number;
  defective: number;
  inHandValue: number;
  lastMovement: string | null;
}

export interface EngineerRow extends StockFigures {
  engineerId: string;
  engineerName: string;
}

export interface EngineerPartRow extends StockFigures {
  partId: string;
  partNo: string;
  description: string;
}

const empty = (): StockFigures => ({ issued: 0, inTransit: 0, received: 0, consumed: 0, returned: 0, inHand: 0, defective: 0, inHandValue: 0, lastMovement: null });

function add(f: StockFigures, r: RecordData) {
  const qty = issuedOf(r);
  f.issued += qty;
  if (r.status === 'issued') f.inTransit += qty;
  if (['received', 'consumed', 'returned'].includes(String(r.status))) f.received += qty;
  if (r.status === 'consumed') f.consumed += num(r.consumedQty ?? qty);
  if (r.status === 'returned') f.returned += qty;
  if (r.status === 'received') {
    f.inHand += qty;
    f.inHandValue += qty * num(r.unitPrice);
  }
  if (r.status === 'consumed' && r.defectiveReturn === 'pending') f.defective += num(r.consumedQty ?? qty);
  const last = [r.issuedAt, r.receivedAt, r.consumedAt, r.returnedAt].map((x) => String(x ?? '')).sort().pop();
  if (last && (!f.lastMovement || last > f.lastMovement)) f.lastMovement = last;
}

/** Whether the actor sees every engineer's stock (Store In-charge, Service Leadership, Management, admin) or only their own. */
export function engineerStockScope(actor: Actor): 'all' | 'own' | 'none' {
  if (can(actor, 'spares.engineerStockAll')) return 'all';
  return (actor.role.resources.requisitions?.read ?? 'none') === 'own' ? 'own' : 'none';
}

/**
 * Engineer Stock: one row per service engineer, plus the per-part breakdown for `engineerId`.
 * Engineers only ever get their own figures (enforced here, not just hidden in the UI).
 */
export function engineerStock(actor: Actor, engineerId?: string | null): { scope: 'all' | 'own'; engineers: EngineerRow[]; parts: EngineerPartRow[]; selected: string | null } {
  const scope = engineerStockScope(actor);
  if (scope === 'none') throw new ServiceError('forbidden', E.engineerStockForbidden);
  if (scope === 'own' && engineerId && engineerId !== actor.staffId) throw new ServiceError('forbidden', E.engineerStockOwnOnly);
  const selected = scope === 'own' ? actor.staffId : engineerId || null;
  const d = getDb();
  const moved = (d.records.requisitions ?? []).filter((r) => MOVED.includes(String(r.status)) && (scope === 'all' || r.engineerId === actor.staffId));
  const employees = d.records.employees ?? [];
  const nameOf = (id: string) => String(employees.find((e) => e.id === id)?.fullName ?? id);

  const byEngineer = new Map<string, StockFigures>();
  if (scope === 'all') employees.filter((e) => e.roleId === 'engineer' && e.status !== 'inactive').forEach((e) => byEngineer.set(e.id, empty()));
  else byEngineer.set(actor.staffId, empty());
  moved.forEach((r) => {
    const k = String(r.engineerId ?? '');
    if (!k) return;
    if (!byEngineer.has(k)) byEngineer.set(k, empty());
    add(byEngineer.get(k)!, r);
  });
  const engineers = [...byEngineer.entries()].map(([id, f]) => ({ engineerId: id, engineerName: nameOf(id), ...f })).sort((a, b) => a.engineerName.localeCompare(b.engineerName));

  const parts: EngineerPartRow[] = [];
  if (selected) {
    const byPart = new Map<string, StockFigures>();
    moved
      .filter((r) => r.engineerId === selected)
      .forEach((r) => {
        const k = String(r.partId);
        if (!byPart.has(k)) byPart.set(k, empty());
        add(byPart.get(k)!, r);
      });
    byPart.forEach((f, partId) => {
      const p = d.records.spareParts?.find((x) => x.id === partId);
      parts.push({ partId, partNo: String(p?.partNo ?? partId), description: String(p?.description ?? ''), ...f });
    });
    parts.sort((a, b) => b.inHand - a.inHand || b.defective - a.defective || a.partNo.localeCompare(b.partNo));
  }
  return { scope, engineers, parts, selected };
}
