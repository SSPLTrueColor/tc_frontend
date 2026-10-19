import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { formatDateTime, nowLocal } from '../../../lib/dates';
import { loaders, serviceApi } from '../../../services/api/service';
import { useActor } from '../../../services/hooks';
import { byId } from '../../../services/lookups';
import { getPolicies } from '../../../services/policies';
import { masterValue } from '../../../services/registry';
import { openVisitOf, requestSignOffOtp } from '../../../services/service/jobs';
import { customerName } from '../../../services/service/tickets';
import { getDb } from '../../../services/db';
import { Button } from '../../../components/primitives/Button';
import { Badge, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../../components/primitives/feedback';
import { PageHeader } from '../../../components/shell/PageHeader';
import { LogActivityDialog } from '../../../components/crm/LogActivityDialog';
import { VoiceButton } from '../../../components/crm/VoiceButton';
import { SlaChips, SpottedDialog } from '../components/TicketExtensions';
import { OfflineBar } from './MyJobsPage';
import { useStep } from './useStep';

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Browser location with a short timeout; falls back to the site's stored coordinates (marked simulated). */
function locate(customerId: unknown): Promise<{ lat: number; lng: number; mock: boolean }> {
  const site = (getDb().records.addresses ?? []).find((a) => a.customerId === customerId && a.lat && a.lng);
  const fallback = { lat: Number(site?.lat ?? 21.1702) + (Math.random() - 0.5) / 1000, lng: Number(site?.lng ?? 72.8311) + (Math.random() - 0.5) / 1000, mock: true };
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(fallback);
    const timer = setTimeout(() => resolve(fallback), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, mock: false });
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
      { timeout: 3500, maximumAge: 60_000 },
    );
  });
}

function SignaturePad({ onSigned }: { onSigned: (signed: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = c.offsetWidth;
    c.height = c.offsetHeight;
  }, []);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  return (
    <>
      <canvas
        ref={ref}
        className="svc-signature"
        aria-label="Customer signature pad"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = e.currentTarget.getContext('2d')!;
          ctx.strokeStyle = getComputedStyle(e.currentTarget).color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(...point(e));
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          ctx.lineTo(...point(e));
          ctx.stroke();
          onSigned(true);
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)}
      />
      <Button
        variant="ghost"
        onClick={() => {
          const c = ref.current;
          c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
          onSigned(false);
        }}
      >
        Clear signature
      </Button>
    </>
  );
}

const fileNames = (files: FileList | null, maxMb: number): { names: string; error?: string } => {
  const list = Array.from(files ?? []);
  const big = list.find((f) => f.size > maxMb * 1024 * 1024);
  if (big) return { names: '', error: `${big.name} is larger than ${maxMb} MB` };
  return { names: list.map((f) => f.name).join(', ') };
};

