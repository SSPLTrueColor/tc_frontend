import { lastUsedValues } from '../../services/lastUsed';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RecordData, ResourceDefinition } from '../../metadata/types';
import { uid } from '../../lib/ids';
import { can, fieldAccessMap } from '../../services/authz';
import { commit, getDb } from '../../services/db';
import { useActor, useRevision } from '../../services/hooks';
import { getSettings, updateSettings } from '../../services/settings';
import { cx } from '../../lib/format';
import { getResource } from '../../services/registry';
import { createRecord, getRecord, type Projected, updateRecord } from '../../services/runtime';
import { type ScheduleConflict, ServiceError } from '../../services/types';
import { isVisible, validateValues } from '../../services/validation';
import { Button } from '../primitives/Button';
import { InlineAlert, useToast } from '../primitives/feedback';
import { Dialog, Drawer } from '../primitives/overlay';
import { ErrorLinksContext, ErrorSummary, FormSections } from './FormFields';
import { hooksFor } from '../../services/resourceHooks';
import { EmptyValue } from '../primitives/display';
import { applyFormLayout, divisionOf } from '../../services/formLayouts';
import { L } from '../../constants/labels';
import { TextField } from '../primitives/controls';

const C = L.common;
const F = L.common.form;

type Values = Record<string, unknown>;

export function initialValues(res: ResourceDefinition, initial: Values = {}): Values {
  const v: Values = {};
  res.fields.forEach((f) => {
    if (f.computed || f.system) return;
    if (f.defaultValue !== undefined) v[f.key] = typeof f.defaultValue === 'object' ? JSON.parse(JSON.stringify(f.defaultValue)) : f.defaultValue;
  });
  return { ...v, ...initial };
}

