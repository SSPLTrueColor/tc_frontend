/** Installed-base record extensions: actions, banners and tabs for installations, machines and contracts. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { addDays, formatDate, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { installedApi } from '../../services/api/installed';
import { can, canReadResource, perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { useActor, useRevision } from '../../services/hooks';
import { coverageFor } from '../../services/lookups';
import { activeMasterValues, masterLabel, masterValue } from '../../services/registry';
import { queryRecords, recordTitle } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { handoverComplete, missingReadiness, missingSteps, signOffBlockers } from '../../services/installed/logic';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { QuickCreateDialog } from '../../components/resource/RecordForm';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';

// ---------------------------------------------------------------- small form helpers

function Field({ id, label, required, error, children, wide }: { id: string; label: string; required?: boolean; error?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`form-field${wide ? ' span-all' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

const fieldErrorsOf = (e: unknown): Record<string, string> => (e instanceof ServiceError && e.fieldErrors ? e.fieldErrors : { form: errorMessage(e) });

function FormError({ errors }: { errors: Record<string, string> }) {
  return errors.form ? (
    <p className="field-error span-all" role="alert">
      {errors.form}
    </p>
  ) : null;
}

const options = (master: string) => activeMasterValues(master).map((v) => ({ value: v.key, label: v.label }));

// ---------------------------------------------------------------- installation job

/** Next-step guidance for an installation job (what blocks the next status). */
export function InstallationBanner({ record }: RecordExtensionProps) {
  useRevision();
  const raw = getDb().records.installations?.find((r) => r.id === record.id);
  if (!raw) return null;
  const s = String(raw.status);
  if (s === 'signed_off')
    return (
      <InlineAlert tone="success" title="Signed off">
        Machine{' '}
        {raw.machineId ? (
          <Link to={recordPeekPath('tc', 'machines', String(raw.machineId))} className="rel-link">
            {String(raw.serialNo ?? raw.machineId)}
          </Link>
        ) : (
          'record'
        )}{' '}
        created with warranty and preventive-maintenance schedule.
      </InlineAlert>
    );
  const todo: string[] = [];
  if (s === 'scheduled') {
    if (!raw.engineerId || !raw.scheduledAt) todo.push('Assign an engineer and a date');
    if (!raw.readinessSharedAt) todo.push('Share the readiness checklist with the customer');
    const miss = missingReadiness(raw);
    if (miss.length) todo.push(`Verify on site: ${miss.join(', ')}`);
  }
  if (s === 'site_ready' && !handoverComplete(raw)) todo.push('Complete the sales-to-service handover (expectations, commitments, key contacts)');
  if (s === 'in_progress') {
    const steps = missingSteps(raw);
    if (steps.length) todo.push(`Job card steps left: ${steps.map((x) => masterLabel('installStep', x)).join(', ')}`);
  }
  if (s === 'trial_training') signOffBlockers(raw).forEach((b) => todo.push(b));
  if (!todo.length) return null;
  return (
    <InlineAlert tone="info" title="Next steps">
      <ul className="plain-list bullets">
        {todo.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </InlineAlert>
  );
}

export function InstallationActions({ actor, record }: RecordExtensionProps) {
  const toast = useToast();
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const status = String(record.status);
  const canEdit = perm(actor, 'installations').update !== 'none';
  return (
    <>
      {status === 'scheduled' && (
        <Button
          icon="send"
          loading={busy}
          disabledReason={!canEdit ? 'Read-only for your role' : undefined}
          onClick={async () => {
            setBusy(true);
            try {
              await installedApi.shareReadinessChecklist(actor, record.id);
              toast('Readiness checklist sent to the customer (simulated)');
            } catch (e) {
              toast(errorMessage(e), 'danger');
            } finally {
              setBusy(false);
            }
          }}
        >
          Share readiness checklist
        </Button>
      )}
      {status !== 'signed_off' && (
        <>
          <Button icon="plus" onClick={() => fileRef.current?.click()} disabledReason={!canEdit ? 'Read-only for your role' : undefined}>
            Add photo / video
          </Button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/*,video/*"
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []).map((f) => ({ name: f.name, size: f.size }));
              e.target.value = '';
              try {
                await installedApi.attachMedia(actor, record.id, files);
                toast(`${files.length} file(s) attached (names only — prototype)`);
              } catch (err) {
                toast(errorMessage(err), 'danger');
              }
            }}
          />
        </>
      )}
      {status === 'trial_training' && (
        <Button variant="primary" icon="check" onClick={() => setSigning(true)} disabledReason={!can(actor, 'install.signoff') ? 'Your role cannot record customer sign-off' : undefined}>
          Customer sign-off
        </Button>
      )}
      {signing && <SignOffDialog record={record} onClose={() => setSigning(false)} />}
    </>
  );
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * e.currentTarget.width) / r.width, y: ((e.clientY - r.top) * e.currentTarget.height) / r.height };
  };
  return (
    <div className="span-all">
      <canvas
        ref={ref}
        width={560}
        height={160}
        aria-label="Signature box — draw with mouse or finger"
        style={{ width: '100%', height: 160, border: '1px solid var(--s-border)', borderRadius: 'var(--c-radius-control)', touchAction: 'none', background: '#fff' }}
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = pos(e);
          const ctx = e.currentTarget.getContext('2d')!;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = pos(e);
          const ctx = e.currentTarget.getContext('2d')!;
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (dirty.current) onChange(e.currentTarget.toDataURL('image/png'));
        }}
      />
      <Button
        variant="ghost"
        onClick={() => {
          const c = ref.current!;
          const ctx = c.getContext('2d')!;
          ctx.fillRect(0, 0, c.width, c.height);
          dirty.current = false;
          onChange(null);
        }}
      >
        Clear signature
      </Button>
    </div>
  );
}

function SignOffDialog({ record, onClose }: { record: RecordData; onClose: () => void }) {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const raw = getDb().records.installations?.find((r) => r.id === record.id) ?? record;
  const blockers = signOffBlockers(raw);
  const [method, setMethod] = useState<'otp' | 'signature'>('otp');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      await installedApi.signOff(actor, record.id, { method, otp, signatureData: signature ?? undefined, signedOffBy: name }, raw.version);
      toast(`${record.id} signed off — machine, warranty and PM schedule created`);
      onClose();
    } catch (e) {
      setErrors(fieldErrorsOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Customer sign-off · ${record.id}`}
      description="Confirms installation, trial printing and training with the customer. Creates the machine record, starts the warranty and generates the preventive-maintenance schedule."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabledReason={blockers.length ? 'Resolve the items listed first' : undefined}>
            Confirm sign-off
          </Button>
        </>
      }
    >
      {blockers.length > 0 ? (
        <InlineAlert tone="warning" title="Not ready for sign-off">
          <ul className="plain-list bullets">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </InlineAlert>
      ) : (
        <div className="form-grid cols-2">
          <Field id="so-name" label="Customer representative" required error={errors.signedOffBy} wide>
            <input id="so-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-autofocus />
          </Field>
          <fieldset className="form-field span-all">
            <legend className="field-label">Sign-off method</legend>
            <div className="segmented" role="radiogroup" aria-label="Sign-off method">
              {(['otp', 'signature'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} className={`seg-btn${method === m ? ' is-on' : ''}`} onClick={() => setMethod(m)}>
                  {masterLabel('installSignOffMethod', m)}
                </button>
              ))}
            </div>
          </fieldset>
          {method === 'otp' ? (
            <>
              <div className="form-field span-all">
                <Button
                  icon="send"
                  onClick={async () => {
                    try {
                      setSentCode(await installedApi.startSignOffOtp(actor, record.id));
                    } catch (e) {
                      setErrors(fieldErrorsOf(e));
                    }
                  }}
                >
                  {sentCode ? 'Resend code' : 'Send code to customer'}
                </Button>
              </div>
              {sentCode && (
                <InlineAlert tone="info" title="Simulated SMS">
                  The customer would receive this by SMS. Code: <strong className="mono">{sentCode}</strong>
                </InlineAlert>
              )}
              <Field id="so-otp" label="Code from the customer" required error={errors.otp}>
                <input id="so-otp" className="input" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} disabled={!sentCode} />
              </Field>
            </>
          ) : (
            <>
              <SignaturePad onChange={setSignature} />
              {errors.signature && <p className="field-error span-all">{errors.signature}</p>}
            </>
          )}
          <FormError errors={errors} />
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- machines

export function MachineBanner({ record }: RecordExtensionProps) {
  useRevision();
  const cov = coverageFor(record.id);
  const w = (getDb().records.warranties ?? []).filter((x) => x.machineId === record.id).sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)))[0];
  const c = (getDb().records.amcContracts ?? []).filter((x) => x.machineId === record.id && ['active', 'due_for_renewal'].includes(String(x.status))).sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)))[0];
  const mv = masterValue('coverage', cov);
  return (
    <InlineAlert tone={cov === 'none' ? 'warning' : 'info'} title={`Coverage today: ${mv?.label ?? cov}`}>
      {c ? `${c.contractNo} until ${formatDate(String(c.endDate))}. ` : ''}
      {w ? `Warranty ${String(w.endDate) < todayKey() ? 'ended' : 'until'} ${formatDate(String(w.endDate))}.` : 'No warranty on record.'}
      {cov === 'none' && ' Offer an AMC / CMC — this machine is on the upsell list.'}
    </InlineAlert>
  );
}

export function MachineActions({ actor, record }: RecordExtensionProps) {
  const [moving, setMoving] = useState(false);
  const [reading, setReading] = useState(false);
  const [component, setComponent] = useState(false);
  return (
    <>
      <Button icon="reset" onClick={() => setMoving(true)} disabledReason={!can(actor, 'machine.transfer') ? 'Only service leadership, coordinators and admins can relocate or transfer machines' : record.status === 'scrapped' ? 'Scrapped machine' : undefined}>
        Relocate / transfer
      </Button>
      <Button icon="activity" onClick={() => setReading(true)} disabledReason={!perm(actor, 'machineReadings').create ? 'Your role cannot record readings' : undefined}>
        Add reading
      </Button>
      <Button icon="plus" onClick={() => setComponent(true)} disabledReason={!perm(actor, 'machineComponents').create ? 'Your role cannot add components' : undefined}>
        Add component
      </Button>
      {moving && <MoveDialog machine={record} onClose={() => setMoving(false)} />}
      <QuickCreateDialog open={reading} resKey="machineReadings" initial={{ machineId: record.id, readingDate: todayKey(), recordedById: actor.staffId, source: 'visit' }} onClose={() => setReading(false)} onCreated={() => setReading(false)} />
      <QuickCreateDialog open={component} resKey="machineComponents" initial={{ machineId: record.id, installedAt: todayKey(), componentType: 'print_head' }} onClose={() => setComponent(false)} onCreated={() => setComponent(false)} />
    </>
  );
}

function MoveDialog({ machine, onClose }: { machine: RecordData; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [moveType, setMoveType] = useState<'relocation' | 'resale'>('relocation');
  const [toCustomerId, setTo] = useState('');
  const [site, setSite] = useState('');
  const [date, setDate] = useState(todayKey());
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const owner = moveType === 'resale' ? toCustomerId : String(machine.customerId);
  const customers = canReadResource(actor, 'customers') ? queryRecords(actor, 'customers', { sort: [{ field: 'name', dir: 'asc' }] }).rows : [];
  const sites = (getDb().records.addresses ?? []).filter((a) => a.customerId === owner).map((a) => ({ value: a.id, label: [a.label || a.addressType, a.city].filter(Boolean).join(' · ') }));
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Relocate or transfer ${String(machine.serialNo)}`}
      description="Records the change in the machine’s ownership / site history. Warranty and contracts stay with the machine; their owners are notified on resale."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                await installedApi.moveMachine(actor, machine.id, { moveType, toCustomerId: toCustomerId || undefined, toSiteAddressId: site || null, moveDate: date, reason });
                toast(moveType === 'resale' ? 'Ownership transferred' : 'Machine relocated');
                onClose();
              } catch (e) {
                setErrors(fieldErrorsOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save change
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <fieldset className="form-field span-all">
          <legend className="field-label">Change</legend>
          <div className="segmented" role="radiogroup" aria-label="Change type">
            {(['relocation', 'resale'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={moveType === m}
                className={`seg-btn${moveType === m ? ' is-on' : ''}`}
                onClick={() => {
                  setMoveType(m);
                  setSite('');
                }}
              >
                {masterLabel('machineMoveType', m)}
              </button>
            ))}
          </div>
        </fieldset>
        {moveType === 'resale' && (
          <Field id="mv-to" label="New owner" required error={errors.toCustomerId} wide>
            <SelectMenu id="mv-to" block searchable label="New owner" value={toCustomerId} options={customers.filter((c) => c.id !== machine.customerId).map((c) => ({ value: c.id, label: String(c.name) }))} onChange={(v) => (setTo(v), setSite(''))} />
          </Field>
        )}
        <Field id="mv-site" label="New site" required={moveType === 'relocation'} error={errors.toSiteAddressId}>
          <SelectMenu id="mv-site" block label="New site" value={site} options={sites} onChange={setSite} placeholder={owner ? (sites.length ? 'Select site…' : 'No addresses for this customer') : 'Choose the new owner first'} />
        </Field>
        <Field id="mv-date" label="Effective date" required error={errors.moveDate}>
          <DatePicker id="mv-date" block value={date} onChange={(v) => setDate(v ?? '')} label="Effective date" />
        </Field>
        <Field id="mv-reason" label="Reason" required error={errors.reason} wide>
          <input id="mv-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormError errors={errors} />
      </div>
    </Dialog>
  );
}

function MiniTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <EmptyState icon="list" title={empty} />;
  return (
    <div className="table-scroll">
      <table className="mini-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c ?? <EmptyValue />}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useMachineRows(actor: RecordExtensionProps['actor'], resKey: string, machineId: string, sortField: string) {
  return useServiceQuery(() => (canReadResource(actor, resKey) ? queryRecords(actor, resKey, { where: { machineId }, sort: [{ field: sortField, dir: 'desc' }] }).rows : []), [resKey, machineId, actor.user.id]);
}

function Loaded<T>({ q, children }: { q: { data: T | undefined; error: string | null; retry: () => void }; children: (d: T) => ReactNode }) {
  if (q.error)
    return (
      <ErrorState title="Could not load" onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={4} />;
  return <>{children(q.data)}</>;
}

export function ComponentsTab({ actor, record }: RecordExtensionProps) {
  const q = useMachineRows(actor, 'machineComponents', record.id, 'installedAt');
  const [replacing, setReplacing] = useState<RecordData | null>(null);
  const canReplace = perm(actor, 'machineComponents').update !== 'none';
  return (
    <Loaded q={q}>
      {(rows) => (
        <>
          <MiniTable
            head={['Component', 'Position', 'Serial', 'Fitted', 'Status', '']}
            empty="No serial-numbered components recorded"
            rows={rows.map((c) => [
              masterLabel('machineComponentType', c.componentType),
              c.position ? String(c.position) : null,
              <span className="mono">{String(c.serialNo)}</span>,
              <DateText value={String(c.installedAt)} />,
              c.status === 'replaced' ? `Replaced ${c.replacedAt} — ${c.replacementReason ?? ''}` : <StatusChip label="In service" tone="success" />,
              c.status === 'in_service' && canReplace ? (
                <Button size="compact" onClick={() => setReplacing(c)}>
                  Replace
                </Button>
              ) : null,
            ])}
          />
          {replacing && <ReplaceDialog component={replacing} onClose={() => setReplacing(null)} />}
        </>
      )}
    </Loaded>
  );
}

function ReplaceDialog({ component, onClose }: { component: RecordData; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [serial, setSerial] = useState('');
  const [date, setDate] = useState(todayKey());
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Replace ${masterLabel('machineComponentType', component.componentType).toLowerCase()} ${String(component.serialNo)}`}
      description="The old part keeps its history; the new part is fitted in the same position."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                await installedApi.replaceComponent(actor, component.id, { newSerial: serial, date, reason });
                toast('Component replaced');
                onClose();
              } catch (e) {
                setErrors(fieldErrorsOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Replace
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="rp-serial" label="New serial no." required error={errors.newSerial}>
          <input id="rp-serial" className="input" value={serial} maxLength={30} onChange={(e) => setSerial(e.target.value.toUpperCase())} data-autofocus />
        </Field>
        <Field id="rp-date" label="Replaced on" required error={errors.date}>
          <DatePicker id="rp-date" block value={date} onChange={(v) => setDate(v ?? '')} label="Replaced on" />
        </Field>
        <Field id="rp-reason" label="Reason" required error={errors.reason}>
          <input id="rp-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormError errors={errors} />
      </div>
    </Dialog>
  );
}

export function ReadingsTab({ actor, record }: RecordExtensionProps) {
  const q = useMachineRows(actor, 'machineReadings', record.id, 'readingDate');
  return (
    <Loaded q={q}>
      {(rows) => (
        <MiniTable
          head={['Date', 'Print counter', 'Ink since last', 'Source', 'Recorded by']}
          empty="No usage readings yet"
          rows={rows.map((r) => [
            <DateText value={String(r.readingDate)} />,
            `${Number(r.printCounter).toLocaleString('en-IN')} m²`,
            r.inkConsumptionMl != null ? `${Number(r.inkConsumptionMl).toLocaleString('en-IN')} ml` : null,
            masterLabel('machineReadingSource', r.source),
            recordTitle('employees', r.recordedById, actor),
          ])}
        />
      )}
    </Loaded>
  );
}

export function HistoryTab({ actor, record }: RecordExtensionProps) {
  const q = useMachineRows(actor, 'machineMoves', record.id, 'moveDate');
  return (
    <Loaded q={q}>
      {(rows) => (
        <MiniTable
          head={['Effective', 'Change', 'From', 'To', 'Reason']}
          empty="No resale or relocation recorded"
          rows={rows.map((m) => [
            <DateText value={String(m.moveDate)} />,
            masterLabel('machineMoveType', m.moveType),
            recordTitle('customers', m.fromCustomerId, actor),
            recordTitle('customers', m.toCustomerId, actor),
            String(m.reason ?? ''),
          ])}
        />
      )}
    </Loaded>
  );
}

// ---------------------------------------------------------------- AMC / CMC contracts

export function ContractActions({ actor, record }: RecordExtensionProps) {
  const [renewing, setRenewing] = useState(false);
  const [losing, setLosing] = useState(false);
  const s = String(record.status);
  const open = ['active', 'due_for_renewal', 'expired'].includes(s);
  const reason = !can(actor, 'amc.renew') ? 'Your role cannot renew contracts' : perm(actor, 'amcContracts').update === 'none' ? 'Read-only for your role' : !open ? `Not possible for a ${masterLabel('amcStatus', s).toLowerCase()} contract` : undefined;
  return (
    <>
      <Button variant={s === 'due_for_renewal' ? 'primary' : 'secondary'} icon="reset" onClick={() => setRenewing(true)} disabledReason={reason}>
        Renew
      </Button>
      <Button onClick={() => setLosing(true)} disabledReason={reason}>
        Mark lost
      </Button>
      {renewing && <RenewDialog contract={record} onClose={() => setRenewing(false)} />}
      {losing && <LostDialog contract={record} onClose={() => setLosing(false)} />}
    </>
  );
}

export function ContractBanner({ record }: RecordExtensionProps) {
  if (record.status !== 'due_for_renewal') return null;
  return (
    <InlineAlert tone="warning" title="Due for renewal">
      Ends {formatDate(String(record.endDate))}.{' '}
      {record.renewalOpportunityId ? (
        <>
          Renewal opportunity{' '}
          <Link className="rel-link" to={recordPeekPath('tc', 'opportunities', String(record.renewalOpportunityId))}>
            {String(record.renewalOpportunityId)}
          </Link>
          .
        </>
      ) : (
        'Renew or mark lost with a reason.'
      )}
    </InlineAlert>
  );
}

export function RenewDialog({ contract, onClose }: { contract: RecordData; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const start = String(contract.endDate) >= todayKey() ? addDays(String(contract.endDate), 1) : todayKey();
  const [type, setType] = useState(String(contract.contractType ?? 'amc') as 'amc' | 'cmc');
  const [startDate, setStart] = useState(start);
  const [endDate, setEnd] = useState(addDays(addDays(start, 365), -1));
  const [value, setValue] = useState(String(Math.round(Number(contract.value) * 1.05)));
  const [visits, setVisits] = useState(String(contract.pmVisitsPerYear ?? 2));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Renew ${String(contract.contractNo)}`}
      description="Creates the new contract (active), links it to this one and schedules its preventive visits. Value defaults to +5%."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                const fresh = await installedApi.renew(actor, contract.id, { contractType: type, startDate, endDate, value: Number(value), pmVisitsPerYear: Number(visits) });
                toast(`Renewed as ${String(fresh.contractNo)}`);
                onClose();
              } catch (e) {
                setErrors(fieldErrorsOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Renew contract
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field id="rn-type" label="Type" required>
          <SelectMenu id="rn-type" block label="Type" value={type} options={options('amcType') as { value: 'amc' | 'cmc'; label: string }[]} onChange={setType} />
        </Field>
        <Field id="rn-visits" label="PM visits / year" required error={errors.pmVisitsPerYear}>
          <input id="rn-visits" className="input" inputMode="numeric" value={visits} onChange={(e) => setVisits(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field id="rn-start" label="Starts" required error={errors.startDate}>
          <DatePicker id="rn-start" block value={startDate} onChange={(v) => setStart(v ?? '')} label="Starts" />
        </Field>
        <Field id="rn-end" label="Ends" required error={errors.endDate}>
          <DatePicker id="rn-end" block value={endDate} onChange={(v) => setEnd(v ?? '')} label="Ends" />
        </Field>
        <Field id="rn-value" label="Value" required error={errors.value}>
          <div className="input-affix">
            <span className="affix affix-start">₹</span>
            <input id="rn-value" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
        </Field>
        <div className="form-field">
          <span className="field-label">Current value</span>
          <span>{formatMoney(Number(contract.value))}</span>
        </div>
        <FormError errors={errors} />
      </div>
    </Dialog>
  );
}

export function LostDialog({ contract, onClose }: { contract: RecordData; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      role="alertdialog"
      title={`Mark ${String(contract.contractNo)} lost?`}
      description="The customer is not renewing. The reason feeds the lost-renewal report; the machine shows no contract after the end date."
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                await installedApi.markLost(actor, contract.id, reason, note);
                toast(`${String(contract.contractNo)} marked lost`);
                onClose();
              } catch (e) {
                setErrors(fieldErrorsOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark lost
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="lo-reason" label="Lost reason" required error={errors.lostReason}>
          <SelectMenu id="lo-reason" block label="Lost reason" value={reason} options={options('lostReason')} onChange={setReason} />
        </Field>
        <Field id="lo-note" label="Note">
          <textarea id="lo-note" className="input textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError errors={errors} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Customer 360 → Training (FR-067)

export function CustomerTrainingTab({ actor, record }: RecordExtensionProps) {
  const q = useServiceQuery(() => (canReadResource(actor, 'trainingRecords') ? queryRecords(actor, 'trainingRecords', { where: { customerId: record.id }, sort: [{ field: 'date', dir: 'desc' }] }).rows : []), [record.id, actor.user.id]);
  const [adding, setAdding] = useState(false);
  return (
    <Loaded q={q}>
      {(rows) => (
        <>
          <div className="toolbar">
            <span className="spacer" />
            <Button icon="plus" onClick={() => setAdding(true)} disabledReason={!perm(actor, 'trainingRecords').create ? 'Your role cannot record training' : undefined}>
              Record training / re-training request
            </Button>
          </div>
          <MiniTable
            head={['Date', 'Machine', 'Topics', 'Trainees', 'Re-training']}
            empty="No training recorded for this customer"
            rows={rows.map((t) => [
              <Link className="rel-link" to={recordPeekPath('tc', 'trainingRecords', t.id)}>
                <DateText value={String(t.date)} />
              </Link>,
              t.machineId ? recordTitle('machines', t.machineId, actor) : null,
              ((t.topics as string[]) ?? []).map((k) => masterLabel('trainingTopic', k)).join(', '),
              String(t.trainees ?? ''),
              masterLabel('retrainingStatus', t.retrainingStatus),
            ])}
          />
          <QuickCreateDialog open={adding} resKey="trainingRecords" initial={{ customerId: record.id, date: todayKey(), trainerId: actor.staffId }} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />
        </>
      )}
    </Loaded>
  );
}

/** Count helper for tabs (synchronous, scope-safe). */
export const countFor = (actor: RecordExtensionProps['actor'], resKey: string, where: Record<string, unknown>) => {
  try {
    return canReadResource(actor, resKey) ? queryRecords(actor, resKey, { where }).total : undefined;
  } catch {
    return undefined;
  }
};

