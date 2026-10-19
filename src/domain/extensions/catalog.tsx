/** Product & Price Master: price list rules (FR-039, BR-15), user lifecycle guard (BR-53), price list Items tab. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES } from '../../constants/routes';
import { recordPeekPath } from '../../lib/routes';
import type { RecordData } from '../../metadata/types';
import { formatMoney } from '../../lib/format';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { call, errorMessage } from '../../services/api/client';
import { can, perm } from '../../services/authz';
import { activationConflicts, assertCanPriceDivision, conflictingPrice } from '../../services/catalog/pricing';
import { ownedOpenRecords } from '../../services/catalog/admin';
import { registerResourceHooks } from '../../services/resourceHooks';
import { registerFormLayoutProvider } from '../../services/formLayouts';
import { getFormLayout } from '../../services/catalog/formLayouts';
import { currentActor } from '../../services/authz';
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
  if (c.gstRate !== undefined && !GST_RATES.includes(Number(c.gstRate))) throw new ServiceError('validation', L.catalog.messages.gstRate, { fieldErrors: { gstRate: L.catalog.messages.gstRateField } });
  const sku = String(c.sku ?? '').toUpperCase();
  if (sku) c.sku = sku;
  if (sku && products.some((p) => p.id !== selfId && String(p.sku).toUpperCase() === sku)) throw new ServiceError('validation', L.catalog.messages.skuUsed(sku), { fieldErrors: { sku: L.catalog.messages.skuUsedField } });
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
      throw new ServiceError('validation', L.catalog.messages.moveDivision, { fieldErrors: { divisionId: L.catalog.messages.moveDivisionField } });
    }
    if (before.status === 'active') {
      const clashes = activationConflicts(d.records, { ...before, ...c } as RecordData);
      if (clashes.length) throw new ServiceError('validation', L.catalog.messages.overlapDates(clashes.slice(0, 3).join('; ')), { fieldErrors: { validFrom: L.catalog.messages.overlapField } });
    }
  },
  beforeTransition: ({ d, actor }, record, to) => {
    assertCanPriceDivision(actor, record.divisionId);
    if (to !== 'active') return;
    if (!(d.records.priceListItems ?? []).some((i) => i.priceListId === record.id)) throw new ServiceError('invalid_state', L.catalog.messages.needItem);
    const clashes = activationConflicts(d.records, record);
    if (clashes.length) throw new ServiceError('invalid_state', L.catalog.messages.cannotActivate(clashes.slice(0, 3).join('; '), clashes.length - 3));
  },
});

function checkItem(d: { records: Record<string, RecordData[]> }, actor: Parameters<typeof assertCanPriceDivision>[0], c: Record<string, unknown>, selfId?: string) {
  const list = (d.records.priceLists ?? []).find((l) => l.id === c.priceListId);
  if (!list) throw new ServiceError('validation', L.catalog.messages.choosePriceList, { fieldErrors: { priceListId: L.catalog.messages.required } });
  assertCanPriceDivision(actor, list.divisionId);
  c.divisionId = list.divisionId;
  const product = (d.records.products ?? []).find((p) => p.id === c.productId);
  if (product && product.divisionId !== list.divisionId) throw new ServiceError('validation', L.catalog.messages.otherDivision(String(product.name)), { fieldErrors: { productId: L.catalog.messages.otherDivisionField } });
  if ((d.records.priceListItems ?? []).some((i) => i.id !== selfId && i.priceListId === list.id && i.productId === c.productId)) throw new ServiceError('validation', L.catalog.messages.alreadyOnList, { fieldErrors: { productId: L.catalog.messages.alreadyOnListField } });
  if (list.status === 'active') {
    const clash = conflictingPrice(d.records, list, String(c.productId), selfId);
    if (clash) throw new ServiceError('validation', L.catalog.messages.pricedElsewhere(String(clash.list.name), clash.list.id), { fieldErrors: { productId: L.catalog.messages.pricedElsewhereField } });
  }
  if (c.landedCost !== undefined && c.landedCost !== null && c.landedCost !== '' && Number(c.landedCost) > Number(c.listPrice)) {
    throw new ServiceError('validation', L.catalog.messages.costAboveList, { fieldErrors: { landedCost: L.catalog.messages.costAboveListField } });
  }
}

registerResourceHooks('priceListItems', {
  beforeCreate: ({ d, actor }, c) => checkItem(d, actor, c),
  beforeUpdate: ({ d, actor }, before, c) => checkItem(d, actor, c, before.id),
});

// ---------------------------------------------------------------- users (BR-53; resource key `employees`)

registerResourceHooks('employees', {
  beforeUpdate: ({ d }, before, c) => {
    if (c.status !== 'inactive' || before.status === 'inactive') return;
    const open = ownedOpenRecords(before.id, d.records);
    if (open.length) {
      const list = open.map((o) => `${o.count} ${o.label.toLowerCase()}`).join(', ');
      throw new ServiceError('invalid_state', L.catalog.messages.ownsOpen(String(before.fullName), list), { fieldErrors: { status: L.catalog.messages.ownsOpenField } });
    }
    if ((d.records.employees ?? []).some((e) => e.managerId === before.id && e.status !== 'inactive')) {
      throw new ServiceError('invalid_state', L.catalog.messages.hasReports(String(before.fullName)), { fieldErrors: { status: L.catalog.messages.hasReportsField } });
    }
  },
});

function UserOwnershipBanner({ actor, record }: RecordExtensionProps) {
  if (!can(actor, 'users.manage') || record.status === 'inactive') return null;
  const open = ownedOpenRecords(record.id);
  if (!open.length) return null;
  return (
    <InlineAlert tone="info" title={L.catalog.userBanner.title}>
      {L.catalog.userBanner.body(open.map((o) => `${o.count} ${o.label.toLowerCase()}`).join(' · '))}
      <Link to={ROUTES.ownershipTransfer}>{L.nav.pages.ownershipTransfer.title}</Link>.
    </InlineAlert>
  );
}
registerRecordBanner('employees', UserOwnershipBanner);

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
        <span className="muted small">{q.data ? L.catalog.itemsTab.count(q.data.total) : ''}</span>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)} disabledReason={canAdd ? undefined : L.catalog.itemsTab.cannotChange}>
          {L.catalog.actions.addPrice}
        </Button>
      </div>
      {q.error ? (
        <ErrorState title={L.catalog.itemsTab.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={5} />
      ) : !q.data.rows.length ? (
        <EmptyState icon="receipt" title={L.catalog.itemsTab.emptyTitle}>
          {L.catalog.itemsTab.emptyBody}
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">{L.catalog.itemsTab.columns.product}</th>
                <th scope="col" className="num">
                  {L.catalog.itemsTab.columns.listPrice}
                </th>
                {showCost && (
                  <th scope="col" className="num">
                    {L.catalog.itemsTab.columns.landedCost}
                  </th>
                )}
                {showCost && (
                  <th scope="col" className="num">
                    {L.catalog.itemsTab.columns.margin}
                  </th>
                )}
                <th scope="col">
                  <span className="sr-only">{L.catalog.itemsTab.columns.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="rel-link" to={recordPeekPath(actor.workspaceId, 'products', String(r.productId))}>
                      {recordTitle('products', r.productId, actor)}
                    </Link>
                  </td>
                  <td className="num">{formatMoney(Number(r.listPrice))}</td>
                  {showCost && <td className="num">{r.landedCost === undefined || r.landedCost === null ? <EmptyValue /> : formatMoney(Number(r.landedCost))}</td>}
                  {showCost && <td className="num">{r.marginPct === null || r.marginPct === undefined ? <EmptyValue /> : `${r.marginPct}%`}</td>}
                  <td className="row-actions">
                    <IconButton icon="pencil" label={L.catalog.itemsTab.editPrice(recordTitle('products', r.productId, actor))} onClick={() => setEditId(r.id)} disabledReason={canEdit ? undefined : L.catalog.itemsTab.readOnly} />
                    <IconButton
                      icon="trash"
                      label={L.catalog.itemsTab.removeLabel(recordTitle('products', r.productId, actor))}
                      disabledReason={canDelete ? undefined : L.catalog.itemsTab.cannotRemove}
                      onClick={() =>
                        confirmDelete({
                          title: L.catalog.itemsTab.removeTitle,
                          message: L.catalog.itemsTab.removeMessage(recordTitle('products', r.productId, actor), String(record.name)),
                          confirmLabel: L.catalog.actions.remove,
                          onConfirm: async () => {
                            try {
                              await call(() => deleteRecord(actor, 'priceListItems', r.id));
                              toast(L.catalog.itemsTab.removed);
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
      <QuickCreateDialog open={adding} resKey="priceListItems" initial={{ priceListId: record.id }} onClose={() => setAdding(false)} onCreated={() => toast(L.catalog.itemsTab.added)} />
      <FormDrawer open={!!editId} resKey="priceListItems" recordId={editId ?? undefined} onClose={() => setEditId(null)} />
    </div>
  );
}

registerRecordTab('priceLists', {
  id: 'items',
  label: L.catalog.tabs.items,
  component: PriceListItemsTab,
  count: ({ actor, record }) => queryRecords(actor, 'priceListItems', { where: { priceListId: record.id } }).total,
});

// ---------------------------------------------------------------- per-division form layouts (ADM-05, G-A15)

/** Saved Custom Fields & Form Layouts → shared RecordForm. Records without a division use the user's first division. */
registerFormLayoutProvider((resKey, division) => {
  const layout = getFormLayout(resKey, division ?? currentActor().divisionIds[0]);
  return layout ? { sectionOrder: layout.order, hiddenSections: layout.hidden } : undefined;
});
