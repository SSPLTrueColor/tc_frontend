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

/**
 * Shared "Log activity" dialog (LEAD-09, COM-05) for any record. With `requireNextFollowUp`
 * the next follow-up date is mandatory (BR-07). Three taps on mobile: type → subject → Save.
 */
export function LogActivityDialog({
  open,
  onClose,
  parent,
  requireNextFollowUp = false,
  defaultType = 'call',
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  parent: Omit<ActivityInput, 'activityType' | 'subject' | 'notes' | 'at' | 'nextFollowUpAt'>;
  requireNextFollowUp?: boolean;
  defaultType?: string;
  onLogged?: () => void;
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
    if (!subject.trim()) e.subject = 'Subject is required';
    if (requireNextFollowUp && !next) e.nextFollowUpAt = 'Next follow-up date is required';
    if (next && next < todayKey()) e.nextFollowUpAt = 'Date cannot be in the past';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await call(() => logActivity(actor, { ...parent, activityType: type, subject: subject.trim(), notes, at, nextFollowUpAt: next || null }));
      toast('Activity logged');
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
      title="Log activity"
      description={`Recorded on ${parent.parentLabel}. It appears in the record’s timeline and the customer’s 360° view.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save activity
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field">
          <label className="field-label" htmlFor="act-type">
            Type <span className="req">*</span>
          </label>
          <SelectMenu id="act-type" block label="Activity type" value={type} options={activeMasterValues('activityType').map((v) => ({ value: v.key, label: v.label }))} onChange={setType} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="act-at">
            When <span className="req">*</span>
          </label>
          <DatePicker id="act-at" withTime value={at} onChange={(v) => setAt(v ?? nowLocal())} label="When" />
        </div>
        <div className="form-field span-all">
          <label className="field-label" htmlFor="act-subject">
            Subject <span className="req">*</span>
          </label>
          <input id="act-subject" className="input" maxLength={140} value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={!!errors.subject || undefined} data-autofocus />
          {errors.subject && <p className="field-error">{errors.subject}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="act-next">
            Next follow-up {requireNextFollowUp && <span className="req">*</span>}
          </label>
          <DatePicker id="act-next" value={next} onChange={(v) => setNext(v ?? '')} label="Next follow-up" />
          {errors.nextFollowUpAt && <p className="field-error">{errors.nextFollowUpAt}</p>}
        </div>
        <div className="form-field span-all">
          <span className="field-label-row">
            <label className="field-label" htmlFor="act-notes">
              Notes
            </label>
            <VoiceButton onText={(t) => setNotes((n) => (n ? `${n} ${t}` : t))} label="Dictate notes" />
          </span>
          <textarea id="act-notes" className="input textarea" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
