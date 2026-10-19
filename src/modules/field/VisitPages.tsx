import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, formatWeekday, nowLocal, startOfWeek, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { recordPagePath } from '../../lib/routes';
import { call, errorMessage } from '../../services/api/client';
import { fieldApi, type VisitLink } from '../../services/api/field';
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
import { EmbeddedResourceList, getLocation, LocationSourcePicker, Meter, ModeSwitch, OfflineSwitch, time12, useLocationSource, useOfflineState } from './common';

const T = L.nav.pages;
const FA = L.field.actions;
const LIST_PARAMS = ['view', 'q', 'f', 'page', 'size'];

const OTHER = '__other__';
const chip = (master: string, v: unknown) => {
  const m = masterValue(master, v);
  return m ? <StatusChip label={m.label} tone={m.tone} /> : null;
};

// ---------------------------------------------------------------- Field Visits (ATT-05, NFR-19)

type VisitMode = 'checkin' | 'list';

/** One page for field visits: the Check-in / Check-out working view and the full Field Visits list. */
export function FieldVisitsPage() {
  const P = L.field.pages.fieldVisits;
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const asked = params.get('mode');
  const mode: VisitMode = asked === 'list' || asked === 'checkin' ? asked : LIST_PARAMS.some((k) => params.has(k)) || can(actor, 'field.team') ? 'list' : 'checkin';
  const switcher = <ModeSwitch<VisitMode> label={P.modeLabel} value={mode} onChange={(m) => setParams({ mode: m })} options={[{ id: 'checkin', label: P.modes.checkin }, { id: 'list', label: P.modes.list }]} />;
  if (mode === 'list')
    return (
      <div className="field-merged">
        {switcher}
        <EmbeddedResourceList resKey="fieldVisits" />
      </div>
    );
  return <VisitCheckIn switcher={switcher} />;
}

