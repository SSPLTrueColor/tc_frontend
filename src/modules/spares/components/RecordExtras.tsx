import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/primitives/Button';
import { DateText, EmptyValue } from '../../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip } from '../../../components/primitives/feedback';
import type { RecordExtensionProps } from '../../../components/resource/extensions';
import { QuickCreateDialog } from '../../../components/resource/RecordForm';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { formatDate } from '../../../lib/dates';
import { formatMoney } from '../../../lib/format';
import { recordPeekPath } from '../../../lib/routes';
import * as api from '../../../services/api/spares';
import { byId, contractRateFor, listPriceFor } from '../../../services/lookups';
import { masterValue } from '../../../services/registry';
import { recordTitle } from '../../../services/runtime';

const chip = (master: string, key: unknown) => {
  const v = masterValue(master, key);
  return v ? <StatusChip label={v.label} tone={v.tone} /> : <EmptyValue />;
};

/** Ticket → "Parts" tab: requisitions raised for the ticket and a "Request part" shortcut (SPR-03). */
export function TicketPartsTab({ actor, record }: RecordExtensionProps) {
  const [open, setOpen] = useState(false);
  const q = useServiceQuery(() => api.requisitionsForTicket(actor, record.id), [actor.user.id, record.id]);
  const canCreate = !!actor.role.resources.requisitions?.create;
  const closed = ['resolved', 'customer_confirmation', 'closed'].includes(String(record.status));
  return (
    <div className="sp-stack">
      <div className="toolbar">
        <span className="muted small">Parts requested for this ticket</span>
        <span className="spacer" />
        {canCreate && (
          <Button icon="plus" onClick={() => setOpen(true)} disabledReason={closed ? 'Parts can only be requested on an open ticket' : undefined}>
            Request part
          </Button>
        )}
      </div>
      {q.error ? (
        <ErrorState title="Could not load parts" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={3} />
      ) : q.data.length ? (
        <table className="mini-table">
          <thead>
            <tr>
              <th scope="col">Requisition</th>
              <th scope="col">Part</th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={recordPeekPath(actor.workspaceId, 'requisitions', r.id)}>{r.id}</Link>
                </td>
                <td>{recordTitle('spareParts', r.partId, actor)}</td>
                <td className="num">{String(r.qty)}</td>
                <td>{chip('requisitionStatus', r.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState icon="blocks" title="No parts requested">
          Request a part when the repair needs one; the ticket waits for parts until it arrives.
        </EmptyState>
      )}
      <QuickCreateDialog open={open} resKey="requisitions" initial={{ ticketId: record.id }} onClose={() => setOpen(false)} onCreated={() => setOpen(false)} />
    </div>
  );
}

/** Customer 360 → "Consumables" tab (CON-01 / FR-098): machines, consumables orders, rate contracts, samples, reorder status. */
export function CustomerConsumablesTab({ actor, record }: RecordExtensionProps) {
  const q = useServiceQuery(() => api.customerConsumables(actor, record.id), [actor.user.id, record.id]);
  if (q.error)
    return (
      <ErrorState title="Could not load consumables" onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={5} />;
  const c = q.data;
  return (
    <div className="sp-stack">
      {c.leaking && (
        <InlineAlert tone="warning" title="Consumables leakage">
          {c.machines.length} machine(s) installed but no consumables order {c.lastOrderDate ? `since ${formatDate(c.lastOrderDate)}` : 'yet'}. <Link to="/consumables/leakage">See leakage list</Link>
        </InlineAlert>
      )}
      {c.reorder && (
        <p className="small">
          Reorder expected around <strong>{formatDate(c.reorder.dueDate)}</strong> (every ~{c.reorder.avgIntervalDays} days){' '}
          <Badge tone={c.reorder.state === 'missed' ? 'danger' : c.reorder.state === 'due' ? 'warning' : 'neutral'}>{c.reorder.state === 'missed' ? 'Missed' : c.reorder.state === 'due' ? 'Due' : 'Upcoming'}</Badge>
        </p>
      )}
      <section>
        <h3 className="panel-title">Installed machines</h3>
        {c.machines.length ? (
          <ul className="plain-list">
            {c.machines.map((m) => (
              <li key={m.id}>
                <Link to={recordPeekPath(actor.workspaceId, 'machines', m.id)}>{String(m.serialNo ?? m.id)}</Link> · {String(m.model ?? '')}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Non-machine customer — consumables only.</p>
        )}
      </section>
      <section>
        <h3 className="panel-title">Consumables orders ({c.orderCount})</h3>
        {c.orders.length ? (
          <table className="mini-table">
            <tbody>
              {c.orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={recordPeekPath(actor.workspaceId, 'salesOrders', o.id)}>{String(o.orderNo ?? o.id)}</Link>
                  </td>
                  <td>
                    <DateText value={String(o.orderDate)} />
                  </td>
                  <td className="num">{formatMoney(Number(o.grandTotal ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">No consumables orders yet.</p>
        )}
      </section>
      <section>
        <h3 className="panel-title">Valid rate contracts</h3>
        {c.contracts.length ? (
          <ul className="plain-list">
            {c.contracts.map((r) => (
              <li key={r.id}>
                <Link to={recordPeekPath(actor.workspaceId, 'rateContracts', r.id)}>{r.id}</Link> · {recordTitle('products', r.productId, actor)} @ {formatMoney(Number(r.rate))} until {formatDate(String(r.validTo))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No valid rate contract — price list applies.</p>
        )}
      </section>
      <section>
        <h3 className="panel-title">Samples & trials ({c.samples.length})</h3>
        {c.samples.length ? (
          <ul className="plain-list">
            {c.samples.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link to={recordPeekPath(actor.workspaceId, 'sampleDispatches', s.id)}>{s.id}</Link> · {recordTitle('products', s.productId, actor)} {chip('sampleStatus', s.status)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No samples sent.</p>
        )}
      </section>
    </div>
  );
}

/** Requisition banner: stock shortage and the suggested consumption basis. */
export function RequisitionBanner({ record }: RecordExtensionProps) {
  const part = byId('spareParts', record.partId);
  if (!part) return null;
  const stock = Number(part.stockMain ?? 0);
  if (['requested', 'approved'].includes(String(record.status)) && stock < Number(record.qty))
    return (
      <InlineAlert tone="warning" title="Short at main store">
        {String(part.partNo)}: {stock} in stock, {String(record.qty)} requested. SCM has been notified of the import requirement.
      </InlineAlert>
    );
  if (record.status === 'consumed' && record.defectiveReturn === 'pending')
    return (
      <InlineAlert tone="warning" title="Defective part pending">
        The failed {String(part.partNo)} must be returned to the store{part.returnable ? ' for the OEM claim' : ''}.
      </InlineAlert>
    );
  return null;
}

/** Rate contract banner: contract rate versus today's list price (BR-41 overrides the price list while valid). */
export function RateContractBanner({ record }: RecordExtensionProps) {
  const lp = record.productId ? listPriceFor(String(record.productId)) : null;
  const effective = record.customerId && record.productId ? contractRateFor(String(record.customerId), String(record.productId)) : null;
  if (!lp) return null;
  const rate = Number(record.rate);
  const pct = lp.listPrice ? Math.round(((lp.listPrice - rate) / lp.listPrice) * 1000) / 10 : 0;
  return (
    <InlineAlert tone={pct > 15 ? 'warning' : 'info'} title={`List price ${formatMoney(lp.listPrice)}`}>
      Contract rate {formatMoney(rate)} is {pct >= 0 ? `${pct}% below` : `${-pct}% above`} list.{' '}
      {effective !== null ? `Quotations and orders for this customer use ${formatMoney(effective)} today.` : 'This contract is not in force today.'}
    </InlineAlert>
  );
}

/** Spare part banner: below-minimum alert. */
export function SparePartBanner({ record }: RecordExtensionProps) {
  if (Number(record.stockMain ?? 0) >= Number(record.minLevel ?? 0) || !Number(record.minLevel)) return null;
  return (
    <InlineAlert tone={record.critical ? 'danger' : 'warning'} title="Below minimum level">
      Stock {String(record.stockMain ?? 0)}, minimum {String(record.minLevel)}. Suggested import: {Math.max(0, Number(record.minLevel) * 2 - Number(record.stockMain ?? 0))}.
    </InlineAlert>
  );
}
