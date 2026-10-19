import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { addDays, todayKey } from '../../lib/dates';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import { formatMoney } from '../../lib/format';
import { errorMessage } from '../../services/api/client';
import { quotationsApi } from '../../services/api/quotations';
import { useActor } from '../../services/hooks';
import { listPriceFor } from '../../services/lookups';
import { getPolicies } from '../../services/policies';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { computeTotals, GST_RATES, lineAmounts, type QuoteLine, validateLines } from '../../services/quotations/pricing';
import { applyPriceList, canSetListPrice, type EditorData, levelName, quoteApprovalChain } from '../../services/quotations/workflow';
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

const T = L.quotations;
const E = T.editor;
const F = T.fields.quotations;

const LINE_TYPE_BY_PRODUCT: Record<string, string> = { machine: 'machine', ink: 'ink', paper: 'consumable', fabric: 'consumable', spares: 'spares_kit', service: 'installation', software: 'software' };

const emptyLine = (): QuoteLine => ({ productId: null, description: '', lineType: 'accessory', qty: 1, listPrice: 0, discountPct: 0, discountAmt: 0, hsnSac: '', gstRate: 18, landedCost: null, priceLocked: false });

/** ROUTES.quotationNew (?opportunity=<id>) and ROUTES.quotationEdit — FR-035 … FR-041, FR-046. */
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
  const title = recordId ? E.titleEdit : E.titleNew;
  if (state.error)
    return (
      <div className="page">
        <PageHeader title={title} />
        <ErrorState title={E.loadError} onRetry={() => setNonce((n) => n + 1)}>
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
        <ErrorState title={E.cannotEdit}>
          {!d.quote.record.isLatest
            ? E.cannotEditOld(String(d.quote.record.quoteNo))
            : !d.quote.canUpdate
              ? T.common.readOnlyFor(actor.role.label)
              : ['accepted', 'rejected'].includes(String(d.quote.record.status))
              ? E.cannotEditFinal(String(d.quote.record.quoteNo), masterLabel('quoteStatus', d.quote.record.status))
              : E.cannotEditStatus(String(d.quote.record.quoteNo), masterLabel('quoteStatus', d.quote.record.status))}{' '}
          <Link to={recordPeekPath('tc', 'quotations', d.quote.record.id)}>{T.actions.openQuotation}</Link>
        </ErrorState>
      </div>
    );
  if (!d.quote && !d.opportunities.length)
    return (
      <div className="page">
        <PageHeader title={title} />
        <EmptyState icon="receipt" title={E.noOpportunity}>
          {E.noOpportunityBody}
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
  // A new quotation saved before a failed submit: later saves update it instead of creating a duplicate.
  const [saved, setSaved] = useState<{ id: string; version: number } | null>(null);
  const mayPrice = canSetListPrice(actor);
  // Synchronous guard: a double click fires twice before the disabled state renders (would create two quotations).
  const inFlight = useRef(false);
  const back = existing ? recordPeekPath('tc', 'quotations', existing.id) : initialOpp ? recordPeekPath('tc', 'opportunities', initialOpp.id) : resourcePath('tc', 'quotations');
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
  const levels = quoteApprovalChain(actor, { ownerId: header.ownerId || opp?.ownerId || existing?.ownerId, divisionId }, totals.maxDiscountPct);
  const sameState = placeOfSupply === getPolicies().companyGstState;

  const products = data.products;
  const productOpts = [{ value: '', label: E.customLine }, ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku ?? p.id})` }))];
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
    if (inFlight.current) return;
    setErrors({});
    const e: Record<string, string> = {};
    if (!header.opportunityId) e.opportunityId = E.chooseOpportunity;
    if (String(header.validUntil) < quoteDate) e.validUntil = F.validUntilCompare;
    if (lineErrors.length) e.lines = lineErrors.join(' · ');
    if (!lines.length) e.lines = E.needLine;
    if (submit && levels.length && reason.trim().length < 5) e.reason = E.needReason;
    if (Object.keys(e).length) {
      setErrors(e);
      toast(E.fixFields, 'danger');
      return;
    }
    setBusy(submit ? 'submit' : 'draft');
    inFlight.current = true;
    try {
      const target = saved ?? (existing ? { id: existing.id, version: Number(existing.version ?? 0) } : null);
      const result = await quotationsApi.save(actor, { id: target?.id, version: target?.version, header: { ...header, placeOfSupply }, lines });
      setSaved({ id: result.record.id, version: result.record.version });
      setDirty(false);
      if (submit) {
        const r = await quotationsApi.submit(actor, result.record.id, result.record.version, reason);
        const no = String(result.record.quoteNo ?? result.record.id);
        toast(r.status === 'approved' ? E.submittedApproved(no) : E.submittedPending(no, String(r.approvalId)));
      } else toast(E.savedDraft(String(result.record.quoteNo ?? result.record.id)));
      navigate(recordPeekPath('tc', 'quotations', result.record.id));
    } catch (err) {
      if (err instanceof ServiceError && err.fieldErrors) setErrors(err.fieldErrors);
      toast(errorMessage(err), 'danger');
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  };

  const title = existing ? E.titleEditNo(String(existing.quoteNo)) : E.titleNew;
  return (
    <div className="page">
      <PageHeader title={title} description={E.description} />
      <div className="full-form panel qt-editor">
        {!!data.quote?.record.rejectNote && <InlineAlert tone="warning" title={T.banner.returnedToDraft}>{String(data.quote.record.rejectNote)}</InlineAlert>}
        <h2 className="panel-title">{T.sections.quotations.header}</h2>
        <div className="form-grid">
          <div className="form-field">
            <label className="field-label" htmlFor="qt-opp">
              {F.opportunityId} <span className="req">*</span>
            </label>
            <SelectMenu
              id="qt-opp"
              block
              label={F.opportunityId}
              value={String(header.opportunityId ?? '')}
              invalid={!!errors.opportunityId}
              disabled={!!existing}
              options={data.opportunities.map((o) => {
                const name = String(o.name ?? o.id);
                const cust = data.customers[String(o.customerId)]?.name ?? '';
                return { value: o.id, label: cust && !name.includes(cust) ? `${name} · ${cust}` : name };
              })}
              onChange={(v) => {
                const o = data.opportunities.find((x) => x.id === v);
                setHeader((h) => ({ ...h, opportunityId: v, contactId: o?.contactId ?? '', placeOfSupply: '', termsTemplateId: '' }));
                setDirty(true);
              }}
            />
            {errors.opportunityId && <p className="field-error">{errors.opportunityId}</p>}
          </div>
          <div className="form-field">
            <span className="field-label">{F.customerId}</span>
            <span className="field-readonly">{customer?.name ?? <EmptyValue />}</span>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="qt-contact">
              {F.contactId}
            </label>
            <SelectMenu id="qt-contact" block label={F.contactId} value={String(header.contactId ?? '')} placeholder={contacts.length ? T.common.select : E.noContacts} options={contacts.map((c) => ({ value: c.id, label: `${c.name}${c.designation ? ` · ${c.designation}` : ''}` }))} onChange={(v) => set('contactId', v)} />
          </div>
          <div className="form-field">
            <span className="field-label">{F.divisionId}</span>
            <span className="field-readonly">{divisionId ? masterLabel('division', divisionId) : <EmptyValue />}</span>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="qt-date">
              {F.quoteDate} <span className="req">*</span>
            </label>
            <DatePicker id="qt-date" block label={F.quoteDate} value={quoteDate} clearable={false} onChange={(v) => set('quoteDate', v ?? todayKey())} />
          </div>
          <div className="form-field">
            <span className="field-label-row">
              <label className="field-label" htmlFor="qt-valid">
                {F.validUntil} <span className="req">*</span>
              </label>
              <InfoTip text={F.validUntilHelp(getPolicies().quoteValidityDays)} label={E.aboutValidity} />
            </span>
            <DatePicker id="qt-valid" block label={F.validUntil} value={String(header.validUntil ?? '')} invalid={!!errors.validUntil} clearable={false} onChange={(v) => set('validUntil', v ?? '')} />
            {errors.validUntil && <p className="field-error">{errors.validUntil}</p>}
          </div>
          <div className="form-field">
            <span className="field-label-row">
              <label className="field-label" htmlFor="qt-pos">
                {F.placeOfSupply} <span className="req">*</span>
              </label>
              <InfoTip text={F.placeOfSupplyHelp} label={E.aboutPlace} />
            </span>
            <SelectMenu id="qt-pos" block label={F.placeOfSupply} value={placeOfSupply} options={activeMasterValues('state').map((s) => ({ value: s.key, label: `${s.label} (${s.key})` }))} onChange={(v) => set('placeOfSupply', v)} />
          </div>
        </div>

        <h2 className="panel-title qt-section">{T.tabs.lineItems}</h2>
        <div className="line-items">
          <ol className="qt-line-list">
            {priced.map((l, i) => {
              const a = lineAmounts(l);
              const byAmount = lines[i].discountType === 'amt' || (lines[i].discountType !== 'pct' && Number(lines[i].discountAmt) > 0);
              const id = `qt-l${i}`;
              return (
                <li key={i} className="qt-line">
                  <span className="qt-line-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="qt-line-grid">
                    <div className="form-field qt-span-2">
                      <label className="field-label" htmlFor={`${id}-p`}>
                        {E.product}
                      </label>
                      <SelectMenu id={`${id}-p`} label={E.lineProduct(i + 1)} block value={String(lines[i].productId ?? '')} options={productOpts} onChange={(v) => pickProduct(i, v)} />
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-t`}>
                        {E.type}
                      </label>
                      <SelectMenu id={`${id}-t`} label={E.lineType(i + 1)} block value={lines[i].lineType} options={activeMasterValues('quoteLineType').map((t) => ({ value: t.key, label: t.label }))} onChange={(v) => setLine(i, { lineType: v })} />
                    </div>
                    <div className="form-field qt-span-2">
                      <label className="field-label" htmlFor={`${id}-d`}>
                        {E.description_}
                      </label>
                      <input id={`${id}-d`} className="input" maxLength={200} value={lines[i].description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-q`}>
                        {T.lineTable.qty}
                      </label>
                      <input id={`${id}-q`} className="input num" inputMode="numeric" value={String(lines[i].qty)} onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                    </div>
                    <div className="form-field">
                      <span className="field-label-row">
                        <label className="field-label" htmlFor={`${id}-lp`}>
                          {T.lineTable.listPrice}
                        </label>
                        {(l.priceLocked || !mayPrice) && <InfoTip text={l.priceLocked ? E.priceLocked : E.priceNotListed} label={E.aboutListPrice} />}
                      </span>
                      {l.priceLocked || !mayPrice ? (
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
                        {T.lineTable.discount}
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
                          label={E.lineDiscountUnit(i + 1)}
                          value={byAmount ? 'amt' : 'pct'}
                          options={[
                            { value: 'pct', label: '%' },
                            { value: 'amt', label: '₹' },
                          ]}
                          onChange={(v) => setLine(i, v === 'amt' ? { discountType: 'amt', discountAmt: a.discount || 0, discountPct: 0 } : { discountType: 'pct', discountPct: a.effectivePct, discountAmt: 0 })}
                        />
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-g`}>
                        {T.lineTable.gst}
                      </label>
                      <SelectMenu id={`${id}-g`} label={E.lineGst(i + 1)} block value={l.gstRate} options={GST_RATES.map((r) => ({ value: r, label: `${r}%` }))} onChange={(v) => setLine(i, { gstRate: v })} />
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor={`${id}-h`}>
                        {T.lineTable.hsnSac}
                      </label>
                      <input id={`${id}-h`} className="input mono" maxLength={8} value={lines[i].hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value.replace(/\D/g, '') })} />
                    </div>
                    <div className="form-field">
                      <span className="field-label">{T.lineTable.net}</span>
                      <span className="field-readonly num">
                        <strong>{formatMoney(a.net)}</strong>
                      </span>
                    </div>
                  </div>
                  <IconButton
                    icon="trash"
                    label={E.removeLine(i + 1)}
                    className="qt-line-del"
                    disabledReason={lines.length === 1 ? E.needOneLine : undefined}
                    onClick={() =>
                      confirmDelete({
                        title: E.removeLineTitle(i + 1),
                        message: E.removeLineBody(lines[i].description || E.untitledLine),
                        confirmLabel: T.actions.remove,
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
            {T.actions.addLine}
          </Button>
          {(errors.lines || (dirty && lineErrors.length > 0)) && (
            <InlineAlert tone="danger" title={E.checkLines}>
              {(errors.lines ?? lineErrors.join(' · ')).split(' · ').slice(0, 4).join(' · ')}
            </InlineAlert>
          )}
        </div>

        <div className="qt-bottom">
          <div className="form-grid cols-2 qt-extras">
            <div className="form-field">
              <label className="field-label" htmlFor="qt-freight">
                {F.freight}
              </label>
              <div className="input-affix has-start">
                <span className="affix affix-start">₹</span>
                <input id="qt-freight" className="input" inputMode="decimal" value={String(header.freight ?? 0)} onChange={(e) => set('freight', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
              </div>
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="qt-ins">
                {F.insurance}
              </label>
              <div className="input-affix has-start">
                <span className="affix affix-start">₹</span>
                <input id="qt-ins" className="input" inputMode="decimal" value={String(header.insurance ?? 0)} onChange={(e) => set('insurance', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
              </div>
            </div>
            <p className="muted small span-all">
              {sameState ? T.tabContent.intraState : T.tabContent.interState} {T.tabContent.extrasTaxed}
            </p>
            {levels.length > 0 ? (
              <div className="span-all">
                <InlineAlert tone="warning" title={E.needsApproval(totals.maxDiscountPct)}>
                  {E.needsApprovalBody(levels.map(levelName).join(' → '))}
                </InlineAlert>
                <div className="form-field">
                  <label className="field-label" htmlFor="qt-reason">
                    {T.dialogs.submit.reason} <span className="req">*</span>
                  </label>
                  <textarea id="qt-reason" className="input textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason || undefined} />
                  {errors.reason && <p className="field-error">{errors.reason}</p>}
                </div>
              </div>
            ) : (
              <p className="muted small span-all">{E.withinLimit(totals.maxDiscountPct)}</p>
            )}
          </div>
          <TotalsBlock t={totals} showMargin={data.showMargin} interState={!sameState} />
        </div>

        <h2 className="panel-title qt-section dialog-title-row">
          {T.tabs.terms}
          <InfoTip text={E.termsHelp} label={E.aboutTerms} />
        </h2>
        <div className="form-grid cols-2">
          <div className="form-field span-all">
            <label className="field-label" htmlFor="qt-tpl">
              {F.termsTemplateId}
            </label>
            <SelectMenu id="qt-tpl" block label={F.termsTemplateId} value={String(header.termsTemplateId ?? '')} placeholder={terms.length ? E.selectTemplate : E.noTemplates} options={terms.map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? E.defaultSuffix : ''}` }))} onChange={applyTemplate} />
          </div>
          {(
            [
              ['paymentTerms', F.paymentTerms],
              ['deliveryTerms', F.deliveryTerms],
              ['warrantyTerms', F.warrantyTerms],
              ['installationTerms', F.installationTerms],
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
          <Button onClick={guard.requestClose}>{T.actions.cancel}</Button>
          <span className="spacer" />
          <Button loading={busy === 'draft'} disabled={!!busy} onClick={() => void save(false)}>
            {T.actions.saveDraft}
          </Button>
          <Button variant="primary" loading={busy === 'submit'} disabled={!!busy} onClick={() => void save(true)}>
            {T.actions.saveAndSubmit}
          </Button>
        </div>
      </div>
      {guard.dialog}
    </div>
  );
}
