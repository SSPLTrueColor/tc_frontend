/** Catalog module: price list rules (FR-039, BR-15), employee lifecycle guard (BR-53), price list Items tab. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { formatMoney } from '../../lib/format';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { call, errorMessage } from '../../services/api/client';
import { can, perm } from '../../services/authz';
import { activationConflicts, assertCanPriceDivision, conflictingPrice } from '../../services/catalog/pricing';
import { ownedOpenRecords } from '../../services/catalog/admin';
import { registerResourceHooks } from '../../services/resourceHooks';
import { deleteRecord, queryRecords, recordTitle } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { registerRecordBanner, registerRecordTab, type RecordExtensionProps } from '../../components/resource/extensions';
import { Button, IconButton } from '../../components/primitives/Button';
import { EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, useToast } from '../../components/primitives/feedback';
import { confirmDelete } from '../../components/primitives/overlay';
import { FormDrawer, QuickCreateDialog } from '../../components/resource/RecordForm';

const GST_RATES = [0, 5, 12, 18, 28];

// ---------------------------------------------------------------- products

function checkProduct(products: RecordData[], c: Record<string, unknown>, selfId?: string) {
  if (c.gstRate !== undefined && !GST_RATES.includes(Number(c.gstRate))) throw new ServiceError('validation', 'GST rate must be 0, 5, 12, 18 or 28 %.', { fieldErrors: { gstRate: 'Use 0, 5, 12, 18 or 28' } });
  const sku = String(c.sku ?? '').toUpperCase();
  if (sku) c.sku = sku;
  if (sku && products.some((p) => p.id !== selfId && String(p.sku).toUpperCase() === sku)) throw new ServiceError('validation', `SKU ${sku} is already used.`, { fieldErrors: { sku: 'Already used by another product' } });
}

registerResourceHooks('products', {
  beforeCreate: ({ d }, c) => checkProduct(d.records.products ?? [], c),
  beforeUpdate: ({ d }, before, c) => checkProduct(d.records.products ?? [], c, before.id),
});

// ---------------------------------------------------------------- price lists

registerResourceHooks('priceLists', {
  beforeCreate: ({ actor }, c) => assertCanPriceDivision(actor, c.divisionId),
  beforeUpdate: ({ d, actor }, before, c) => {
    assertCanPriceDivision(actor, c.divisionId);
    if (c.divisionId !== before.divisionId && (d.records.priceListItems ?? []).some((i) => i.priceListId === before.id)) {
      throw new ServiceError('validation', 'Remove the items before moving this price list to another division.', { fieldErrors: { divisionId: 'Price list already has items' } });
    }
    if (before.status === 'active') {
      const clashes = activationConflicts(d.records, { ...before, ...c } as RecordData);
      if (clashes.length) throw new ServiceError('validation', `New dates overlap another active price list: ${clashes.slice(0, 3).join('; ')}`, { fieldErrors: { validFrom: 'Overlaps another active price list' } });
    }
  },
  beforeTransition: ({ d, actor }, record, to) => {
    assertCanPriceDivision(actor, record.divisionId);
    if (to !== 'active') return;
    if (!(d.records.priceListItems ?? []).some((i) => i.priceListId === record.id)) throw new ServiceError('invalid_state', 'Add at least one product price before activating.');
    const clashes = activationConflicts(d.records, record);
    if (clashes.length) throw new ServiceError('invalid_state', `Cannot activate: ${clashes.slice(0, 3).join('; ')}${clashes.length > 3 ? ` and ${clashes.length - 3} more` : ''}. Expire the other list first.`);
  },
});

function checkItem(d: { records: Record<string, RecordData[]> }, actor: Parameters<typeof assertCanPriceDivision>[0], c: Record<string, unknown>, selfId?: string) {
  const list = (d.records.priceLists ?? []).find((l) => l.id === c.priceListId);
  if (!list) throw new ServiceError('validation', 'Choose a price list.', { fieldErrors: { priceListId: 'Required' } });
  assertCanPriceDivision(actor, list.divisionId);
  c.divisionId = list.divisionId;
  const product = (d.records.products ?? []).find((p) => p.id === c.productId);
  if (product && product.divisionId !== list.divisionId) throw new ServiceError('validation', `${product.name} belongs to another division than this price list.`, { fieldErrors: { productId: 'Product is from another division' } });
  if ((d.records.priceListItems ?? []).some((i) => i.id !== selfId && i.priceListId === list.id && i.productId === c.productId)) throw new ServiceError('validation', 'This product is already on the price list.', { fieldErrors: { productId: 'Already on this list' } });
  if (list.status === 'active') {
    const clash = conflictingPrice(d.records, list, String(c.productId), selfId);
    if (clash) throw new ServiceError('validation', `Already priced on active list ${clash.list.name} (${clash.list.id}) for overlapping dates.`, { fieldErrors: { productId: 'Priced on another active list' } });
  }
  if (c.landedCost !== undefined && c.landedCost !== null && c.landedCost !== '' && Number(c.landedCost) > Number(c.listPrice)) {
    throw new ServiceError('validation', 'Landed cost is higher than the list price.', { fieldErrors: { landedCost: 'Higher than list price' } });
  }
}

registerResourceHooks('priceListItems', {
  beforeCreate: ({ d, actor }, c) => checkItem(d, actor, c),
  beforeUpdate: ({ d, actor }, before, c) => checkItem(d, actor, c, before.id),
});

// ---------------------------------------------------------------- employees (BR-53)

registerResourceHooks('employees', {
  beforeUpdate: ({ d }, before, c) => {
    if (c.status !== 'inactive' || before.status === 'inactive') return;
    const open = ownedOpenRecords(before.id, d.records);
    if (open.length) {
      const list = open.map((o) => `${o.count} ${o.label.toLowerCase()}`).join(', ');
      throw new ServiceError('invalid_state', `${String(before.fullName)} still owns ${list}. Transfer them first (Administration → Ownership transfer), then deactivate.`, { fieldErrors: { status: 'Transfer open records first' } });
    }
    if ((d.records.employees ?? []).some((e) => e.managerId === before.id && e.status !== 'inactive')) {
      throw new ServiceError('invalid_state', `${String(before.fullName)} still has direct reports. Change their "Reports to" first.`, { fieldErrors: { status: 'Has direct reports' } });
    }
  },
});

function EmployeeOwnershipBanner({ actor, record }: RecordExtensionProps) {
  if (!can(actor, 'users.manage') || record.status === 'inactive') return null;
  const open = ownedOpenRecords(record.id);
  if (!open.length) return null;
  return (
    <InlineAlert tone="info" title="Owns open records">
      {open.map((o) => `${o.count} ${o.label.toLowerCase()}`).join(' · ')}. Deactivation is blocked until these are transferred — <Link to="/admin/transfer">Ownership transfer</Link>.
    </InlineAlert>
  );
}
registerRecordBanner('employees', EmployeeOwnershipBanner);

// ---------------------------------------------------------------- price list → Items tab

function PriceListItemsTab({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const q = useServiceQuery(() => queryRecords(actor, 'priceListItems', { where: { priceListId: record.id }, sort: [{ field: 'productId', dir: 'asc' }] }), [record.id, actor.user.id]);
  const canEdit = perm(actor, 'priceListItems').update === 'all' || (perm(actor, 'priceListItems').update === 'division' && actor.divisionIds.includes(String(record.divisionId)));
  const canAdd = perm(actor, 'priceListItems').create && canEdit;
  const canDelete = perm(actor, 'priceListItems').delete && canEdit;
  const showCost = q.data?.rows.some((r) => 'landedCost' in r) ?? false;
  return (
    <div className="cat-stack">
      <div className="toolbar">
        <span className="muted small">{q.data ? `${q.data.total} product(s)` : ''}</span>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)} disabledReason={canAdd ? undefined : 'Only administrators and this division’s head can change list prices'}>
          Add price
        </Button>
      </div>
      {q.error ? (
        <ErrorState title="Could not load prices" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={5} />
      ) : !q.data.rows.length ? (
        <EmptyState icon="receipt" title="No prices yet">
          Add the products this list prices.
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  List price
                </th>
                {showCost && (
                  <th scope="col" className="num">
                    Landed cost
                  </th>
                )}
                {showCost && (
                  <th scope="col" className="num">
                    Margin
                  </th>
                )}
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="rel-link" to={`/products?peek=${String(r.productId)}`}>
                      {recordTitle('products', r.productId, actor)}
                    </Link>
                  </td>
                  <td className="num">{formatMoney(Number(r.listPrice))}</td>
                  {showCost && <td className="num">{r.landedCost === undefined || r.landedCost === null ? <EmptyValue /> : formatMoney(Number(r.landedCost))}</td>}
                  {showCost && <td className="num">{r.marginPct === null || r.marginPct === undefined ? <EmptyValue /> : `${r.marginPct}%`}</td>}
                  <td className="row-actions">
                    <IconButton icon="pencil" label={`Edit price of ${recordTitle('products', r.productId, actor)}`} onClick={() => setEditId(r.id)} disabledReason={canEdit ? undefined : 'Read-only for your role'} />
                    <IconButton
                      icon="trash"
                      label={`Remove ${recordTitle('products', r.productId, actor)}`}
                      disabledReason={canDelete ? undefined : 'Only administrators and this division’s head can remove prices'}
                      onClick={() =>
                        confirmDelete({
                          title: 'Remove this price?',
                          message: `${recordTitle('products', r.productId, actor)} will no longer be priced on ${String(record.name)}. Existing quotations keep their prices.`,
                          confirmLabel: 'Remove',
                          onConfirm: async () => {
                            try {
                              await call(() => deleteRecord(actor, 'priceListItems', r.id));
                              toast('Price removed');
                            } catch (e) {
                              toast(errorMessage(e), 'danger');
                            }
                          },
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <QuickCreateDialog open={adding} resKey="priceListItems" initial={{ priceListId: record.id }} onClose={() => setAdding(false)} onCreated={() => toast('Price added')} />
      <FormDrawer open={!!editId} resKey="priceListItems" recordId={editId ?? undefined} onClose={() => setEditId(null)} />
    </div>
  );
}

registerRecordTab('priceLists', {
  id: 'items',
  label: 'Items',
  component: PriceListItemsTab,
  count: ({ actor, record }) => queryRecords(actor, 'priceListItems', { where: { priceListId: record.id } }).total,
});
