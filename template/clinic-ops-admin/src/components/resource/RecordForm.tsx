import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RecordData, ResourceDefinition } from '../../metadata/types';
import { uid } from '../../lib/ids';
import { can, fieldAccessMap } from '../../services/authz';
import { commit, getDb } from '../../services/db';
import { useActor } from '../../services/hooks';
import { getResource } from '../../services/registry';
import { createRecord, getRecord, type Projected, updateRecord } from '../../services/runtime';
import { findConflicts } from '../../services/scheduling';
import { type ScheduleConflict, ServiceError } from '../../services/types';
import { isVisible, validateValues } from '../../services/validation';
import { Button } from '../primitives/Button';
import { InlineAlert, useToast } from '../primitives/feedback';
import { Dialog, Drawer } from '../primitives/overlay';
import { ErrorSummary, FormSections } from './FormFields';
import { EmptyValue } from '../primitives/display';

type Values = Record<string, unknown>;

export function initialValues(res: ResourceDefinition, initial: Values = {}): Values {
  const v: Values = {};
  res.fields.forEach((f) => {
    if (f.computed || f.system) return;
    if (f.defaultValue !== undefined) v[f.key] = typeof f.defaultValue === 'object' ? JSON.parse(JSON.stringify(f.defaultValue)) : f.defaultValue;
  });
  if (res.key === 'invoices') {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    v.issueDate = key(today);
    v.dueDate = key(new Date(today.getTime() + 14 * 864e5));
    v.lineItems = [{ serviceCode: 'consult_std', description: '', qty: 1, unitPrice: 95 }];
  }
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
  const [values, setValues] = useState<Values>(() => (loaded ? { ...loaded.record } : initialValues(res, initial)));
  const [baseVersion, setBaseVersion] = useState(loaded?.record.version ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
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

  const schedulePreview = useMemo(() => {
    if (resKey !== 'appointments' || !values.start || !values.clinicianId) return [];
    return findConflicts(getDb(), values, actor.workspaceId, recordId);
  }, [resKey, values, actor.workspaceId, recordId]);

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
    const payload: Values = {};
    scope.forEach((k) => {
      const f = res.fields.find((x) => x.key === k);
      if (f && (isVisible(f, values) || f.clearWhenHidden)) payload[k] = values[k];
    });
    setSubmitting(true);
    try {
      const out = recordId
        ? updateRecord(actor, resKey, recordId, payload, baseVersion, { overrideReason: opts.overrideReason })
        : createRecord(actor, resKey, payload, { idempotencyKey: idemKey.current, overrideReason: opts.overrideReason });
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
          setMessage(e.message);
          focusFirstError();
        } else if (e.code === 'conflict') {
          setConflicts(e.conflicts ?? []);
          setMessage(e.message);
        } else if (e.code === 'version_conflict') {
          setVersionConflict(e.message);
        } else setMessage(e.message);
      } else setMessage('Unexpected error — nothing was saved.');
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

  return { actor, res, access, values, setValue, setValues, errors, setErrors, message, conflicts, versionConflict, submitting, dirty, submit, reload, loaded, schedulePreview, setDirty };
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
      <InlineAlert tone={blocking ? 'danger' : 'warning'} title={blocking ? 'Scheduling conflict' : 'Scheduling warning'}>
        <ul className="plain-list">
          {list.map((c, i) => (
            <li key={i}>{c.message}</li>
          ))}
        </ul>
        {blocking ? (
          <p>Rooms are exclusive. Choose another time or room.</p>
        ) : !canOverride ? (
          <p>Choose another time, or ask a practice manager to book with an override.</p>
        ) : form.conflicts ? (
          <div className="override">
            <label className="field-label" htmlFor="override-reason">
              Override reason (audited)
            </label>
            <input id="override-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Double-booked by agreement with clinician" />
            <Button variant="danger" disabled={reason.trim().length < 5} onClick={() => onOverride(reason)}>
              Book anyway
            </Button>
          </div>
        ) : (
          <p>You can save with an audited override reason.</p>
        )}
      </InlineAlert>
    </div>
  );
}

