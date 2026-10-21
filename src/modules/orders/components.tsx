/** Small UI pieces shared by the Sales Orders & Contracts pages and record tabs. */
import type { ReactNode } from 'react';
import { formatMoney } from '../../lib/format';
import { cx } from '../../lib/format';
import { getPolicies } from '../../services/policies';
import { lineDiscount, lineDiscountPct, lineGross, lineNet, type LineDiff, type OrderTotals, type QuoteLine } from '../../services/orders/lines';
import { amountInWords } from '../../services/lookups';
import { EmptyValue } from '../../components/primitives/display';
import { InfoTip } from '../../components/primitives/InfoTip';
import { InlineAlert } from '../../components/primitives/feedback';
import { L } from '../../constants/labels';
import { NumberInput } from '../../components/primitives/NumberInput';
import { NUMBER_LIMITS } from '../../services/validation';
import { Table } from '../../components/primitives/Table';
import { FileInput } from '../../components/primitives/controls';

const O = L.orders;

export function Field({ id, label, required, help, error, children, wide }: { id: string; label: string; required?: boolean; help?: string; error?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('form-field', wide && 'span-all')}>
      <span className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label} {required && <span className="req">*</span>}
        </label>
        {help && <InfoTip text={help} label={O.common.about(label)} />}
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
      <FileInput
        id={id}
        
        accept={accept}
        
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f.name, f.size);
        }}
      />
      {value && <span className="muted small">{O.file.attached(value)}</span>}
      <span className="muted small">{(accept.includes('pdf') ? O.file.hint : O.file.photoHint)(getPolicies().maxFileMb)}</span>
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
        <EmptyValue label={O.lines.none} />
      </p>
    );
  const ref = new Map((diffAgainst ?? []).map((l) => [l.productId, l]));
  return (
    
      <Table className="orders-lines">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{O.table.item}</th>
            <th scope="col">{O.table.hsn}</th>
            <th scope="col" className="th-num">
              {O.table.qty}
            </th>
            <th scope="col" className="th-num">
              {O.table.listPrice}
            </th>
            <th scope="col" className="th-num">
              {O.table.discountPct}
            </th>
            <th scope="col" className="th-num">
              {O.table.gst}
            </th>
            <th scope="col" className="th-num">
              {O.table.net}
            </th>
            {editable && onRemove && (
              <th scope="col">
                <span className="sr-only">{O.actions.remove}</span>
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
                  {isNew && <span className="tag tone-warning orders-tag">{O.lines.notInQuotation}</span>}
                  {changed && <span className="tag tone-info orders-tag">{O.lines.changed}</span>}
                  {priceSource?.[i] && <div className="muted small">{O.lines.price(priceSource[i])}</div>}
                </td>
                <td className="mono small">{l.hsnSac || <EmptyValue />}</td>
                <td className="num">
                  {editable ? (
                    <NumberInput dense className="orders-num" rule={NUMBER_LIMITS.qty} value={Number(l.qty)} aria-label={O.lines.qtyAria(i + 1)} onValueChange={(n) => onChange?.(i, { qty: n ?? NaN })} />
                  ) : (
                    l.qty
                  )}
                </td>
                <td className="num">{formatMoney(Number(l.listPrice))}</td>
                <td className="num">
                  {editable ? (
                    <NumberInput
                      dense
                      className="orders-num"
                      rule={NUMBER_LIMITS.discountPct}
                      value={l.discountAmt ? lineDiscountPct(l) : Number(l.discountPct ?? 0)}
                      aria-label={O.lines.discountAria(i + 1)}
                      onValueChange={(n) => onChange?.(i, { discountPct: n ?? 0, discountAmt: 0 })}
                    />
                  ) : (
                    `${lineDiscountPct(l)}%`
                  )}
                </td>
                <td className="num">{l.gstRate}%</td>
                <td className="num">
                  {formatMoney(lineNet(l))}
                  {lineDiscount(l) > 0 && <div className="muted small">{O.lines.of(formatMoney(lineGross(l)))}</div>}
                </td>
                {editable && onRemove && (
                  <td>
                    <button type="button" className="link small" onClick={() => onRemove(i)}>
                      {O.actions.remove}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>
    
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
      {row(O.totals.subtotal, t.subtotal)}
      {t.discountTotal > 0 && row(O.totals.discount, -t.discountTotal)}
      {t.freight > 0 && row(O.totals.freight, t.freight)}
      {t.insurance > 0 && row(O.totals.insurance, t.insurance)}
      {/* D-1: the taxable value (before GST) is the order value on dashboards and the won opportunity. */}
      {row(O.totals.taxable, t.taxable, true)}
      {intraState ? (
        <>
          {row(O.totals.cgst, t.cgst)}
          {row(O.totals.sgst, t.sgst)}
        </>
      ) : (
        row(O.totals.igst, t.igst)
      )}
      {row(O.totals.orderValue, t.grandTotal)}
      <div className="detail-row">
        <dt>{O.totals.inWords}</dt>
        <dd className="small">{amountInWords(t.grandTotal)}</dd>
      </div>
    </dl>
  );
}

export function DiffAlert({ diff, tolerance }: { diff: LineDiff; tolerance: number }) {
  const reasons: string[] = [];
  if (diff.added.length) reasons.push(O.diff.added(diff.added.length));
  if (diff.removed.length) reasons.push(O.diff.removed(diff.removed.length));
  if (Math.abs(diff.valueChangePct) > tolerance) reasons.push(O.diff.value(diff.valueChangePct, tolerance));
  if (diff.discountIncreased) reasons.push(O.diff.discount);
  if (!reasons.length && !diff.changed.length && !diff.valueChangePct) return null;
  return (
    <InlineAlert tone={reasons.length ? 'warning' : 'info'} title={reasons.length ? O.diff.reapprovalTitle : O.diff.smallTitle}>
      {reasons.length ? reasons.join(' · ') : O.diff.small(diff.changed.length, diff.valueChangePct, tolerance)}
    </InlineAlert>
  );
}
