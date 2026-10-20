import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { uid } from '../../lib/ids';
import { errorMessage } from '../../services/api/client';
import { createOrder, customerNameOf, draftFromQuotation, draftFromRepeat, eligibleQuotations, repeatableOrders } from '../../services/api/orders';
import { perm } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getPolicies } from '../../services/policies';
import { recordTitle } from '../../services/runtime';
import { computeTotals, diffLines, type QuoteLine } from '../../services/orders/lines';
import { ServiceError } from '../../services/types';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { recordPeekPath } from '../../lib/routes';
import { DiffAlert, Field, FilePick, LinesTable, TotalsBlock } from './components';
import { LinkButton, SearchInput, TextField } from '../../components/primitives/controls';

const O = L.orders;
const P = O.pages.newOrder;
const F = O.fields.salesOrders;

/** SO-01 / CON-02: Generate Sales Order from an accepted quotation, or repeat a consumables order. */
export function NewOrderPage() {
  const actor = useActor();
  const [params] = useSearchParams();
  const quotation = params.get('quotation');
  const repeatOf = params.get('repeatOf');
  if (!perm(actor, 'salesOrders').create) return <NoAccess what={P.noAccess} />;
  if (quotation) return <OrderForm source="quotation" sourceId={quotation} />;
  if (repeatOf) return <OrderForm source="repeat" sourceId={repeatOf} />;
  return <SourcePicker />;
}

