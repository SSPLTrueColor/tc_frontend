import { useState } from 'react';
import { nowLocal, todayKey } from '../../lib/dates';
import { call, errorMessage } from '../../services/api/client';
import { logActivity, type ActivityInput } from '../../services/activities';
import { useActor } from '../../services/hooks';
import { activeMasterValues } from '../../services/registry';
import { ServiceError } from '../../services/types';
import { Button } from '../primitives/Button';
import { DatePicker } from '../primitives/DatePicker';
import { useToast } from '../primitives/feedback';
import { Dialog } from '../primitives/overlay';
import { SelectMenu } from '../primitives/SelectMenu';
import { VoiceButton } from './VoiceButton';
import { L } from '../../constants/labels';
import { TextField, Textarea } from '../primitives/controls';

const A = L.common.activity;

/**
 * Shared "Log Activity" dialog (leads and opportunities pass title "Log Follow-up") (LEAD-09, COM-05) for any record. With `requireNextFollowUp`
 * the next follow-up date is mandatory (BR-07). Three taps on mobile: type → subject → Save.
 */
export function LogActivityDialog({
  open,
  onClose,
  parent,
  requireNextFollowUp = false,
  defaultType = 'call',
  onLogged,
  title = A.title,
}: {
  open: boolean;
  onClose: () => void;
  parent: Omit<ActivityInput, 'activityType' | 'subject' | 'notes' | 'at' | 'nextFollowUpAt'>;
  requireNextFollowUp?: boolean;
  defaultType?: string;
  onLogged?: () => void;
  /** Dialog title: "Log Activity" by default; leads and opportunities use "Log Follow-up" (GLOSSARY §5). */
  title?: string;
}) {
  const actor = useActor();
  const toast = useToast();
  const [type, setType] = useState(defaultType);
  const [subject, setSubject] = useState('');
  const [at, setAt] = useState(nowLocal());
  const [next, setNext] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!subject.trim()) e.subject = A.subjectRequired;
    if (requireNextFollowUp && !next) e.nextFollowUpAt = A.nextRequired;
    if (next && next < todayKey()) e.nextFollowUpAt = A.notPast;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await call(() => logActivity(actor, { ...parent, activityType: type, subject: subject.trim(), notes, at, nextFollowUpAt: next || null }));
      toast(L.common.toasts.activityLogged);
      onLogged?.();
      setSubject('');
      setNotes('');
      setNext('');
      onClose();
    } catch (err) {
      setErrors(err instanceof ServiceError && err.fieldErrors ? err.fieldErrors : { form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={title}
      description={A.description(parent.parentLabel)}
      footer={
        <>
          <Button onClick={onClose}>{L.common.actions.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {L.common.actions.saveActivity}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field">
          <label className="field-label" htmlFor="act-type">
            {A.type} <span className="req">*</span>
          </label>
          <SelectMenu id="act-type" block label={A.type} value={type} options={activeMasterValues('activityType').map((v) => ({ value: v.key, label: v.label }))} onChange={setType} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="act-at">
            {A.when} <span className="req">*</span>
          </label>
          <DatePicker id="act-at" withTime value={at} onChange={(v) => setAt(v ?? nowLocal())} label={A.when} />
        </div>
        <div className="form-field span-all">
          <label className="field-label" htmlFor="act-subject">
            {A.subject} <span className="req">*</span>
          </label>
          <TextField id="act-subject" maxLength={140} value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={!!errors.subject || undefined} data-autofocus />
          {errors.subject && <p className="field-error">{errors.subject}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="act-next">
            {A.nextFollowUp} {requireNextFollowUp && <span className="req">*</span>}
          </label>
          <DatePicker id="act-next" value={next} onChange={(v) => setNext(v ?? '')} label={A.nextFollowUp} />
          {errors.nextFollowUpAt && <p className="field-error">{errors.nextFollowUpAt}</p>}
        </div>
        <div className="form-field span-all">
          <span className="field-label-row">
            <label className="field-label" htmlFor="act-notes">
              {A.notes}
            </label>
            <VoiceButton onText={(t) => setNotes((n) => (n ? `${n} ${t}` : t))} label={L.common.voice.dictateNotes} />
          </span>
          <Textarea id="act-notes" className="textarea" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {errors.form && (
          <p className="field-error span-all" role="alert">
            {errors.form}
          </p>
        )}
      </div>
    </Dialog>
  );
}