function VisitCheckIn({ switcher }: { switcher: ReactNode }) {
  const P = L.field.pages.fieldVisits;
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const peek = params.get('peek');
  const q = useServiceQuery(() => fieldApi.myVisits(actor), [actor.user.id]);
  const [source, setSource] = useLocationSource();
  // Deep link from a lead / opportunity / ticket: ?mode=checkin&log=1&link=<resource>:<id> opens Log Visit pre-linked (ATT-05).
  const [logging, setLogging] = useState(params.get('log') === '1');
  const deepLink = params.get('link') ?? '';
  const [planning, setPlanning] = useState(false);
  const [closing, setClosing] = useState<RecordData | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { offline } = useOfflineState();
  const peekLink = (id: string) => toPath(ROUTES.fieldVisits, {}, { mode: 'checkin', peek: id });

  const checkInAt = async (v: RecordData) => {
    setBusyId(v.id);
    try {
      const { point } = await getLocation(source, actor.staffId);
      const r = await fieldApi.startVisit(actor, v.id, nowLocal(), point, source);
      toast(r.queued ? P.queuedIn : P.checkedInAtSite(String(v.siteLabel)), r.queued ? 'info' : 'success');
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page field-page">
      <PageHeader title={T.fieldVisits.title} description={P.description} />
      {switcher}
      <div className="toolbar field-toolbar">
        <Button variant="primary" size="default" icon="plus" onClick={() => setLogging(true)} disabledReason={!q.data ? L.field.common.loading : undefined}>
          {FA.logVisit}
        </Button>
        <Button icon="calendar" onClick={() => setPlanning(true)}>
          {FA.planVisit}
        </Button>
        <span className="spacer" />
        <OfflineSwitch />
      </div>
      {offline && <InlineAlert tone="warning">{P.offline}</InlineAlert>}
      <LocationSourcePicker value={source} onChange={setSource} />
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          {q.data.active.map((v) => (
            <section key={v.id} className="panel">
              <div className="panel-head">
                <h2 className="panel-title">{P.atSite(String(v.siteLabel))}</h2>
                {chip('visitPurpose', v.purpose)}
              </div>
              <p className="muted">{P.checkedInAt(time12(v.checkInAt))}</p>
              <Button variant="primary" icon="check" onClick={() => setClosing(v)}>
                {FA.checkOut}
              </Button>
            </section>
          ))}
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{P.plannedTitle}</h2>
              <Link to={ROUTES.beatPlan} className="link small">
                {P.beatPlanLink}
              </Link>
            </div>
            {q.data.planned.length ? (
              <ul className="flow-list">
                {q.data.planned.map((v) => {
                  const due = String(v.plannedFor) <= todayKey();
                  return (
                    <li key={v.id} className="flow-item">
                      <span className={cx('tag', String(v.plannedFor) < todayKey() ? 'tone-danger' : due ? 'tone-warning' : 'tone-neutral')}>{String(v.plannedFor) === todayKey() ? P.today : formatDate(String(v.plannedFor))}</span>
                      <Link to={peekLink(v.id)} className="flow-main">
                        <span className="flow-title">{String(v.siteLabel)}</span>
                        <span className="muted small">{masterValue('visitPurpose', v.purpose)?.label}</span>
                      </Link>
                      <Button loading={busyId === v.id} onClick={() => checkInAt(v)} disabledReason={!due ? P.checkInOnDay : q.data!.active.length ? P.checkOutFirst : undefined}>
                        {FA.checkIn}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="calendar" title={P.plannedEmptyTitle}>
                {P.plannedEmptyBody}
              </EmptyState>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{P.recentTitle}</h2>
              <Link to={toPath(ROUTES.fieldVisits, {}, { mode: 'list' })} className="link small">
                {P.allLink}
              </Link>
            </div>
            {q.data.recent.length ? (
              <ul className="flow-list">
                {q.data.recent.map((v) => (
                  <li key={v.id} className="flow-item">
                    <span className="tag tone-success">{formatDate(String(v.checkOutAt ?? v.plannedFor).slice(0, 10))}</span>
                    <Link to={peekLink(v.id)} className="flow-main">
                      <span className="flow-title">{String(v.siteLabel)}</span>
                      <span className="muted small">
                        {masterValue('visitPurpose', v.purpose)?.label}
                        {v.nextAction ? P.next(String(v.nextAction)) : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="door-open" title={P.recentEmptyTitle}>
                {P.recentEmptyBody}
              </EmptyState>
            )}
          </section>
        </>
      )}
      {logging && q.data && (
        <LogVisitDialog
          customers={q.data.customers}
          links={q.data.links}
          initialLink={deepLink}
          source={source}
          onClose={() => {
            setLogging(false);
            if (params.has('log')) setParams({ mode: 'checkin' }, { replace: true });
          }}
        />
      )}
      {closing && <CompleteVisitDialog visit={closing} onClose={() => setClosing(null)} />}
      <QuickCreateDialog open={planning} resKey="fieldVisits" initial={{ plannedFor: addDays(todayKey(), 1) }} onClose={() => setPlanning(false)} onCreated={() => toast(P.planned)} />
      {peek && <RecordInspector resKey="fieldVisits" recordId={peek} onClose={() => setParams({ mode: 'checkin' })} />}
    </div>
  );
}

function LogVisitDialog({ customers, links, initialLink, source, onClose }: { customers: { id: string; name: string; mine: boolean }[]; links: VisitLink[]; initialLink?: string; source: Parameters<typeof getLocation>[0]; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const preset = links.find((l) => `${l.resource}:${l.id}` === initialLink);
  const [customerId, setCustomerId] = useState<string>(preset?.customerId ?? customers.find((c) => c.mine)?.id ?? (customers[0]?.id || OTHER));
  const [linkKey, setLinkKey] = useState(preset ? `${preset.resource}:${preset.id}` : '');
  const [site, setSite] = useState('');
  const [purpose, setPurpose] = useState('follow_up');
  const [remarks, setRemarks] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const customer = customers.find((c) => c.id === customerId);
  const P = L.field.pages.fieldVisits.log;
  const customerLinks = links.filter((l) => l.customerId === customerId);
  const link = customerLinks.find((l) => `${l.resource}:${l.id}` === linkKey);
  const E = L.field.errors;
  const save = async () => {
    setError('');
    const siteLabel = customer ? customer.name : site.trim();
    if (!siteLabel) return setError(E.siteRequired);
    if (nextDate && nextDate < todayKey()) return setError(E.nextDatePast);
    setBusy(true);
    try {
      const { point } = await getLocation(source, actor.staffId);
      const parent = link ? { parentResource: link.resource, parentId: link.id, parentLabel: `${link.label} · ${siteLabel}` } : {};
      const r = await fieldApi.logVisit(actor, { customerId: customer?.id ?? null, siteLabel, purpose, remarks, nextAction, nextActionDate: nextDate || null, point, source, at: nowLocal(), ...parent });
      toast(r.queued ? P.queued : P.logged(siteLabel), r.queued ? 'info' : 'success');
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
      title={FA.logVisit}
      description={P.description}
      footer={
        <>
          <Button onClick={onClose}>{L.field.actions.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {FA.saveVisit}
          </Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="form-field span-all">
          <label className="field-label" htmlFor="lv-customer">
            {P.customer} <span className="req">*</span>
          </label>
          <SelectMenu
            id="lv-customer"
            block
            searchable
            label={P.customer}
            value={customerId}
            options={[...customers.map((c) => ({ value: c.id, label: c.mine ? P.myAccount(c.name) : c.name })), { value: OTHER, label: P.otherSite }]}
            onChange={(v) => {
              setCustomerId(v);
              setLinkKey('');
            }}
          />
        </div>
        {customerLinks.length > 0 && (
          <div className="form-field span-all">
            <label className="field-label" htmlFor="lv-link">
              {P.linkedTo}
            </label>
            <SelectMenu
              id="lv-link"
              block
              searchable
              label={P.linkedTo}
              value={linkKey}
              options={[{ value: '', label: P.linkNone }, ...customerLinks.map((l) => ({ value: `${l.resource}:${l.id}`, label: P.linkOption(P.linkKinds[l.resource], l.label) }))]}
              onChange={setLinkKey}
            />
          </div>
        )}
        {customerId === OTHER && (
          <div className="form-field span-all">
            <label className="field-label" htmlFor="lv-site">
              {P.siteName} <span className="req">*</span>
            </label>
            <input id="lv-site" className="input" maxLength={140} value={site} onChange={(e) => setSite(e.target.value)} />
          </div>
        )}
        <div className="form-field span-all">
          <span className="field-label">{P.purpose}</span>
          <div className="segmented" role="radiogroup" aria-label={P.purpose}>
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
              {P.remarks}
            </label>
            <VoiceButton onText={(t) => setRemarks((r) => (r ? `${r} ${t}` : t))} label={P.dictate} />
          </span>
          <textarea id="lv-remarks" className="input textarea" rows={2} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="lv-next">
            {P.nextAction}
          </label>
          <input id="lv-next" className="input" maxLength={200} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="lv-next-date">
            {P.nextActionDate}
          </label>
          <DatePicker id="lv-next-date" value={nextDate} onChange={(v) => setNextDate(v ?? '')} label={P.nextActionDate} />
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
  const P = L.field.pages.fieldVisits;
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={P.complete.title(String(visit.siteLabel))}
      footer={
        <>
          <Button onClick={onClose}>{L.field.actions.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!remarks.trim()) return setError(L.field.errors.remarksFirst);
              setBusy(true);
              try {
                const r = await fieldApi.completeVisit(actor, visit.id, { at: nowLocal(), remarks, nextAction, nextActionDate: nextDate || null });
                toast(r.queued ? P.complete.queued : P.complete.done, r.queued ? 'info' : 'success');
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {FA.checkOut}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-field">
          <span className="field-label-row">
            <label className="field-label" htmlFor="cv-remarks">
              {P.log.remarks} <span className="req">*</span>
            </label>
            <VoiceButton onText={(t) => setRemarks((r) => (r ? `${r} ${t}` : t))} label={P.log.dictate} />
          </span>
          <textarea id="cv-remarks" className="input textarea" rows={3} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-invalid={!!error || undefined} data-autofocus />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-next">
            {P.log.nextAction}
          </label>
          <input id="cv-next" className="input" maxLength={200} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="cv-next-date">
            {P.log.nextActionDate}
          </label>
          <DatePicker id="cv-next-date" value={nextDate} onChange={(v) => setNextDate(v ?? '')} label={P.log.nextActionDate} />
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

// ---------------------------------------------------------------- Beat Plan (ATT-06)

type BeatMode = 'week' | 'list';

/** One page for the weekly beat plan: planned vs actual for the week, and the full Beat Plan list. */
export function BeatPlanPage() {
  const P = L.field.pages.beatPlan;
  const [params, setParams] = useSearchParams();
  const asked = params.get('mode');
  const mode: BeatMode = asked === 'list' || asked === 'week' ? asked : LIST_PARAMS.some((k) => params.has(k)) ? 'list' : 'week';
  const switcher = <ModeSwitch<BeatMode> label={P.modeLabel} value={mode} onChange={(m) => setParams({ mode: m })} options={[{ id: 'week', label: P.modes.week }, { id: 'list', label: P.modes.list }]} />;
  if (mode === 'list')
    return (
      <div className="field-merged">
        {switcher}
        <EmbeddedResourceList resKey="beatPlans" />
      </div>
    );
  return <BeatWeek switcher={switcher} />;
}

function BeatWeek({ switcher }: { switcher: ReactNode }) {
  const P = L.field.pages.beatPlan;
  const actor = useActor();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const week = startOfWeek(params.get('week') ?? todayKey());
  const q = useServiceQuery(() => fieldApi.beatPlan(actor, week), [actor.user.id, week]);
  const [adding, setAdding] = useState<string | null>(null);
  const days = Array.from({ length: 6 }, (_, i) => addDays(week, i));
  const goWeek = (w: string) => setParams({ mode: 'week', week: w });
  const remove = (b: RecordData) =>
    confirmDelete({
      title: L.field.confirms.removePlanTitle,
      message: L.field.confirms.removePlan(String(b.siteLabel), formatDate(String(b.date))),
      confirmLabel: FA.remove,
      onConfirm: async () => {
        try {
          await call(() => deleteRecord(actor, 'beatPlans', b.id));
          toast(P.removed);
        } catch (e) {
          toast(errorMessage(e), 'danger');
        }
      },
    });
  return (
    <div className="page">
      <PageHeader title={T.beatPlan.title} description={P.description} />
      {switcher}
      <div className="toolbar field-toolbar">
        <Button icon="chevron-left" onClick={() => goWeek(addDays(week, -7))}>
          {FA.previousWeek}
        </Button>
        <strong>{L.field.common.weekOf(formatDate(week))}</strong>
        <Button iconRight="chevron-right" onClick={() => goWeek(addDays(week, 7))}>
          {FA.nextWeek}
        </Button>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setAdding(days.find((d) => d >= todayKey()) ?? addDays(week, 7))} disabledReason={addDays(week, 6) < todayKey() ? P.pastWeek : undefined}>
          {FA.addToPlan}
        </Button>
      </div>
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{P.myPlan}</h2>
            </div>
            {q.data.mine.length ? (
              <ul className="flow-list">
                {q.data.mine.map((b) => (
                  <li key={b.id} className="flow-item">
                    <span className="tag tone-neutral">{formatWeekday(String(b.date))}</span>
                    <Link to={recordPagePath(actor.workspaceId, 'beatPlans', b.id)} className="flow-main">
                      <span className="flow-title">{String(b.siteLabel)}</span>
                      <span className="muted small">{masterValue('visitPurpose', b.purpose)?.label}</span>
                    </Link>
                    {chip('beatStatus', b.status)}
                    {b.status === 'planned' && <Button variant="ghost" icon="trash" onClick={() => remove(b)} aria-label={P.removeAria(String(b.siteLabel))} />}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="calendar" title={P.emptyTitle}>
                {P.emptyBody}
              </EmptyState>
            )}
          </section>
          {can(actor, 'field.team') && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">{P.teamTitle}</h2>
              </div>
              {q.data.team.length ? (
                <div className="table-scroll">
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th scope="col">{L.field.common.person}</th>
                        <th scope="col">{P.planned}</th>
                        <th scope="col">{P.visited}</th>
                        <th scope="col">{P.missed}</th>
                        <th scope="col">{P.upcoming}</th>
                        <th scope="col">{P.unplanned}</th>
                        <th scope="col">{P.adherence}</th>
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
                            <td>{done ? <Meter pct={Math.round((r.visited / done) * 100)} label={P.adherenceAria(String(r.employee.fullName))} /> : <span className="muted small">{P.notDue}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon="users" title={P.teamEmpty} />
              )}
            </section>
          )}
        </div>
      )}
      <QuickCreateDialog open={!!adding} resKey="beatPlans" initial={adding ? { date: adding } : undefined} onClose={() => setAdding(null)} onCreated={() => toast(P.added)} />
    </div>
  );
}
