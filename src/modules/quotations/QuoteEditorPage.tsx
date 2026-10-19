import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addDays, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { errorMessage } from '../../services/api/client';
import { quotationsApi } from '../../services/api/quotations';
import { useActor } from '../../services/hooks';
import { listPriceFor } from '../../services/lookups';
import { discountApprovalLevels, getPolicies } from '../../services/policies';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { computeTotals, GST_RATES, lineAmounts, type QuoteLine, validateLines } from '../../services/quotations/pricing';
import { applyPriceList, type EditorData } from '../../services/quotations/workflow';
import { ServiceError } from '../../services/types';
import type { RecordData } from '../../metadata/types';
import { Button, IconButton } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { confirmDelete } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { useUnsavedGuard } from '../../components/resource/RecordForm';
import { PageHeader } from '../../components/shell/PageHeader';
import { TotalsBlock } from './LinesTable';

const LINE_TYPE_BY_PRODUCT: Record<string, string> = { machine: 'machine', ink: 'ink', paper: 'consumable', fabric: 'consumable', spares: 'spares_kit', service: 'installation', software: 'software' };

const emptyLine = (): QuoteLine => ({ productId: null, description: '', lineType: 'accessory', qty: 1, listPrice: 0, discountPct: 0, discountAmt: 0, hsnSac: '', gstRate: 18, landedCost: null, priceLocked: false });

/** /quotations/new?opportunity=<id> and /quotations/:recordId/edit — FR-035 … FR-041, FR-046. */
export function QuoteEditorPage() {
  const { recordId } = useParams();
  const [params] = useSearchParams();
  const oppId = params.get('opportunity') ?? undefined;
  return <EditorLoader key={`${recordId ?? 'new'}:${oppId ?? ''}`} recordId={recordId} oppId={oppId} />;
}

function EditorLoader({ recordId, oppId }: { recordId?: string; oppId?: string }) {
  const actor = useActor();
  const [state, setState] = useState<{ data?: EditorData; error?: string }>({});
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({});
    quotationsApi
      .editor(actor, recordId, oppId)
      .then((data) => alive && setState({ data }))
      .catch((e) => alive && setState({ error: errorMessage(e) }));
    return () => {
      alive = false;
    };
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = recordId ? 'Edit quotation' : 'New quotation';
  if (state.error)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState title="Could not open the quotation editor" onRetry={() => setNonce((n) => n + 1)}>
          {state.error}
        </ErrorState>
      </div>
    );
  if (!state.data)
    return (
      <div className="page">
        <PageHeader title={title} />
        <Skeleton rows={10} />
      </div>
    );
  const d = state.data;
  if (d.quote && !d.quote.canEdit)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState title="This quotation cannot be edited">
          {d.quote.record.isLatest ? `${d.quote.record.quoteNo} is ${masterLabel('quoteStatus', d.quote.record.status).toLowerCase()}. Only drafts can be edited — revise it to create the next revision.` : `${d.quote.record.quoteNo} is an older revision.`}{' '}
          <Link to={`/quotations?peek=${d.quote.record.id}`}>Open quotation</Link>
        </ErrorState>
      </div>
    );
  if (!d.quote && !d.opportunities.length)
    return (
      <div className="page">
        <PageHeader title={title} />
        <EmptyState icon="receipt" title="No open opportunity to quote on">
          Quotations are prepared for an opportunity. Qualify a lead or open an opportunity first.
        </EmptyState>
      </div>
    );
  return <QuoteEditor data={d} />;
}