function VersionConflict({ form }: { form: RecordFormState }) {
  if (!form.versionConflict) return null;
  return (
    <InlineAlert tone="warning" title="This record changed">
      {form.versionConflict}{' '}
      <Button size="compact" icon="reset" onClick={form.reload}>
        Reload latest (discards your edits)
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
      title="Discard unsaved changes?"
      description="Your edits have not been saved."
      size="sm"
      role="alertdialog"
      footer={
        <>
          <Button onClick={() => setAsking(false)} data-autofocus>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setAsking(false);
              onClose();
            }}
          >
            Discard
          </Button>
        </>
      }
    >
      <p className="muted">Closing will lose the changes you made in this form.</p>
    </Dialog>
  );
  return { requestClose, dialog };
}

function FormBody({ form, fieldKeys, sectionIds, children }: { form: RecordFormState; fieldKeys?: string[]; sectionIds?: string[]; children?: ReactNode }) {
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
      <FormSections
        res={form.res}
        fieldKeys={fieldKeys}
        sectionIds={sectionIds}
        values={form.values}
        setValue={form.setValue}
        errors={form.errors}
        access={form.access}
        actor={form.actor}
        record={form.loaded?.record}
      />
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
      toast(`${form.res.label} ${out.record.id} created`);
      onCreated(out.record);
      onClose();
    }
  };
  return (
    <>
      <Dialog
        open
        onClose={guard.requestClose}
        title={`New ${form.res.label.toLowerCase()}`}
        description="Quick create — only the essentials. Use More fields for the full form."
        footer={
          <>
            {onMoreFields && (
              <Button variant="ghost" onClick={() => onMoreFields(form.values)} className="mr-auto">
                More fields…
              </Button>
            )}
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={form.submitting} onClick={() => save()}>
              Create
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
  const toast = useToast();
  const guard = useUnsavedGuard(form.dirty, onClose);
  const save = async (overrideReason?: string) => {
    const out = await form.submit({ overrideReason });
    if (out) {
      toast(recordId ? `${out.record.id} saved` : `${form.res.label} ${out.record.id} created`);
      onSaved?.(out.record);
      onClose();
    }
  };
  return (
    <>
      <Drawer
        open
        onClose={guard.requestClose}
        title={`${recordId ? `Edit ${form.res.label.toLowerCase()} ${recordId}` : `New ${form.res.label.toLowerCase()}`}${form.dirty ? ' · unsaved' : ''}`}
        footer={
          <>
            <Button onClick={guard.requestClose}>Cancel</Button>
            <Button variant="primary" loading={form.submitting} onClick={() => save()}>
              {recordId ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <FormBody form={form}>
          <ConflictPanel form={form} onOverride={(r) => save(r)} />
        </FormBody>
      </Drawer>
      {guard.dialog}
    </>
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
  const steps = form.res.form.wizard ?? [{ id: 'all', title: 'Details', sections: form.res.form.sections.map((s) => s.id) }];
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
      toast(`${form.res.label} ${out.record.id} registered`);
      onCreated(out.record);
      onClose();
    }
  };

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={`Register ${form.res.label.toLowerCase()}`}
      description="Step-by-step registration. Progress is saved as a local draft in this browser."
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
              Discard draft
            </Button>
          ) : null}
          <Button onClick={onClose} title="Closes the wizard; your draft is kept">Cancel</Button>
          {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>Back</Button>}
          {isReview ? (
            <Button variant="primary" loading={form.submitting} onClick={finish}>
              Register
            </Button>
          ) : (
            <Button variant="primary" onClick={next}>
              Next
            </Button>
          )}
        </>
      }
    >
      <ol className="wizard-steps" aria-label="Progress">
        {[...steps.map((s) => s.title), 'Review'].map((t, i) => (
          <li key={t} className={i === step ? 'is-current' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="wizard-num">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
      {resumed && step === 0 && !form.dirty && <InlineAlert tone="info">Resumed your saved draft.</InlineAlert>}
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
    </Dialog>
  );
}

export { FormBody, VersionConflict };
