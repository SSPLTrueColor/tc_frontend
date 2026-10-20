/**
 * Configurable business numbers on three Administration pages (GLOSSARY G-A12, G-B9):
 * Workflows & Approval Matrices (ADM-04), SLA Matrix (SRV-04, SRV-09) and Configurable Rules (ADM-04, ADM-09).
 * Each page edits only its own keys (services/catalog/policyRules.ts); same validation, save, toast and audit.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { resetPolicies, savePolicies } from '../../services/api/catalog';
import { can } from '../../services/authz';
import { COVERAGE_KEYS, POLICY_GROUPS, PRIORITY_KEYS, STAGE_KEYS, type PolicyGroup, validatePolicyGroup } from '../../services/catalog/policyRules';
import { useActor } from '../../services/hooks';
import { getPolicies, type Policies } from '../../services/policies';
import { activeMasterValues } from '../../services/registry';
import type { ApprovalLevel } from '../../services/types';
import { Button, IconButton } from '../../components/primitives/Button';
import { ErrorState, NoAccess, useToast } from '../../components/primitives/feedback';
import { MultiSelectMenu } from '../../components/primitives/MultiSelectMenu';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { DangerZone, SaveBar, SettingsField, SettingsPage, SettingsSection, SettingsSkeleton } from '../../components/settings/kit';

const P = L.admin.policies;
const F = P.fields;
const U = P.units;

/** Approval levels an administrator can put on a discount band (capability → role name shown to approvers). */
const LEVELS: ApprovalLevel[] = [
  { capability: 'approve.l1', label: P.approvers.l1 },
  { capability: 'approve.l2', label: P.approvers.l2 },
  { capability: 'approve.l3', label: P.approvers.l3 },
  { capability: 'approve.finance', label: P.approvers.finance },
];

const TITLES: Record<PolicyGroup, string> = { workflows: L.nav.pages.workflows.title, sla: L.nav.pages.slaMatrix.title, rules: L.nav.pages.configurableRules.title };

/** Errors show once the field has been left (blur) or after a save attempt. */
const ShowAllErrors = createContext(false);

function Num({ id, label, value, onChange, unit, error, help, step = 1 }: { id: string; label: string; value: number; onChange: (n: number) => void; unit?: string; error?: string; help?: string; step?: number }) {
  const all = useContext(ShowAllErrors);
  const [blurred, setBlurred] = useState(false);
  const shownError = blurred || all ? error : undefined;
  return (
    <SettingsField label={label} htmlFor={id} help={help} error={shownError}>
      <div className={unit ? 'input-affix has-end' : undefined}>
        <input
          id={id}
          className="input"
          type="number"
          step={step}
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          onBlur={() => setBlurred(true)}
          aria-invalid={!!shownError || undefined}
          aria-describedby={shownError ? `${id}-err` : undefined}
        />
        {unit && <span className="affix affix-end">{unit}</span>}
      </div>
    </SettingsField>
  );
}

const Section = SettingsSection;

const num = (v: string) => (v === '' ? NaN : Number(v));

interface EditorProps {
  p: Policies;
  set: (patch: Partial<Policies>) => void;
  shown: (k: string) => string | undefined;
}

