import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { organization } from '../../../domain/pack';
import { errorMessage } from '../../../services/api/client';
import { publicApi } from '../../../services/api/service';
import { activeMasterValues } from '../../../services/registry';
import type { PortalMatch } from '../../../services/service/tickets';
import { ServiceError } from '../../../services/types';
import { Button } from '../../../components/primitives/Button';
import { ErrorState, InlineAlert, Skeleton } from '../../../components/primitives/feedback';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import '../service.css';

function PublicShell({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} · ${organization.name}`;
  }, [title]);
  return (
    <main className="login-page">
      <div className="login-card panel">
        <div className="login-brand">
          <span className="rail-brand" aria-hidden="true">
            <span>{organization.monogram}</span>
          </span>
          <div>
            <h1 className="login-title">{title}</h1>
            <p className="muted">{organization.name} · service</p>
          </div>
        </div>
        {children}
        <p className="muted small login-foot">Prototype · demo data only · nothing is sent.</p>
      </div>
    </main>
  );
}

type Feedback = Awaited<ReturnType<typeof publicApi.feedback>>;

/** FR-086: customer feedback link (public, no sign-in): 1–5 rating, comment, confirm or "not resolved". */
export function FeedbackPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Feedback | undefined>(undefined);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const load = () => {
    setError('');
    setData(undefined);
    publicApi
      .feedback(token)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (resolved: boolean) => {
    setBusy(true);
    setError('');
    try {
      await publicApi.submitFeedback(token, { rating, comment, resolved });
      setDone(resolved ? 'Thank you! Your confirmation and rating were recorded.' : 'Thank you. We have re-opened your complaint and an engineer will contact you.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PublicShell title="Rate our service">
      {error && !data ? (
        <ErrorState title="Could not open the feedback form" onRetry={load}>
          {error}
        </ErrorState>
      ) : data === undefined ? (
        <Skeleton rows={4} />
      ) : data === null ? (
        <ErrorState title="Link not valid">This feedback link is not valid. Please contact True Colors service.</ErrorState>
      ) : done ? (
        <InlineAlert tone="success" title="Feedback received">
          {done}
        </InlineAlert>
      ) : !data.canRespond ? (
        <InlineAlert tone="info" title={data.rating ? 'Feedback already received' : 'Not ready for feedback'}>
          {data.rating ? `You rated ticket ${data.id} ${data.rating}/5. Thank you!` : `Ticket ${data.id} is still being worked on.`}
        </InlineAlert>
      ) : (
        <div className="form-grid">
          <p>
            <strong>{data.id}</strong> · {data.customer}
            {data.machine ? ` · ${data.machine}` : ''}
          </p>
          <p className="muted small">Your complaint: {data.description}</p>
          {data.resolution && <p className="small">Work done: {data.resolution}</p>}
          <fieldset className="form-field">
            <legend className="field-label">
              How satisfied are you? <span className="req">*</span>
            </legend>
            <div className="svc-stars" role="radiogroup" aria-label="Rating 1 to 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} className={rating >= n ? 'is-on' : ''} onClick={() => setRating(n)}>
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="form-field">
            <label className="field-label" htmlFor="fb-comment">
              Comments
            </label>
            <textarea id="fb-comment" className="input textarea" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="primary" size="default" loading={busy} disabledReason={rating ? undefined : 'Choose a rating'} onClick={() => submit(true)}>
            Yes, it’s fixed — submit
          </Button>
          <Button size="default" disabledReason={rating ? undefined : 'Choose a rating'} onClick={() => submit(false)}>
            No, the problem is not resolved
          </Button>
        </div>
      )}
    </PublicShell>
  );
}

/** FR-075 customer portal (public): identify by mobile or machine serial, then log a complaint. */
export function PortalPage() {
  const [query, setQuery] = useState('');
  const [match, setMatch] = useState<PortalMatch | null>(null);
  const [machineId, setMachineId] = useState('');
  const [category, setCategory] = useState('other');
  const [down, setDown] = useState(false);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const identify = async () => {
    setBusy(true);
    setErrors({});
    try {
      const m = await publicApi.identify(query);
      if (!m) setErrors({ query: 'We could not find this mobile number or serial number. Please call our service desk.' });
      setMatch(m);
      setMachineId(m?.machines[0]?.id ?? '');
    } catch (e) {
      setErrors({ form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!match) return;
    setBusy(true);
    setErrors({});
    const machine = match.machines.find((m) => m.id === machineId);
    try {
      const t = await publicApi.createTicket({ customerId: match.customerId, contactId: match.contactId, machineId: machineId || undefined, divisionId: machine?.divisionId ?? match.divisionIds[0], description, category, priority: down ? 'critical' : 'medium', channel: 'portal' });
      setCreated(t.id);
    } catch (e) {
      setErrors(e instanceof ServiceError && e.fieldErrors ? { ...e.fieldErrors, form: e.message } : { form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <PublicShell title="Report a problem">
      {created ? (
        <InlineAlert tone="success" title={`Complaint ${created} logged`}>
          We have sent you a WhatsApp confirmation. Our engineer will contact you shortly.
        </InlineAlert>
      ) : !match ? (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void identify();
          }}
        >
          <div className="form-field">
            <label className="field-label" htmlFor="pt-q">
              Registered mobile number or machine serial number <span className="req">*</span>
            </label>
            <input id="pt-q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} aria-invalid={!!errors.query || undefined} autoFocus />
            {errors.query && <p className="field-error">{errors.query}</p>}
          </div>
          {errors.form && <p className="field-error">{errors.form}</p>}
          <Button type="submit" variant="primary" size="default" loading={busy} disabledReason={query.trim().length < 4 ? 'Enter your mobile or serial number' : undefined}>
            Continue
          </Button>
        </form>
      ) : (
        <div className="form-grid">
          <p>
            Welcome, <strong>{match.customerName}</strong>
          </p>
          {match.machines.length > 0 && (
            <div className="form-field">
              <label className="field-label" htmlFor="pt-m">
                Machine
              </label>
              <SelectMenu id="pt-m" block label="Machine" value={machineId} options={[...match.machines.map((m) => ({ value: m.id, label: `${m.serialNo} · ${m.model}` })), { value: '', label: 'Not about a machine (ink, paper, fabric)' }]} onChange={setMachineId} />
            </div>
          )}
          <div className="form-field">
            <label className="field-label" htmlFor="pt-c">
              What is the problem about?
            </label>
            <SelectMenu id="pt-c" block label="Category" value={category} options={activeMasterValues('complaintCategory').map((v) => ({ value: v.key, label: v.label }))} onChange={setCategory} />
          </div>
          <label className="row-gap">
            <input type="checkbox" checked={down} onChange={(e) => setDown(e.target.checked)} /> The machine is down / production has stopped
          </label>
          <div className="form-field">
            <label className="field-label" htmlFor="pt-d">
              Describe the problem <span className="req">*</span>
            </label>
            <textarea id="pt-d" className="input textarea" rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!!errors.description || undefined} />
            {errors.description && <p className="field-error">{errors.description}</p>}
          </div>
          {errors.form && !errors.description && <p className="field-error">{errors.form}</p>}
          <Button variant="primary" size="default" loading={busy} onClick={submit}>
            Submit complaint
          </Button>
          <Button variant="ghost" onClick={() => setMatch(null)}>
            Not you? Start again
          </Button>
        </div>
      )}
    </PublicShell>
  );
}
