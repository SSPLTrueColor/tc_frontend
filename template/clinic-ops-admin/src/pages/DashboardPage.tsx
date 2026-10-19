import { Link, useNavigate } from 'react-router-dom';
import { addDays, addMinutes, formatTime, formatWeekday, todayKey, toLocalDateTime } from '../lib/dates';
import { formatMoney, pct } from '../lib/format';
import { recordPeekPath, resourcePath, wsBase } from '../lib/routes';
import { can, canReadResource, fieldAccess } from '../services/authz';
import { getDb } from '../services/db';
import { encodeFilter, newCondition, newGroup } from '../services/filter';
import { useActor, useRevision } from '../services/hooks';
import { getResource, masterValue } from '../services/registry';
import { availableTransitions, queryRecords, recordTitle, transitionRecord } from '../services/runtime';
import { ServiceError } from '../services/types';
import { listApprovals } from '../services/workflow';
import { Button } from '../components/primitives/Button';
import { EmptyState, StatusChip, useToast } from '../components/primitives/feedback';
import { BarChart } from '../components/resource/BarChart';
import { PageHeader } from '../components/shell/PageHeader';
import { InfoTip } from '../components/primitives/InfoTip';

const ACTIVE = ['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed'];

function Stat({ label, value, sub, to }: { label: string; value: string | number; sub?: string; to?: string }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  );
  return to ? (
    <Link className="stat" to={to}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

export function DashboardPage() {
  useRevision();
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const today = todayKey();
  const ws = actor.workspaceId;
  const nowLocal = toLocalDateTime(new Date());
  const canAppts = canReadResource(actor, 'appointments');
  const appts = canAppts ? queryRecords(actor, 'appointments', { sort: [{ field: 'start', dir: 'asc' }] }).rows : [];
  const todays = appts.filter((a) => String(a.start).startsWith(today));
  const todaysActive = todays.filter((a) => ACTIVE.includes(String(a.status)));
  const waiting = todays.filter((a) => a.status === 'checked_in');
  const noShows7 = appts.filter((a) => a.status === 'no_show' && String(a.start) >= addDays(today, -7) && String(a.start) < today).length;

  const invRes = canReadResource(actor, 'invoices') ? getResource('invoices') : null;
  const financeVisible = !!invRes && ['view', 'edit'].includes(fieldAccess(actor, invRes, invRes.fields.find((f) => f.key === 'balance')!));
  const openInv = invRes ? queryRecords(actor, 'invoices', {}).rows.filter((i) => ['issued', 'partially_paid'].includes(String(i.status))) : [];
  const openBalance = financeVisible ? openInv.reduce((s, i) => s + (Number(i.balance) || 0), 0) : 0;
  const overdue = openInv.filter((i) => String(i.dueDate) < today);

  const refs = canReadResource(actor, 'referrals') ? queryRecords(actor, 'referrals', {}).rows.filter((r) => ['received', 'in_review'].includes(String(r.status))) : [];
  const refsDue = refs.filter((r) => String(r.dueBy) <= addDays(today, 3));
  const myTasks = queryRecords(actor, 'tasks', { where: { assigneeId: actor.staffId } }).rows.filter((t) => t.status !== 'done');
  const approvals = listApprovals(actor).filter((a) => a.status === 'pending');

  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => ({
    key: d,
    label: formatWeekday(d).split(',')[0],
    value: appts.filter((a) => String(a.start).startsWith(d) && ACTIVE.includes(String(a.status))).length,
  }));

  const rooms = canReadResource(actor, 'rooms') ? getDb().records.rooms.filter((r) => r.workspaceId === ws && r.roomType !== 'telehealth') : [];
  const DAY_MIN = 10 * 60;
  const util = rooms.map((r) => {
    const booked = getDb()
      .records.appointments.filter((a) => a.workspaceId === ws && a.roomId === r.id && String(a.start).startsWith(today) && ACTIVE.includes(String(a.status)))
      .reduce((s, a) => s + Number(a.durationMin), 0);
    return { id: r.id, name: String(r.name), status: String(r.status), ratio: Math.min(1, booked / DAY_MIN), minutes: booked };
  });

  const upcoming = todays.filter((a) => ['scheduled', 'confirmed', 'checked_in', 'in_progress'].includes(String(a.status)) && addMinutes(String(a.start), Number(a.durationMin)) >= nowLocal).slice(0, 8);
  const todayFilter = encodeFilter({ ...newGroup('and'), children: [newCondition('start', 'today')] });

  return (
    <div className="page">
      <PageHeader title={`Good day, ${actor.user.name.replace('Dr. ', '').split(' ')[0]}`} description={`${actor.role.label} overview · figures computed from local synthetic data, refreshed on every change.`} crumbs={[{ label: 'Overview' }]} />
      <section className="stats" aria-label="Key figures">
        {canAppts && <Stat label={actor.role.resources.appointments.read === 'own' ? 'My appointments today' : 'Appointments today'} value={todaysActive.length} sub={`${todays.filter((a) => a.status === 'completed').length} completed`} to={resourcePath(ws, 'appointments', { view: 'v_appts_today' })} />}
        {canAppts && <Stat label="Waiting (checked in)" value={waiting.length} sub={waiting[0] ? `Longest since ${formatTime(String(waiting[0].start))}` : 'No one waiting'} to={resourcePath(ws, 'appointments', { view: 'v_appts_board' })} />}
        {canAppts && <Stat label="No-shows, last 7 days" value={noShows7} />}
        {financeVisible && <Stat label="Open balance" value={formatMoney(openBalance)} sub={`${overdue.length} overdue invoice(s)`} to={resourcePath(ws, 'invoices', { view: 'v_inv_overdue' })} />}
        {refs.length > 0 && <Stat label="Referrals due ≤ 3 days" value={refsDue.length} sub={`${refs.length} open`} to={resourcePath(ws, 'referrals', { view: 'v_ref_open' })} />}
        <Stat label="My open tasks" value={myTasks.length} sub={myTasks.filter((t) => String(t.dueDate) < today).length ? `${myTasks.filter((t) => String(t.dueDate) < today).length} overdue` : 'None overdue'} to={resourcePath(ws, 'tasks', { view: 'v_tasks_open' })} />
        {can(actor, 'approve.writeoff') && <Stat label="Approvals pending" value={approvals.length} to={`${wsBase(ws)}/work/inbox?tab=approvals`} />}
      </section>

      <div className="dash-grid">
        {canAppts && (
          <section className="panel">
            <BarChart
              data={week}
              label="Booked appointments, next 7 days"
              unit="appointments"
              onSelect={(d) => navigate(`${wsBase(ws)}/scheduling/schedule?date=${d}`)}
            />
          </section>
        )}
        {canAppts && (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Today’s flow</h2>
              <Link to={resourcePath(ws, 'appointments', { view: 'v_appts_today', f: todayFilter })} className="link small">
                All today
              </Link>
            </div>
            {upcoming.length ? (
              <ul className="flow-list">
                {upcoming.map((a) => {
                  const mv = masterValue('appointmentStatus', a.status);
                  const next = availableTransitions(actor, getResource('appointments'), a).find((t) => !t.disabledReason && !t.confirm);
                  return (
                    <li key={a.id} className="flow-item">
                      <span className="flow-time">{formatTime(String(a.start))}</span>
                      <Link to={recordPeekPath(ws, 'appointments', a.id)} className="flow-main">
                        <span className="flow-title">{recordTitle('patients', a.patientId, actor)}</span>
                        <span className="muted small">
                          {recordTitle('staff', a.clinicianId, actor)} · {a.roomId ? recordTitle('rooms', a.roomId, actor) : 'Telehealth'}
                        </span>
                      </Link>
                      {mv && <StatusChip label={mv.label} tone={mv.tone} />}
                      {next && (
                        <Button
                          onClick={() => {
                            try {
                              transitionRecord(actor, 'appointments', a.id, next.to, a.version);
                              toast(`${a.id}: ${next.action}`);
                            } catch (e) {
                              toast(e instanceof ServiceError ? e.message : 'Failed', 'danger');
                            }
                          }}
                        >
                          {next.action}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="calendar" title="Nothing else today">
                Remaining appointments will appear here.
              </EmptyState>
            )}
          </section>
        )}
        {util.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title dialog-title-row">
                Room utilization today
                <InfoTip text="Booked minutes ÷ 10 opening hours. Cancelled and no-show bookings excluded." label="About room utilization" />
              </h2>
              <Link to={`${wsBase(ws)}/scheduling/schedule`} className="link small">
                Day schedule
              </Link>
            </div>
            <ul className="util-list">
              {util.map((u) => (
                <li key={u.id} className="util-item">
                  <span className="util-name">{u.name}</span>
                  {u.status !== 'available' ? (
                    <span className="tag tone-warning">{u.status.replace(/_/g, ' ')}</span>
                  ) : (
                    <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.ratio * 100)} aria-label={`${u.name} utilization`}>
                      <span className="meter-track">
                        <span className="meter-fill" style={{ width: `${u.ratio * 100}%` }} />
                      </span>
                      <span className="meter-text">
                        {pct(u.ratio)} · {Math.round(u.minutes / 60 * 10) / 10}h
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {(financeVisible || refs.length > 0) && (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Needs attention</h2>
            </div>
            <ul className="flow-list">
              {overdue.slice(0, 4).map((i) => (
                <li key={i.id} className="flow-item">
                  <span className="tag tone-danger">Overdue</span>
                  <Link to={recordPeekPath(ws, 'invoices', i.id)} className="flow-main">
                    <span className="flow-title">
                      {i.id} · {recordTitle('patients', i.patientId, actor)}
                    </span>
                    <span className="muted small">{financeVisible ? formatMoney(Number(i.balance)) : ''} due</span>
                  </Link>
                </li>
              ))}
              {refsDue.slice(0, 4).map((r) => (
                <li key={r.id} className="flow-item">
                  <span className="tag tone-warning">Referral</span>
                  <Link to={recordPeekPath(ws, 'referrals', r.id)} className="flow-main">
                    <span className="flow-title">
                      {r.id} · {recordTitle('patients', r.patientId, actor)}
                    </span>
                    <span className="muted small">Book by {String(r.dueBy)}</span>
                  </Link>
                </li>
              ))}
              {!overdue.length && !refsDue.length && <li className="muted">Nothing urgent.</li>}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
