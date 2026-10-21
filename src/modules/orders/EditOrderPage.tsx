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
import { L } from '../../constants/labels';
import { recordPeekPath } from '../../lib/routes';
import { Textarea } from '../../components/primitives/controls';
import { NumberInput } from '../../components/primitives/NumberInput';
import { isBadNumber, NUMBER_LIMITS } from '../../services/validation';

const O = L.orders;
const P = O.pages.editOrder;

/** SO-03 / BR-22: customise a sales order before dispatch; differences beyond tolerance re-trigger approval. */
export function EditOrderPage() {
  const { recordId: orderId = '' } = useParams();
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const view = useServiceQuery(() => orderView(actor, orderId), [orderId, actor.user.id]);
  const [lines, setLines] = useState<QuoteLine[] | null>(null);
  const [freight, setFreight] = useState<number | null>(0);
  const [insurance, setInsurance] = useState<number | null>(0);
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
        <PageHeader title={P.title} />
        <ErrorState title={P.unavailable} onRetry={view.retry}>
          {view.error}
        </ErrorState>
      </div>
    );
  if (!view.data || !lines)
    return (
      <div className="page">
        <PageHeader title={P.title} />
        <Skeleton rows={8} />
      </div>
    );
  const v = view.data;
  const o = v.order;
  if (!v.canEditLines)
    return (
      <div className="page">
        <PageHeader title={P.titleFor(String(o.orderNo))} />
        <ErrorState title={P.notEditable}>{v.canEdit ? P.notEditableBody : P.roleCannot(actor.role.label)}</ErrorState>
        <p className="center">
          <Link to={recordPeekPath(actor.workspaceId, 'salesOrders', o.id)}>{O.actions.backToOrder}</Link>
        </p>
      </div>
    );

  const pos = String(o.placeOfSupply);
  // A value still being typed (NaN) previews as 0; the field shows why and the save is blocked (COM-05).
  const fin = (n: unknown) => (n !== null && Number.isFinite(Number(n)) ? Number(n) : 0);
  const badNumber =
    isBadNumber(freight, NUMBER_LIMITS.amount) ||
    isBadNumber(insurance, NUMBER_LIMITS.amount) ||
    lines.some((l) => !Number.isFinite(Number(l.qty)) || isBadNumber(Number(l.qty), NUMBER_LIMITS.qty) || isBadNumber(Number(l.discountPct ?? 0), NUMBER_LIMITS.discountPct) || isBadNumber(Number(l.discountAmt ?? 0), NUMBER_LIMITS.amount));
  const safeLines = lines.map((l) => ({ ...l, qty: fin(l.qty), discountPct: fin(l.discountPct), discountAmt: fin(l.discountAmt) }));
  const totals = computeTotals(safeLines, pos, fin(freight), fin(insurance));
  const reference = v.quotation ? v.quotationLines : v.lines;
  const diff = diffLines(safeLines, reference, totals.grandTotal, v.quotation ? Number(v.quotation.grandTotal) : Number(o.grandTotal));
  const tol = getPolicies().soTolerancePct;
  const willReapprove = o.status !== 'pending_approval' && (diff.added.length > 0 || diff.removed.length > 0 || Math.abs(diff.valueChangePct) > tol || diff.discountIncreased);
  const addable = (products.data ?? []).filter((p) => !lines.some((l) => l.productId === p.id) && listPriceFor(p.id));

  const save = async () => {
    if (badNumber) {
      toast(L.common.form.fixHighlighted, 'danger');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await updateOrderLines(actor, o.id, { lines, freight: fin(freight), insurance: fin(insurance), version, note });
      toast(r.reapproval ? P.savedReapproval(String(o.orderNo), r.summary) : P.saved(String(o.orderNo)), r.reapproval ? 'info' : 'success');
      navigate(recordPeekPath(actor.workspaceId, 'salesOrders', o.id));
    } catch (e) {
      setError(errorMessage(e));
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={P.titleFor(String(o.orderNo))}
        description={P.description}
        actions={
          <>
            <Button onClick={() => navigate(-1)}>{O.actions.cancel}</Button>
            <Button variant="primary" loading={busy} disabledReason={badNumber ? L.common.form.fixHighlighted : undefined} onClick={save}>
              {willReapprove ? O.actions.saveAndReapprove : O.actions.saveChanges}
            </Button>
          </>
        }
      />
      {v.quotation ? <DiffAlert diff={diff} tolerance={tol} /> : willReapprove && <InlineAlert tone="warning" title={P.reapprovalTitle}>{P.reapprovalBody(tol)}</InlineAlert>}
      <section className="panel">
        <LinesTable lines={lines} editable diffAgainst={v.quotation ? v.quotationLines : undefined} onChange={(i, p) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)))} onRemove={lines.length > 1 ? (i) => setLines(lines.filter((_, j) => j !== i)) : undefined} />
        <div className="form-grid">
          <Field id="eo-add" label={P.addProduct} help={P.addProductHelp}>
            <SelectMenu
              id="eo-add"
              block
              searchable
              label={P.addProduct}
              value={adding}
              placeholder={products.data ? (addable.length ? P.chooseProduct : P.noProducts) : P.loading}
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
          <Field id="eo-freight" label={P.freight}>
            <NumberInput id="eo-freight" prefix="₹" value={freight} onValueChange={setFreight} rule={NUMBER_LIMITS.amount} />
          </Field>
          <Field id="eo-ins" label={P.insurance}>
            <NumberInput id="eo-ins" prefix="₹" value={insurance} onValueChange={setInsurance} rule={NUMBER_LIMITS.amount} />
          </Field>
          <Field id="eo-note" label={P.note} wide help={P.noteHelp}>
            <Textarea id="eo-note" className="textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <TotalsBlock t={totals} intraState={pos === getPolicies().companyGstState} />
      </section>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </div>
  );
}
