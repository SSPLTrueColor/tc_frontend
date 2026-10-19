import { useState } from 'react';
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { errorMessage } from '../../services/api/client';
import { markOpportunityLost } from '../../services/api/opportunities';
import type { Actor } from '../../services/authz';
import { activeMasterValues } from '../../services/registry';
import { ServiceError } from '../../services/types';
import { Button } from '../../components/primitives/Button';
import { useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';

const T = L.opportunities;

/** FR-031: Lost needs a reason from the master list and the competitor / price lost to. */
export function MarkLostDialog({ actor, record, onClose }: { actor: Actor; record: RecordData; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await markOpportunityLost(actor, record.id, { lostReason: reason, lostToCompetitor: competitor, lostToPrice: price ? Number(price) : null, note }, record.version);
      toast(T.messages.markedLost(record.id));
      onClose();
    } catch (e) {
      setErrors(e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      role="alertdialog"
      title={T.markLost.title(record.id)}
      description={T.markLost.description}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            {T.actions.cancel}
          </Button>
          <Button variant="danger" loading={busy} onClick={save}>
            {T.actions.markLost}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field">
          <label className="field-label" htmlFor="lost-reason">
            {T.markLost.reason} <span className="req">*</span>
          </label>
          <SelectMenu id="lost-reason" block label={T.markLost.reason} value={reason} invalid={!!errors.lostReason} options={activeMasterValues('lostReason').map((v) => ({ value: v.key, label: v.label }))} onChange={setReason} />
          {errors.lostReason && <p className="field-error">{errors.lostReason}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="lost-to">
            {T.markLost.competitor} <span className="req">*</span>
          </label>
          <input id="lost-to" className="input" maxLength={80} value={competitor} onChange={(e) => setCompetitor(e.target.value)} aria-invalid={!!errors.lostToCompetitor || undefined} />
          {errors.lostToCompetitor && <p className="field-error">{errors.lostToCompetitor}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="lost-price">
            {T.markLost.price}
          </label>
          <div className="input-affix has-start">
            <span className="affix affix-start">₹</span>
            <input id="lost-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={!!errors.lostToPrice || undefined} />
          </div>
          {errors.lostToPrice && <p className="field-error">{errors.lostToPrice}</p>}
        </div>
        <div className="form-field span-all">
          <label className="field-label" htmlFor="lost-note">
            {T.markLost.note}
          </label>
          <textarea id="lost-note" className="input textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
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
