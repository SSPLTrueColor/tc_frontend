/** Small UI pieces shared by the orders pages and record tabs. */
import type { ReactNode } from 'react';
import { formatMoney } from '../../lib/format';
import { cx } from '../../lib/format';
import { getPolicies } from '../../services/policies';
import { lineDiscount, lineDiscountPct, lineGross, lineNet, type LineDiff, type OrderTotals, type QuoteLine } from '../../services/orders/lines';
import { amountInWords } from '../../services/lookups';
import { EmptyValue } from '../../components/primitives/display';
import { InfoTip } from '../../components/primitives/InfoTip';
import { InlineAlert } from '../../components/primitives/feedback';

export function Field({ id, label, required, help, error, children, wide }: { id: string; label: string; required?: boolean; help?: string; error?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('form-field', wide && 'span-all')}>
      <span className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label} {required && <span className="req">*</span>}
        </label>
        {help && <InfoTip text={help} label={`About ${label}`} />}
      </span>
      {children}
      {error && (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Simulated upload: keeps the file name and size only (nothing is stored). */
export function FilePick({ id, value, onPick, accept = '.pdf,.jpg,.jpeg,.png', invalid }: { id: string; value: string; onPick: (name: string, size: number) => void; accept?: string; invalid?: boolean }) {
  return (
    <div className="orders-file">
      <input
        id={id}
        type="file"
        accept={accept}
        className="input"
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f.name, f.size);
        }}
      />
      {value && <span className="muted small">Attached: {value}</span>}
      <span className="muted small">PDF, JPG or PNG up to {getPolicies().maxFileMb} MB · simulated upload (file not stored)</span>
    </div>
  );
}

export function LinesTable({
  lines,
  editable,
  onChange,
  onRemove,
  diffAgainst,
  priceSource,
}: {
  lines: QuoteLine[];
  editable?: boolean;
  onChange?: (i: number, patch: Partial<QuoteLine>) => void;
  onRemove?: (i: number) => void;
  diffAgainst?: QuoteLine[];
  priceSource?: string[];
}) {
  if (!lines.length)
    return (
      <p className="muted">
        <EmptyValue label="No lines" />
      </p>
    );
  const ref = new Map((diffAgainst ?? []).map((l) => [l.productId, l]));
  return (
    <div className="table-scroll">
      <table className="mini-table orders-lines">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Item</th>
            <th scope="col">HSN/SAC</th>
            <th scope="col" className="th-num">
              Qty
            </th>
            <th scope="col" className="th-num">
              List price
            </th>
            <th scope="col" className="th-num">
              Discount %
            </th>
            <th scope="col" className="th-num">
              GST
            </th>
            <th scope="col" className="th-num">
              Net
            </th>
            {editable && onRemove && (
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const before = ref.get(l.productId);
            const isNew = diffAgainst && !before;
            const changed = before && (Number(before.qty) !== Number(l.qty) || lineDiscount(before) !== lineDiscount(l));
            return (
              <tr key={`${l.productId}-${i}`} className={cx(isNew && 'orders-row-added', changed && 'orders-row-changed')}>
                <td>{i + 1}</td>
                <td>
                  {l.description}
                  {isNew && <span className="tag tone-warning orders-tag">Not in quotation</span>}
                  {changed && <span className="tag tone-info orders-tag">Changed</span>}
                  {priceSource?.[i] && <div className="muted small">Price: {priceSource[i]}</div>}
                </td>
                <td className="mono small">{l.hsnSac || <EmptyValue />}</td>
                <td className="num">
                  {editable ? (
                    <input className="input input-compact orders-num" type="number" min={1} step={1} value={l.qty} aria-label={`Quantity, line ${i + 1}`} onChange={(e) => onChange?.(i, { qty: Number(e.target.value) })} />
                  ) : (
                    l.qty
                  )}
                </td>
                <td className="num">{formatMoney(Number(l.listPrice))}</td>
                <td className="num">
                  {editable ? (
                    <input
                      className="input input-compact orders-num"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={l.discountAmt ? lineDiscountPct(l) : l.discountPct ?? 0}
                      aria-label={`Discount percent, line ${i + 1}`}
                      onChange={(e) => onChange?.(i, { discountPct: Number(e.target.value), discountAmt: 0 })}
                    />
                  ) : (
                    `${lineDiscountPct(l)}%`
                  )}
                </td>
                <td className="num">{l.gstRate}%</td>
                <td className="num">
                  {formatMoney(lineNet(l))}
                  {lineDiscount(l) > 0 && <div className="muted small">of {formatMoney(lineGross(l))}</div>}
                </td>
                {editable && onRemove && (
                  <td>
                    <button type="button" className="link small" onClick={() => onRemove(i)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TotalsBlock({ t, intraState }: { t: OrderTotals; intraState: boolean }) {
  const row = (label: string, v: number, strong = false) => (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd className="num">{strong ? <strong>{formatMoney(v)}</strong> : formatMoney(v)}</dd>
    </div>
  );
  return (
    <dl className="detail-list orders-totals">
      {row('Subtotal', t.subtotal)}
      {t.discountTotal > 0 && row('Discount', -t.discountTotal)}
      {t.freight > 0 && row('Freight', t.freight)}
      {t.insurance > 0 && row('Insurance', t.insurance)}
      {row('Taxable value', t.taxable)}
      {intraState ? (
        <>
          {row('CGST', t.cgst)}
          {row('SGST', t.sgst)}
        </>
      ) : (
        row('IGST', t.igst)
      )}
      {row('Order value', t.grandTotal, true)}
      <div className="detail-row">
        <dt>In words</dt>
        <dd className="small">{amountInWords(t.grandTotal)}</dd>
      </div>
    </dl>
  );
}

export function DiffAlert({ diff, tolerance }: { diff: LineDiff; tolerance: number }) {
  const reasons: string[] = [];
  if (diff.added.length) reasons.push(`${diff.added.length} line(s) not in the quotation`);
  if (diff.removed.length) reasons.push(`${diff.removed.length} quotation line(s) removed`);
  if (Math.abs(diff.valueChangePct) > tolerance) reasons.push(`value ${diff.valueChangePct > 0 ? '+' : ''}${diff.valueChangePct}% vs quotation (tolerance ±${tolerance}%)`);
  if (diff.discountIncreased) reasons.push('discount higher than quoted');
  if (!reasons.length && !diff.changed.length && !diff.valueChangePct) return null;
  return (
    <InlineAlert tone={reasons.length ? 'warning' : 'info'} title={reasons.length ? 'Differs from the accepted quotation — needs re-approval' : 'Small changes vs the quotation'}>
      {reasons.length ? reasons.join(' · ') : `${diff.changed.length} line(s) changed, value ${diff.valueChangePct}% (within ±${tolerance}%).`}
    </InlineAlert>
  );
}
