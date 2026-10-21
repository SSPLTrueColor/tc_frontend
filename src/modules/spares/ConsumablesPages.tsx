import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { confirmDelete } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { FormDrawer } from '../../components/resource/RecordForm';
import { ListPage } from '../../components/shell/ListPage';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatMoney } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import * as api from '../../services/api/spares';
import { can, canReadResource } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { DataTable } from '../../components/primitives/DataTable';
import { RepeatOrderDialog } from './components/RepeatOrderDialog';

// ---------------------------------------------------------------- Repeat Orders (CON-02, FR-099)

export function RepeatOrdersPage() {
  const actor = useActor();
  const P = L.consumables.pages.repeatOrders;
  const q = useServiceQuery(() => api.repeatOrderList(actor), [actor.user.id]);
  const [show, setShow] = useState<'latest' | 'all'>('latest');
  const [customer, setCustomer] = useState('');
  const [price, setPrice] = useState<'all' | 'contract' | 'list'>('all');
  const [repeat, setRepeat] = useState<{ id: string; label: string } | null>(null);
  const customers = useMemo(() => {
    const m = new Map<string, string>();
    (q.data?.rows ?? []).forEach((r) => m.set(r.customerId, r.customerName));
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [q.data]);
  const rows = useMemo(
    () => (q.data?.rows ?? []).filter((r) => (show === 'all' || r.latest) && (!customer || r.customerId === customer) && (price === 'all' || (price === 'contract' ? r.contract : !r.contract))),
    [q.data, show, customer, price],
  );
  if (!can(actor, 'consumables.view')) return <NoAccess what={P.noAccess} />;
  return (
    <ListPage title={L.nav.pages.repeatOrders.title} description={P.description}
      >
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={8} />
        ) : !q.data.rows.length ? (
          <>
            {q.data.sourcesMissing.length > 0 && <InlineAlert tone="info">{L.consumables.pages.reorderPrediction.waiting(q.data.sourcesMissing.join(', '))}</InlineAlert>}
            <EmptyState icon="reset" title={P.empty}>
              {P.emptyBody}
            </EmptyState>
          </>
        ) : (
          <DataTable exportResource="salesOrders"
            label={P.tableLabel}
            rows={rows}
            rowKey={(r) => r.id}
            search={(r) => `${r.orderNo} ${r.customerName} ${r.products}`}
            initialSort={{ key: 'date', dir: 'desc' }}
            emptyText={P.noRowsBody}
            summary={P.summary(rows.length, new Set(rows.map((r) => r.customerId)).size)}
            activeFilters={(customer ? 1 : 0) + (price !== 'all' ? 1 : 0) + (show !== 'latest' ? 1 : 0)}
            onClearFilters={() => (setCustomer(''), setPrice('all'), setShow('latest'))}
            filters={
              <>
                <SelectMenu label={P.customer} searchable value={customer} options={[{ value: '', label: P.allCustomers }, ...customers]} onChange={setCustomer} />
                <SelectMenu label={P.priceFilter} value={price} options={[{ value: 'all', label: P.priceOptions.all }, { value: 'contract', label: P.priceOptions.contract }, { value: 'list', label: P.priceOptions.list }]} onChange={setPrice} />
                <SelectMenu label={L.consumables.common.show} value={show} options={[{ value: 'latest', label: P.showOptions.latest }, { value: 'all', label: P.showOptions.all }]} onChange={setShow} />
              </>
            }
            columns={[
              { key: 'order', label: P.cols.order, sort: (r) => r.orderNo, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'salesOrders', r.id)}>{r.orderNo}</Link> },
              { key: 'cust', label: P.cols.customer, sort: (r) => r.customerName, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'customers', r.customerId)}>{r.customerName}</Link> },
              { key: 'date', label: P.cols.date, sort: (r) => r.orderDate, render: (r) => <DateText value={r.orderDate} /> },
              { key: 'items', label: P.cols.items, sort: (r) => r.items, render: (r) => <span data-tooltip={r.products}>{P.items(r.items)}</span> },
              { key: 'value', label: P.cols.value, num: true, sort: (r) => r.value, render: (r) => formatMoney(r.value) },
              { key: 'orders', label: P.cols.orders, num: true, sort: (r) => r.customerOrders, render: (r) => r.customerOrders },
              { key: 'price', label: P.cols.price, sort: (r) => Number(r.contract), render: (r) => (r.contract ? <Badge tone="success">{P.contractBadge}</Badge> : <Badge>{P.listBadge}</Badge>) },
              { key: 'owner', label: P.cols.owner, sort: (r) => recordTitle('employees', r.ownerId, actor), render: (r) => (r.ownerId ? recordTitle('employees', r.ownerId, actor) : <EmptyValue />) },
              {
                key: 'act',
                label: P.cols.actions,
                render: (r) => (
                  <Button size="compact" icon="reset" disabledReason={q.data?.canRepeat ? undefined : P.noCreate} onClick={() => setRepeat({ id: r.id, label: r.orderNo })}>
                    {L.consumables.actions.repeatOrder}
                  </Button>
                ),
              },
            ]}
          />
        )}
      
      {repeat && <RepeatOrderDialog orderId={repeat.id} orderLabel={repeat.label} onClose={() => setRepeat(null)} />}
    </ListPage>
  );
}

