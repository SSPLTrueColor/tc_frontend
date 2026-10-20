import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { advanceOrderProcessing, customerNameOf, processingBoard, updateOrderProcessing, validateProcessing, type ProcessingInput, type ProcessingRow } from '../../services/api/orders';
import { can, canReadResource } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { CUSTOMS_STATUSES, SO_PROCESSING_STATUSES } from '../../domain/modules/orders';
import { Button, IconButton } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { ErrorState, InlineAlert, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { DataTable, type Column } from '../../components/primitives/DataTable';
import { KpiStrip } from '../../components/resource/ListCard';
import { PageHeader } from '../../components/shell/PageHeader';
import { chip } from './OrderTabs';
import { Checkbox, TextField } from '../../components/primitives/controls';

const O = L.orders;
const P = O.pages.orderProcessing;
const F = O.fields.salesOrders;

const draftOf = (o: RecordData): ProcessingInput => ({
  poToPrincipalNo: String(o.poToPrincipalNo ?? ''),
  poToPrincipalDate: String(o.poToPrincipalDate ?? ''),
  shipmentEta: String(o.shipmentEta ?? ''),
  customsStatus: String(o.customsStatus ?? 'not_applicable'),
  machineReady: !!o.machineReady,
  pdiDone: !!o.pdiDone,
});

const statusText = (key: string) => (O.masters.soStatus.values as Record<string, string>)[key] ?? key;

/**
 * SO-08 Order Processing: Import / SCM keeps PO to principal, shipment ETA, customs status, machine readiness
 * and pre-dispatch inspection current for approved sales orders. SCM (and admin) edit inline; other roles view.
 */
export function OrderProcessingPage() {
  const actor = useActor();
  const toast = useToast();
  const allowed = canReadResource(actor, 'salesOrders');
  const data = useServiceQuery(() => (allowed ? processingBoard(actor) : []), [actor.user.id]);
  const [status, setStatus] = useState('');
  const [customs, setCustoms] = useState('');
  const [kind, setKind] = useState('');
  const [division, setDivision] = useState('');
  const [etaOnly, setEtaOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProcessingInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const canProcess = can(actor, 'orders.process');

  const rows = useMemo(() => {
    return (data.data ?? []).filter(({ order: o, etaPassed }) => {
      if (status && o.status !== status) return false;
      if (customs && o.customsStatus !== customs) return false;
      if (kind && o.orderKind !== kind) return false;
      if (division && o.divisionId !== division) return false;
      return !etaOnly || etaPassed;
    });
  }, [data.data, status, customs, kind, division, etaOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <NoAccess what={P.noAccess} />;

  const all = data.data ?? [];
  const reset = (fn: () => void) => fn();

  const startEdit = (o: RecordData) => {
    setEditing(o.id);
    setDraft(draftOf(o));
    setErrors({});
  };
  const stopEdit = () => {
    setEditing(null);
    setDraft(null);
    setErrors({});
  };
  const save = async (o: RecordData) => {
    if (!draft) return;
    const local = validateProcessing(o, draft);
    if (Object.keys(local).length) {
      setErrors(local);
      toast(O.errors.fixFields, 'danger');
      return;
    }
    setBusy(o.id);
    try {
      await updateOrderProcessing(actor, o.id, draft, o.version);
      toast(P.saved(String(o.orderNo)));
      stopEdit();
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
    }
  };
  const advance = async (o: RecordData, to: 'processing' | 'ready_for_dispatch') => {
    setBusy(o.id);
    try {
      await advanceOrderProcessing(actor, o.id, to, o.version);
      toast(P.moved(String(o.orderNo), statusText(to)));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const kpi = (key: string, label: string, n: number, active: boolean, onClick: () => void) => ({ key, label, value: n, sub: P.orders(n), active, onClick });
  const err = (k: string) => errors[k] && <p className="field-error">{errors[k]}</p>;
  const set = (p: Partial<ProcessingInput>) => draft && setDraft({ ...draft, ...p });

  const editingRow = (o: RecordData) => (editing === o.id && draft ? draft : null);
  const columns: Column<ProcessingRow>[] = [
    {
      key: 'order',
      label: F.orderNo,
      className: 'nowrap',
      sort: ({ order: o }) => String(o.orderNo),
      render: ({ order: o }) => (
        <>
          <Link className="rel-link" to={recordPeekPath(actor.workspaceId, 'salesOrders', o.id)}>
            {String(o.orderNo)}
          </Link>
          <div className="muted small">
            {masterValue('orderKind', o.orderKind)?.label} · {formatDate(String(o.orderDate))}
          </div>
        </>
      ),
    },
    { key: 'customer', label: F.customerId, sort: ({ order: o }) => customerNameOf(o.customerId), render: ({ order: o }) => <span className="orders-clamp" data-tooltip={customerNameOf(o.customerId)}>{customerNameOf(o.customerId)}</span> },
    { key: 'product', label: F.productId, render: ({ order: o }) => (o.productId ? <span className="orders-clamp" data-tooltip={recordTitle('products', o.productId, actor)}>{recordTitle('products', o.productId, actor)}</span> : <EmptyValue />) },
    { key: 'status', label: F.status, className: 'nowrap', sort: ({ order: o }) => String(o.status), render: ({ order: o }) => chip('soStatus', o.status) },
    {
      key: 'po',
      label: F.poToPrincipalNo,
      render: ({ order: o }) => {
        const d = editingRow(o);
        return d ? (
          <>
            <TextField dense maxLength={40} aria-label={F.poToPrincipalNo} value={d.poToPrincipalNo} onChange={(e) => set({ poToPrincipalNo: e.target.value })} aria-invalid={!!errors.poToPrincipalNo || undefined} />
            {err('poToPrincipalNo')}
            <DatePicker label={F.poToPrincipalDate} placeholder={P.poDate} value={d.poToPrincipalDate} onChange={(v) => set({ poToPrincipalDate: v ?? '' })} invalid={!!errors.poToPrincipalDate} />
            {err('poToPrincipalDate')}
          </>
        ) : (
          <>
            {o.poToPrincipalNo ? String(o.poToPrincipalNo) : <EmptyValue />}
            {!!o.poToPrincipalDate && <div className="muted small">{formatDate(String(o.poToPrincipalDate))}</div>}
          </>
        );
      },
    },
    {
      key: 'eta',
      label: F.shipmentEta,
      className: 'nowrap',
      sort: ({ order: o }) => String(o.shipmentEta ?? '9999-12-31'),
      render: ({ order: o, etaPassed }) => {
        const d = editingRow(o);
        return d ? (
          <>
            <DatePicker label={F.shipmentEta} value={d.shipmentEta} onChange={(v) => set({ shipmentEta: v ?? '' })} invalid={!!errors.shipmentEta} />
            {err('shipmentEta')}
          </>
        ) : (
          <>
            {o.shipmentEta ? <DateText value={String(o.shipmentEta)} /> : <EmptyValue />}
            {etaPassed && <div className="small text-danger">{P.etaPassed}</div>}
          </>
        );
      },
    },
    {
      key: 'customs',
      label: F.customsStatus,
      className: 'nowrap',
      render: ({ order: o }) => {
        const d = editingRow(o);
        return d ? (
          <>
            <SelectMenu label={F.customsStatus} value={d.customsStatus} options={CUSTOMS_STATUSES.map((k) => ({ value: k, label: masterValue('customsStatus', k)?.label ?? k }))} onChange={(v) => set({ customsStatus: v })} invalid={!!errors.customsStatus} />
            {err('customsStatus')}
          </>
        ) : (
          chip('customsStatus', o.customsStatus)
        );
      },
    },
    {
      key: 'ready',
      label: P.readiness,
      className: 'nowrap',
      render: ({ order: o }) => {
        const d = editingRow(o);
        return d ? (
          <>
            <label className="orders-check">
              <Checkbox checked={d.machineReady} onChange={(e) => set({ machineReady: e.target.checked, pdiDone: e.target.checked ? d.pdiDone : false })} /> {F.machineReady}
            </label>
            {err('machineReady')}
            <label className="orders-check">
              <Checkbox checked={d.pdiDone} onChange={(e) => set({ pdiDone: e.target.checked })} /> {F.pdiDone}
            </label>
            {err('pdiDone')}
          </>
        ) : (
          <>
            <div className="small">
              {P.machineShort}: {o.machineReady ? O.common.yes : <span className="muted">{O.common.no}</span>}
            </div>
            <div className="small">
              {P.pdiShort}: {o.pdiDone ? O.common.yes : <span className="muted">{O.common.no}</span>}
            </div>
          </>
        );
      },
    },
    {
      key: 'act',
      label: O.table.actions,
      className: 'nowrap',
      render: ({ order: o, canEdit }) =>
        editingRow(o) ? (
          <>
            <Button size="compact" variant="primary" loading={busy === o.id} onClick={() => save(o)}>
              {O.actions.save}
            </Button>{' '}
            <Button size="compact" variant="ghost" onClick={stopEdit}>
              {O.actions.cancel}
            </Button>
          </>
        ) : canEdit ? (
          <div className="orders-actions">
            <IconButton icon="pencil" label={P.editRow(String(o.orderNo))} onClick={() => startEdit(o)} disabledReason={editing && editing !== o.id ? P.finishOther : undefined} />
            {['confirmed', 'payment_received'].includes(String(o.status)) && <IconButton icon="play" label={O.transitions.startProcessing} disabled={busy === o.id} onClick={() => advance(o, 'processing')} />}
            {o.status === 'processing' && <IconButton icon="truck" label={O.transitions.readyForDispatch} disabled={busy === o.id} onClick={() => advance(o, 'ready_for_dispatch')} />}
          </div>
        ) : (
          <Link className="link small" to={recordPeekPath(actor.workspaceId, 'salesOrders', o.id)}>
            {O.actions.open}
          </Link>
        ),
    },
  ];

  return (
    <div className="page orders-page">
      <PageHeader title={L.nav.pages.orderProcessing.title} description={P.description} />
      {!canProcess && <InlineAlert tone="info">{P.viewOnly}</InlineAlert>}
      {data.error ? (
        <ErrorState title={P.loadError} onRetry={data.retry}>
          {data.error}
        </ErrorState>
      ) : !data.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <KpiStrip
            label={P.stats}
            items={[
              kpi('processing', P.inProcessing, all.filter((r) => r.order.status === 'processing').length, status === 'processing', () => reset(() => (setStatus('processing'), setEtaOnly(false), setCustoms('')))),
              kpi('eta', P.etaOverdue, all.filter((r) => r.etaPassed).length, etaOnly, () => reset(() => (setStatus(''), setEtaOnly(true), setCustoms('')))),
              kpi('customs', P.customsPending, all.filter((r) => ['pending', 'filed'].includes(String(r.order.customsStatus))).length, customs === 'pending', () => reset(() => (setStatus(''), setEtaOnly(false), setCustoms('pending')))),
              kpi('ready', P.readyForDispatch, all.filter((r) => r.order.status === 'ready_for_dispatch').length, status === 'ready_for_dispatch', () => reset(() => (setStatus('ready_for_dispatch'), setEtaOnly(false), setCustoms('')))),
            ]}
          />
          <div className="content-surface">
            <DataTable
              label={P.tableTitle}
              rows={rows}
              rowKey={(r) => r.order.id}
              noun={P.noun}
              initialSort={{ key: 'eta', dir: 'asc' }}
              search={({ order: o }) => `${o.orderNo} ${o.poToPrincipalNo ?? ''} ${customerNameOf(o.customerId)} ${recordTitle('products', o.productId, actor)}`}
              summary={P.orders(rows.length)}
              activeFilters={[status, customs, kind, division].filter(Boolean).length + (etaOnly ? 1 : 0)}
              onClearFilters={() => (setStatus(''), setCustoms(''), setKind(''), setDivision(''), setEtaOnly(false))}
              empty={all.length ? undefined : { icon: 'sliders', title: P.empty, body: P.emptyBody }}
              emptyText={P.emptyFiltered}
              filters={
                <>
                  <SelectMenu label={P.statusFilter} value={status} options={[{ value: '', label: P.allStatuses }, ...SO_PROCESSING_STATUSES.map((k) => ({ value: k, label: statusText(k) }))]} onChange={setStatus} />
                  <SelectMenu label={P.customsFilter} value={customs} options={[{ value: '', label: P.allCustoms }, ...CUSTOMS_STATUSES.map((k) => ({ value: k, label: masterValue('customsStatus', k)?.label ?? k }))]} onChange={setCustoms} />
                  <SelectMenu label={P.typeFilter} value={kind} options={[{ value: '', label: P.allTypes }, ...activeMasterValues('orderKind').map((v) => ({ value: v.key, label: v.label }))]} onChange={setKind} />
                  <SelectMenu label={P.divisionFilter} value={division} options={[{ value: '', label: P.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={setDivision} />
                  <label className="orders-check">
                    <Checkbox checked={etaOnly} onChange={(e) => setEtaOnly(e.target.checked)} /> {P.onlyOverdueEta}
                  </label>
                </>
              }
              columns={columns}
            />
          </div>
        </>
      )}
    </div>
  );
}
