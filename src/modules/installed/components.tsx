/** Installed Base record extensions: actions, banners and tabs for installation jobs, machines and contracts. Labels: L.installed. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import type { RecordData } from '../../metadata/types';
import { addDays, formatDate, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { installedApi } from '../../services/api/installed';
import { can, canReadResource, fieldAccessMap, perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { useActor, useRevision } from '../../services/hooks';
import { coverageFor } from '../../services/lookups';
import { activeMasterValues, getResource, masterLabel, masterValue } from '../../services/registry';
import { queryRecords, recordTitle } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { allSteps, canFillHandover, handoverComplete, hasResource, missingReadiness, missingSteps, READINESS_FIELDS, signOffBlockers } from '../../services/installed/logic';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { FieldValue } from '../../components/resource/FieldValue';
import { QuickCreateDialog } from '../../components/resource/RecordForm';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { TextField, Textarea } from '../../components/primitives/controls';
import { SegmentedControl } from '../../components/primitives/controls';
import { Table } from '../../components/primitives/Table';
import { FileInput } from '../../components/primitives/controls';

const T = L.installed;
const M = T.messages;
const A = T.actions;
const C = T.columns;

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
      <InlineAlert tone="success" title={M.signedOffTitle}>
        {M.machineWord}{' '}
        {raw.machineId ? (
          <Link to={recordPeekPath('tc', 'machines', String(raw.machineId))} className="rel-link">
            {String(raw.serialNo ?? raw.machineId)}
          </Link>
        ) : (
          M.recordWord
        )}{' '}
        {M.signedOffBody}
      </InlineAlert>
    );
  const todo: string[] = [];
  if (s === 'scheduled') {
    if (!raw.engineerId || !raw.scheduledAt) todo.push(M.todoAssign);
    if (!raw.readinessSharedAt) todo.push(M.todoShare);
    const miss = missingReadiness(raw);
    if (miss.length) todo.push(M.todoVerify(miss.join(', ')));
  }
  if (s === 'site_ready' && !handoverComplete(raw)) todo.push(M.todoHandover);
  if (s === 'in_progress') {
    const steps = missingSteps(raw);
    if (steps.length) todo.push(M.todoSteps(steps.map((x) => masterLabel('installStep', x)).join(', ')));
  }
  if (s === 'trial_training') signOffBlockers(raw).forEach((b) => todo.push(b));
  if (!todo.length) return null;
  return (
    <InlineAlert tone="info" title={M.nextSteps}>
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
          disabledReason={!canEdit ? M.readOnly : undefined}
          onClick={async () => {
            setBusy(true);
            try {
              await installedApi.shareReadinessChecklist(actor, record.id);
              toast(M.checklistShared);
            } catch (e) {
              toast(errorMessage(e), 'danger');
            } finally {
              setBusy(false);
            }
          }}
        >
          {A.shareChecklist}
        </Button>
      )}
      {status !== 'signed_off' && (
        <>
          <Button icon="plus" onClick={() => fileRef.current?.click()} disabledReason={!canEdit ? M.readOnly : undefined}>
            {A.addMedia}
          </Button>
          <FileInput
            ref={fileRef}
            
            hidden
            multiple
            accept="image/*,video/*"
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []).map((f) => ({ name: f.name, size: f.size }));
              e.target.value = '';
              try {
                await installedApi.attachMedia(actor, record.id, files);
                toast(M.filesAttached(files.length));
              } catch (err) {
                toast(errorMessage(err), 'danger');
              }
            }}
          />
        </>
      )}
      {status === 'trial_training' && (
        <Button variant="primary" icon="check" onClick={() => setSigning(true)} disabledReason={!can(actor, 'install.signoff') ? M.noSignOffCapability : undefined}>
          {A.customerSignOff}
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
        aria-label={M.signatureBox}
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
        {A.clearSignature}
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
      toast(M.signOffDone(record.id));
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
      title={M.signOffTitle(record.id)}
      description={M.signOffDescription}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabledReason={blockers.length ? M.resolveFirst : undefined}>
            {A.confirmSignOff}
          </Button>
        </>
      }
    >
      {blockers.length > 0 ? (
        <InlineAlert tone="warning" title={M.notReady}>
          <ul className="plain-list bullets">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </InlineAlert>
      ) : (
        <div className="form-grid cols-2">
          <Field id="so-name" label={M.representative} required error={errors.signedOffBy} wide>
            <TextField id="so-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-autofocus />
          </Field>
          <fieldset className="form-field span-all">
            <legend className="field-label">{T.fields.installations.signOffMethod}</legend>
            <SegmentedControl
              label={T.fields.installations.signOffMethod}
              value={method}
              onChange={(next) => setMethod(next)}
              options={(['otp', 'signature'] as const).map((m) => ({ value: m, label: masterLabel('installSignOffMethod', m) }))}
            />
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
                  {sentCode ? A.resendCode : A.sendCode}
                </Button>
              </div>
              {sentCode && (
                <InlineAlert tone="info" title={M.simulatedSms}>
                  {M.smsBody} <strong className="mono">{sentCode}</strong>
                </InlineAlert>
              )}
              <Field id="so-otp" label={M.codeFromCustomer} required error={errors.otp}>
                <TextField id="so-otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} disabled={!sentCode} />
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
    <InlineAlert tone={cov === 'none' ? 'warning' : 'info'} title={M.coverageToday(mv?.label ?? cov)}>
      {c ? M.contractUntil(String(c.contractNo), formatDate(String(c.endDate))) : ''}
      {w ? M.warrantyUntil(String(w.endDate) < todayKey(), formatDate(String(w.endDate))) : M.noWarranty}
      {cov === 'none' && M.upsell}
    </InlineAlert>
  );
}

export function MachineActions({ actor, record }: RecordExtensionProps) {
  const [moving, setMoving] = useState(false);
  const [reading, setReading] = useState(false);
  const [component, setComponent] = useState(false);
  return (
    <>
      <Button icon="reset" onClick={() => setMoving(true)} disabledReason={!can(actor, 'machine.transfer') ? M.noTransfer : record.status === 'scrapped' ? M.scrapped : undefined}>
        {A.relocate}
      </Button>
      <Button icon="activity" onClick={() => setReading(true)} disabledReason={!perm(actor, 'machineReadings').create ? M.noReadings : undefined}>
        {A.addReading}
      </Button>
      <Button icon="plus" onClick={() => setComponent(true)} disabledReason={!perm(actor, 'machineComponents').create ? M.noComponents : undefined}>
        {A.addComponent}
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
      title={M.moveTitle(String(machine.serialNo))}
      description={M.moveDescription}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                await installedApi.moveMachine(actor, machine.id, { moveType, toCustomerId: toCustomerId || undefined, toSiteAddressId: site || null, moveDate: date, reason });
                toast(moveType === 'resale' ? M.transferred : M.relocated);
                onClose();
              } catch (e) {
                setErrors(fieldErrorsOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {A.saveChange}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <fieldset className="form-field span-all">
          <legend className="field-label">{T.fields.machineMoves.moveType}</legend>
          <SegmentedControl
            label={M.changeType}
            value={moveType}
            onChange={(next) => {
              setMoveType(next);
              setSite('');
            }}
            options={(['relocation', 'resale'] as const).map((m) => ({ value: m, label: masterLabel('machineMoveType', m) }))}
          />
        </fieldset>
        {moveType === 'resale' && (
          <Field id="mv-to" label={M.newOwner} required error={errors.toCustomerId} wide>
            <SelectMenu id="mv-to" block searchable label={M.newOwner} value={toCustomerId} options={customers.filter((c) => c.id !== machine.customerId).map((c) => ({ value: c.id, label: String(c.name) }))} onChange={(v) => (setTo(v), setSite(''))} />
          </Field>
        )}
        <Field id="mv-site" label={M.newSite} required={moveType === 'relocation'} error={errors.toSiteAddressId}>
          <SelectMenu id="mv-site" block label={M.newSite} value={site} options={sites} onChange={setSite} placeholder={owner ? (sites.length ? M.selectSite : M.noSites) : M.chooseOwnerFirst} />
        </Field>
        <Field id="mv-date" label={M.effectiveDate} required error={errors.moveDate}>
          <DatePicker id="mv-date" block value={date} onChange={(v) => setDate(v ?? '')} label={M.effectiveDate} />
        </Field>
        <Field id="mv-reason" label={M.reason} required error={errors.reason} wide>
          <TextField id="mv-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormError errors={errors} />
      </div>
    </Dialog>
  );
}

function MiniTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <EmptyState icon="list" title={empty} />;
  return (
    
      <Table>
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
      </Table>
    
  );
}

function useMachineRows(actor: RecordExtensionProps['actor'], resKey: string, machineId: string, sortField: string) {
  return useServiceQuery(() => (canReadResource(actor, resKey) ? queryRecords(actor, resKey, { where: { machineId }, sort: [{ field: sortField, dir: 'desc' }] }).rows : []), [resKey, machineId, actor.user.id]);
}

function Loaded<T>({ q, children }: { q: { data: T | undefined; error: string | null; retry: () => void }; children: (d: T) => ReactNode }) {
  if (q.error)
    return (
      <ErrorState title={M.loadError} onRetry={q.retry}>
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
            head={[C.component, C.position, C.serial, C.fitted, C.status, '']}
            empty={M.noComponentRows}
            rows={rows.map((c) => [
              masterLabel('machineComponentType', c.componentType),
              c.position ? String(c.position) : null,
              <span className="mono">{String(c.serialNo)}</span>,
              <DateText value={String(c.installedAt)} />,
              c.status === 'replaced' ? M.replacedNote(formatDate(String(c.replacedAt)), String(c.replacementReason ?? '')) : <StatusChip label={masterLabel('machineComponentStatus', 'in_service')} tone="success" />,
              c.status === 'in_service' && canReplace ? (
                <Button size="compact" onClick={() => setReplacing(c)}>
                  {A.replace}
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
      title={M.replaceTitle(masterLabel('machineComponentType', component.componentType), String(component.serialNo))}
      description={M.replaceDescription}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                await installedApi.replaceComponent(actor, component.id, { newSerial: serial, date, reason });
                toast(M.componentReplaced);
                onClose();
              } catch (e) {
                setErrors(fieldErrorsOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {A.replace}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="rp-serial" label={M.newSerial} required error={errors.newSerial}>
          <TextField id="rp-serial" value={serial} maxLength={30} onChange={(e) => setSerial(e.target.value.toUpperCase())} data-autofocus />
        </Field>
        <Field id="rp-date" label={M.replacedOn} required error={errors.date}>
          <DatePicker id="rp-date" block value={date} onChange={(v) => setDate(v ?? '')} label={M.replacedOn} />
        </Field>
        <Field id="rp-reason" label={M.reason} required error={errors.reason}>
          <TextField id="rp-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
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
          head={[C.date, C.printCounter, C.inkSinceLast, C.source, C.recordedBy]}
          empty={M.noReadingRows}
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
          head={[C.effective, C.change, C.from, C.to, C.reason]}
          empty={M.noMoveRows}
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
  const reason = !can(actor, 'amc.renew') ? M.noRenewCapability : perm(actor, 'amcContracts').update === 'none' ? M.readOnly : !open ? M.notPossibleFor(masterLabel('amcStatus', s)) : undefined;
  return (
    <>
      <Button variant={s === 'due_for_renewal' ? 'primary' : 'secondary'} icon="reset" onClick={() => setRenewing(true)} disabledReason={reason}>
        {A.renew}
      </Button>
      <RenewalQuotationButton actor={actor} contract={record} disabledReason={reason} />
      <Button onClick={() => setLosing(true)} disabledReason={reason}>
        {A.markLost}
      </Button>
      {renewing && <RenewDialog contract={record} onClose={() => setRenewing(false)} />}
      {losing && <LostDialog contract={record} onClose={() => setLosing(false)} />}
    </>
  );
}

export function ContractBanner({ record }: RecordExtensionProps) {
  if (record.status !== 'due_for_renewal') return null;
  return (
    <InlineAlert tone="warning" title={M.dueTitle}>
      {M.endsOn(formatDate(String(record.endDate)))}
      {record.renewalOpportunityId ? (
        <>
          {M.renewalOpportunity}{' '}
          <Link className="rel-link" to={recordPeekPath('tc', 'opportunities', String(record.renewalOpportunityId))}>
            {String(record.renewalOpportunityId)}
          </Link>
          .
        </>
      ) : (
        M.renewOrLose
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
      title={M.renewTitle(String(contract.contractNo))}
      description={M.renewDescription}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                const fresh = await installedApi.renew(actor, contract.id, { contractType: type, startDate, endDate, value: Number(value), pmVisitsPerYear: Number(visits) });
                toast(M.renewedAs(String(fresh.contractNo)));
                onClose();
              } catch (e) {
                setErrors(fieldErrorsOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {A.renewContract}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field id="rn-type" label={T.fields.amcContracts.contractType} required>
          <SelectMenu id="rn-type" block label={T.fields.amcContracts.contractType} value={type} options={options('amcType') as { value: 'amc' | 'cmc'; label: string }[]} onChange={setType} />
        </Field>
        <Field id="rn-visits" label={T.fields.amcContracts.pmVisitsPerYear} required error={errors.pmVisitsPerYear}>
          <TextField id="rn-visits" inputMode="numeric" value={visits} onChange={(e) => setVisits(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field id="rn-start" label={T.fields.amcContracts.startDate} required error={errors.startDate}>
          <DatePicker id="rn-start" block value={startDate} onChange={(v) => setStart(v ?? '')} label={T.fields.amcContracts.startDate} />
        </Field>
        <Field id="rn-end" label={T.fields.amcContracts.endDate} required error={errors.endDate}>
          <DatePicker id="rn-end" block value={endDate} onChange={(v) => setEnd(v ?? '')} label={T.fields.amcContracts.endDate} />
        </Field>
        <Field id="rn-value" label={T.fields.amcContracts.value} required error={errors.value}>
          <div className="input-affix">
            <span className="affix affix-start">₹</span>
            <TextField id="rn-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
        </Field>
        <div className="form-field">
          <span className="field-label">{M.currentValue}</span>
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
      title={M.lostTitle(String(contract.contractNo))}
      description={M.lostDescription}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            {A.cancel}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErrors({});
              try {
                await installedApi.markLost(actor, contract.id, reason, note);
                toast(M.markedLost(String(contract.contractNo)));
                onClose();
              } catch (e) {
                setErrors(fieldErrorsOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {A.markLost}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="lo-reason" label={T.fields.amcContracts.lostReason} required error={errors.lostReason}>
          <SelectMenu id="lo-reason" block label={T.fields.amcContracts.lostReason} value={reason} options={options('lostReason')} onChange={setReason} />
        </Field>
        <Field id="lo-note" label={M.note}>
          <Textarea id="lo-note" className="textarea" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError errors={errors} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Customer 360 → Training Records (FR-067)

export function CustomerTrainingTab({ actor, record }: RecordExtensionProps) {
  const q = useServiceQuery(() => (canReadResource(actor, 'trainingRecords') ? queryRecords(actor, 'trainingRecords', { where: { customerId: record.id }, sort: [{ field: 'date', dir: 'desc' }] }).rows : []), [record.id, actor.user.id]);
  const [adding, setAdding] = useState(false);
  return (
    <Loaded q={q}>
      {(rows) => (
        <>
          <div className="toolbar">
            <span className="spacer" />
            <Button icon="plus" onClick={() => setAdding(true)} disabledReason={!perm(actor, 'trainingRecords').create ? M.noTrainingCapability : undefined}>
              {A.recordTraining}
            </Button>
          </div>
          <MiniTable
            head={[C.date, C.machine, C.topics, C.trainees, C.retraining]}
            empty={M.noTrainingRows}
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


// ---------------------------------------------------------------- shared tab helpers

/** Read-only field list in the record-details style; values via FieldValue (masking and links included). */
function FieldList({ actor, resKey, record, keys, title }: { actor: RecordExtensionProps['actor']; resKey: string; record: RecordData; keys: string[]; title?: string }) {
  const res = getResource(resKey);
  const access = fieldAccessMap(actor, res);
  const fields = keys.map((k) => res.fields.find((f) => f.key === k)).filter((f): f is NonNullable<typeof f> => !!f && access[f.key] !== 'hide');
  return (
    <section className="detail-section">
      {title && <h3 className="detail-section-title">{title}</h3>}
      <dl className="detail-list">
        {fields.map((f) => (
          <div key={f.key} className="detail-row" data-type={f.type}>
            <dt>{f.label}</dt>
            <dd>{record[f.key] == null || record[f.key] === '' ? <EmptyValue label={M.notRecorded} /> : <FieldValue field={f} value={record[f.key]} access={access[f.key]} actor={actor} />}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Checklist rows: label + Yes / No chip. */
function Checklist({ items, caption }: { items: { key: string; label: string; done: boolean }[]; caption: string }) {
  return (
    
      <Table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{C.item}</th>
            <th scope="col">{C.done}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key}>
              <td>{i.label}</td>
              <td>
                <StatusChip label={i.done ? C.yes : C.no} tone={i.done ? 'success' : 'warning'} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    
  );
}

/** Raw installation record (live, unmasked workflow flags). */
const rawInstallation = (record: RecordData) => getDb().records.installations?.find((r) => r.id === record.id) ?? record;

// ---------------------------------------------------------------- installation job tabs (INS-03 … INS-06)

export function ReadinessTab({ actor, record }: RecordExtensionProps) {
  useRevision();
  const raw = rawInstallation(record);
  return (
    <>
      <p className="muted small">{M.readinessEditHint}</p>
      <Checklist caption={T.tabs.readiness} items={READINESS_FIELDS.map(([k, label]) => ({ key: k, label, done: raw[k] === true }))} />
      <FieldList actor={actor} resKey="installations" record={record} keys={['readinessSharedAt', 'readinessVerifiedAt']} />
    </>
  );
}

export function HandoverTab({ actor, record }: RecordExtensionProps) {
  useRevision();
  const raw = rawInstallation(record);
  const done = handoverComplete(raw);
  const [editing, setEditing] = useState(false);
  const allowed = canFillHandover(actor, raw);
  return (
    <>
      <InlineAlert tone={done ? 'success' : 'info'} title={done ? M.handoverDone : M.handoverPending}>
        {M.handoverEditHint}
      </InlineAlert>
      {raw.status !== 'signed_off' && (
        <div className="row-gap" style={{ margin: '8px 0' }}>
          <Button icon="pencil" variant={done ? 'secondary' : 'primary'} onClick={() => setEditing(true)} disabledReason={allowed ? undefined : T.service.handoverDenied}>
            {A.fillHandover}
          </Button>
        </div>
      )}
      <FieldList actor={actor} resKey="installations" record={raw} keys={['hoExpectations', 'hoCommitments', 'hoKeyContacts', 'handoverAt']} />
      {editing && <HandoverDialog record={raw} onClose={() => setEditing(false)} />}
    </>
  );
}

/** INS-04 Sales-to-Service handover form (sales owner or service desk). */
function HandoverDialog({ record, onClose }: { record: RecordData; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const F = T.fields.installations;
  const [values, setValues] = useState({ hoExpectations: String(record.hoExpectations ?? ''), hoCommitments: String(record.hoCommitments ?? ''), hoKeyContacts: String(record.hoKeyContacts ?? '') });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fields = [
    ['hoExpectations', F.hoExpectations, 1000],
    ['hoCommitments', F.hoCommitments, 1000],
    ['hoKeyContacts', F.hoKeyContacts, 500],
  ] as const;
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      await installedApi.saveHandover(actor, record.id, values, Number(record.version));
      toast(M.handoverSaved);
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
      title={M.handoverTitle(record.id)}
      description={M.handoverDescription}
      footer={
        <>
          <Button onClick={onClose}>{A.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {A.saveHandover}
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {fields.map(([k, label, max], i) => (
          <Field key={k} id={`ho-${k}`} label={label} required error={errors[k]}>
            <Textarea id={`ho-${k}`} className="textarea" rows={3} maxLength={max} value={values[k]} onChange={(e) => setValues({ ...values, [k]: e.target.value })} aria-invalid={!!errors[k] || undefined} data-autofocus={i === 0 || undefined} />
          </Field>
        ))}
        <FormError errors={errors} />
      </form>
    </Dialog>
  );
}

export function JobCardTab({ actor, record }: RecordExtensionProps) {
  useRevision();
  const raw = rawInstallation(record);
  const done = new Set((raw.jcSteps as string[] | undefined) ?? []);
  return (
    <>
      <Checklist caption={T.tabs.jobCard} items={allSteps().map((k) => ({ key: k, label: masterLabel('installStep', k), done: done.has(k) }))} />
      <FieldList actor={actor} resKey="installations" record={record} keys={['trialResults', 'parameters', 'mediaFiles', 'trainingTopics', 'trainees']} />
    </>
  );
}

export function SignOffTab({ actor, record }: RecordExtensionProps) {
  useRevision();
  const raw = rawInstallation(record);
  const signed = raw.status === 'signed_off';
  const blockers = signed ? [] : signOffBlockers(raw);
  return (
    <>
      {!signed && (
        <InlineAlert tone={blockers.length ? 'warning' : 'info'} title={blockers.length ? M.signOffBlockersTitle : M.signOffPending}>
          {blockers.length > 0 && (
            <ul className="plain-list bullets">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </InlineAlert>
      )}
      <FieldList actor={actor} resKey="installations" record={record} keys={['serialNo', 'printHeads', 'printWidth', 'softwareVersion', 'signOffMethod', 'signedOffBy', 'signedOffAt', 'signatureData', 'machineId']} />
    </>
  );
}

// ---------------------------------------------------------------- machine tabs (IB-01 … IB-06)

/** Rows of another resource for this machine, first column links to the record. */
function MachineRowsTab({ actor, record, resKey, sortField, keys, empty }: RecordExtensionProps & { resKey: string; sortField: string; keys: string[]; empty: string }) {
  const q = useMachineRows(actor, resKey, record.id, sortField);
  if (!hasResource(resKey) || !canReadResource(actor, resKey)) return <EmptyState icon="list" title={empty} />;
  const res = getResource(resKey);
  const access = fieldAccessMap(actor, res);
  const fields = keys.map((k) => res.fields.find((f) => f.key === k)).filter((f): f is NonNullable<typeof f> => !!f && access[f.key] !== 'hide');
  return (
    <Loaded q={q}>
      {(rows) => (
        <MiniTable
          head={[res.label, ...fields.map((f) => f.label)]}
          empty={empty}
          rows={rows.map((r) => [
            <Link className="rel-link" to={recordPeekPath('tc', resKey, r.id)}>
              {r.id}
            </Link>,
            ...fields.map((f) => (r[f.key] == null || r[f.key] === '' ? null : <FieldValue field={f} value={r[f.key]} access={access[f.key]} actor={actor} />)),
          ])}
        />
      )}
    </Loaded>
  );
}

export const WarrantyTab = (p: RecordExtensionProps) => <MachineRowsTab {...p} resKey="warranties" sortField="endDate" keys={['coverageType', 'startDate', 'endDate', 'warrantyStatus']} empty={M.noWarrantyRows} />;
export const ContractsTab = (p: RecordExtensionProps) => (
  <MachineRowsTab {...p} resKey="amcContracts" sortField="endDate" keys={['contractNo', 'contractType', 'startDate', 'endDate', 'pmVisitsPerYear', 'value', 'status']} empty={M.noContractRows} />
);
export const TicketsTab = (p: RecordExtensionProps) =>
  hasResource('tickets') ? <MachineRowsTab {...p} resKey="tickets" sortField="reportedAt" keys={['reportedAt', 'ticketType', 'priority', 'status', 'assigneeId']} empty={M.noTicketRows} /> : <EmptyState icon="list" title={M.ticketsUnavailable} />;

// ---------------------------------------------------------------- Create Renewal Quotation (IB-05)

export function RenewalQuotationButton({ actor, contract, disabledReason }: { actor: RecordExtensionProps['actor']; contract: RecordData; disabledReason?: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const unavailable = !hasResource('quotations') || !hasResource('opportunities') ? M.quotationNotAvailable : !perm(actor, 'quotations').create ? M.readOnly : undefined;
  return (
    <Button
      icon="receipt"
      loading={busy}
      disabledReason={disabledReason ?? unavailable}
      onClick={async () => {
        setBusy(true);
        try {
          const opportunity = await installedApi.prepareRenewalQuotation(actor, contract.id);
          navigate(toPath(ROUTES.quotationNew, {}, { opportunity }));
        } catch (e) {
          toast(errorMessage(e), 'danger');
        } finally {
          setBusy(false);
        }
      }}
    >
      {A.createRenewalQuotation}
    </Button>
  );
}
