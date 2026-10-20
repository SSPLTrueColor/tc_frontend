import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
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
import { L } from '../../../constants/labels';
import { ROUTES, toPath } from '../../../constants/routes';
import { Checkbox, LinkButton, TextField, Textarea } from '../../../components/primitives/controls';
import { SegmentedControl } from '../../../components/primitives/controls';
import { FileInput } from '../../../components/primitives/controls';

const S = L.service;
const P = S.pages.myJob;
const ST = P.steps;

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
        aria-label={P.signaturePad}
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
        {S.actions.clearSignature}
      </Button>
    </>
  );
}

const fileNames = (files: FileList | null, maxMb: number): { names: string; error?: string } => {
  const list = Array.from(files ?? []);
  const big = list.find((f) => f.size > maxMb * 1024 * 1024);
  if (big) return { names: '', error: P.fileTooBig(big.name, maxMb) };
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
        <PageHeader title={P.titleLoading} />
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!t)
    return (
      <div className="page">
        <PageHeader title={P.titleLoading} />
        <Skeleton rows={8} />
      </div>
    );

  const status = s(t.status);
  const machine = byId('machines', t.machineId);
  const mine = t.assigneeId === actor.staffId;
  const v = t.version;
  const num = (x: string) => (x.trim() === '' ? null : Number(x));
  const maxMb = getPolicies().maxFileMb;
  // Resolving needs the work to be running (not Waiting for Parts / Customer); checking out is always possible.
  const canResolve = status === 'in_progress';

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: L.nav.pages.myJobs.title, to: ROUTES.myJobs }]} title={P.title(t.id)} description={P.description} />
      <OfflineBar />
      <section className="panel">
        <div className="svc-job-top">
          <StatusChip label={masterValue('ticketStatus', status)?.label ?? status} tone={masterValue('ticketStatus', status)?.tone} />
          <StatusChip label={masterValue('ticketPriority', t.priority)?.label ?? s(t.priority)} tone={masterValue('ticketPriority', t.priority)?.tone} />
          <StatusChip label={P.coverage(masterValue('coverage', t.coverage)?.label ?? S.sla.chips.not_applicable)} tone={masterValue('coverage', t.coverage)?.tone} />
          {!!t.repeatOfId && <Badge tone="danger">{S.banner.repeatOf(s(t.repeatOfId))}</Badge>}
        </div>
        <h2 className="panel-title">{customerName(t.customerId)}</h2>
        <p>{s(t.description)}</p>
        <p className="muted small">
          {machine ? `${s(machine.serialNo)} · ${s(machine.model)}` : P.noMachine} · {P.reported(formatDateTime(s(t.reportedAt)))}
        </p>
        <SlaChips record={t} />
        {!mine && <InlineAlert tone="info">{P.notMine}</InlineAlert>}
      </section>

      <section className="panel">
        <h2 className="panel-title">{P.nextStep}</h2>
        <div className="svc-steps">
          {status === 'assigned' && (
            <>
              <Button variant="primary" size="default" loading={busy === ST.accept} onClick={() => run(ST.accept, () => serviceApi.accept(actor, t.id, v), S.toasts.jobAccepted)}>
                {S.actions.acceptJob}
              </Button>
              <Button size="default" loading={busy === ST.reject} onClick={() => run(ST.reject, () => serviceApi.reject(actor, t.id, v), S.toasts.jobRejected)}>
                {S.actions.rejectJob}
              </Button>
            </>
          )}
          {['accepted', 'reopened', 'in_progress'].includes(status) && !visit && (
            <Button variant="primary" size="default" loading={busy === ST.travel} onClick={() => run(ST.travel, () => serviceApi.startTravel(actor, t.id, v), S.toasts.travelStarted)}>
              {S.actions.startTravel}
            </Button>
          )}
          {['accepted', 'reopened', 'in_progress'].includes(status) && visit?.status === 'travelling' && (
            <Button
              variant="primary"
              size="default"
              loading={busy === ST.checkIn}
              onClick={async () => {
                const at = await locate(t.customerId);
                run(ST.checkIn, () => serviceApi.checkIn(actor, t.id, at, v), at.mock ? S.toasts.checkedInSimulated : S.toasts.checkedIn);
              }}
            >
              {S.actions.checkIn}
            </Button>
          )}
          {status === 'in_progress' && (
            <>
              <Button size="default" onClick={() => run(ST.waitingParts, () => serviceApi.waiting(actor, t.id, v, 'waiting_parts'), S.toasts.waitingParts)}>
                {S.actions.waitingParts}
              </Button>
              <Button size="default" onClick={() => run(ST.waitingCustomer, () => serviceApi.waiting(actor, t.id, v, 'waiting_customer'), S.toasts.waitingCustomer)}>
                {S.actions.waitingCustomer}
              </Button>
            </>
          )}
          {['waiting_parts', 'waiting_customer'].includes(status) && (
            <Button variant="primary" size="default" onClick={() => run(ST.resume, () => serviceApi.waiting(actor, t.id, v, 'in_progress'), S.toasts.resumed)}>
              {S.actions.resumeWork}
            </Button>
          )}
          {status === 'customer_confirmation' && <InlineAlert tone="success">{P.resolved}</InlineAlert>}
          <Button size="default" icon="message" onClick={() => setDialog('activity')}>
            {S.actions.logActivity}
          </Button>
          <Button size="default" icon="sparkles" disabledReason={t.spottedLeadId ? P.leadCreated(s(t.spottedLeadId)) : undefined} onClick={() => setDialog('spotted')}>
            {S.actions.opportunitySpotted}
          </Button>
          <LinkButton size="default" to={toPath(ROUTES.knowledgeBase, {}, { q: s(machine?.model) || undefined, category: machine ? undefined : s(t.category) || undefined })}>{S.actions.knowledgeBase}</LinkButton>
        </div>
      </section>

      {visit?.status === 'on_site' && (
        <section className="panel">
          <h2 className="panel-title">{P.jobCard}</h2>
          <div className="form-grid cols-2">
            {(
              [
                ['diagnosis', S.fields.serviceVisits.diagnosis],
                ['workDone', S.fields.serviceVisits.workDone],
              ] as const
            ).map(([k, l]) => (
              <div key={k} className="form-field span-all">
                <span className="field-label-row">
                  <label className="field-label" htmlFor={`jc-${k}`}>
                    {l}
                  </label>
                  <VoiceButton onText={(x) => setWork((w) => ({ ...w, [k]: w[k] ? `${w[k]} ${x}` : x }))} />
                </span>
                <Textarea id={`jc-${k}`} className="textarea" rows={3} maxLength={2000} value={work[k]} onChange={(e) => setWork({ ...work, [k]: e.target.value })} />
              </div>
            ))}
            <div className="form-field span-all">
              <label className="field-label" htmlFor="jc-parts">
                {S.fields.serviceVisits.partsUsed}
              </label>
              <TextField id="jc-parts" maxLength={300} placeholder={P.partsPlaceholder} value={work.partsUsed} onChange={(e) => setWork({ ...work, partsUsed: e.target.value })} />
            </div>
            {(
              [
                ['photosBefore', S.fields.serviceVisits.photosBefore],
                ['photosAfter', S.fields.serviceVisits.photosAfter],
              ] as const
            ).map(([k, l]) => (
              <div key={k} className="form-field">
                <label className="field-label" htmlFor={`jc-${k}`}>
                  {l}
                </label>
                <FileInput
                  id={`jc-${k}`}
                  
                  
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
                {P.counter}
              </label>
              <TextField id="jc-counter" inputMode="numeric" value={work.printCounter} onChange={(e) => setWork({ ...work, printCounter: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="jc-ink">
                {P.ink}
              </label>
              <TextField id="jc-ink" inputMode="numeric" value={work.inkUsedMl} onChange={(e) => setWork({ ...work, inkUsedMl: e.target.value.replace(/\D/g, '') })} />
            </div>
            {fileError && <p className="field-error span-all">{fileError} {P.fileNote}</p>}
            <div className="span-all">
              <Button
                variant="primary"
                loading={busy === ST.save}
                onClick={() => run(ST.save, () => serviceApi.saveWork(actor, t.id, { ...work, printCounter: num(work.printCounter), inkUsedMl: num(work.inkUsedMl) }, v), S.toasts.jobCardSaved)}
              >
                {S.actions.saveJobCard}
              </Button>
            </div>
          </div>

          <h2 className="panel-title" style={{ marginTop: 16 }}>
            {P.checkOutHeading}
          </h2>
          <div className="form-grid">
            <SegmentedControl
              label={P.signOffMethod}
              value={method}
              onChange={(next) => setMethod(next)}
              options={(['otp', 'signature'] as const).map((m) => ({ value: m, label: S.masters.signOffMethod.values[m] }))}
            />
            {method === 'otp' ? (
              <div className="form-field">
                {otp ? (
                  <InlineAlert tone="info" title={P.otpTitle}>
                    {P.otpBody} <strong className="mono">{otp}</strong>. {P.otpAsk}
                  </InlineAlert>
                ) : (
                  <Button onClick={() => setOtp(requestSignOffOtp(t.id))}>{S.actions.sendCode}</Button>
                )}
                <label className="field-label" htmlFor="jc-otp">
                  {P.code}
                </label>
                <TextField id="jc-otp" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </div>
            ) : (
              <div className="form-field">
                <span className="field-label">{P.signature}</span>
                <SignaturePad onSigned={setSigned} />
              </div>
            )}
            <label className="row-gap">
              <Checkbox checked={canResolve && resolve} disabled={!canResolve} onChange={(e) => setResolve(e.target.checked)} /> {P.resolveCheck}
            </label>
            {!canResolve && <p className="muted small">{P.resolveNeedsWork(masterValue('ticketStatus', status)?.label ?? status)}</p>}
            <div>
              <Button
                variant="primary"
                size="default"
                loading={busy === ST.checkOut}
                disabledReason={method === 'otp' && code.length !== 6 ? P.enterCode : method === 'signature' && !signed ? P.mustSign : undefined}
                onClick={async () => {
                  // Persist the latest job-card text first so "resolve" sees the work performed.
                  if (work.workDone.trim() && work.workDone !== s(visit.workDone)) await run(ST.save, () => serviceApi.saveWork(actor, t.id, { ...work, printCounter: num(work.printCounter), inkUsedMl: num(work.inkUsedMl) }), S.toasts.jobCardSaved);
                  const ok = await run(ST.checkOut, () => serviceApi.checkOut(actor, t.id, { method, otp: code, signed, resolve: canResolve && resolve }), canResolve && resolve ? S.toasts.checkedOutResolved : S.toasts.checkedOut);
                  if (ok) {
                    setOtp(null);
                    setCode('');
                  }
                }}
              >
                {S.actions.checkOut}
              </Button>
            </div>
            <p className="muted small">{P.times(visit.checkInAt ? formatDateTime(s(visit.checkInAt)) : S.sla.chips.not_applicable, formatDateTime(nowLocal()))}</p>
          </div>
        </section>
      )}
      {dialog === 'activity' && (
        <LogActivityDialog
          open
          onClose={() => setDialog(null)}
          defaultType="visit"
          parent={{ parentResource: 'tickets', parentId: t.id, parentLabel: `${t.id} · ${customerName(t.customerId)}`, customerId: s(t.customerId) || undefined }}
          onLogged={() => toast(S.toasts.loggedOnTimeline)}
        />
      )}
      {dialog === 'spotted' && <SpottedDialog ticketId={t.id} onClose={() => setDialog(null)} />}
    </div>
  );
}