function SourcePicker() {
  const actor = useActor();
  const [q, setQ] = useState('');
  const data = useServiceQuery(() => ({ quotes: eligibleQuotations(actor), repeats: repeatableOrders(actor) }), [actor.user.id]);
  const needle = q.trim().toLowerCase();
  const match = (...s: unknown[]) => !needle || s.some((x) => String(x ?? '').toLowerCase().includes(needle));
  return (
    <div className="page">
      <PageHeader title={P.title} description={P.description} />
      <div className="toolbar">
        <SearchInput dense placeholder={P.search} aria-label={P.searchAria} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {data.error ? (
        <ErrorState title={P.loadError} onRetry={data.retry}>
          {data.error}
        </ErrorState>
      ) : !data.data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{P.acceptedQuotations}</h2>
            </div>
            {data.data.quotes.filter((x) => match(x.quoteNo, x.id, customerNameOf(x.customerId))).length ? (
              <ul className="flow-list">
                {data.data.quotes
                  .filter((x) => match(x.quoteNo, x.id, customerNameOf(x.customerId)))
                  .map((x) => (
                    <li key={x.id} className="flow-item">
                      <span className="flow-main">
                        <span className="flow-title">
                          {String(x.quoteNo ?? x.id)} · {customerNameOf(x.customerId)}
                        </span>
                        <span className="muted small">
                          {P.accepted(formatMoney(Number(x.grandTotal)), x.acceptedAt ? formatDate(String(x.acceptedAt)) : formatDate(String(x.quoteDate)))}
                        </span>
                      </span>
                      <LinkButton variant="primary" to={toPath(ROUTES.salesOrderNew, {}, { quotation: x.id })}>{O.actions.generateSalesOrder}</LinkButton>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState icon="receipt" title={P.noQuotations}>
                {P.noQuotationsBody}
              </EmptyState>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{P.repeatPanel}</h2>
            </div>
            {data.data.repeats.filter((x) => match(x.orderNo, customerNameOf(x.customerId))).length ? (
              <ul className="flow-list">
                {data.data.repeats
                  .filter((x) => match(x.orderNo, customerNameOf(x.customerId)))
                  .slice(0, 20)
                  .map((x) => (
                    <li key={x.id} className="flow-item">
                      <span className="flow-main">
                        <span className="flow-title">
                          {customerNameOf(x.customerId)} · {String(x.orderNo)}
                        </span>
                        <span className="muted small">
                          {P.lastOrdered(formatDate(String(x.orderDate)), formatMoney(Number(x.grandTotal)))}
                        </span>
                      </span>
                      <LinkButton to={toPath(ROUTES.salesOrderNew, {}, { repeatOf: x.id })}>{O.actions.repeatOrder}</LinkButton>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState icon="reset" title={P.noRepeats} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function OrderForm({ source, sourceId }: { source: 'quotation' | 'repeat'; sourceId: string }) {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const draft = useServiceQuery(() => (source === 'quotation' ? draftFromQuotation(actor, sourceId) : draftFromRepeat(actor, sourceId)), [source, sourceId, actor.user.id]);
  const [lines, setLines] = useState<QuoteLine[] | null>(null);
  const [po, setPo] = useState({ customerPoNo: '', customerPoDate: todayKey(), poFileName: '', poFileSize: 0 });
  const [site, setSite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const idem = useRef(uid('so'));

  useEffect(() => {
    if (draft.data && !lines) {
      setLines(draft.data.lines);
      // PO captured when the quotation was accepted carries forward (no re-entry, SO-02).
      if (draft.data.po) setPo({ customerPoNo: draft.data.po.customerPoNo, customerPoDate: draft.data.po.customerPoDate || todayKey(), poFileName: draft.data.po.poFileName, poFileSize: 0 });
      const install = draft.data.siteAddresses.find((a) => a.addressType === 'installation') ?? draft.data.siteAddresses[0];
      if (install) setSite(install.id);
    }
  }, [draft.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = source === 'quotation' ? P.fromQuotation : P.repeatTitle;
  if (draft.error)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState title={P.cannotStart} onRetry={draft.retry}>
          {draft.error}
        </ErrorState>
        <p className="center">
          <Link to={ROUTES.salesOrderNew}>{O.actions.chooseAnotherQuotation}</Link>
        </p>
      </div>
    );
  if (!draft.data || !lines)
    return (
      <div className="page">
        <PageHeader title={title} />
        <Skeleton rows={8} />
      </div>
    );
  const d = draft.data;
  if (d.blocker)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState title={P.blocked}>{d.blocker}</ErrorState>
        <p className="center">
          <Link to={ROUTES.salesOrderNew}>{O.actions.backToQuotations}</Link>
        </p>
      </div>
    );

  const totals = computeTotals(lines, d.placeOfSupply, d.freight, d.insurance);
  const diff = d.quotationLines ? diffLines(lines, d.quotationLines, totals.grandTotal, d.quotationTotal ?? totals.grandTotal) : undefined;
  const intra = d.placeOfSupply === getPolicies().companyGstState;

  const submit = async () => {
    setBusy(true);
    setFormError('');
    try {
      const order = await createOrder(actor, { source, sourceId, lines, siteAddressId: site || undefined, idempotencyKey: idem.current, ...po });
      toast(P.created(String(order.orderNo)));
      navigate(recordPeekPath(actor.workspaceId, 'salesOrders', order.id));
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
      setFormError(errorMessage(e));
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={title}
        description={P.formDescription}
        actions={
          <>
            <Button onClick={() => navigate(-1)}>{O.actions.cancel}</Button>
            <Button variant="primary" loading={busy} onClick={submit}>
              {source === 'quotation' ? O.actions.generateSalesOrder : O.actions.repeatOrder}
            </Button>
          </>
        }
      />
      <div className="orders-grid">
        <section className="panel">
          <h2 className="panel-title">{P.source}</h2>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>{F.customerId}</dt>
              <dd>
                <Link to={recordPeekPath(actor.workspaceId, 'customers', d.customerId)}>{d.customerName}</Link>
              </dd>
            </div>
            <div className="detail-row">
              <dt>{source === 'quotation' ? F.quotationId : F.repeatOfId}</dt>
              <dd>
                <Link to={recordPeekPath(actor.workspaceId, source === 'quotation' ? 'quotations' : 'salesOrders', sourceId)}>{recordTitle(source === 'quotation' ? 'quotations' : 'salesOrders', sourceId, actor)}</Link>
              </dd>
            </div>
            <div className="detail-row">
              <dt>{F.orderKind}</dt>
              <dd>{O.masters.orderKind.values[d.orderKind]}</dd>
            </div>
            <div className="detail-row">
              <dt>{F.placeOfSupply}</dt>
              <dd>{intra ? P.intra : P.inter}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2 className="panel-title">{P.poPanel}</h2>
          <div className="form-grid cols-2">
            <Field id="so-po" label={F.customerPoNo} required error={errors.customerPoNo}>
              <TextField id="so-po" maxLength={40} value={po.customerPoNo} onChange={(e) => setPo({ ...po, customerPoNo: e.target.value })} aria-invalid={!!errors.customerPoNo || undefined} data-autofocus />
            </Field>
            <Field id="so-po-date" label={F.customerPoDate} required error={errors.customerPoDate}>
              <DatePicker id="so-po-date" label={F.customerPoDate} value={po.customerPoDate} onChange={(v) => setPo({ ...po, customerPoDate: v ?? '' })} invalid={!!errors.customerPoDate} />
            </Field>
            <Field id="so-po-file" label={F.poFileName} required error={errors.poFileName} wide>
              <FilePick id="so-po-file" value={po.poFileName} onPick={(name, size) => setPo({ ...po, poFileName: name, poFileSize: size })} invalid={!!errors.poFileName} />
            </Field>
            {d.orderKind === 'machine' && (
              <Field id="so-site" label={F.siteAddressId} required error={errors.siteAddressId} wide help={F.siteAddressIdHelp}>
                {d.siteAddresses.length ? (
                  <SelectMenu id="so-site" block label={F.siteAddressId} value={site} options={d.siteAddresses.map((a) => ({ value: a.id, label: `${a.label ?? a.addressType}: ${a.line1}, ${a.city}` }))} onChange={setSite} />
                ) : (
                  <span className="muted small">{P.noAddresses}</span>
                )}
              </Field>
            )}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{P.linesPanel}</h2>
        </div>
        {diff && <DiffAlert diff={diff} tolerance={getPolicies().soTolerancePct} />}
        <LinesTable
          lines={lines}
          editable
          diffAgainst={d.quotationLines}
          priceSource={source === 'repeat' ? d.priceSource : undefined}
          onChange={(i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))}
          onRemove={lines.length > 1 ? (i) => setLines(lines.filter((_, j) => j !== i)) : undefined}
        />
        <TotalsBlock t={totals} intraState={intra} />
      </section>
      {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
    </div>
  );
}