/** FR-080 job card: one screen, one big button per step (NFR-19). */
export function MyJobPage() {
  const { recordId = '' } = useParams();
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(loaders.job(actor, recordId), [actor.user.id, recordId]);
  const { run, busy } = useStep();
  const [dialog, setDialog] = useState<'activity' | 'spotted' | null>(null);
  const [work, setWork] = useState({ diagnosis: '', workDone: '', partsUsed: '', photosBefore: '', photosAfter: '', printCounter: '', inkUsedMl: '' });
  const [fileError, setFileError] = useState('');
  const [method, setMethod] = useState<'otp' | 'signature'>('otp');
  const [otp, setOtp] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [signed, setSigned] = useState(false);
  const [resolve, setResolve] = useState(true);

  const t = q.data;
  const visit = t ? openVisitOf(t.id) : undefined;
  useEffect(() => {
    if (visit) setWork((w) => ({ ...w, diagnosis: s(visit.diagnosis) || w.diagnosis, workDone: s(visit.workDone) || w.workDone, partsUsed: s(visit.partsUsed) || w.partsUsed, photosBefore: s(visit.photosBefore) || w.photosBefore, photosAfter: s(visit.photosAfter) || w.photosAfter }));
  }, [visit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.error)
    return (
      <div className="page">
        <PageHeader title="Job" />
        <ErrorState title="Job not available" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!t)
    return (
      <div className="page">
        <PageHeader title="Job" />
        <Skeleton rows={8} />
      </div>
    );

  const status = s(t.status);
  const machine = byId('machines', t.machineId);
  const mine = t.assigneeId === actor.staffId;
  const v = t.version;
  const num = (x: string) => (x.trim() === '' ? null : Number(x));
  const maxMb = getPolicies().maxFileMb;

  return (
    <div className="page">
      <PageHeader title={`Job ${t.id}`} description="Accept, travel, check in, record work and get the customer’s sign-off. Works offline: steps sync when you are back online." />
      <OfflineBar />
      <section className="panel">
        <div className="svc-job-top">
          <StatusChip label={masterValue('ticketStatus', status)?.label ?? status} tone={masterValue('ticketStatus', status)?.tone} />
          <StatusChip label={masterValue('ticketPriority', t.priority)?.label ?? s(t.priority)} tone={masterValue('ticketPriority', t.priority)?.tone} />
          <StatusChip label={`Coverage: ${masterValue('coverage', t.coverage)?.label ?? 'N/A'}`} tone={masterValue('coverage', t.coverage)?.tone} />
          {!!t.repeatOfId && <Badge tone="danger">Repeat of {s(t.repeatOfId)}</Badge>}
        </div>
        <h2 className="panel-title">{customerName(t.customerId)}</h2>
        <p>{s(t.description)}</p>
        <p className="muted small">
          {machine ? `${s(machine.serialNo)} · ${s(machine.model)}` : 'No machine'} · reported {formatDateTime(s(t.reportedAt))}
        </p>
        <SlaChips record={t} />
        {!mine && <InlineAlert tone="info">This job is assigned to someone else; you can view it but steps are for the assigned engineer.</InlineAlert>}
      </section>

      <section className="panel">
        <h2 className="panel-title">Next step</h2>
        <div className="svc-steps">
          {status === 'assigned' && (
            <>
              <Button variant="primary" size="default" loading={busy === 'Accept'} onClick={() => run('Accept', () => serviceApi.accept(actor, t.id, v), 'Job accepted')}>
                Accept job
              </Button>
              <Button size="default" onClick={() => run('Reject', () => serviceApi.reject(actor, t.id, v), 'Job returned to the coordinator')}>
                Reject
              </Button>
            </>
          )}
          {['accepted', 'reopened', 'in_progress'].includes(status) && !visit && (
            <Button variant="primary" size="default" loading={busy === 'Start travel'} onClick={() => run('Start travel', () => serviceApi.startTravel(actor, t.id, v), 'Travel started')}>
              Start travel
            </Button>
          )}
          {['accepted', 'reopened', 'in_progress'].includes(status) && visit?.status === 'travelling' && (
            <Button
              variant="primary"
              size="default"
              loading={busy === 'Check in'}
              onClick={async () => {
                const at = await locate(t.customerId);
                run('Check in', () => serviceApi.checkIn(actor, t.id, at, v), at.mock ? 'Checked in (location simulated — browser location unavailable)' : 'Checked in at site');
              }}
            >
              Check in at site
            </Button>
          )}
          {status === 'in_progress' && (
            <>
              <Button size="default" onClick={() => run('Waiting for parts', () => serviceApi.waiting(actor, t.id, v, 'waiting_parts'), 'Marked waiting for parts')}>
                Waiting for parts
              </Button>
              <Button size="default" onClick={() => run('Waiting for customer', () => serviceApi.waiting(actor, t.id, v, 'waiting_customer'), 'SLA paused — waiting for customer')}>
                Waiting for customer
              </Button>
            </>
          )}
          {['waiting_parts', 'waiting_customer'].includes(status) && (
            <Button variant="primary" size="default" onClick={() => run('Resume work', () => serviceApi.waiting(actor, t.id, v, 'in_progress'), 'Work resumed')}>
              Resume work
            </Button>
          )}
          {status === 'customer_confirmation' && <InlineAlert tone="success">Resolved — the customer has the job card and the feedback link.</InlineAlert>}
          <Button size="default" icon="message" onClick={() => setDialog('activity')}>
            Log activity
          </Button>
          <Button size="default" icon="sparkles" disabledReason={t.spottedLeadId ? `Lead ${s(t.spottedLeadId)} created` : undefined} onClick={() => setDialog('spotted')}>
            Opportunity spotted
          </Button>
          <Link className="btn btn-secondary btn-default" to={`/knowledgeArticles?q=${encodeURIComponent(s(machine?.model) || s(t.category))}`}>
            <span className="btn-label">Knowledge base</span>
          </Link>
        </div>
      </section>

      {visit?.status === 'on_site' && (
        <section className="panel">
          <h2 className="panel-title">Job card</h2>
          <div className="form-grid cols-2">
            {(
              [
                ['diagnosis', 'Diagnosis'],
                ['workDone', 'Work performed'],
              ] as const
            ).map(([k, l]) => (
              <div key={k} className="form-field span-all">
                <span className="field-label-row">
                  <label className="field-label" htmlFor={`jc-${k}`}>
                    {l}
                  </label>
                  <VoiceButton onText={(x) => setWork((w) => ({ ...w, [k]: w[k] ? `${w[k]} ${x}` : x }))} />
                </span>
                <textarea id={`jc-${k}`} className="input textarea" rows={3} maxLength={2000} value={work[k]} onChange={(e) => setWork({ ...work, [k]: e.target.value })} />
              </div>
            ))}
            <div className="form-field span-all">
              <label className="field-label" htmlFor="jc-parts">
                Parts used
              </label>
              <input id="jc-parts" className="input" maxLength={300} placeholder="e.g. 1 × print head DX5, damper kit" value={work.partsUsed} onChange={(e) => setWork({ ...work, partsUsed: e.target.value })} />
            </div>
            {(
              [
                ['photosBefore', 'Photos / videos before'],
                ['photosAfter', 'Photos / videos after'],
              ] as const
            ).map(([k, l]) => (
              <div key={k} className="form-field">
                <label className="field-label" htmlFor={`jc-${k}`}>
                  {l}
                </label>
                <input
                  id={`jc-${k}`}
                  className="input"
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  capture="environment"
                  onChange={(e) => {
                    const r = fileNames(e.target.files, maxMb);
                    setFileError(r.error ?? '');
                    if (!r.error) setWork((w) => ({ ...w, [k]: r.names }));
                  }}
                />
                {work[k] && <span className="muted small">{work[k]}</span>}
              </div>
            ))}
            <div className="form-field">
              <label className="field-label" htmlFor="jc-counter">
                Print counter (m²)
              </label>
              <input id="jc-counter" className="input" inputMode="numeric" value={work.printCounter} onChange={(e) => setWork({ ...work, printCounter: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="jc-ink">
                Ink consumption since last visit (ml)
              </label>
              <input id="jc-ink" className="input" inputMode="numeric" value={work.inkUsedMl} onChange={(e) => setWork({ ...work, inkUsedMl: e.target.value.replace(/\D/g, '') })} />
            </div>
            {fileError && <p className="field-error span-all">{fileError} (photos are stored as file names only in this prototype)</p>}
            <div className="span-all">
              <Button
                variant="primary"
                loading={busy === 'Save job card'}
                onClick={() => run('Save job card', () => serviceApi.saveWork(actor, t.id, { ...work, printCounter: num(work.printCounter), inkUsedMl: num(work.inkUsedMl) }, v), 'Job card saved')}
              >
                Save job card
              </Button>
            </div>
          </div>

          <h2 className="panel-title" style={{ marginTop: 16 }}>
            Check out & customer sign-off
          </h2>
          <div className="form-grid">
            <div className="segmented" role="radiogroup" aria-label="Sign-off method">
              {(['otp', 'signature'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} className={`seg-btn${method === m ? ' is-on' : ''}`} onClick={() => setMethod(m)}>
                  {m === 'otp' ? 'One-time code' : 'Signature'}
                </button>
              ))}
            </div>
            {method === 'otp' ? (
              <div className="form-field">
                {otp ? (
                  <InlineAlert tone="info" title="Simulated SMS to the customer">
                    The customer’s phone shows <strong className="mono">{otp}</strong>. Ask them to read it out.
                  </InlineAlert>
                ) : (
                  <Button onClick={() => setOtp(requestSignOffOtp(t.id))}>Send code to customer</Button>
                )}
                <label className="field-label" htmlFor="jc-otp">
                  Code from the customer
                </label>
                <input id="jc-otp" className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </div>
            ) : (
              <div className="form-field">
                <span className="field-label">Customer signature</span>
                <SignaturePad onSigned={setSigned} />
              </div>
            )}
            <label className="row-gap">
              <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} /> Problem fixed — resolve the ticket and send the job card and feedback link
            </label>
            <div>
              <Button
                variant="primary"
                size="default"
                loading={busy === 'Check out'}
                disabledReason={method === 'otp' && code.length !== 6 ? 'Enter the 6-digit code' : method === 'signature' && !signed ? 'Customer must sign' : undefined}
                onClick={async () => {
                  // Persist the latest job-card text first so "resolve" sees the work performed.
                  if (work.workDone.trim() && work.workDone !== s(visit.workDone)) await run('Save job card', () => serviceApi.saveWork(actor, t.id, { ...work, printCounter: num(work.printCounter), inkUsedMl: num(work.inkUsedMl) }), 'Job card saved');
                  const ok = await run('Check out', () => serviceApi.checkOut(actor, t.id, { method, otp: code, signed, resolve }), resolve ? 'Checked out — ticket resolved, job card sent' : 'Checked out');
                  if (ok) {
                    setOtp(null);
                    setCode('');
                  }
                }}
              >
                Check out
              </Button>
            </div>
            <p className="muted small">Check-in {visit.checkInAt ? formatDateTime(s(visit.checkInAt)) : 'N/A'} · now {formatDateTime(nowLocal())}</p>
          </div>
        </section>
      )}
      {dialog === 'activity' && (
        <LogActivityDialog
          open
          onClose={() => setDialog(null)}
          defaultType="visit"
          parent={{ parentResource: 'tickets', parentId: t.id, parentLabel: `${t.id} · ${customerName(t.customerId)}`, customerId: s(t.customerId) || undefined }}
          onLogged={() => toast('Logged on the ticket timeline')}
        />
      )}
      {dialog === 'spotted' && <SpottedDialog ticketId={t.id} onClose={() => setDialog(null)} />}
    </div>
  );
}
