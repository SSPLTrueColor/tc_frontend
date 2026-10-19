import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/primitives/Button';
import { DatePicker } from '../../../components/primitives/DatePicker';
import { Badge, ErrorState, Skeleton, useToast } from '../../../components/primitives/feedback';
import { Dialog } from '../../../components/primitives/overlay';
import { L } from '../../../constants/labels';
import { ROUTES, toPath } from '../../../constants/routes';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { todayKey } from '../../../lib/dates';
import { formatMoney } from '../../../lib/format';
import { uid } from '../../../lib/ids';
import { recordPagePath } from '../../../lib/routes';
import { errorMessage } from '../../../services/api/client';
import * as api from '../../../services/api/spares';
import { useActor } from '../../../services/hooks';
import { lineNet } from '../../../services/orders/lines';
import { ServiceError } from '../../../services/types';

const D = L.consumables.pages.repeatDialog;
const A = L.consumables.actions;

const Err = ({ id, msg }: { id: string; msg?: string }) =>
  msg ? (
    <p className="field-error" id={id} role="alert">
      {msg}
    </p>
  ) : null;

/**
 * CON-02 one-tap Repeat Order: previews the orders module's repeat draft (rate contract → price
 * list → previous price) and creates the sales order with the customer PO (BR-21).
 */
export function RepeatOrderDialog({ orderId, orderLabel, onClose }: { orderId: string; orderLabel: string; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useServiceQuery(() => api.repeatOrderDraft(actor, orderId), [actor.user.id, orderId]);
  const [poNo, setPoNo] = useState('');
  const [poDate, setPoDate] = useState<string | null>(todayKey());
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => uid('rep'));

  const submit = async () => {
    if (!q.data) return;
    setBusy(true);
    setErrors({});
    try {
      const order = await api.placeRepeatOrder(actor, { orderId, lines: q.data.lines, customerPoNo: poNo, customerPoDate: poDate ?? '', poFileName: file?.name ?? '', poFileSize: file?.size, idempotencyKey: key });
      toast(D.created(String(order.orderNo ?? order.id)));
      onClose();
      navigate(recordPagePath(actor.workspaceId, 'salesOrders', order.id));
    } catch (err) {
      // Required PO number, date and copy are validated by the orders service (BR-21).
      setErrors(err instanceof ServiceError && err.fieldErrors ? err.fieldErrors : { form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={D.title(orderLabel)}
      description={D.description}
      footer={
        <>
          <Button onClick={() => navigate(toPath(ROUTES.salesOrderNew, {}, { repeatOf: orderId }))}>{A.openFullForm}</Button>
          <span className="spacer" />
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" icon="reset" loading={busy} disabledReason={!q.data ? D.loading : undefined} onClick={submit}>
            {A.placeOrder}
          </Button>
        </>
      }
    >
      {q.error ? (
        <ErrorState title={D.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={4} />
      ) : (
        <div className="form-grid">
          <div className="sp-table-wrap span-all">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">{D.cols.product}</th>
                  <th scope="col" className="num">
                    {D.cols.qty}
                  </th>
                  <th scope="col" className="num">
                    {D.cols.price}
                  </th>
                  <th scope="col">{D.cols.source}</th>
                  <th scope="col" className="num">
                    {D.cols.amount}
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.lines.map((l, i) => (
                  <tr key={`${l.productId}-${i}`}>
                    <td>{l.description}</td>
                    <td className="num">{l.qty}</td>
                    <td className="num">{formatMoney(l.listPrice)}</td>
                    <td>
                      <Badge tone={/rate contract/i.test(q.data!.priceSource[i] ?? '') ? 'success' : 'neutral'}>{q.data!.priceSource[i]}</Badge>
                    </td>
                    <td className="num">{formatMoney(lineNet(l))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    <strong>{D.total}</strong>
                  </td>
                  <td className="num">
                    <strong>{formatMoney(q.data.totals.grandTotal)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="rep-po">
              {D.poNo} <span className="req">*</span>
            </label>
            <input id="rep-po" className="input" maxLength={40} value={poNo} onChange={(e) => setPoNo(e.target.value)} aria-invalid={!!errors.customerPoNo || undefined} aria-describedby={errors.customerPoNo ? 'rep-po-err' : undefined} data-autofocus />
            <Err id="rep-po-err" msg={errors.customerPoNo} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="rep-date">
              {D.poDate} <span className="req">*</span>
            </label>
            <DatePicker id="rep-date" block label={D.poDate} value={poDate} onChange={setPoDate} invalid={!!errors.customerPoDate} />
            <Err id="rep-date-err" msg={errors.customerPoDate} />
          </div>
          <div className="form-field span-all">
            <label className="field-label" htmlFor="rep-file">
              {D.poFile} <span className="req">*</span>
            </label>
            <input
              id="rep-file"
              type="file"
              className="input"
              accept=".pdf,.jpg,.jpeg,.png"
              aria-invalid={!!errors.poFileName || undefined}
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFile(f ? { name: f.name, size: f.size } : null);
              }}
            />
            <p className="muted small">{D.poFileHelp}</p>
            <Err id="rep-file-err" msg={errors.poFileName} />
          </div>
          <Err id="rep-form-err" msg={errors.form} />
        </div>
      )}
    </Dialog>
  );
}
