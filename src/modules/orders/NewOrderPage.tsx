import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatDate, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { uid } from '../../lib/ids';
import { errorMessage } from '../../services/api/client';
import { createOrder, draftFromQuotation, draftFromRepeat, eligibleQuotations, repeatableOrders } from '../../services/api/orders';
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
import { DiffAlert, Field, FilePick, LinesTable, TotalsBlock } from './components';

/** FR-049 / CON-02: start a sales order from an accepted quotation, or repeat a consumables order. */
export function NewOrderPage() {
  const actor = useActor();
  const [params] = useSearchParams();
  const quotation = params.get('quotation');
  const repeatOf = params.get('repeatOf');
  if (!perm(actor, 'salesOrders').create) return <NoAccess what="creating sales orders" />;
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
      <PageHeader title="New sales order" description="Orders start from an accepted quotation whose opportunity is Won (BR-20), or repeat an earlier consumables order (CON-02)." />
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder="Search customer or number" aria-label="Search quotations and orders" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {data.error ? (
        <ErrorState title="Could not load quotations" onRetry={data.retry}>
          {data.error}
        </ErrorState>
      ) : !data.data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Accepted quotations</h2>
            </div>
            {data.data.quotes.filter((x) => match(x.quoteNo, x.id, recordTitle('customers', x.customerId, actor))).length ? (
              <ul className="flow-list">
                {data.data.quotes
                  .filter((x) => match(x.quoteNo, x.id, recordTitle('customers', x.customerId, actor)))
                  .map((x) => (
                    <li key={x.id} className="flow-item">
                      <span className="flow-main">
                        <span className="flow-title">
                          {String(x.quoteNo ?? x.id)} · {recordTitle('customers', x.customerId, actor)}
                        </span>
                        <span className="muted small">
                          {formatMoney(Number(x.grandTotal))} · accepted {x.acceptedAt ? formatDate(String(x.acceptedAt)) : formatDate(String(x.quoteDate))}
                        </span>
                      </span>
                      <Link className="btn btn-primary" to={`/orders/new?quotation=${encodeURIComponent(x.id)}`}>
                        <span className="btn-label">Create order</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState icon="receipt" title="No quotations ready for an order">
                A quotation needs to be Accepted (latest revision) and its opportunity Won, with no order yet.
              </EmptyState>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Repeat a consumables order</h2>
            </div>
            {data.data.repeats.filter((x) => match(x.orderNo, recordTitle('customers', x.customerId, actor))).length ? (
              <ul className="flow-list">
                {data.data.repeats
                  .filter((x) => match(x.orderNo, recordTitle('customers', x.customerId, actor)))
                  .slice(0, 20)
                  .map((x) => (
                    <li key={x.id} className="flow-item">
                      <span className="flow-main">
                        <span className="flow-title">
                          {recordTitle('customers', x.customerId, actor)} · {String(x.orderNo)}
                        </span>
                        <span className="muted small">
                          Last ordered {formatDate(String(x.orderDate))} · {formatMoney(Number(x.grandTotal))}
                        </span>
                      </span>
                      <Link className="btn btn-secondary" to={`/orders/new?repeatOf=${encodeURIComponent(x.id)}`}>
                        <span className="btn-label">Repeat</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState icon="reset" title="No consumables orders to repeat" />
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
      const install = draft.data.siteAddresses.find((a) => a.addressType === 'installation') ?? draft.data.siteAddresses[0];
      if (install) setSite(install.id);
    }
  }, [draft.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = source === 'quotation' ? 'New sales order from quotation' : 'Repeat consumables order';
  if (draft.error)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState title="Cannot start this order" onRetry={draft.retry}>
          {draft.error}
        </ErrorState>
        <p className="center">
          <Link to="/orders/new">Choose another quotation</Link>
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
        <ErrorState title="This quotation cannot become an order yet">{d.blocker}</ErrorState>
        <p className="center">
          <Link to="/orders/new">Back to quotations</Link>
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
      toast(`${order.orderNo} created and sent for approval`);
      navigate(`/salesOrders?peek=${encodeURIComponent(order.id)}`);
    } catch (e) {
      if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={title}
        description="Customer, products, rates and terms come from the source document. Changes are highlighted; the order goes to your reporting manager for approval."
        actions={
          <>
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={submit}>
              Create and submit for approval
            </Button>
          </>
        }
      />
      <div className="orders-grid">
        <section className="panel">
          <h2 className="panel-title">Source</h2>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Customer</dt>
              <dd>
                <Link to={`/customers?peek=${encodeURIComponent(d.customerId)}`}>{recordTitle('customers', d.customerId, actor)}</Link>
              </dd>
            </div>
            <div className="detail-row">
              <dt>{source === 'quotation' ? 'Quotation' : 'Repeat of'}</dt>
              <dd>
                <Link to={source === 'quotation' ? `/quotations?peek=${encodeURIComponent(sourceId)}` : `/salesOrders?peek=${encodeURIComponent(sourceId)}`}>{recordTitle(source === 'quotation' ? 'quotations' : 'salesOrders', sourceId, actor)}</Link>
              </dd>
            </div>
            <div className="detail-row">
              <dt>Order kind</dt>
              <dd>{d.orderKind === 'machine' ? 'Machine' : 'Consumables'}</dd>
            </div>
            <div className="detail-row">
              <dt>Place of supply</dt>
              <dd>{intra ? 'Within the state — CGST + SGST' : 'Inter-state — IGST'}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2 className="panel-title">Customer PO</h2>
          <div className="form-grid cols-2">
            <Field id="so-po" label="PO number" required error={errors.customerPoNo}>
              <input id="so-po" className="input" maxLength={40} value={po.customerPoNo} onChange={(e) => setPo({ ...po, customerPoNo: e.target.value })} aria-invalid={!!errors.customerPoNo || undefined} data-autofocus />
            </Field>
            <Field id="so-po-date" label="PO date" required error={errors.customerPoDate}>
              <DatePicker id="so-po-date" label="PO date" value={po.customerPoDate} onChange={(v) => setPo({ ...po, customerPoDate: v ?? '' })} invalid={!!errors.customerPoDate} />
            </Field>
            <Field id="so-po-file" label="PO copy" required error={errors.poFileName} wide>
              <FilePick id="so-po-file" value={po.poFileName} onPick={(name, size) => setPo({ ...po, poFileName: name, poFileSize: size })} invalid={!!errors.poFileName} />
            </Field>
            {d.orderKind === 'machine' && (
              <Field id="so-site" label="Installation site" error={errors.siteAddressId} wide help="Used for the installation job created on delivery.">
                {d.siteAddresses.length ? (
                  <SelectMenu id="so-site" block label="Installation site" value={site} options={d.siteAddresses.map((a) => ({ value: a.id, label: `${a.label ?? a.addressType}: ${a.line1}, ${a.city}` }))} onChange={setSite} />
                ) : (
                  <span className="muted small">No addresses on file for this customer.</span>
                )}
              </Field>
            )}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Lines</h2>
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
