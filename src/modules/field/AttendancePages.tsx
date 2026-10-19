import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, nowLocal, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { errorMessage } from '../../services/api/client';
import { fieldApi } from '../../services/api/field';
import { useActor } from '../../services/hooks';
import { masterValue } from '../../services/registry';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { Avatar, EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, Tabs, useToast } from '../../components/primitives/feedback';
import { EmptyValue } from '../../components/primitives/display';
import { InfoTip } from '../../components/primitives/InfoTip';
import { QuickCreateDialog } from '../../components/resource/RecordForm';
import { RecordInspector } from '../../components/resource/RecordInspector';
import { PageHeader } from '../../components/shell/PageHeader';
import { fmtMinutes, getLocation, LocationSourcePicker, OfflineSwitch, Stat, time12, useLocationSource, useOfflineState } from './common';

const statusChip = (s: unknown) => {
  const v = masterValue('attendanceStatus', s);
  return v ? <StatusChip label={v.label} tone={v.tone} /> : <EmptyValue />;
};

// ---------------------------------------------------------------- My day (ATT-01, ATT-02, NFR-19)

export function MyDayPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const peek = params.get('peek');
  const q = useServiceQuery(() => fieldApi.myDay(actor), [actor.user.id, todayKey()]);
  const [source, setSource] = useLocationSource();
  const [onTour, setOnTour] = useState(false);
  const [selfie, setSelfie] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState<null | 'regularisations' | 'leaves'>(null);
  const { offline, pending } = useOfflineState();

  const act = async (kind: 'in' | 'out') => {
    setBusy(true);
    setError('');
    try {
      const { point, place } = await getLocation(source, actor.staffId);
      const at = nowLocal();
      const r = kind === 'in' ? await fieldApi.checkIn(actor, { at, point, place, source, selfie, onTour }) : await fieldApi.checkOut(actor, { at, point, place, source });
      toast(r.queued ? `Saved offline — ${kind === 'in' ? 'check-in' : 'check-out'} will sync when you are back online` : kind === 'in' ? `Checked in at ${time12(at)}` : `Checked out at ${time12(at)}`, r.queued ? 'info' : 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title="My day" description="Check in and out with time and location. Location is captured only at check-in, visits and check-out (simulated tracking in between)." />;
  if (q.error)
    return (
      <div className="page">
        {header}
        <ErrorState title="Could not load your day" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        {header}
        <Skeleton rows={6} />
      </div>
    );
  const d = q.data;
  const rec = d.record;
  const state = rec?.status === 'leave' && !rec.checkInAt ? 'leave' : !rec?.checkInAt ? 'out' : !rec.checkOutAt ? 'in' : 'done';

  return (
    <div className="page field-page">
      {header}
      {!d.consent && (
        <InlineAlert tone="info" title="Location consent (DPDP Act, 2023)">
          True Colors records your location only when you check in, log a visit and check out, to verify field attendance and calculate conveyance. It is not tracked outside working hours and is kept per company retention rules.{' '}
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await fieldApi.grantConsent(actor);
                toast('Consent recorded');
              } catch (e) {
                toast(errorMessage(e), 'danger');
              }
            }}
          >
            I agree
          </Button>
        </InlineAlert>
      )}
      {offline && (
        <InlineAlert tone="warning" title="Working offline">
          Check-ins and visits are saved on this device{pending ? ` (${pending} waiting)` : ''} and sync when you switch back online.
        </InlineAlert>
      )}
      <section className="panel field-checkin">
        <div className="panel-head">
          <h2 className="panel-title dialog-title-row">
            {formatDate(d.today)}
            <InfoTip text={`Shift ${d.shift.start}–${d.shift.end}, ${d.shift.graceMin} min grace; under ${d.shift.halfDayHours} h counts as a half-day.${d.office ? ` Office staff check in within ${d.radiusM} m of the office.` : ''}`} label="About your shift" />
          </h2>
          {rec ? statusChip(rec.status) : <StatusChip label="Not checked in" tone="neutral" />}
          <span className="spacer" />
          <OfflineSwitch />
        </div>
        {state === 'leave' ? (
          <p className="muted">You are on approved leave today.</p>
        ) : state === 'done' ? (
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Checked in</dt>
              <dd>
                {time12(rec!.checkInAt)} · {String(rec!.checkInPlace ?? '')}
              </dd>
            </div>
            <div className="detail-row">
              <dt>Checked out</dt>
              <dd>{time12(rec!.checkOutAt)}</dd>
            </div>
            <div className="detail-row">
              <dt>Worked</dt>
              <dd>
                {fmtMinutes(rec!.workMinutes)}
                {Number(rec!.lateByMin) > 0 && ` · late by ${rec!.lateByMin} min`}
                {Number(rec!.earlyByMin) > 0 && ` · left ${rec!.earlyByMin} min early`}
              </dd>
            </div>
            {rec!.distanceKm !== undefined && rec!.distanceKm !== null && (
              <div className="detail-row">
                <dt>Route</dt>
                <dd>
                  <Link to={`/attendance/${actor.staffId}/route?date=${d.today}`}>{String(rec!.distanceKm)} km travelled</Link>
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="field-checkin-body">
            {state === 'in' && (
              <p>
                Checked in at <strong>{time12(rec!.checkInAt)}</strong> · {String(rec!.checkInPlace ?? '')}
                {Number(rec!.lateByMin) > 0 && <span className="text-danger"> · late by {String(rec!.lateByMin)} min</span>}
              </p>
            )}
            <LocationSourcePicker value={source} onChange={setSource} />
            {state === 'out' && (
              <div className="row-gap">
                <label className="switch">
                  <input type="checkbox" role="switch" checked={onTour} onChange={(e) => setOnTour(e.target.checked)} aria-label="On tour today" />
                  <span className="switch-track" aria-hidden="true" />
                  <span className="small">On tour today</span>
                </label>
                <label className="switch">
                  <input type="checkbox" role="switch" checked={selfie} onChange={(e) => setSelfie(e.target.checked)} aria-label="Attach selfie" />
                  <span className="switch-track" aria-hidden="true" />
                  <span className="small">Attach selfie (simulated)</span>
                </label>
              </div>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" size="default" className="field-big-btn" loading={busy} icon={state === 'out' ? 'door-open' : 'check'} onClick={() => act(state === 'out' ? 'in' : 'out')} disabledReason={!d.consent ? 'Give location consent first' : undefined}>
              {state === 'out' ? 'Check in' : 'Check out'}
            </Button>
          </div>
        )}
      </section>

      <section className="stats" aria-label="Today">
        <Stat label="Visits today" value={d.visitsToday} sub="Log a visit at each customer" to="/visits" />
        <Stat label="Pending regularisations" value={d.pendingRegularisations} to="/regularisations" />
      </section>
      <div className="row-gap">
        <Button icon="door-open" onClick={() => navigate('/visits')}>
          Log a visit
        </Button>
        <Button icon="calendar-clock" onClick={() => setCreating('regularisations')}>
          Request regularisation
        </Button>
        <Button icon="calendar" onClick={() => setCreating('leaves')}>
          Apply for leave
        </Button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Last 7 days</h2>
        </div>
        {d.recent.length ? (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                  <th scope="col">In</th>
                  <th scope="col">Out</th>
                  <th scope="col">Worked</th>
                  <th scope="col">Late</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">
                      <Link to={`/attendance?peek=${r.id}`}>{formatDate(String(r.date))}</Link>
                    </td>
                    <td>{statusChip(r.status)}</td>
                    <td>{r.checkInAt ? time12(r.checkInAt) : <EmptyValue />}</td>
                    <td>{r.checkOutAt ? time12(r.checkOutAt) : <EmptyValue />}</td>
                    <td>{r.workMinutes !== null && r.workMinutes !== undefined ? fmtMinutes(r.workMinutes) : <EmptyValue />}</td>
                    <td>{Number(r.lateByMin) > 0 ? `${r.lateByMin} min` : <EmptyValue label="On time" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="calendar-clock" title="No attendance yet">
            Your check-ins appear here.
          </EmptyState>
        )}
      </section>
      {creating && <QuickCreateDialog open resKey={creating} onClose={() => setCreating(null)} onCreated={() => toast(creating === 'leaves' ? 'Leave applied — sent for approval' : 'Regularisation sent for approval')} />}
      {peek && <RecordInspector resKey="attendance" recordId={peek} onClose={() => setParams({})} />}
    </div>
  );
}

// ---------------------------------------------------------------- Team attendance (ATT-03)

export function TeamAttendancePage() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const peek = params.get('peek');
  const q = useServiceQuery(() => fieldApi.teamAttendance(actor, date), [actor.user.id, date]);
  const rows = q.data ?? [];
  const present = rows.filter((r) => r.record?.checkInAt).length;
  const late = rows.filter((r) => Number(r.record?.lateByMin) > 0).length;
  const leave = rows.filter((r) => r.record?.status === 'leave').length;
  return (
    <div className="page">
      <PageHeader title="Team attendance" description="Who checked in, when, for how long, late arrivals and early exits — per the shift policy. Scope follows your role (team, division or company)." />
      <div className="toolbar">
        <DatePicker value={date} onChange={(v) => setParams(v && v !== todayKey() ? { date: v } : {})} label="Date" clearable={false} />
        <Button icon="chevron-left" onClick={() => setParams({ date: addDays(date, -1) })}>
          Previous day
        </Button>
        <Button iconRight="chevron-right" onClick={() => setParams({ date: addDays(date, 1) })} disabledReason={date >= todayKey() ? 'Cannot look ahead' : undefined}>
          Next day
        </Button>
        <span className="spacer" />
        <Link to={`/attendance/exceptions?date=${date}`} className="link small">
          Exceptions for this day
        </Link>
      </div>
      {q.error ? (
        <ErrorState title="Could not load attendance" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="stats" aria-label="Summary">
            <Stat label="People" value={rows.length} />
            <Stat label="Checked in" value={present} sub={`${rows.length - present - leave} not checked in`} />
            <Stat label="Late" value={late} />
            <Stat label="On leave" value={leave} />
          </section>
          <div className="content-surface">
            {rows.length ? (
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Status</th>
                      <th scope="col">In</th>
                      <th scope="col">Out</th>
                      <th scope="col">Worked</th>
                      <th scope="col">Late by</th>
                      <th scope="col">Early exit</th>
                      <th scope="col">Place</th>
                      <th scope="col">Visits</th>
                      <th scope="col">Route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ employee, record, visits }) => (
                      <tr key={employee.id}>
                        <td>
                          <span className="row-gap">
                            <Avatar name={String(employee.fullName)} size={22} />
                            <span>
                              {String(employee.fullName)}
                              <div className="muted small">{String(employee.designation ?? '')}</div>
                            </span>
                          </span>
                        </td>
                        <td>{record ? statusChip(record.status) : <StatusChip label="Not checked in" tone="neutral" />}</td>
                        <td>{record?.checkInAt ? <button type="button" className="link" onClick={() => setParams({ ...(params.get('date') ? { date } : {}), peek: record.id })}>{time12(record.checkInAt)}</button> : <EmptyValue />}</td>
                        <td>{record?.checkOutAt ? time12(record.checkOutAt) : <EmptyValue />}</td>
                        <td>{record?.workMinutes ? fmtMinutes(record.workMinutes) : <EmptyValue />}</td>
                        <td className={cx(Number(record?.lateByMin) > 0 && 'text-danger')}>{Number(record?.lateByMin) > 0 ? `${record!.lateByMin} min` : <EmptyValue label="On time" />}</td>
                        <td>{Number(record?.earlyByMin) > 0 ? `${record!.earlyByMin} min` : <EmptyValue />}</td>
                        <td>{record?.checkInPlace ? String(record.checkInPlace) : <EmptyValue />}</td>
                        <td>{visits}</td>
                        <td>{record?.distanceKm ? <Link to={`/attendance/${employee.id}/route?date=${date}`}>{String(record.distanceKm)} km</Link> : <EmptyValue />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="users" title="No one in your scope">
                Team attendance lists the people who report to you.
              </EmptyState>
            )}
          </div>
        </>
      )}
      {peek && <RecordInspector resKey="attendance" recordId={peek} onClose={() => setParams(params.get('date') ? { date } : {})} />}
    </div>
  );
}

// ---------------------------------------------------------------- Exceptions (ATT-10)

type ExTab = 'all' | 'no_check_in' | 'late' | 'early_exit' | 'no_visits';
const EX_LABEL: Record<string, string> = { no_check_in: 'No check-in', late: 'Late', early_exit: 'Early exit', no_visits: 'No visits logged', mock_location: 'Mock location', not_checked_out: 'No check-out' };
const EX_TONE: Record<string, 'danger' | 'warning' | 'info'> = { no_check_in: 'danger', late: 'warning', early_exit: 'warning', no_visits: 'info', mock_location: 'danger', not_checked_out: 'warning' };

export function ExceptionsPage() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const [tab, setTab] = useState<ExTab>('all');
  const q = useServiceQuery(() => fieldApi.exceptions(actor, date), [actor.user.id, date]);
  const rows = (q.data ?? []).filter((r) => tab === 'all' || r.kind === tab);
  const count = (k: ExTab) => (q.data ?? []).filter((r) => k === 'all' || r.kind === k).length;
  return (
    <div className="page">
      <PageHeader title="Attendance exceptions" description="People with no check-in, late arrival, early exit or no visits logged on a day. Sundays are off." />
      <div className="toolbar">
        <DatePicker value={date} onChange={(v) => setParams(v && v !== todayKey() ? { date: v } : {})} label="Date" clearable={false} />
        <Button icon="chevron-left" onClick={() => setParams({ date: addDays(date, -1) })}>
          Previous day
        </Button>
        <span className="spacer" />
        <Link to={`/attendance/team${date !== todayKey() ? `?date=${date}` : ''}`} className="link small">
          Team attendance
        </Link>
      </div>
      <Tabs<ExTab>
        label="Exception type"
        value={tab}
        onChange={setTab}
        tabs={(['all', 'no_check_in', 'late', 'early_exit', 'no_visits'] as ExTab[]).map((id) => ({ id, label: id === 'all' ? 'All' : EX_LABEL[id], count: q.data ? count(id) : undefined }))}
      />
      <div className="content-surface">
        {q.error ? (
          <ErrorState title="Could not load exceptions" onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={6} />
        ) : rows.length ? (
          <ul className="flow-list">
            {rows.map((r, i) => (
              <li key={`${r.employee.id}-${r.kind}-${i}`} className="flow-item">
                <span className={`tag tone-${EX_TONE[r.kind]}`}>{EX_LABEL[r.kind]}</span>
                <span className="flow-main">
                  <span className="flow-title">{String(r.employee.fullName)}</span>
                  <span className="muted small">
                    {String(r.employee.designation ?? '')} · {r.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="check" title="No exceptions">
            Everyone in your scope is on track for {formatDate(date)}.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Route map (ATT-07, simulated)

export function RoutePage() {
  const actor = useActor();
  const navigate = useNavigate();
  const { staffId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const q = useServiceQuery(() => fieldApi.route(actor, staffId, date), [actor.user.id, staffId, date]);
  const header = <PageHeader title="Route" description="Positions captured between check-in and check-out (simulated tracking: check-in, each visit, check-out). No map tiles in the prototype — the route is drawn to scale." />;
  if (q.error)
    return (
      <div className="page">
        {header}
        <ErrorState title="Route unavailable" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        {header}
        <Skeleton rows={6} />
      </div>
    );
  const { employee, points, distanceKm, days } = q.data;
  return (
    <div className="page">
      {header}
      <div className="toolbar">
        <strong>{String(employee.fullName)}</strong>
        <DatePicker value={date} onChange={(v) => setParams(v ? { date: v } : {})} label="Date" clearable={false} />
        <span className="spacer" />
        <Button icon="chevron-left" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
      <section className="panel">
        {points.length > 1 ? (
          <>
            <RouteSvg points={points} />
            <p className="muted small">
              {points.length} positions · <strong>{distanceKm} km</strong> straight-line distance between positions (used for conveyance claims).
            </p>
            <ol className="plain-list">
              {points.map((p, i) => (
                <li key={i} className="small">
                  {i === 0 ? 'Check-in' : i === points.length - 1 ? 'Check-out' : `Stop ${i}`} · {p.at ? time12(p.at) : ''} · {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <EmptyState icon="activity" title="No route for this day">
            {days.length ? 'Pick one of the days with a tracked route below.' : 'Routes appear after a check-in and check-out.'}
          </EmptyState>
        )}
        {days.length > 0 && (
          <div className="row-gap">
            <span className="muted small">Days with a route:</span>
            {days.map((dk) => (
              <Button key={dk} size="compact" variant={dk === date ? 'primary' : 'ghost'} onClick={() => setParams({ date: dk })}>
                {formatDate(dk)}
              </Button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RouteSvg({ points }: { points: { lat: number; lng: number }[] }) {
  const W = 640;
  const H = 360;
  const pad = 24;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = Math.max(maxLat - minLat, maxLng - minLng, 0.002);
  const x = (lng: number) => pad + ((lng - minLng) / span) * (W - pad * 2);
  const y = (lat: number) => H - pad - ((lat - minLat) / span) * (H - pad * 2);
  const path = points.map((p) => `${x(p.lng).toFixed(1)},${y(p.lat).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="field-route" role="img" aria-label={`Route with ${points.length} positions`}>
      <polyline points={path} fill="none" stroke="var(--c-accent, #7c5cff)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.lng)} cy={y(p.lat)} r={i === 0 || i === points.length - 1 ? 7 : 5} fill={i === 0 ? 'var(--c-success, #16a34a)' : i === points.length - 1 ? 'var(--c-danger, #dc2626)' : 'var(--s-panel, #fff)'} stroke="var(--c-accent, #7c5cff)" strokeWidth="2" />
          <text x={x(p.lng) + 9} y={y(p.lat) - 9} fontSize="12" fill="currentColor">
            {i === 0 ? 'In' : i === points.length - 1 ? 'Out' : i}
          </text>
        </g>
      ))}
    </svg>
  );
}
