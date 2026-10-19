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
import { EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { chip } from './OrderTabs';

const O = L.orders;
const P = O.pages.orderProcessing;
const F = O.fields.salesOrders;
const PAGE = 25;

type SortKey = 'shipmentEta' | 'customer';

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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [customs, setCustoms] = useState('');
  const [kind, setKind] = useState('');
  const [division, setDivision] = useState('');
  const [etaOnly, setEtaOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'shipmentEta', dir: 1 });
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProcessingInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const canProcess = can(actor, 'orders.process');

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (data.data ?? []).filter(({ order: o, etaPassed }) => {
      if (status && o.status !== status) return false;
      if (customs && o.customsStatus !== customs) return false;
      if (kind && o.orderKind !== kind) return false;
      if (division && o.divisionId !== division) return false;
      if (etaOnly && !etaPassed) return false;
      return !needle || `${o.orderNo} ${o.poToPrincipalNo ?? ''} ${customerNameOf(o.customerId)} ${recordTitle('products', o.productId, actor)}`.toLowerCase().includes(needle);
    });
    const val = (r: ProcessingRow): string => (sort.key === 'customer' ? customerNameOf(r.order.customerId) : String(r.order[sort.key] ?? '9999-12-31'));
    return [...list].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  }, [data.data, search, status, customs, kind, division, etaOnly, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <NoAccess what={P.noAccess} />;

  const all = data.data ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE);
  const filtered = !!(search || status || customs || kind || division || etaOnly);
  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };

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

  const sortBtn = (key: SortKey, label: string) => (
    <button type="button" className="th-btn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <span className="th-label">{label}</span>
      <span aria-hidden="true">{sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
    </button>
  );
  const stat = (label: string, n: number, onClick: () => void) => (
    <button type="button" className="stat" onClick={onClick}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{n}</span>
      <span className="stat-sub">{P.orders(n)}</span>
    </button>
  );
  const err = (k: string) => errors[k] && <p className="field-error">{errors[k]}</p>;
  const set = (p: Partial<ProcessingInput>) => draft && setDraft({ ...draft, ...p });

  return (
    <div className="page">
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
          <section className="stats" aria-label={P.stats}>
            {stat(P.inProcessing, all.filter((r) => r.order.status === 'processing').length, () => reset(() => (setStatus('processing'), setEtaOnly(false), setCustoms(''))))}
            {stat(P.etaOverdue, all.filter((r) => r.etaPassed).length, () => reset(() => (setStatus(''), setEtaOnly(true), setCustoms(''))))}
            {stat(P.customsPending, all.filter((r) => ['pending', 'filed'].includes(String(r.order.customsStatus))).length, () => reset(() => (setStatus(''), setEtaOnly(false), setCustoms('pending'))))}
            {stat(P.readyForDispatch, all.filter((r) => r.order.status === 'ready_for_dispatch').length, () => reset(() => (setStatus('ready_for_dispatch'), setEtaOnly(false), setCustoms(''))))}
          </section>
          <div className="toolbar">
            <input type="search" className="input input-compact" placeholder={P.search} aria-label={P.searchAria} value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
            <SelectMenu label={P.statusFilter} value={status} options={[{ value: '', label: P.allStatuses }, ...SO_PROCESSING_STATUSES.map((k) => ({ value: k, label: statusText(k) }))]} onChange={(v) => reset(() => setStatus(v))} />
            <SelectMenu label={P.customsFilter} value={customs} options={[{ value: '', label: P.allCustoms }, ...CUSTOMS_STATUSES.map((k) => ({ value: k, label: masterValue('customsStatus', k)?.label ?? k }))]} onChange={(v) => reset(() => setCustoms(v))} />
            <SelectMenu label={P.typeFilter} value={kind} options={[{ value: '', label: P.allTypes }, ...activeMasterValues('orderKind').map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => reset(() => setKind(v))} />
            <SelectMenu label={P.divisionFilter} value={division} options={[{ value: '', label: P.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => reset(() => setDivision(v))} />
            <label className="orders-check">
              <input type="checkbox" checked={etaOnly} onChange={(e) => reset(() => setEtaOnly(e.target.checked))} /> {P.onlyOverdueEta}
            </label>
          </div>
          <div className="content-surface">
            {rows.length === 0 ? (
              <EmptyState icon="sliders" title={filtered ? P.emptyFiltered : P.empty}>
                {P.emptyBody}
              </EmptyState>
            ) : (
              <>
                <div className="table-scroll">
                  <table className="mini-table orders-processing">
                    <thead>
                      <tr>
                        <th scope="col">{F.orderNo}</th>
                        <th scope="col">{sortBtn('customer', F.customerId)}</th>
                        <th scope="col">{F.productId}</th>
                        <th scope="col">{F.status}</th>
                        <th scope="col">{F.poToPrincipalNo}</th>
                        <th scope="col">{sortBtn('shipmentEta', F.shipmentEta)}</th>
                        <th scope="col">{F.customsStatus}</th>
                        <th scope="col">{F.machineReady}</th>
                        <th scope="col">{F.pdiDone}</th>
                        <th scope="col">{O.table.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(({ order: o, etaPassed, canEdit }) => {
                        const isEditing = editing === o.id && draft;
                        return (
                          <tr key={o.id}>
                            <td className="nowrap">
                              <Link className="rel-link" to={recordPeekPath(actor.workspaceId, 'salesOrders', o.id)}>
                                {String(o.orderNo)}
                              </Link>
                              <div className="muted small">
                                {masterValue('orderKind', o.orderKind)?.label} · {formatDate(String(o.orderDate))}
                              </div>
                            </td>
                            <td>{customerNameOf(o.customerId)}</td>
                            <td>{o.productId ? recordTitle('products', o.productId, actor) : <EmptyValue />}</td>
                            <td>{chip('soStatus', o.status)}</td>
                            {isEditing ? (
                              <>
                                <td>
                                  <input className="input input-compact" maxLength={40} aria-label={F.poToPrincipalNo} value={draft.poToPrincipalNo} onChange={(e) => set({ poToPrincipalNo: e.target.value })} aria-invalid={!!errors.poToPrincipalNo || undefined} />
                                  {err('poToPrincipalNo')}
                                  <DatePicker label={F.poToPrincipalDate} placeholder={P.poDate} value={draft.poToPrincipalDate} onChange={(v) => set({ poToPrincipalDate: v ?? '' })} invalid={!!errors.poToPrincipalDate} />
                                  {err('poToPrincipalDate')}
                                </td>
                                <td>
                                  <DatePicker label={F.shipmentEta} value={draft.shipmentEta} onChange={(v) => set({ shipmentEta: v ?? '' })} invalid={!!errors.shipmentEta} />
                                  {err('shipmentEta')}
                                </td>
                                <td>
                                  <SelectMenu label={F.customsStatus} value={draft.customsStatus} options={CUSTOMS_STATUSES.map((k) => ({ value: k, label: masterValue('customsStatus', k)?.label ?? k }))} onChange={(v) => set({ customsStatus: v })} invalid={!!errors.customsStatus} />
                                  {err('customsStatus')}
                                </td>
                                <td>
                                  <input type="checkbox" aria-label={F.machineReady} checked={draft.machineReady} onChange={(e) => set({ machineReady: e.target.checked, pdiDone: e.target.checked ? draft.pdiDone : false })} />
                                  {err('machineReady')}
                                </td>
                                <td>
                                  <input type="checkbox" aria-label={F.pdiDone} checked={draft.pdiDone} onChange={(e) => set({ pdiDone: e.target.checked })} />
                                  {err('pdiDone')}
                                </td>
                                <td className="nowrap">
                                  <Button size="compact" variant="primary" loading={busy === o.id} onClick={() => save(o)}>
                                    {O.actions.save}
                                  </Button>{' '}
                                  <Button size="compact" variant="ghost" onClick={stopEdit}>
                                    {O.actions.cancel}
                                  </Button>
                                </td>
                              </>
                            ) : (
                              <>
                                <td>
                                  {o.poToPrincipalNo ? String(o.poToPrincipalNo) : <EmptyValue />}
                                  {!!o.poToPrincipalDate && <div className="muted small">{formatDate(String(o.poToPrincipalDate))}</div>}
                                </td>
                                <td className="nowrap">
                                  {o.shipmentEta ? <DateText value={String(o.shipmentEta)} /> : <EmptyValue />}
                                  {etaPassed && <div className="small text-danger">{P.etaPassed}</div>}
                                </td>
                                <td>{chip('customsStatus', o.customsStatus)}</td>
                                <td>{o.machineReady ? O.common.yes : O.common.no}</td>
                                <td>{o.pdiDone ? O.common.yes : O.common.no}</td>
                                <td className="nowrap">
                                  {canEdit ? (
                                    <>
                                      <IconButton icon="pencil" label={P.editRow(String(o.orderNo))} onClick={() => startEdit(o)} disabledReason={editing && editing !== o.id ? P.finishOther : undefined} />
                                      {['confirmed', 'payment_received'].includes(String(o.status)) && (
                                        <Button size="compact" loading={busy === o.id} onClick={() => advance(o, 'processing')}>
                                          {O.transitions.startProcessing}
                                        </Button>
                                      )}
                                      {o.status === 'processing' && (
                                        <Button size="compact" loading={busy === o.id} onClick={() => advance(o, 'ready_for_dispatch')}>
                                          {O.transitions.readyForDispatch}
                                        </Button>
                                      )}
                                    </>
                                  ) : (
                                    <Link className="link small" to={recordPeekPath(actor.workspaceId, 'salesOrders', o.id)}>
                                      {O.actions.open}
                                    </Link>
                                  )}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="grid-footer">
                  <span className="grid-footer-range">{P.range(current * PAGE + 1, Math.min(rows.length, (current + 1) * PAGE), rows.length)}</span>
                  <nav className="grid-pages" aria-label={O.pager.nav}>
                    <IconButton icon="chevron-left" label={O.pager.prev} disabledReason={current === 0 ? O.pager.first : undefined} onClick={() => setPage(current - 1)} />
                    <span className="muted small">{O.pager.page(current + 1, pageCount)}</span>
                    <IconButton icon="chevron-right" label={O.pager.next} disabledReason={current >= pageCount - 1 ? O.pager.last : undefined} onClick={() => setPage(current + 1)} />
                  </nav>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