function QuoteEditor({ data }: { data: EditorData }) {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = data.quote?.record;
  const initialOpp = data.opportunity ?? (existing ? null : data.opportunities[0]);
  const [header, setHeader] = useState<Record<string, unknown>>(() =>
    existing
      ? { ...existing }
      : { opportunityId: initialOpp?.id ?? '', quoteDate: todayKey(), validUntil: addDays(todayKey(), getPolicies().quoteValidityDays), freight: 0, insurance: 0, contactId: initialOpp?.contactId ?? '' },
  );
  const [lines, setLines] = useState<QuoteLine[]>(() => (data.quote ? data.quote.lines : [emptyLine()]));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');
  const back = existing ? `/quotations?peek=${existing.id}` : initialOpp ? `/opportunities?peek=${initialOpp.id}` : '/quotations';
  const guard = useUnsavedGuard(dirty, () => navigate(back));

  const opp: RecordData | undefined = data.opportunities.find((o) => o.id === header.opportunityId);
  const customerId = String(opp?.customerId ?? existing?.customerId ?? '');
  const customer = data.customers[customerId];
  const divisionId = String(opp?.divisionId ?? existing?.divisionId ?? '');
  const placeOfSupply = String(header.placeOfSupply || customer?.billingState || getPolicies().companyGstState);
  const quoteDate = String(header.quoteDate || todayKey());

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const set = (k: string, v: unknown) => {
    setHeader((h) => ({ ...h, [k]: v }));
    setDirty(true);
  };
  const setLine = (i: number, patch: Partial<QuoteLine>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  // Live preview with the same pricing the service enforces on save (BR-15/16).
  const priced = useMemo(() => applyPriceList(lines, quoteDate), [lines, quoteDate]);
  const totals = useMemo(() => computeTotals(priced, placeOfSupply, Number(header.freight) || 0, Number(header.insurance) || 0, getPolicies().companyGstState), [priced, placeOfSupply, header.freight, header.insurance]);
  const lineErrors = validateLines(priced);
  const levels = discountApprovalLevels(totals.maxDiscountPct);
  const sameState = placeOfSupply === getPolicies().companyGstState;

  const products = data.products;
  const productOpts = [{ value: '', label: 'Custom line (no product)' }, ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku ?? p.id})` }))];
  const contacts = data.contacts.filter((c) => c.customerId === customerId);
  const terms = data.terms.filter((t) => !divisionId || t.divisionId === divisionId);

  const pickProduct = (i: number, productId: string) => {
    if (!productId) return setLine(i, { productId: null, priceLocked: false });
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const pl = listPriceFor(productId, quoteDate);
    setLine(i, {
      productId,
      description: `${p.name}${p.model ? ` — ${p.model}` : ''}`,
      lineType: LINE_TYPE_BY_PRODUCT[String(p.productType)] ?? 'accessory',
      hsnSac: String(p.hsnSac ?? ''),
      gstRate: GST_RATES.includes(Number(p.gstRate)) ? Number(p.gstRate) : 18,
      listPrice: pl?.listPrice ?? 0,
      landedCost: pl?.landedCost ?? null,
      priceLocked: !!pl,
    });
  };

  const applyTemplate = (id: string) => {
    const t = data.terms.find((x) => x.id === id);
    setHeader((h) => ({ ...h, termsTemplateId: id, paymentTerms: t?.paymentTerms ?? '', deliveryTerms: t?.deliveryTerms ?? '', warrantyTerms: t?.warrantyTerms ?? '', installationTerms: t?.installationTerms ?? '' }));
    setDirty(true);
  };

  const save = async (submit: boolean) => {
    setErrors({});
    const e: Record<string, string> = {};
    if (!header.opportunityId) e.opportunityId = 'Choose the opportunity';
    if (String(header.validUntil) < quoteDate) e.validUntil = 'Validity must end on or after the quotation date';
    if (lineErrors.length) e.lines = lineErrors.join(' · ');
    if (!lines.length) e.lines = 'Add at least one line item';
    if (submit && levels.length && reason.trim().length < 5) e.reason = 'Give a reason for the discount (at least 5 characters)';
    if (Object.keys(e).length) {
      setErrors(e);
      toast('Please fix the highlighted fields', 'danger');
      return;
    }
    setBusy(submit ? 'submit' : 'draft');
    try {
      const saved = await quotationsApi.save(actor, { id: existing?.id, version: Number(existing?.version ?? 0), header: { ...header, placeOfSupply }, lines });
      setDirty(false);
      if (submit) {
        const r = await quotationsApi.submit(actor, saved.record.id, saved.record.version, reason);
        toast(r.status === 'approved' ? `${saved.record.quoteNo ?? saved.record.id} approved — ready to send` : `${saved.record.quoteNo ?? saved.record.id} sent for approval (${r.approvalId})`);
      } else toast(`${saved.record.quoteNo ?? saved.record.id} saved as draft`);
      navigate(`/quotations?peek=${saved.record.id}`);
    } catch (err) {
      if (err instanceof ServiceError && err.fieldErrors) setErrors(err.fieldErrors);
      toast(errorMessage(err), 'danger');
    } finally {
      setBusy('');
    }
  };

  const title = existing ? `Edit ${existing.quoteNo}` : 'New quotation';
  return (
    <div className="page">
      <PageHeader title={title} description="Prices come from the active price list; discounts above your limit go for approval. Totals and GST are recalculated by the service when you save." />
      <div className="full-form panel qt-editor">
        {!!data.quote?.record.rejectNote && <InlineAlert tone="warning" title="Returned to draft">{String(data.quote.record.rejectNote)}</InlineAlert>}
        <h2 className="panel-title">Quotation</h2>
        <div className="form-grid">
          <div className="form-field">
            <label className="field-label" htmlFor="qt-opp">
              Opportunity <span className="req">*</span>
            </label>
            <SelectMenu
              id="qt-opp"
              block
              label="Opportunity"
              value={String(header.opportunityId ?? '')}
              invalid={!!errors.opportunityId}
              disabled={!!existing}
              options={data.opportunities.map((o) => ({ value: o.id, label: `${o.name ?? o.id} · ${data.customers[String(o.customerId)]?.name ?? ''}` }))}
              onChange={(v) => {
                const o = data.opportunities.find((x) => x.id === v);
                setHeader((h) => ({ ...h, opportunityId: v, contactId: o?.contactId ?? '', placeOfSupply: '', termsTemplateId: '' }));
                setDirty(true);
              }}
            />
            {errors.opportunityId && <p className="field-error">{errors.opportunityId}</p>}
          </div>
          <div className="form-field">
            <span className="field-label">Customer</span>
            <span className="field-readonly">{customer?.name ?? <EmptyValue />}</span>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="qt-contact">
              Contact person
            </label>
            <SelectMenu id="qt-contact" block label="Contact person" value={String(header.contactId ?? '')} placeholder={contacts.length ? 'Select…' : 'No contacts for this customer'} options={contacts.map((c) => ({ value: c.id, label: `${c.name}${c.designation ? ` · ${c.designation}` : ''}` }))} onChange={(v) => set('contactId', v)} />
          </div>
          <div className="form-field">
            <span className="field-label">Division</span>
            <span className="field-readonly">{divisionId ? masterLabel('division', divisionId) : <EmptyValue />}</span>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="qt-date">
              Quotation date <span className="req">*</span>
            </label>
            <DatePicker id="qt-date" block label="Quotation date" value={quoteDate} clearable={false} onChange={(v) => set('quoteDate', v ?? todayKey())} />
          </div>
          <div className="form-field">
            <span className="field-label-row">
              <label className="field-label" htmlFor="qt-valid">
                Valid until <span className="req">*</span>
              </label>
              <InfoTip text={`Default ${getPolicies().quoteValidityDays} days. The quotation expires automatically after this date.`} label="About validity" />
            </span>
            <DatePicker id="qt-valid" block label="Valid until" value={String(header.validUntil ?? '')} invalid={!!errors.validUntil} clearable={false} onChange={(v) => set('validUntil', v ?? '')} />
            {errors.validUntil && <p className="field-error">{errors.validUntil}</p>}
          </div>
          <div className="form-field">
            <span className="field-label-row">
              <label className="field-label" htmlFor="qt-pos">
                Place of supply <span className="req">*</span>
              </label>
              <InfoTip text="Same state as True Colors’ GST registration → CGST + SGST; any other state → IGST." label="About place of supply" />
            </span>
            <SelectMenu id="qt-pos" block label="Place of supply" value={placeOfSupply} options={activeMasterValues('state').map((s) => ({ value: s.key, label: `${s.label} (${s.key})` }))} onChange={(v) => set('placeOfSupply', v)} />
          </div>
        </div>

        <h2 className="panel-title qt-section">Line items</h2>
        <div className="line-items">
          <ol className="qt-line-list">
            {priced.map((l, i) => {
              const a = lineAmounts(l);
              const byAmount = Number(lines[i].discountAmt) > 0;
              const id = `qt-l${i}`;
              return (
                <li key={i} className="qt-line">
                  <span className="qt-line-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="qt-line-grid">
                    <div className="form-field qt-span-2">
                      <label className="field-label" htmlFor={`${id}-p`}>
                        Product
                      </label>
                      <SelectMenu id={`${id}-p`} label={`Line ${i + 1} product`} block value={String(lines[i].productId ?? '')} options={productOpts} onChange={(v) => pickProduct(i, v)} />
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-t`}>
                        Type
                      </label>
                      <SelectMenu id={`${id}-t`} label={`Line ${i + 1} type`} block value={lines[i].lineType} options={activeMasterValues('quoteLineType').map((t) => ({ value: t.key, label: t.label }))} onChange={(v) => setLine(i, { lineType: v })} />
                    </div>
                    <div className="form-field qt-span-2">
                      <label className="field-label" htmlFor={`${id}-d`}>
                        Description
                      </label>
                      <input id={`${id}-d`} className="input" maxLength={200} value={lines[i].description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-q`}>
                        Qty
                      </label>
                      <input id={`${id}-q`} className="input num" inputMode="numeric" value={String(lines[i].qty)} onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                    </div>
                    <div className="form-field">
                      <span className="field-label-row">
                        <label className="field-label" htmlFor={`${id}-lp`}>
                          List price
                        </label>
                        {l.priceLocked && <InfoTip text="From the active price list — sales users cannot change list prices." label="About the list price" />}
                      </span>
                      {l.priceLocked ? (
                        <span id={`${id}-lp`} className="field-readonly num">
                          {formatMoney(l.listPrice)}
                        </span>
                      ) : (
                        <div className="input-affix has-start">
                          <span className="affix affix-start">₹</span>
                          <input id={`${id}-lp`} className="input num" inputMode="decimal" value={String(lines[i].listPrice)} onChange={(e) => setLine(i, { listPrice: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
                        </div>
                      )}
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-dc`}>
                        Discount
                      </label>
                      <div className="qt-disc">
                        <input
                          id={`${id}-dc`}
                          className="input num"
                          inputMode="decimal"
                          value={String(byAmount ? lines[i].discountAmt : lines[i].discountPct)}
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/[^\d.]/g, '')) || 0;
                            setLine(i, byAmount ? { discountAmt: n } : { discountPct: n });
                          }}
                        />
                        <SelectMenu
                          label={`Line ${i + 1} discount unit`}
                          value={byAmount ? 'amt' : 'pct'}
                          options={[
                            { value: 'pct', label: '%' },
                            { value: 'amt', label: '₹' },
                          ]}
                          onChange={(v) => setLine(i, v === 'amt' ? { discountAmt: a.discount || 0, discountPct: 0 } : { discountPct: a.effectivePct, discountAmt: 0 })}
                        />
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-g`}>
                        GST
                      </label>
                      <SelectMenu id={`${id}-g`} label={`Line ${i + 1} GST rate`} block value={l.gstRate} options={GST_RATES.map((r) => ({ value: r, label: `${r}%` }))} onChange={(v) => setLine(i, { gstRate: v })} />
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-h`}>
                        HSN / SAC
                      </label>
                      <input id={`${id}-h`} className="input mono" maxLength={8} value={lines[i].hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value.replace(/\D/g, '') })} />
                    </div>
                    <div className="form-field">
                      <span className="field-label">Net</span>
                      <span className="field-readonly num">
                        <strong>{formatMoney(a.net)}</strong>
                      </span>
                    </div>
                  </div>
                  <IconButton
                    icon="trash"
                    label={`Remove line ${i + 1}`}
                    className="qt-line-del"
                    disabledReason={lines.length === 1 ? 'A quotation needs at least one line' : undefined}
                    onClick={() =>
                      confirmDelete({
                        title: `Remove line ${i + 1}?`,
                        message: `“${lines[i].description || 'Untitled line'}” is removed from this quotation. Other lines are not affected.`,
                        confirmLabel: 'Remove',
                        onConfirm: () => {
                          setLines((ls) => ls.filter((_, j) => j !== i));
                          setDirty(true);
                        },
                      })
                    }
                  />
                </li>
              );
            })}
          </ol>
          <Button
            icon="plus"
            onClick={() => {
              setLines((ls) => [...ls, emptyLine()]);
              setDirty(true);
            }}
          >
            Add line
          </Button>
          {(errors.lines || (dirty && lineErrors.length > 0)) && (
            <InlineAlert tone="danger" title="Check the line items">
              {(errors.lines ?? lineErrors.join(' · ')).split(' · ').slice(0, 4).join(' · ')}
            </InlineAlert>
          )}
        </div>

        <div className="qt-bottom">
          <div className="form-grid cols-2 qt-extras">
            <div className="form-field">
              <label className="field-label" htmlFor="qt-freight">
                Freight
              </label>
              <div className="input-affix has-start">
                <span className="affix affix-start">₹</span>
                <input id="qt-freight" className="input" inputMode="decimal" value={String(header.freight ?? 0)} onChange={(e) => set('freight', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
              </div>
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="qt-ins">
                Insurance
              </label>
              <div className="input-affix has-start">
                <span className="affix affix-start">₹</span>
                <input id="qt-ins" className="input" inputMode="decimal" value={String(header.insurance ?? 0)} onChange={(e) => set('insurance', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
              </div>
            </div>
            <p className="muted small span-all">
              {sameState ? 'Intra-state supply: CGST + SGST.' : 'Inter-state supply: IGST.'} Freight and insurance are taxed at the rate of the main item.
            </p>
            {levels.length > 0 ? (
              <div className="span-all">
                <InlineAlert tone="warning" title={`Discount ${totals.maxDiscountPct}% needs approval`}>
                  {levels.map((l) => l.label).join(' → ')}. Submitting starts the approval; you can send the quotation once it is approved.
                </InlineAlert>
                <div className="form-field">
                  <label className="field-label" htmlFor="qt-reason">
                    Reason for the discount <span className="req">*</span>
                  </label>
                  <textarea id="qt-reason" className="input textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason || undefined} />
                  {errors.reason && <p className="field-error">{errors.reason}</p>}
                </div>
              </div>
            ) : (
              <p className="muted small span-all">Highest discount {totals.maxDiscountPct}% — within the limit, approved automatically on submit.</p>
            )}
          </div>
          <TotalsBlock t={totals} showMargin={data.showMargin} />
        </div>

        <h2 className="panel-title qt-section dialog-title-row">
          Commercial terms
          <InfoTip text="Pick a division template, then adjust the wording for this customer." label="About terms" />
        </h2>
        <div className="form-grid cols-2">
          <div className="form-field span-all">
            <label className="field-label" htmlFor="qt-tpl">
              Terms template
            </label>
            <SelectMenu id="qt-tpl" block label="Terms template" value={String(header.termsTemplateId ?? '')} placeholder={terms.length ? 'Select a template…' : 'No templates for this division'} options={terms.map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? ' (default)' : ''}` }))} onChange={applyTemplate} />
          </div>
          {(
            [
              ['paymentTerms', 'Payment terms'],
              ['deliveryTerms', 'Delivery timeline'],
              ['warrantyTerms', 'Warranty'],
              ['installationTerms', 'Installation terms'],
            ] as const
          ).map(([k, label]) => (
            <div className="form-field" key={k}>
              <label className="field-label" htmlFor={`qt-${k}`}>
                {label}
              </label>
              <textarea id={`qt-${k}`} className="input textarea" rows={3} maxLength={1000} value={String(header[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
        </div>

        <div className="full-form-bar">
          <Button onClick={guard.requestClose}>Cancel</Button>
          <span className="spacer" />
          <Button loading={busy === 'draft'} disabled={!!busy} onClick={() => void save(false)}>
            Save draft
          </Button>
          <Button variant="primary" loading={busy === 'submit'} disabled={!!busy} onClick={() => void save(true)}>
            {levels.length ? 'Save & submit for approval' : 'Save & approve'}
          </Button>
        </div>
      </div>
      {guard.dialog}
    </div>
  );
}