/** Shared mutation contract for every form mode (same validation, idempotency and audit). */
export function useRecordForm({ resKey, recordId, initial }: { resKey: string; recordId?: string; initial?: Values }) {
  const actor = useActor();
  const res = getResource(resKey);
  const mode = recordId ? 'update' : 'create';
  const access = useMemo(() => fieldAccessMap(actor, res, mode), [actor.user.id, actor.workspaceId, res, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = useMemo<Projected | null>(() => {
    if (!recordId) return null;
    try {
      return getRecord(actor, resKey, recordId);
    } catch {
      return null;
    }
  }, [recordId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<Values>(() => (loaded ? { ...loaded.record } : initialValues(res, { ...lastUsedValues(actor.user.id, resKey), ...initial })));
  const [baseVersion, setBaseVersion] = useState(loaded?.record.version ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorLinks, setErrorLinks] = useState<Record<string, { label: string; to: string }>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const warnedFor = useRef<string | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [conflicts, setConflicts] = useState<ScheduleConflict[] | null>(null);
  const [versionConflict, setVersionConflict] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const idemKey = useRef(uid('idem'));

  const setValue = useCallback((key: string, v: unknown) => {
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      // Dependent master/relation: clear child when parent changes.
      res.fields.forEach((f) => {
        if (f.masterParentField === key && prev[key] !== v) next[f.key] = null;
        if (f.relation?.filterBy?.fromField === key && prev[key] !== v) next[f.key] = null;
      });
      return next;
    });
    setDirty(true);
    setErrors((e) => {
      if (!e[key]) return e;
      const n = { ...e };
      delete n[key];
      return n;
    });
  }, [res]);

  const editable = useMemo(() => new Set(Object.entries(access).filter(([, a]) => a === 'edit').map(([k]) => k)), [access]);

  // Live conflict preview is a hook point for scheduling-type resources (none registered yet).
  const schedulePreview: ScheduleConflict[] = [];

  const focusFirstError = () =>
    setTimeout(() => {
      document.querySelector<HTMLElement>('[data-error-summary]')?.focus();
    }, 0);

  const submit = async (opts: { overrideReason?: string; fieldKeys?: string[] } = {}): Promise<Projected | null> => {
    if (submitting) return null; // no double submit
    const scope = opts.fieldKeys ? new Set(opts.fieldKeys.filter((k) => editable.has(k))) : editable;
    const clientErrors = validateValues(res, values, scope);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      setMessage(undefined);
      focusFirstError();
      return null;
    }
    // Pre-save warnings (resourceHooks.saveWarnings): shown once; saving again with the same values proceeds.
    const warn = hooksFor(resKey).saveWarnings?.(actor, values, recordId) ?? [];
    const valuesKey = JSON.stringify(values);
    if (warn.length && warnedFor.current !== valuesKey) {
      warnedFor.current = valuesKey;
      setWarnings(warn);
      return null;
    }
    setWarnings([]);
    const payload: Values = {};
    scope.forEach((k) => {
      const f = res.fields.find((x) => x.key === k);
      if (f && (isVisible(f, values) || f.clearWhenHidden)) payload[k] = values[k];
    });
    setSubmitting(true);
    try {
      const out = recordId
        ? updateRecord(actor, resKey, recordId, payload, baseVersion)
        : createRecord(actor, resKey, payload, { idempotencyKey: idemKey.current });
      idemKey.current = uid('idem');
      setDirty(false);
      setErrors({});
      setMessage(undefined);
      setConflicts(null);
      setBaseVersion(out.record.version);
      return out;
    } catch (e) {
      if (e instanceof ServiceError) {
        if (e.code === 'validation') {
          setErrors(e.fieldErrors ?? {});
          setErrorLinks(e.fieldLinks ?? {});
          setMessage(e.message);
          focusFirstError();
        } else if (e.code === 'conflict') {
          setConflicts(e.conflicts ?? []);
          setMessage(e.message);
        } else if (e.code === 'version_conflict') {
          setVersionConflict(e.message);
        } else setMessage(e.message);
      } else setMessage(C.toasts.nothingSaved);
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const reload = () => {
    if (!recordId) return;
    const fresh = getRecord(actor, resKey, recordId);
    setValues({ ...fresh.record });
    setBaseVersion(fresh.record.version);
    setVersionConflict(null);
    setDirty(false);
  };

  return { actor, res, access, values, setValue, setValues, errors, setErrors, errorLinks, warnings, message, conflicts, versionConflict, submitting, dirty, submit, reload, loaded, schedulePreview, setDirty };
}

export type RecordFormState = ReturnType<typeof useRecordForm>;

export function ConflictPanel({ form, onOverride }: { form: RecordFormState; onOverride: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const list = form.conflicts ?? form.schedulePreview;
  if (!list.length) return null;
  const blocking = list.some((c) => !c.overridable);
  const canOverride = can(form.actor, 'schedule.override');
  return (
    <div className="conflict-panel" role={form.conflicts ? 'alert' : 'status'}>
      <InlineAlert tone={blocking ? 'danger' : 'warning'} title={blocking ? F.schedulingConflict : F.schedulingWarning}>
        <ul className="plain-list">
          {list.map((c, i) => (
            <li key={i}>{c.message}</li>
          ))}
        </ul>
        {blocking ? (
          <p>{F.conflictBlocking}</p>
        ) : !canOverride ? (
          <p>{F.conflictAskManager}</p>
        ) : form.conflicts ? (
          <div className="override">
            <label className="field-label" htmlFor="override-reason">
              {F.overrideReason}
            </label>
            <TextField id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={F.overridePlaceholder} />
            <Button variant="danger" disabled={reason.trim().length < 5} onClick={() => onOverride(reason)}>
              {F.overrideAction}
            </Button>
          </div>
        ) : (
          <p>{F.canOverride}</p>
        )}
      </InlineAlert>
    </div>
  );
}

function VersionConflict({ form }: { form: RecordFormState }) {
  if (!form.versionConflict) return null;
  return (
    <InlineAlert tone="warning" title={F.recordChanged}>
      {form.versionConflict}{' '}
      <Button size="compact" icon="reset" onClick={form.reload}>
        {F.reloadLatest}
      </Button>
    </InlineAlert>
  );
}

/** Confirm-before-discard for dirty forms. */
export function useUnsavedGuard(dirty: boolean, onClose: () => void) {
  const [asking, setAsking] = useState(false);
  const requestClose = () => (dirty ? setAsking(true) : onClose());
  const dialog = (
    <Dialog
      open={asking}
      onClose={() => setAsking(false)}
      title={C.confirm.unsavedTitle}
      description={C.confirm.unsavedDescription}
      size="sm"
      role="alertdialog"
      footer={
        <>
          <Button onClick={() => setAsking(false)} data-autofocus>
            {C.actions.keepEditing}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setAsking(false);
              onClose();
            }}
          >
            {C.actions.discard}
          </Button>
        </>
      }
    >
      <p className="muted">{C.confirm.unsavedBody}</p>
    </Dialog>
  );
  return { requestClose, dialog };
}

function FormBody({ form, fieldKeys, sectionIds, children, layout }: { form: RecordFormState; fieldKeys?: string[]; sectionIds?: string[]; children?: ReactNode; layout?: 'simple' | 'canvas' }) {
  // Per-division form layout (ADM-05): registered by Administration in src/services/formLayouts.ts; no-op when none.
  const res = applyFormLayout(form.res, divisionOf(form.res, form.values));
  return (
    <form
      className="record-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <VersionConflict form={form} />
      <ErrorSummary errors={form.errors} res={form.res} message={form.message && !form.conflicts ? form.message : undefined} />
      {form.warnings.length > 0 && (
        <InlineAlert tone="warning" title={L.common.form.warningsTitle}>
          <ul>
            {form.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {L.common.form.warningsBody}
        </InlineAlert>
      )}
      <ErrorLinksContext.Provider value={form.errorLinks}>
      <FormSections
        res={res}
        fieldKeys={fieldKeys}
        sectionIds={sectionIds}
        values={form.values}
        setValue={form.setValue}
        errors={form.errors}
        access={form.access}
        actor={form.actor}
        record={form.loaded?.record}
        layout={layout}
      />
      </ErrorLinksContext.Provider>
      {children}
    </form>
  );
}

// ---------------------------------------------------------------- Quick create (small dialog)

export function QuickCreateDialog({
  resKey,
  open,
  onClose,
  initial,
  onCreated,
  onMoreFields,
}: {
  resKey: string;
  open: boolean;
  onClose: () => void;
  initial?: Values;
  onCreated: (r: RecordData) => void;
  onMoreFields?: (values: Values) => void;
}) {
  if (!open) return null;
  return <QuickCreateInner resKey={resKey} onClose={onClose} initial={initial} onCreated={onCreated} onMoreFields={onMoreFields} />;
}

function QuickCreateInner({ resKey, onClose, initial, onCreated, onMoreFields }: { resKey: string; onClose: () => void; initial?: Values; onCreated: (r: RecordData) => void; onMoreFields?: (values: Values) => void }) {
  const form = useRecordForm({ resKey, initial });
  const toast = useToast();
  const guard = useUnsavedGuard(form.dirty, onClose);
  const keys = form.res.form.quickCreate;
  const save = async (overrideReason?: string) => {
    const out = await form.submit({ overrideReason });
    if (out) {
      toast(C.toasts.created(form.res.label, out.record.id));
      onCreated(out.record);
      onClose();
    }
  };
  return (
    <>
      <Dialog
        open
        onClose={guard.requestClose}
        title={form.res.form.primaryLabel ?? F.newTitle(form.res.label)}
        description={F.quickCreateDescription}
        footer={
          <>
            {onMoreFields && (
              <Button variant="ghost" onClick={() => onMoreFields(form.values)} className="mr-auto">
                {C.actions.moreFields}
              </Button>
            )}
            <Button onClick={guard.requestClose}>{C.actions.cancel}</Button>
            <Button variant="primary" loading={form.submitting} onClick={() => save()}>
              {form.res.form.primaryLabel ?? C.actions.create}
            </Button>
          </>
        }
      >
        <FormBody form={form} fieldKeys={keys}>
          <ConflictPanel form={form} onOverride={(r) => save(r)} />
        </FormBody>
      </Dialog>
      {guard.dialog}
    </>
  );
}

// ---------------------------------------------------------------- Drawer form (create/edit without losing the list)

export function FormDrawer({ resKey, recordId, open, onClose, initial, onSaved }: { resKey: string; recordId?: string; open: boolean; onClose: () => void; initial?: Values; onSaved?: (r: RecordData) => void }) {
  if (!open) return null;
  return <FormDrawerInner resKey={resKey} recordId={recordId} onClose={onClose} initial={initial} onSaved={onSaved} />;
}

function FormDrawerInner({ resKey, recordId, onClose, initial, onSaved }: { resKey: string; recordId?: string; onClose: () => void; initial?: Values; onSaved?: (r: RecordData) => void }) {
  const form = useRecordForm({ resKey, recordId, initial });
  useRevision();
  const layout = getSettings(form.actor.user.id).formLayout ?? 'simple';
  const toast = useToast();
  const guard = useUnsavedGuard(form.dirty, onClose);
  const save = async (overrideReason?: string) => {
    const out = await form.submit({ overrideReason });
    if (out) {
      toast(recordId ? C.toasts.saved(out.record.id) : C.toasts.created(form.res.label, out.record.id));
      onSaved?.(out.record);
      onClose();
    }
  };
  return (
    <>
      <FormFrame
        kind="form"
        onClose={guard.requestClose}
        title={`${recordId ? F.editTitle(form.res.label, recordId) : F.newTitle(form.res.label)}${form.dirty ? F.unsavedSuffix : ''}`}
        layoutSwitch={<LayoutSwitch />}
        footer={
          <>
            <Button onClick={guard.requestClose}>{C.actions.cancel}</Button>
            <Button variant="primary" loading={form.submitting} onClick={() => save()}>
              {recordId ? C.actions.saveChanges : C.actions.create}
            </Button>
          </>
        }
      >
        <FormBody form={form} layout={layout}>
          <ConflictPanel form={form} onOverride={(r) => save(r)} />
        </FormBody>
      </FormFrame>
      {guard.dialog}
    </>
  );
}

/** Simple | Canvas switch (per user), shared by add/edit forms and the step wizard. */
function LayoutSwitch() {
  useRevision();
  const actor = useActor();
  const layout = getSettings(actor.user.id).formLayout ?? 'simple';
  return (
    <div className="segmented form-layout-switch" role="radiogroup" aria-label={F.layout}>
      {(['simple', 'canvas'] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={layout === l} className={cx('seg-btn', layout === l && 'is-on')} onClick={() => updateSettings(actor.user.id, { formLayout: l })}>
          {l === 'simple' ? F.simple : F.canvas}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Form frame: side drawer OR popup (user choice)

/** Forms open in a side drawer; the step wizard opens as a popup (no Drawer | Popup switch — owner rule). */
function FormFrame({ kind, onClose, title, footer, children, layoutSwitch }: { kind: 'form' | 'wizard'; onClose: () => void; title: string; footer: ReactNode; children: ReactNode; layoutSwitch?: ReactNode }) {
  const extra = layoutSwitch ? <span className="form-header-switches">{layoutSwitch}</span> : undefined;
  return kind === 'form' ? (
    <Drawer open onClose={onClose} title={title} headerExtra={extra} footer={footer}>
      {children}
    </Drawer>
  ) : (
    <Dialog open size="lg" onClose={onClose} title={title} headerExtra={extra} footer={footer}>
      {children}
    </Dialog>
  );
}

// ---------------------------------------------------------------- Wizard (validated steps, local draft)

export function WizardDialog({ resKey, open, onClose, onCreated }: { resKey: string; open: boolean; onClose: () => void; onCreated: (r: RecordData) => void }) {
  if (!open) return null;
  return <WizardInner resKey={resKey} onClose={onClose} onCreated={onCreated} />;
}

function WizardInner({ resKey, onClose, onCreated }: { resKey: string; onClose: () => void; onCreated: (r: RecordData) => void }) {
  const actor = useActor();
  const draftKey = `wizard:${resKey}:${actor.user.id}:${actor.workspaceId}`;
  const saved = getDb().formDrafts[draftKey] as { values: Values; step: number } | undefined;
  const form = useRecordForm({ resKey, initial: saved?.values });
  const [step, setStep] = useState(saved?.step ?? 0);
  const [resumed] = useState(!!saved);
  const toast = useToast();
  const steps = form.res.form.wizard ?? [{ id: 'all', title: F.details, sections: form.res.form.sections.map((s) => s.id) }];
  const isReview = step === steps.length;

  // Autosave draft (debounced) — local only.
  useEffect(() => {
    if (!form.dirty) return;
    const t = setTimeout(() => commit((d) => (d.formDrafts[draftKey] = { values: form.values, step })), 500);
    return () => clearTimeout(t);
  }, [form.values, step, form.dirty, draftKey]);

  const clearDraft = () => commit((d) => delete d.formDrafts[draftKey]);
  const stepFields = (i: number) => steps[i].sections.flatMap((sid) => form.res.form.sections.find((s) => s.id === sid)?.fields ?? []);

  const next = () => {
    const keys = new Set(stepFields(step).filter((k) => form.access[k] === 'edit'));
    const errs = validateValues(form.res, form.values, keys);
    if (Object.keys(errs).length) {
      form.setErrors(errs);
      setTimeout(() => document.querySelector<HTMLElement>('[data-error-summary]')?.focus(), 0);
      return;
    }
    setStep((s) => s + 1);
  };

  const finish = async () => {
    const out = await form.submit();
    if (out) {
      clearDraft();
      toast(C.toasts.registered(form.res.label, out.record.id));
      onCreated(out.record);
      onClose();
    }
  };

  return (
    <FormFrame
      kind="wizard"
      onClose={onClose}
      title={C.actions.registerRecord(form.res.label)}
      footer={
        <>
          {resumed || form.dirty ? (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                clearDraft();
                onClose();
              }}
            >
              {C.actions.discardDraft}
            </Button>
          ) : null}
          <Button onClick={onClose} title={F.wizardCancelTip}>
            {C.actions.cancel}
          </Button>
          {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>{C.actions.back}</Button>}
          {isReview ? (
            <Button variant="primary" loading={form.submitting} onClick={finish}>
              {C.actions.register}
            </Button>
          ) : (
            <Button variant="primary" onClick={next}>
              {C.actions.next}
            </Button>
          )}
        </>
      }
    >
      <ol className="wizard-steps" aria-label={F.progress}>
        {[...steps.map((s) => s.title), F.review].map((t, i) => (
          <li key={t} className={i === step ? 'is-current' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="wizard-num">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
      {resumed && step === 0 && !form.dirty && <InlineAlert tone="info">{F.resumedDraft}</InlineAlert>}
      {isReview ? (
        <div className="review">
          <ErrorSummary errors={form.errors} res={form.res} message={form.message} />
          <dl className="detail-list">
            {form.res.fields
              .filter((f) => form.access[f.key] === 'edit' && isVisible(f, form.values))
              .map((f) => (
                <div key={f.key} className="detail-row">
                  <dt>{f.label}</dt>
                  <dd>{(Array.isArray(form.values[f.key]) ? (form.values[f.key] as string[]).join(', ') : String(form.values[f.key] ?? '')) || <EmptyValue />}</dd>
                </div>
              ))}
          </dl>
        </div>
      ) : (
        <FormBody form={form} sectionIds={steps[step].sections} />
      )}
    </FormFrame>
  );
}

export { FormBody, VersionConflict };