/** Shared load → edit → validate → save shell for one policy page. */
function PolicyPage({ group, children }: { group: PolicyGroup; children: (props: EditorProps & { renewalText: string; setRenewalText: (s: string) => void }) => ReactNode }) {
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

  const description = L.settingsKit.desc[group];
  if (!can(actor, 'config.publish')) return <NoAccess what={P.noAccessWhat[group]} />;
  if (q.error)
    return (
      <SettingsPage title={TITLES[group]} description={description}>
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </SettingsPage>
    );
  if (!q.data || !draft)
    return (
      <SettingsPage title={TITLES[group]} description={description}>
        <SettingsSkeleton sections={3} />
      </SettingsPage>
    );

  const p = draft;
  const keys = POLICY_GROUPS[group];
  const set = (patch: Partial<Policies>) => setDraft({ ...p, ...patch });
  const errors = validatePolicyGroup(p, group);
  const shown = (k: string) => errors[k];
  const changed = keys.filter((k) => JSON.stringify(p[k]) !== JSON.stringify(q.data![k]));
  const dirty = changed.length > 0;
  const errorCount = Object.keys(errors).length;

  const save = async () => {
    setTried(true);
    if (errorCount) {
      toast(P.fixBeforeSave(errorCount), 'danger');
      return;
    }
    const patch = Object.fromEntries(changed.map((k) => [k, p[k]])) as Partial<Policies>;
    setBusy(true);
    try {
      await savePolicies(actor, patch);
      toast(P.saved(changed.length));
      setDraft(null);
      setTried(false);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPage title={TITLES[group]} description={description}>
      <ShowAllErrors.Provider value={tried}>{children({ p, set, shown, renewalText, setRenewalText })}</ShowAllErrors.Provider>
      <SaveBar
        dirty={dirty}
        busy={busy}
        errorCount={tried ? errorCount : 0}
        saveLabel={P.save}
        onSave={save}
        onCancel={() => {
          setDraft(structuredClone(q.data!));
          setRenewalText(q.data!.renewalReminderDays.join(', '));
          setTried(false);
        }}
      />
      <DangerZone
        title={P.restoreTitle}
        description={P.restoreMessage}
        actionLabel={L.admin.common.restoreDefaults}
        confirmWord={L.settingsKit.resetWord}
        confirmTitle={P.restoreTitle}
        confirmBody={P.restoreMessage}
        onConfirm={async () => {
          try {
            await resetPolicies(actor, group);
            setDraft(null);
            setTried(false);
            toast(P.restored);
          } catch (e) {
            toast(errorMessage(e), 'danger');
            throw e;
          }
        }}
      />
    </SettingsPage>
  );
}

// ---------------------------------------------------------------- Workflows & Approval Matrices (ADM-04)

export function WorkflowsPage() {
  return (
    <PolicyPage group="workflows">
      {({ p, set, shown }) => (
        <>
          <Section wide title={P.sections.discount} help={P.sections.discountHelp}>
            <div className="table-scroll">
              <table className="mini-table cat-bands">
                <thead>
                  <tr>
                    <th scope="col">{F.upTo}</th>
                    <th scope="col">{F.approvedBy}</th>
                    <th scope="col">
                      <span className="sr-only">{L.admin.common.remove}</span>
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
                            aria-label={F.bandLimit(i + 1)}
                            value={Number.isFinite(b.upTo) ? b.upTo : ''}
                            onChange={(e) => set({ discountBands: p.discountBands.map((x, j) => (j === i ? { ...x, upTo: num(e.target.value) } : x)) })}
                            aria-invalid={!!shown(`band.${i}`) || undefined}
                          />
                          <span className="affix affix-end">{U.pct}</span>
                        </div>
                        {shown(`band.${i}`) && <p className="field-error">{shown(`band.${i}`)}</p>}
                      </td>
                      <td>
                        <MultiSelectMenu
                          label={F.bandApprovers(i + 1)}
                          emptyLabel={F.autoApproved}
                          block
                          values={b.levels.map((l) => l.capability)}
                          options={LEVELS.map((l) => ({ value: l.capability, label: l.label }))}
                          onChange={(caps) => set({ discountBands: p.discountBands.map((x, j) => (j === i ? { ...x, levels: LEVELS.filter((l) => caps.includes(l.capability)) } : x)) })}
                        />
                      </td>
                      <td>
                        <IconButton icon="trash" label={F.removeBand(i + 1)} disabledReason={p.discountBands.length <= 1 ? F.keepOneBand : undefined} onClick={() => set({ discountBands: p.discountBands.filter((_, j) => j !== i) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown('discountBands') && <p className="field-error">{shown('discountBands')}</p>}
            <Button icon="plus" onClick={() => set({ discountBands: [...p.discountBands, { upTo: 100, levels: [LEVELS[0], LEVELS[1], LEVELS[2]] }] })}>
              {F.addBand}
            </Button>
          </Section>
          <Section title={P.sections.salesOrder} help={P.sections.salesOrderHelp}>
            <div className="form-grid">
              <Num id="pol-tol" label={F.soTolerance} unit={U.pm} value={p.soTolerancePct} onChange={(v) => set({ soTolerancePct: v })} error={shown('soTolerancePct')} step={0.5} help={F.soToleranceHelp} />
              <Num id="pol-adv" label={F.soFinance} unit={U.pct} value={p.soFinanceCheckAdvancePct} onChange={(v) => set({ soFinanceCheckAdvancePct: v })} error={shown('soFinanceCheckAdvancePct')} help={F.soFinanceHelp} />
            </div>
          </Section>
          <Section title={P.sections.reminders} help={P.sections.remindersHelp}>
            <div className="form-grid">
              <Num id="pol-pay" label={F.paymentReminder} unit={U.days} value={p.paymentReminderDaysBefore} onChange={(v) => set({ paymentReminderDaysBefore: v })} error={shown('paymentReminderDaysBefore')} />
            </div>
          </Section>
        </>
      )}
    </PolicyPage>
  );
}

// ---------------------------------------------------------------- SLA Matrix (SRV-04, SRV-09)

export function SlaMatrixPage() {
  return (
    <PolicyPage group="sla">
      {({ p, set, shown }) => (
        <>
          <Section wide title={P.sections.slaMatrix} help={P.sections.slaMatrixHelp}>
            <div className="st-sla-list">
              {PRIORITY_KEYS.map((pr) => (
                <div key={pr} className="st-sla-block">
                  <h3 className="st-subtitle">{P.priorities[pr]}</h3>
                  <div className="table-scroll">
                    <table className="mini-table st-sla">
                      <thead>
                        <tr>
                          <th scope="col">{F.coverage}</th>
                          {(['response', 'arrival', 'resolution'] as const).map((k) => (
                            <th key={k} scope="col">
                              {F.slaColumns[k]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {COVERAGE_KEYS.map((cv) => {
                          const s = p.sla[pr]?.[cv] ?? { response: NaN, arrival: NaN, resolution: NaN };
                          const upd = (k: 'response' | 'arrival' | 'resolution', v: number) => set({ sla: { ...p.sla, [pr]: { ...p.sla[pr], [cv]: { ...s, [k]: v } } } });
                          const err = shown(`sla.${pr}.${cv}`);
                          return (
                            <tr key={cv}>
                              <th scope="row">{P.coverages[cv]}</th>
                              {(['response', 'arrival', 'resolution'] as const).map((k) => (
                                <td key={k}>
                                  <input className="input" type="number" aria-label={F.slaCell(P.priorities[pr], P.coverages[cv], F.slaKinds[k])} value={Number.isFinite(s[k]) ? s[k] : ''} onChange={(e) => upd(k, num(e.target.value))} aria-invalid={!!err || undefined} />
                                </td>
                              ))}
                              {err && (
                                <td className="field-error st-sla-err" colSpan={3}>
                                  {err}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Section>
          <Section wide title={P.sections.escalation} help={P.sections.escalationHelp}>
            <div className="table-scroll">
              <table className="mini-table cat-bands">
                <tbody>
                  {p.escalation.map((x, i) => (
                    <tr key={i}>
                      <td>
                        <div className="input-affix has-end cat-num">
                          <input className="input" type="number" aria-label={F.escalationHours(i + 1)} value={Number.isFinite(x.afterHours) ? x.afterHours : ''} onChange={(e) => set({ escalation: p.escalation.map((y, j) => (j === i ? { ...y, afterHours: num(e.target.value) } : y)) })} />
                          <span className="affix affix-end">{U.h}</span>
                        </div>
                      </td>
                      <td>
                        <input className="input" aria-label={F.escalationTo(i + 1)} value={x.to} maxLength={40} onChange={(e) => set({ escalation: p.escalation.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)) })} />
                        {shown(`esc.${i}`) && <p className="field-error">{shown(`esc.${i}`)}</p>}
                      </td>
                      <td>
                        <IconButton icon="trash" label={F.removeStep(i + 1)} disabledReason={p.escalation.length <= 1 ? F.keepOneStep : undefined} onClick={() => set({ escalation: p.escalation.filter((_, j) => j !== i) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button icon="plus" onClick={() => set({ escalation: [...p.escalation, { afterHours: (p.escalation[p.escalation.length - 1]?.afterHours ?? 0) + 24, to: '' }] })}>
              {F.addStep}
            </Button>
          </Section>
        </>
      )}
    </PolicyPage>
  );
}

// ---------------------------------------------------------------- Configurable Rules (ADM-04, ADM-09)

export function ConfigurableRulesPage() {
  return (
    <PolicyPage group="rules">
      {({ p, set, shown, renewalText, setRenewalText }) => (
        <>
          <Section title={P.sections.sales} help={P.sections.salesHelp}>
            <div className="form-grid cols-2">
              <Num id="pol-lead" label={F.leadFirstContact} unit={U.hours} value={p.leadFirstContactHours} onChange={(v) => set({ leadFirstContactHours: v })} error={shown('leadFirstContactHours')} help={F.leadFirstContactHelp} />
              <Num id="pol-stag" label={F.stagnation} unit={U.days} value={p.opportunityStagnationDays} onChange={(v) => set({ opportunityStagnationDays: v })} error={shown('opportunityStagnationDays')} help={F.stagnationHelp} />
              {STAGE_KEYS.map((k) => (
                <Num key={k} id={`pol-stage-${k}`} label={F.stageProbability(P.stages[k])} unit={U.pct} value={p.stageProbability[k] ?? NaN} onChange={(v) => set({ stageProbability: { ...p.stageProbability, [k]: v } })} error={shown(`stage.${k}`)} />
              ))}
            </div>
          </Section>

          <Section title={P.sections.quotations} help={P.sections.quotationsHelp}>
            <div className="form-grid">
              <Num id="pol-valid" label={F.quoteValidity} unit={U.days} value={p.quoteValidityDays} onChange={(v) => set({ quoteValidityDays: v })} error={shown('quoteValidityDays')} />
              <div className="form-field">
                <label className="field-label" htmlFor="pol-gst">
                  {F.gstState}
                </label>
                <SelectMenu id="pol-gst" block label={F.gstState} value={p.companyGstState} options={activeMasterValues('state').map((s) => ({ value: s.key, label: `${s.label} (${s.key})` }))} onChange={(v) => set({ companyGstState: v })} />
              </div>
            </div>
          </Section>

          <Section title={P.sections.service} help={P.sections.serviceHelp}>
            <div className="form-grid cols-2">
              <Num id="pol-repeat" label={F.repeatComplaint} unit={U.days} value={p.repeatComplaintDays} onChange={(v) => set({ repeatComplaintDays: v })} error={shown('repeatComplaintDays')} />
              <Num id="pol-reopen" label={F.reopenWindow} unit={U.days} value={p.reopenWindowDays} onChange={(v) => set({ reopenWindowDays: v })} error={shown('reopenWindowDays')} />
              <Num id="pol-auto" label={F.autoClose} unit={U.days} value={p.autoCloseDays} onChange={(v) => set({ autoCloseDays: v })} error={shown('autoCloseDays')} />
              <Num id="pol-rating" label={F.lowRating} unit={U.star} value={p.lowRatingThreshold} onChange={(v) => set({ lowRatingThreshold: v })} error={shown('lowRatingThreshold')} />
            </div>
          </Section>

          <Section title={P.sections.installed} help={P.sections.installedHelp}>
            <div className="form-grid cols-2">
              <Num id="pol-warr" label={F.warranty} unit={U.months} value={p.defaultWarrantyMonths} onChange={(v) => set({ defaultWarrantyMonths: v })} error={shown('defaultWarrantyMonths')} />
              <div className="form-field">
                <label className="field-label" htmlFor="pol-renew">
                  {F.renewalReminders}
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
              <Num id="pol-leak" label={F.leakage} unit={U.days} value={p.leakageDays} onChange={(v) => set({ leakageDays: v })} error={shown('leakageDays')} />
              <Num id="pol-missed" label={F.missedReorder} unit={U.daysLate} value={p.missedReorderDays} onChange={(v) => set({ missedReorderDays: v })} error={shown('missedReorderDays')} />
              <Num id="pol-dormant" label={F.dormant} unit={U.days} value={p.dormantDays} onChange={(v) => set({ dormantDays: v })} error={shown('dormantDays')} />
            </div>
          </Section>

          <Section title={P.sections.field} help={P.sections.fieldHelp}>
            <div className="form-grid cols-2">
              <Num id="pol-geo" label={F.geofence} unit={U.m} value={p.geofenceRadiusM} onChange={(v) => set({ geofenceRadiusM: v })} error={shown('geofenceRadiusM')} />
              <div className="form-field">
                <label className="field-label" htmlFor="pol-shift-start">
                  {F.shiftStart}
                </label>
                <input id="pol-shift-start" className="input" placeholder="09:30" value={p.shift.start} onChange={(e) => set({ shift: { ...p.shift, start: e.target.value } })} aria-invalid={!!shown('shift.start') || undefined} />
                {shown('shift.start') && <p className="field-error">{shown('shift.start')}</p>}
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="pol-shift-end">
                  {F.shiftEnd}
                </label>
                <input id="pol-shift-end" className="input" placeholder="18:30" value={p.shift.end} onChange={(e) => set({ shift: { ...p.shift, end: e.target.value } })} aria-invalid={!!shown('shift.end') || undefined} />
                {shown('shift.end') && <p className="field-error">{shown('shift.end')}</p>}
              </div>
              <Num id="pol-grace" label={F.grace} unit={U.min} value={p.shift.graceMin} onChange={(v) => set({ shift: { ...p.shift, graceMin: v } })} error={shown('shift.graceMin')} />
              <Num id="pol-half" label={F.halfDay} unit={U.hours} step={0.5} value={p.shift.halfDayHours} onChange={(v) => set({ shift: { ...p.shift, halfDayHours: v } })} error={shown('shift.halfDayHours')} />
              <Num id="pol-tw" label={F.twoWheeler} unit={U.perKm} step={0.5} value={p.conveyance.twoWheeler} onChange={(v) => set({ conveyance: { ...p.conveyance, twoWheeler: v } })} error={shown('conveyance.twoWheeler')} />
              <Num id="pol-car" label={F.car} unit={U.perKm} step={0.5} value={p.conveyance.car} onChange={(v) => set({ conveyance: { ...p.conveyance, car: v } })} error={shown('conveyance.car')} />
              <Num id="pol-file" label={F.maxFile} unit={U.mb} value={p.maxFileMb} onChange={(v) => set({ maxFileMb: v })} error={shown('maxFileMb')} />
            </div>
          </Section>
        </>
      )}
    </PolicyPage>
  );
}
