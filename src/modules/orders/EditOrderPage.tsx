import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { orderView, updateOrderLines } from '../../services/api/orders';
import { useActor } from '../../services/hooks';
import { listPriceFor } from '../../services/lookups';
import { getPolicies } from '../../services/policies';
import { queryRecords } from '../../services/runtime';
import { canReadResource } from '../../services/authz';
import { computeTotals, diffLines, type QuoteLine } from '../../services/orders/lines';
import { Button } from '../../components/primitives/Button';
import { ErrorState, InlineAlert, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { DiffAlert, Field, LinesTable, TotalsBlock } from './components';

/** FR-051 / BR-22: customise an order before dispatch; differences beyond tolerance re-trigger approval. */
export function EditOrderPage() {
  const { recordId = '', id = '' } = useParams();
  const orderId = recordId || id;
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const view = useServiceQuery(() => orderView(actor, orderId), [orderId, actor.user.id]);
  const [lines, setLines] = useState<QuoteLine[] | null>(null);
  const [freight, setFreight] = useState(0);
  const [insurance, setInsurance] = useState(0);
  const [version, setVersion] = useState(0);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const products = useServiceQuery(() => (canReadResource(actor, 'products') ? queryRecords(actor, 'products', { sort: [{ field: 'name', dir: 'asc' }] }).rows.filter((p) => p.status !== 'inactive') : []), [actor.user.id]);

  useEffect(() => {
    if (view.data && !lines) {
      setLines(view.data.lines);
      setFreight(Number(view.data.order.freight) || 0);
      setInsurance(Number(view.data.order.insurance) || 0);
      setVersion(view.data.order.version);
    }
  }, [view.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view.error)
    return (
      <div className="page">
        <PageHeader title="Edit sales order" />
        <ErrorState title="Order unavailable" onRetry={view.retry}>
          {view.error}
        </ErrorState>
      </div>
    );
  if (!view.data || !lines)
    return (
      <div className="page">
        <PageHeader title="Edit sales order" />
        <Skeleton rows={8} />
      </div>
    );
  const v = view.data;
  const o = v.order;
  if (!v.canEditLines)
    return (
      <div className="page">
        <PageHeader title={`Edit ${o.orderNo}`} />
        <ErrorState title="Not editable">{v.canEdit ? 'Lines can only change before the order is dispatched, and not while it is on hold or cancelled.' : `Your role (${actor.role.label}) cannot change this order.`}</ErrorState>
        <p className="center">
          <Link to={`/salesOrders?peek=${encodeURIComponent(o.id)}`}>Back to the order</Link>
        </p>
      </div>
    );

  const pos = String(o.placeOfSupply);
  const totals = computeTotals(lines, pos, freight, insurance);
  const reference = v.quotation ? v.quotationLines : v.lines;
  const diff = diffLines(lines, reference, totals.grandTotal, v.quotation ? Number(v.quotation.grandTotal) : Number(o.grandTotal));
  const tol = getPolicies().soTolerancePct;
  const willReapprove = o.status !== 'pending_approval' && (diff.added.length > 0 || diff.removed.length > 0 || Math.abs(diff.valueChangePct) > tol || diff.discountIncreased);
  const addable = (products.data ?? []).filter((p) => !lines.some((l) => l.productId === p.id) && listPriceFor(p.id));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await updateOrderLines(actor, o.id, { lines, freight, insurance, version, note });
      toast(r.reapproval ? `${o.orderNo} saved — sent back for approval (${r.summary})` : `${o.orderNo} saved`, r.reapproval ? 'info' : 'success');
      navigate(`/salesOrders?peek=${encodeURIComponent(o.id)}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={`Edit ${o.orderNo}`}
        description="Change quantities, discounts, freight or add products. Prices come from the quotation or today’s price list and cannot be edited here."
        actions={
          <>
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {willReapprove ? 'Save and send for re-approval' : 'Save changes'}
            </Button>
          </>
        }
      />
      {v.quotation ? <DiffAlert diff={diff} tolerance={tol} /> : willReapprove && <InlineAlert tone="warning" title="Needs re-approval">The change is beyond ±{tol}% or raises the discount.</InlineAlert>}
      <section className="panel">
        <LinesTable lines={lines} editable diffAgainst={v.quotation ? v.quotationLines : undefined} onChange={(i, p) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)))} onRemove={lines.length > 1 ? (i) => setLines(lines.filter((_, j) => j !== i)) : undefined} />
        <div className="form-grid">
          <Field id="eo-add" label="Add product" help="Only products with a valid list price today can be added.">
            <SelectMenu
              id="eo-add"
              block
              searchable
              label="Add product"
              value={adding}
              placeholder={products.data ? (addable.length ? 'Choose a product…' : 'No other priced products') : 'Loading…'}
              disabled={!addable.length}
              options={addable.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
              onChange={(pid) => {
                const p = addable.find((x) => x.id === pid)!;
                const price = listPriceFor(pid)!;
                setLines([...lines, { productId: pid, description: String(p.name), lineType: String(p.productType), qty: 1, listPrice: price.listPrice, discountPct: 0, discountAmt: 0, hsnSac: String(p.hsnSac ?? ''), gstRate: Number(p.gstRate) || 18 }]);
                setAdding('');
              }}
            />
          </Field>
          <Field id="eo-freight" label="Freight (₹)">
            <input id="eo-freight" className="input" type="number" min={0} value={freight} onChange={(e) => setFreight(Math.max(0, Number(e.target.value)))} />
          </Field>
          <Field id="eo-ins" label="Insurance (₹)">
            <input id="eo-ins" className="input" type="number" min={0} value={insurance} onChange={(e) => setInsurance(Math.max(0, Number(e.target.value)))} />
          </Field>
          <Field id="eo-note" label="Reason for the change" wide help="Shown to the approver when re-approval is needed.">
            <textarea id="eo-note" className="input textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <TotalsBlock t={totals} intraState={pos === getPolicies().companyGstState} />
      </section>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </div>
  );
}