// ---------------------------------------------------------------- Dealer / Distributor Orders (CON-06, FR-103)

export function DealerOrdersPage() {
  const actor = useActor();
  const toast = useToast();
  const P = L.consumables.pages.dealerOrders;
  const allowed = can(actor, 'consumables.view') && canReadResource(actor, 'dealerOrders');
  const q = useServiceQuery(() => (allowed ? api.dealerOrderList(actor) : null), [actor.user.id, allowed]);
  const [dealer, setDealer] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => (!dealer || r.dealerId === dealer) && (!status || r.status === status)), [q.data, dealer, status]);
  if (!allowed) return <NoAccess what={P.noAccess} />;
  const data = q.data;
  const remove = (id: string) =>
    confirmDelete({
      title: P.deleteTitle(id),
      message: P.deleteBody,
      confirmLabel: L.consumables.actions.delete,
      onConfirm: () =>
        api
          .deleteDealerOrder(actor, id)
          .then(() => toast(P.deleted(id)))
          .catch((e) => toast(errorMessage(e), 'danger')),
    });
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ListPage
        title={L.nav.pages.dealerOrders.title}
        description={P.description}
        actions={
          <Button variant="primary" icon="plus" disabledReason={data && !data.canCreate ? P.noCreate : undefined} onClick={() => setForm({})}>
            {L.consumables.actions.newDealerOrder}
          </Button>
        }
      >
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !data ? (
          <Skeleton rows={8} />
        ) : !data.rows.length ? (
          <EmptyState icon="building" title={P.empty}>
            {P.emptyBody}
          </EmptyState>
        ) : (
          <DataTable exportResource="dealerOrders"
            label={P.tableLabel}
            rows={rows}
            rowKey={(r) => r.id}
            search={(r) => `${r.id} ${r.dealerName} ${r.endCustomer} ${r.endCustomerCity} ${r.productName} ${r.invoiceNo}`}
            initialSort={{ key: 'date', dir: 'desc' }}
            emptyText={P.noRowsBody}
            summary={P.summary(rows.length, formatMoney(total))}
            activeFilters={(dealer ? 1 : 0) + (status ? 1 : 0)}
            onClearFilters={() => (setDealer(''), setStatus(''))}
            filters={
              <>
                <SelectMenu label={P.dealer} searchable value={dealer} options={[{ value: '', label: P.allDealers }, ...data.dealers]} onChange={setDealer} />
                <SelectMenu label={P.status} value={status} options={[{ value: '', label: P.allStatuses }, ...activeMasterValues('dealerOrderStatus').map((v) => ({ value: v.key, label: v.label }))]} onChange={setStatus} />
              </>
            }
            columns={[
              { key: 'id', label: P.cols.id, sort: (r) => r.id, render: (r) => r.id },
              { key: 'date', label: P.cols.date, sort: (r) => r.orderDate, render: (r) => <DateText value={r.orderDate} /> },
              { key: 'dealer', label: P.cols.dealer, sort: (r) => r.dealerName, render: (r) => <Link to={recordPeekPath(actor.workspaceId, 'customers', r.dealerId)}>{r.dealerName}</Link> },
              { key: 'end', label: P.cols.endCustomer, sort: (r) => r.endCustomer, render: (r) => (r.endCustomerCity ? `${r.endCustomer} · ${r.endCustomerCity}` : r.endCustomer) },
              { key: 'product', label: P.cols.product, sort: (r) => r.productName, render: (r) => r.productName || <EmptyValue /> },
              { key: 'qty', label: P.cols.qty, num: true, sort: (r) => r.qty, render: (r) => `${r.qty} ${r.uom}`.trim() },
              { key: 'value', label: P.cols.value, num: true, sort: (r) => r.value, render: (r) => formatMoney(r.value) },
              {
                key: 'status',
                label: P.cols.status,
                sort: (r) => r.status,
                render: (r) => {
                  const v = masterValue('dealerOrderStatus', r.status);
                  return v ? <StatusChip label={v.label} tone={v.tone} /> : <EmptyValue />;
                },
              },
              {
                key: 'act',
                label: P.cols.actions,
                render: (r) => (
                  <span className="sp-page-actions">
                    <Button size="compact" icon="pencil" disabledReason={r.canEdit ? undefined : P.noEdit} onClick={() => setForm({ id: r.id })}>
                      {L.consumables.actions.edit}
                    </Button>
                    <Button size="compact" variant="ghost" icon="trash" disabledReason={data.canDelete ? undefined : P.noDelete} onClick={() => remove(r.id)}>
                      {L.consumables.actions.delete}
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        )}
      
      <FormDrawer resKey="dealerOrders" recordId={form?.id} open={!!form} onClose={() => setForm(null)} />
    </ListPage>
  );
}
