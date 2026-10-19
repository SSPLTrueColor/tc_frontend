import { useEffect, useState, type ReactNode } from 'react';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { resetPolicies, savePolicies } from '../../services/api/catalog';
import { can } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getPolicies, type Policies } from '../../services/policies';
import { activeMasterValues } from '../../services/registry';
import type { ApprovalLevel } from '../../services/types';
import { Button, IconButton } from '../../components/primitives/Button';
import { ErrorState, InlineAlert, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { MultiSelectMenu } from '../../components/primitives/MultiSelectMenu';
import { confirmDelete } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';

/** Approval levels an administrator can put on a discount band (capability → label shown to approvers). */
const LEVELS: ApprovalLevel[] = [
  { capability: 'approve.l1', label: 'Sales manager' },
  { capability: 'approve.l2', label: 'Division head' },
  { capability: 'approve.l3', label: 'Management (MD)' },
  { capability: 'approve.finance', label: 'Accounts (finance check)' },
];
const STAGES: [string, string][] = [
  ['needs_assessment', 'Needs assessment'],
  ['demo', 'Demo / sample'],
  ['proposal', 'Proposal / quotation'],
  ['negotiation', 'Negotiation'],
  ['won', 'Won'],
  ['lost', 'Lost'],
];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const COVERAGES: [string, string][] = [
  ['cmc', 'CMC'],
  ['amc', 'AMC'],
  ['warranty', 'Warranty'],
  ['none', 'No contract'],
];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type Errors = Record<string, string>;

/** Validation for every policy value (non-negative, ordered bands, response ≤ arrival ≤ resolution …). */
export function validatePolicies(p: Policies): Errors {
  const e: Errors = {};
  const nonNeg = (k: string, v: number, max?: number) => {
    if (!Number.isFinite(v) || v < 0) e[k] = 'Enter 0 or more';
    else if (max !== undefined && v > max) e[k] = `At most ${max}`;
  };
  const positive = (k: string, v: number) => {
    if (!Number.isFinite(v) || v <= 0) e[k] = 'Must be greater than 0';
  };
  positive('leadFirstContactHours', p.leadFirstContactHours);
  positive('opportunityStagnationDays', p.opportunityStagnationDays);
  positive('quoteValidityDays', p.quoteValidityDays);
  nonNeg('soTolerancePct', p.soTolerancePct, 100);
  nonNeg('soFinanceCheckAdvancePct', p.soFinanceCheckAdvancePct, 100);
  nonNeg('paymentReminderDaysBefore', p.paymentReminderDaysBefore, 90);
  positive('defaultWarrantyMonths', p.defaultWarrantyMonths);
  positive('repeatComplaintDays', p.repeatComplaintDays);
  nonNeg('reopenWindowDays', p.reopenWindowDays);
  positive('autoCloseDays', p.autoCloseDays);
  if (!(p.lowRatingThreshold >= 1 && p.lowRatingThreshold <= 4)) e.lowRatingThreshold = 'Between 1 and 4';
  positive('leakageDays', p.leakageDays);
  nonNeg('missedReorderDays', p.missedReorderDays);
  positive('dormantDays', p.dormantDays);
  positive('geofenceRadiusM', p.geofenceRadiusM);
  positive('maxFileMb', p.maxFileMb);
  nonNeg('conveyance.twoWheeler', p.conveyance.twoWheeler);
  nonNeg('conveyance.car', p.conveyance.car);
  STAGES.forEach(([k]) => nonNeg(`stage.${k}`, p.stageProbability[k] ?? NaN, 100));
  if (!p.renewalReminderDays.length || p.renewalReminderDays.some((d) => !Number.isInteger(d) || d <= 0)) e.renewalReminderDays = 'Whole days, separated by commas (e.g. 90, 60, 30)';
  if (!TIME.test(p.shift.start)) e['shift.start'] = 'Use HH:mm';
  if (!TIME.test(p.shift.end)) e['shift.end'] = 'Use HH:mm';
  if (TIME.test(p.shift.start) && TIME.test(p.shift.end) && p.shift.end <= p.shift.start) e['shift.end'] = 'Must be after the start';
  nonNeg('shift.graceMin', p.shift.graceMin, 120);
  if (!(p.shift.halfDayHours > 0 && p.shift.halfDayHours < 12)) e['shift.halfDayHours'] = 'Between 0 and 12 hours';
  p.discountBands.forEach((b, i) => {
    if (!(b.upTo > 0 && b.upTo <= 100)) e[`band.${i}`] = 'Upper limit must be between 0 and 100 %';
    else if (i > 0 && b.upTo <= p.discountBands[i - 1].upTo) e[`band.${i}`] = 'Each band must be higher than the previous one';
  });
  if (!p.discountBands.length || p.discountBands[p.discountBands.length - 1].upTo !== 100) e.discountBands = 'The last band must go up to 100 %';
  PRIORITIES.forEach((pr) =>
    COVERAGES.forEach(([cv]) => {
      const s = p.sla[pr]?.[cv];
      const k = `sla.${pr}.${cv}`;
      if (!s || [s.response, s.arrival, s.resolution].some((x) => !(x > 0))) e[k] = 'Hours must be greater than 0';
      else if (!(s.response <= s.arrival && s.arrival <= s.resolution)) e[k] = 'Response ≤ on-site ≤ resolution';
    }),
  );
  p.escalation.forEach((x, i) => {
    if (!x.to.trim()) e[`esc.${i}`] = 'Name who is alerted';
    else if (!(x.afterHours >= 0) || (i > 0 && x.afterHours <= p.escalation[i - 1].afterHours)) e[`esc.${i}`] = 'Hours must increase down the chain';
  });
  return e;
}

function Num({ id, label, value, onChange, unit, error, help, step = 1 }: { id: string; label: string; value: number; onChange: (n: number) => void; unit?: string; error?: string; help?: string; step?: number }) {
  return (
    <div className="form-field">
      <span className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {help && <InfoTip text={help} label={`About ${label}`} />}
      </span>
      <div className={unit ? 'input-affix has-end' : undefined}>
        <input id={id} className="input" type="number" step={step} inputMode="decimal" value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} aria-invalid={!!error || undefined} />
        {unit && <span className="affix affix-end">{unit}</span>}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function Section({ title, help, children, wide }: { title: string; help: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? 'panel cat-wide' : 'panel'}>
      <h2 className="panel-title dialog-title-row">
        {title}
        <InfoTip text={help} label={`About ${title}`} />
      </h2>
      {children}
    </section>
  );
}

/** FR-122 / ADM-04: every configurable business number, validated and audited. */
export function PoliciesPage() {
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(() => getPolicies(), [actor.user.id]);
  const [draft, setDraft] = useState<Policies | null>(null);
  const [renewalText, setRenewalText] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (q.data && !draft) {
      setDraft(structuredClone(q.data));
      setRenewalText(q.data.renewalReminderDays.join(', '));
    }
  }, [q.data, draft]);

  if (!can(actor, 'config.publish')) return <NoAccess what="business policies" />;
  const header = <PageHeader title="Business policies" description="Thresholds, SLAs and reminder rules used across the CRM. Changes apply immediately to new records and are written to the audit log." />;
  if (q.error)
    return (
      <div className="page">
        {header}
        <ErrorState title="Could not load policies" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data || !draft)
    return (
      <div className="page">
        {header}
        <Skeleton rows={10} />
      </div>
    );

  const p = draft;
  const set = (patch: Partial<Policies>) => setDraft({ ...p, ...patch });
  const errors = validatePolicies(p);
  const shown = (k: string) => (tried ? errors[k] : undefined);
  const dirty = JSON.stringify(p) !== JSON.stringify(q.data);
  const errorCount = Object.keys(errors).length;

  const save = async () => {
    setTried(true);
    if (errorCount) {
      toast(`Fix ${errorCount} highlighted value(s) before saving`, 'danger');
      return;
    }
    const patch = Object.fromEntries(Object.entries(p).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((q.data as unknown as Record<string, unknown>)[k]))) as Partial<Policies>;
    setBusy(true);
    try {
      await savePolicies(actor, patch);
      toast(`Saved ${Object.keys(patch).length} policy change(s)`);
      setDraft(null);
      setTried(false);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      {header}
      {tried && errorCount > 0 && (
        <InlineAlert tone="danger" title="Some values need attention">
          {errorCount} value(s) are invalid. Nothing has been saved.
        </InlineAlert>
      )}
      <div className="cat-grid">
        <Section title="Sales" help="Lead first-contact SLA, opportunity stagnation and stage probabilities that drive the weighted forecast.">
          <div className="form-grid cols-2">
            <Num id="pol-lead" label="Lead first-contact SLA" unit="hours" value={p.leadFirstContactHours} onChange={(v) => set({ leadFirstContactHours: v })} error={shown('leadFirstContactHours')} help="Untouched leads after this are escalated and listed as Not attended (BR-08)." />
            <Num id="pol-stag" label="Opportunity stagnation" unit="days" value={p.opportunityStagnationDays} onChange={(v) => set({ opportunityStagnationDays: v })} error={shown('opportunityStagnationDays')} help="No activity for this long raises a stagnation alert (BR-12)." />
            {STAGES.map(([k, label]) => (
              <Num key={k} id={`pol-stage-${k}`} label={`${label} probability`} unit="%" value={p.stageProbability[k] ?? NaN} onChange={(v) => set({ stageProbability: { ...p.stageProbability, [k]: v } })} error={shown(`stage.${k}`)} />
            ))}
          </div>
        </Section>

        <Section wide title="Quotations & orders" help="Validity, discount approval bands (BR-17), order change tolerance (BR-22) and the finance check (BR-23).">
          <div className="form-grid">
            <Num id="pol-valid" label="Quotation validity" unit="days" value={p.quoteValidityDays} onChange={(v) => set({ quoteValidityDays: v })} error={shown('quoteValidityDays')} />
            <div className="form-field">
              <label className="field-label" htmlFor="pol-gst">
                Company GST state
              </label>
              <SelectMenu id="pol-gst" block label="Company GST state" value={p.companyGstState} options={activeMasterValues('state').map((s) => ({ value: s.key, label: `${s.label} (${s.key})` }))} onChange={(v) => set({ companyGstState: v })} />
            </div>
            <Num id="pol-tol" label="Order change tolerance" unit="±%" value={p.soTolerancePct} onChange={(v) => set({ soTolerancePct: v })} error={shown('soTolerancePct')} step={0.5} help="A sales order whose value moves more than this from the quotation goes back for approval." />
            <Num id="pol-adv" label="Finance check below advance" unit="%" value={p.soFinanceCheckAdvancePct} onChange={(v) => set({ soFinanceCheckAdvancePct: v })} error={shown('soFinanceCheckAdvancePct')} />
            <Num id="pol-pay" label="Payment reminder before due" unit="days" value={p.paymentReminderDaysBefore} onChange={(v) => set({ paymentReminderDaysBefore: v })} error={shown('paymentReminderDaysBefore')} />
          </div>
          <h3 className="field-label" style={{ marginTop: 14 }}>
            Discount approval bands
          </h3>
          <table className="mini-table cat-bands">
            <thead>
              <tr>
                <th scope="col">Highest line discount up to</th>
                <th scope="col">Approved by (in order)</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {p.discountBands.map((b, i) => (
                <tr key={i}>
                  <td>
                    <div className="input-affix has-end cat-num">
                      <input
                        className="input"
                        type="number"
                        aria-label={`Band ${i + 1} upper limit`}
                        value={Number.isFinite(b.upTo) ? b.upTo : ''}
                        onChange={(e) => set({ discountBands: p.discountBands.map((x, j) => (j === i ? { ...x, upTo: e.target.value === '' ? NaN : Number(e.target.value) } : x)) })}
                        aria-invalid={!!shown(`band.${i}`) || undefined}
                      />
                      <span className="affix affix-end">%</span>
                    </div>
                    {shown(`band.${i}`) && <p className="field-error">{shown(`band.${i}`)}</p>}
                  </td>
                  <td>
                    <MultiSelectMenu
                      label={`Approvers for band ${i + 1}`}
                      emptyLabel="No approval (auto-approved)"
                      block
                      values={b.levels.map((l) => l.capability)}
                      options={LEVELS.map((l) => ({ value: l.capability, label: l.label }))}
                      onChange={(caps) => set({ discountBands: p.discountBands.map((x, j) => (j === i ? { ...x, levels: LEVELS.filter((l) => caps.includes(l.capability)) } : x)) })}
                    />
                  </td>
                  <td>
                    <IconButton icon="trash" label={`Remove band ${i + 1}`} disabledReason={p.discountBands.length <= 1 ? 'Keep at least one band' : undefined} onClick={() => set({ discountBands: p.discountBands.filter((_, j) => j !== i) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown('discountBands') && <p className="field-error">{shown('discountBands')}</p>}
          <Button icon="plus" onClick={() => set({ discountBands: [...p.discountBands, { upTo: 100, levels: [LEVELS[0], LEVELS[1], LEVELS[2]] }] })}>
            Add band
          </Button>
        </Section>

        <Section wide title="Service SLA matrix" help="Hours to respond, reach site and resolve, by priority and contract. The SLA clock pauses while waiting for the customer (BR-30, BR-31).">
          <div className="table-scroll">
            <table className="mini-table cat-sla">
              <thead>
                <tr>
                  <th scope="col">Priority</th>
                  {COVERAGES.map(([, l]) => (
                    <th key={l} scope="col">
                      {l} (resp / site / fix h)
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRIORITIES.map((pr) => (
                  <tr key={pr}>
                    <th scope="row">{pr[0].toUpperCase() + pr.slice(1)}</th>
                    {COVERAGES.map(([cv, cl]) => {
                      const s = p.sla[pr]?.[cv] ?? { response: NaN, arrival: NaN, resolution: NaN };
                      const upd = (k: 'response' | 'arrival' | 'resolution', v: number) => set({ sla: { ...p.sla, [pr]: { ...p.sla[pr], [cv]: { ...s, [k]: v } } } });
                      return (
                        <td key={cv}>
                          <span className="row-gap">
                            {(['response', 'arrival', 'resolution'] as const).map((k) => (
                              <input key={k} className="input input-compact" type="number" aria-label={`${pr} ${cl} ${k} hours`} value={Number.isFinite(s[k]) ? s[k] : ''} onChange={(e) => upd(k, e.target.value === '' ? NaN : Number(e.target.value))} aria-invalid={!!shown(`sla.${pr}.${cv}`) || undefined} />
                            ))}
                          </span>
                          {shown(`sla.${pr}.${cv}`) && <p className="field-error">{shown(`sla.${pr}.${cv}`)}</p>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="field-label" style={{ marginTop: 14 }}>
            Escalation after breach
          </h3>
          <table className="mini-table cat-bands">
            <tbody>
              {p.escalation.map((x, i) => (
                <tr key={i}>
                  <td>
                    <div className="input-affix has-end cat-num">
                      <input className="input" type="number" aria-label={`Escalation ${i + 1} hours after breach`} value={Number.isFinite(x.afterHours) ? x.afterHours : ''} onChange={(e) => set({ escalation: p.escalation.map((y, j) => (j === i ? { ...y, afterHours: e.target.value === '' ? NaN : Number(e.target.value) } : y)) })} />
                      <span className="affix affix-end">h</span>
                    </div>
                  </td>
                  <td>
                    <input className="input" aria-label={`Escalation ${i + 1} alerts`} value={x.to} maxLength={40} onChange={(e) => set({ escalation: p.escalation.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)) })} />
                    {shown(`esc.${i}`) && <p className="field-error">{shown(`esc.${i}`)}</p>}
                  </td>
                  <td>
                    <IconButton icon="trash" label={`Remove escalation step ${i + 1}`} disabledReason={p.escalation.length <= 1 ? 'Keep at least one step' : undefined} onClick={() => set({ escalation: p.escalation.filter((_, j) => j !== i) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button icon="plus" onClick={() => set({ escalation: [...p.escalation, { afterHours: (p.escalation[p.escalation.length - 1]?.afterHours ?? 0) + 24, to: '' }] })}>
            Add step
          </Button>
          <div className="form-grid cols-2" style={{ marginTop: 14 }}>
            <Num id="pol-repeat" label="Repeat complaint window" unit="days" value={p.repeatComplaintDays} onChange={(v) => set({ repeatComplaintDays: v })} error={shown('repeatComplaintDays')} />
            <Num id="pol-reopen" label="Re-open window" unit="days" value={p.reopenWindowDays} onChange={(v) => set({ reopenWindowDays: v })} error={shown('reopenWindowDays')} />
            <Num id="pol-auto" label="Auto-close awaiting confirmation" unit="days" value={p.autoCloseDays} onChange={(v) => set({ autoCloseDays: v })} error={shown('autoCloseDays')} />
            <Num id="pol-rating" label="Low rating alert at or below" unit="★" value={p.lowRatingThreshold} onChange={(v) => set({ lowRatingThreshold: v })} error={shown('lowRatingThreshold')} />
          </div>
        </Section>

        <Section title="Installed base & consumables" help="Warranty default, renewal reminders (IB-05), consumables leakage and reorder rules (BR-39, BR-40) and dormant customers (BR-51).">
          <div className="form-grid cols-2">
            <Num id="pol-warr" label="Default warranty" unit="months" value={p.defaultWarrantyMonths} onChange={(v) => set({ defaultWarrantyMonths: v })} error={shown('defaultWarrantyMonths')} />
            <div className="form-field">
              <label className="field-label" htmlFor="pol-renew">
                Renewal reminders (days before end)
              </label>
              <input
                id="pol-renew"
                className="input"
                value={renewalText}
                onChange={(e) => {
                  setRenewalText(e.target.value);
                  const days = e.target.value.split(/[,\s]+/).filter(Boolean).map(Number);
                  set({ renewalReminderDays: days.every((n) => Number.isFinite(n)) ? [...days].sort((a, b) => b - a) : [NaN] });
                }}
                aria-invalid={!!shown('renewalReminderDays') || undefined}
              />
              {shown('renewalReminderDays') && <p className="field-error">{shown('renewalReminderDays')}</p>}
            </div>
            <Num id="pol-leak" label="Leakage after no consumables order" unit="days" value={p.leakageDays} onChange={(v) => set({ leakageDays: v })} error={shown('leakageDays')} />
            <Num id="pol-missed" label="Missed reorder after" unit="days late" value={p.missedReorderDays} onChange={(v) => set({ missedReorderDays: v })} error={shown('missedReorderDays')} />
            <Num id="pol-dormant" label="Dormant customer after" unit="days" value={p.dormantDays} onChange={(v) => set({ dormantDays: v })} error={shown('dormantDays')} />
          </div>
        </Section>

        <Section title="Field force & documents" help="Office geofence, shift policy (BR-42, BR-43), conveyance rates (BR-46) and the file size limit for attachments (COM-04).">
          <div className="form-grid cols-2">
            <Num id="pol-geo" label="Office geofence radius" unit="m" value={p.geofenceRadiusM} onChange={(v) => set({ geofenceRadiusM: v })} error={shown('geofenceRadiusM')} />
            <div className="form-field">
              <label className="field-label" htmlFor="pol-shift-start">
                Shift start
              </label>
              <input id="pol-shift-start" className="input" placeholder="09:30" value={p.shift.start} onChange={(e) => set({ shift: { ...p.shift, start: e.target.value } })} aria-invalid={!!shown('shift.start') || undefined} />
              {shown('shift.start') && <p className="field-error">{shown('shift.start')}</p>}
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="pol-shift-end">
                Shift end
              </label>
              <input id="pol-shift-end" className="input" placeholder="18:30" value={p.shift.end} onChange={(e) => set({ shift: { ...p.shift, end: e.target.value } })} aria-invalid={!!shown('shift.end') || undefined} />
              {shown('shift.end') && <p className="field-error">{shown('shift.end')}</p>}
            </div>
            <Num id="pol-grace" label="Late-entry grace" unit="min" value={p.shift.graceMin} onChange={(v) => set({ shift: { ...p.shift, graceMin: v } })} error={shown('shift.graceMin')} />
            <Num id="pol-half" label="Half day below" unit="hours" step={0.5} value={p.shift.halfDayHours} onChange={(v) => set({ shift: { ...p.shift, halfDayHours: v } })} error={shown('shift.halfDayHours')} />
            <Num id="pol-tw" label="Conveyance – two-wheeler" unit="₹/km" step={0.5} value={p.conveyance.twoWheeler} onChange={(v) => set({ conveyance: { ...p.conveyance, twoWheeler: v } })} error={shown('conveyance.twoWheeler')} />
            <Num id="pol-car" label="Conveyance – car" unit="₹/km" step={0.5} value={p.conveyance.car} onChange={(v) => set({ conveyance: { ...p.conveyance, car: v } })} error={shown('conveyance.car')} />
            <Num id="pol-file" label="Attachment size limit" unit="MB" value={p.maxFileMb} onChange={(v) => set({ maxFileMb: v })} error={shown('maxFileMb')} />
          </div>
        </Section>
      </div>
      <div className="cat-sticky-actions">
        <Button
          icon="reset"
          onClick={() =>
            confirmDelete({
              title: 'Restore default policies?',
              message: 'All thresholds, SLAs and reminder rules return to the shipped defaults. The change is audited.',
              confirmLabel: 'Restore defaults',
              onConfirm: async () => {
                try {
                  await resetPolicies(actor);
                  setDraft(null);
                  toast('Default policies restored');
                } catch (e) {
                  toast(errorMessage(e), 'danger');
                }
              },
            })
          }
        >
          Restore defaults
        </Button>
        <Button
          onClick={() => {
            setDraft(structuredClone(q.data!));
            setRenewalText(q.data!.renewalReminderDays.join(', '));
            setTried(false);
          }}
          disabledReason={dirty ? undefined : 'No unsaved changes'}
        >
          Discard changes
        </Button>
        <Button variant="primary" loading={busy} onClick={save} disabledReason={dirty ? undefined : 'No unsaved changes'}>
          Save policies
        </Button>
      </div>
    </div>
  );
}
