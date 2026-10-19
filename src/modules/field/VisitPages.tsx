import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, formatWeekday, nowLocal, startOfWeek, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { call, errorMessage } from '../../services/api/client';
import { fieldApi } from '../../services/api/field';
import { can } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterValue } from '../../services/registry';
import { deleteRecord } from '../../services/runtime';
import type { RecordData } from '../../metadata/types';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { confirmDelete, Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { VoiceButton } from '../../components/crm/VoiceButton';
import { QuickCreateDialog } from '../../components/resource/RecordForm';
import { RecordInspector } from '../../components/resource/RecordInspector';
import { PageHeader } from '../../components/shell/PageHeader';
import { getLocation, LocationSourcePicker, Meter, OfflineSwitch, time12, useLocationSource, useOfflineState } from './common';

const OTHER = '__other__';
const chip = (master: string, v: unknown) => {
  const m = masterValue(master, v);
  return m ? <StatusChip label={m.label} tone={m.tone} /> : null;
};

// ---------------------------------------------------------------- My visits (ATT-05, NFR-19)

export function MyVisitsPage() {
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const peek = params.get('peek');
  const q = useServiceQuery(() => fieldApi.myVisits(actor), [actor.user.id]);
  const [source, setSource] = useLocationSource();
  const [logging, setLogging] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [closing, setClosing] = useState<RecordData | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { offline } = useOfflineState();

  const checkInAt = async (v: RecordData) => {
    setBusyId(v.id);
    try {
      const { point } = await getLocation(source, actor.staffId);
      const r = await fieldApi.startVisit(actor, v.id, nowLocal(), point, source);
      toast(r.queued ? 'Saved offline — check-in will sync later' : `Checked in at ${String(v.siteLabel)}`, r.queued ? 'info' : 'success');
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusyId(null);
    }
  };

  const header = <PageHeader title="My visits" description="Log a visit in three taps, or check in and out of planned visits. Each visit is geo-tagged and added to the customer’s timeline." />;
  return (
    <div className="page field-page">
      {header}
      <div className="toolbar field-toolbar">
        <Button variant="primary" size="default" icon="plus" onClick={() => setLogging(true)} disabledReason={!q.data ? 'Loading…' : undefined}>
          Log visit
        </Button>
        <Button icon="calendar" onClick={() => setPlanning(true)}>
          Plan a visit
        </Button>
        <span className="spacer" />
        <OfflineSwitch />
      </div>
      {offline && <InlineAlert tone="warning">Working offline — visits are saved on this device and sync when you are back online.</InlineAlert>}
      <LocationSourcePicker value={source} onChange={setSource} />
      {q.error ? (
        <ErrorState title="Could not load your visits" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          {q.data.active.map((v) => (
            <section key={v.id} className="panel">
              <div className="panel-head">
                <h2 className="panel-title">At {String(v.siteLabel)}</h2>
                {chip('visitPurpose', v.purpose)}
              </div>
              <p className="muted">Checked in at {time12(v.checkInAt)}.</p>
              <Button variant="primary" icon="check" onClick={() => setClosing(v)}>
                Check out
              </Button>
            </section>
          ))}
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Planned (next 7 days)</h2>
              <Link to="/visits/plan" className="link small">
                Beat plan
              </Link>
            </div>
            {q.data.planned.length ? (
              <ul className="flow-list">
                {q.data.planned.map((v) => {
                  const due = String(v.plannedFor) <= todayKey();
                  return (
                    <li key={v.id} className="flow-item">
                      <span className={cx('tag', String(v.plannedFor) < todayKey() ? 'tone-danger' : due ? 'tone-warning' : 'tone-neutral')}>{String(v.plannedFor) === todayKey() ? 'Today' : formatDate(String(v.plannedFor))}</span>
                      <Link to={`/visits?peek=${v.id}`} className="flow-main">
                        <span className="flow-title">{String(v.siteLabel)}</span>
                        <span className="muted small">{masterValue('visitPurpose', v.purpose)?.label}</span>
                      </Link>
                      <Button loading={busyId === v.id} onClick={() => checkInAt(v)} disabledReason={!due ? 'Check in on the planned day' : q.data!.active.length ? 'Check out of your current visit first' : undefined}>
                        Check in
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="calendar" title="No planned visits">
                Plan visits here or in your weekly beat plan.
              </EmptyState>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Recent visits</h2>
              <Link to="/fieldVisits" className="link small">
                All visits
              </Link>
            </div>
            {q.data.recent.length ? (
              <ul className="flow-list">
                {q.data.recent.map((v) => (
                  <li key={v.id} className="flow-item">
                    <span className="tag tone-success">{formatDate(String(v.checkOutAt ?? v.plannedFor).slice(0, 10))}</span>
                    <Link to={`/visits?peek=${v.id}`} className="flow-main">
                      <span className="flow-title">{String(v.siteLabel)}</span>
                      <span className="muted small">
                        {masterValue('visitPurpose', v.purpose)?.label}
                        {v.nextAction ? ` · Next: ${String(v.nextAction)}` : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="door-open" title="No visits yet">
                Tap “Log visit” at the customer’s site.
              </EmptyState>
            )}
          </section>
        </>
      )}
      {logging && q.data && <LogVisitDialog customers={q.data.customers} source={source} onClose={() => setLogging(false)} />}
      {closing && <CompleteVisitDialog visit={closing} onClose={() => setClosing(null)} />}
      <QuickCreateDialog open={planning} resKey="fieldVisits" initial={{ plannedFor: addDays(todayKey(), 1) }} onClose={() => setPlanning(false)} onCreated={() => toast('Visit planned')} />
      {peek && <RecordInspector resKey="fieldVisits" recordId={peek} onClose={() => setParams({})} />}
    </div>
  );
}

function LogVisitDialog({ customers, source, onClose }: { customers: { id: string; name: string; mine: boolean }[]; source: Parameters<typeof getLocation>[0]; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [customerId, setCustomerId] = useState<string>(customers.find((c) => c.mine)?.id ?? (customers[0]?.id || OTHER));
  const [site, setSite] = useState('');
  const [purpose, setPurpose] = useState('follow_up');
  const [remarks, setRemarks] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const customer = customers.find((c) => c.id === customerId);
  const save = async () => {
    setError('');
    const siteLabel = customer ? customer.name : site.trim();
    if (!siteLabel) return setError('Choose a customer or type the site name');
    if (nextDate && nextDate < todayKey()) return setError('Next action date cannot be in the past');
    setBusy(true);
    try {
      const { point } = await getLocation(source, actor.staffId);
      const r = await fieldApi.logVisit(actor, { customerId: customer?.id ?? null, siteLabel, purpose, remarks, nextAction, nextActionDate: nextDate || null, point, source, at: nowLocal() });
      toast(r.queued ? 'Visit saved offline — it will sync later' : `Visit at ${siteLabel} logged`, r.queued ? 'info' : 'success');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Log visit"
      description="Records a completed visit here and now, with your location."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save visit
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field span-all">
          <label className="field-label" htmlFor="lv-customer">
            Customer <span className="req">*</span>
          </label>
          <SelectMenu id="lv-customer" block searchable label="Customer" value={customerId} options={[...customers.map((c) => ({ value: c.id, label: c.mine ? `${c.name} (my account)` : c.name })), { value: OTHER, label: 'Other site / new prospect…' }]} onChange={setCustomerId} />
        </div>
        {customerId === OTHER && (
          <div className="form-field span-all">
            <label className="field-label" htmlFor="lv-site">
              Site name <span className="req">*</span>
            </label>
            <input id="lv-site" className="input" maxLength={140} value={site} onChange={(e) => setSite(e.target.value)} />
          </div>
        )}
        <div className="form-field span-all">
          <span className="field-label">Purpose</span>
          <div className="segmented" role="radiogroup" aria-label="Purpose">
            {activeMasterValues('visitPurpose').map((v) => (
              <button key={v.key} type="button" role="radio" aria-checked={purpose === v.key} className={cx('seg-btn', purpose === v.key && 'is-on')} onClick={() => setPurpose(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="form-field span-all">
          <span className="field-label-row">
            <label className="field-label" htmlFor="lv-remarks">
              Remarks
            </label>
            <VoiceButton onText={(t) => setRemarks((r) => (r ? `${r} ${t}` : t))} label="Dictate remarks" />
          </span>
          <textarea id="lv-remarks" className="input textarea" rows={2} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="lv-next">
            Next action
          </label>
          <input id="lv-next" className="input" maxLength={200} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="lv-next-date">
            Next action date
          </label>
          <DatePicker id="lv-next-date" value={nextDate} onChange={(v) => setNextDate(v ?? '')} label="Next action date" />
        </div>
        {error && (
          <p className="field-error span-all" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function CompleteVisitDialog({ visit, onClose }: { visit: RecordData; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [remarks, setRemarks] = useState(String(visit.remarks ?? ''));
  const [nextAction, setNextAction] = useState(String(visit.nextAction ?? ''));
  const [nextDate, setNextDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Check out · ${String(visit.siteLabel)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!remarks.trim()) return setError('Add remarks before checking out');
              setBusy(true);
              try {
                const r = await fieldApi.completeVisit(actor, visit.id, { at: nowLocal(), remarks, nextAction, nextActionDate: nextDate || null });
                toast(r.queued ? 'Saved offline — will sync later' : 'Visit completed', r.queued ? 'info' : 'success');
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Check out
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <span className="field-label-row">
            <label className="field-label" htmlFor="cv-remarks">
              Remarks <span className="req">*</span>
            </label>
            <VoiceButton onText={(t) => setRemarks((r) => (r ? `${r} ${t}` : t))} label="Dictate remarks" />
          </span>
          <textarea id="cv-remarks" className="input textarea" rows={3} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-invalid={!!error || undefined} data-autofocus />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-next">
            Next action
          </label>
          <input id="cv-next" className="input" maxLength={200} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-next-date">
            Next action date
          </label>
          <DatePicker id="cv-next-date" value={nextDate} onChange={(v) => setNextDate(v ?? '')} label="Next action date" />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Beat plan (ATT-06)

export function BeatPlanPage() {
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const week = startOfWeek(params.get('week') ?? todayKey());
  const q = useServiceQuery(() => fieldApi.beatPlan(actor, week), [actor.user.id, week]);
  const [adding, setAdding] = useState<string | null>(null);
  const days = Array.from({ length: 6 }, (_, i) => addDays(week, i));
  const remove = (b: RecordData) =>
    confirmDelete({
      title: 'Remove plan entry?',
      message: `${String(b.siteLabel)} on ${formatDate(String(b.date))} is removed from your beat plan. Visits already logged are kept.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        try {
          await call(() => deleteRecord(actor, 'beatPlans', b.id));
          toast('Plan entry removed');
        } catch (e) {
          toast(errorMessage(e), 'danger');
        }
      },
    });
  return (
    <div className="page">
      <PageHeader title="Beat plan" description="Plan the week’s customer visits; managers compare planned with actual visits for their team." />
      <div className="toolbar">
        <Button icon="chevron-left" onClick={() => setParams({ week: addDays(week, -7) })}>
          Previous week
        </Button>
        <strong>Week of {formatDate(week)}</strong>
        <Button iconRight="chevron-right" onClick={() => setParams({ week: addDays(week, 7) })}>
          Next week
        </Button>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setAdding(days.find((d) => d >= todayKey()) ?? addDays(week, 7))} disabledReason={addDays(week, 6) < todayKey() ? 'Past week' : undefined}>
          Add to plan
        </Button>
      </div>
      {q.error ? (
        <ErrorState title="Could not load the beat plan" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">My plan</h2>
            </div>
            {q.data.mine.length ? (
              <ul className="flow-list">
                {q.data.mine.map((b) => (
                  <li key={b.id} className="flow-item">
                    <span className="tag tone-neutral">{formatWeekday(String(b.date))}</span>
                    <span className="flow-main">
                      <span className="flow-title">{String(b.siteLabel)}</span>
                      <span className="muted small">{masterValue('visitPurpose', b.purpose)?.label}</span>
                    </span>
                    {chip('beatStatus', b.status)}
                    {b.status === 'planned' && <Button variant="ghost" icon="trash" onClick={() => remove(b)} aria-label={`Remove ${String(b.siteLabel)}`} />}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="calendar" title="Nothing planned this week">
                Add the customers you intend to visit.
              </EmptyState>
            )}
          </section>
          {can(actor, 'field.team') && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Team: planned vs actual</h2>
              </div>
              {q.data.team.length ? (
                <div className="table-scroll">
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th scope="col">Person</th>
                        <th scope="col">Planned</th>
                        <th scope="col">Visited</th>
                        <th scope="col">Missed</th>
                        <th scope="col">Upcoming</th>
                        <th scope="col">Unplanned visits</th>
                        <th scope="col">Plan adherence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.team.map((r) => {
                        const done = r.visited + r.missed;
                        return (
                          <tr key={r.employee.id}>
                            <td>{String(r.employee.fullName)}</td>
                            <td>{r.planned.length}</td>
                            <td>{r.visited}</td>
                            <td className={cx(r.missed > 0 && 'text-danger')}>{r.missed}</td>
                            <td>{r.pending}</td>
                            <td>{r.unplanned}</td>
                            <td>{done ? <Meter pct={Math.round((r.visited / done) * 100)} label={`${String(r.employee.fullName)} plan adherence`} /> : <span className="muted small">Not due yet</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon="users" title="No plans in your team this week" />
              )}
            </section>
          )}
        </div>
      )}
      <QuickCreateDialog open={!!adding} resKey="beatPlans" initial={adding ? { date: adding } : undefined} onClose={() => setAdding(null)} onCreated={() => toast('Added to your beat plan')} />
    </div>
  );
}
