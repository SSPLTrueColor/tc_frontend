import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { errorMessage } from '../../../services/api/client';
import { loaders, serviceApi } from '../../../services/api/service';
import { can } from '../../../services/authz';
import { useActor } from '../../../services/hooks';
import { masterValue } from '../../../services/registry';
import { clockStates } from '../../../services/service/sla';
import { customerName } from '../../../services/service/tickets';
import { nowLocal, addDays, formatWeekday, todayKey } from '../../../lib/dates';
import { ServiceError } from '../../../services/types';
import { Button } from '../../../components/primitives/Button';
import { Badge, EmptyState, ErrorState, NoAccess, Skeleton, StatusChip, useToast } from '../../../components/primitives/feedback';
import { InfoTip } from '../../../components/primitives/InfoTip';
import { Dialog } from '../../../components/primitives/overlay';
import { PageHeader } from '../../../components/shell/PageHeader';
import { AssignDialog, clockText } from '../components/TicketExtensions';
import { L } from '../../../constants/labels';
import { resourcePath } from '../../../lib/routes';

const S = L.service;
const P = S.pages.engineerCalendar;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Engineer Calendar & Map (FR-079, SRV-05): unassigned queue with Suggest Engineer, engineer calendar and territory map. */
export function EngineerCalendarPage() {
  const actor = useActor();
  const q = useServiceQuery(loaders.board(actor), [actor.user.id]);
  const [assign, setAssign] = useState<string | null>(null);
  const [incoming, setIncoming] = useState(false);
  if (!can(actor, 'ticket.assign')) return <NoAccess what={P.noAccess} />;
  const today = todayKey();
  const header = (
    <PageHeader
      title={L.nav.pages.engineerCalendar.title}
      description={P.description}
      actions={
        <Button icon="message" onClick={() => setIncoming(true)}>
          {S.actions.incomingMessage}
        </Button>
      }
    />
  );
  return (
    <div className="page">
      {header}
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={10} />
      ) : (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{P.unassigned(q.data.unassigned.length)}</h2>
              <Link to={resourcePath(actor.workspaceId, 'tickets', { view: 'v_tkt_unassigned' })} className="link small">
                {S.actions.openList}
              </Link>
            </div>
            {q.data.unassigned.length ? (
              <ul className="flow-list">
                {q.data.unassigned.slice(0, 12).map((t) => {
                  const resp = clockStates(t, nowLocal()).find((c) => c.clock === 'response');
                  const pr = masterValue('ticketPriority', t.priority);
                  return (
                    <li key={t.id} className="flow-item">
                      {pr && <StatusChip label={pr.label.replace(' (machine down)', '')} tone={pr.tone} />}
                      <Link to={resourcePath(actor.workspaceId, 'tickets', { peek: t.id })} className="flow-main">
                        <span className="flow-title">
                          {t.id} · {customerName(t.customerId)}
                        </span>
                        <span className={`small ${resp && (resp.status === 'breached' || resp.status === 'at_risk') ? 'text-danger' : 'muted'}`}>
                          {P.responseIn(s(masterValue('division', t.divisionId)?.label), resp ? clockText(resp) : S.sla.chips.not_applicable)}
                        </span>
                      </Link>
                      <Button variant="primary" onClick={() => setAssign(t.id)}>
                        {S.actions.assignEngineer}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="check" title={P.allAssigned} />
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title dialog-title-row">
                {P.calendar}
                <InfoTip text={P.calendarTip} label={P.calendarTipLabel} />
              </h2>
            </div>
            {q.data.engineers.length ? (
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th scope="col">{P.colEngineer}</th>
                      <th scope="col">{P.colToday}</th>
                      <th scope="col" className="num">
                        {P.colOpen}
                      </th>
                      <th scope="col">
                        {P.colWeek} <span className="muted small">({formatWeekday(today)} →)</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.engineers.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <Link to={resourcePath(actor.workspaceId, 'employees', { peek: e.id })}>{e.name}</Link>
                          <div className="muted small">
                            {e.divisions.map((d) => masterValue('division', d)?.label ?? d).join(', ')} · {e.territories.map((t) => masterValue('territory', t)?.label ?? t).join(', ') || P.noTerritory}
                          </div>
                        </td>
                        <td>{e.onLeave ? <Badge tone="warning">{P.onLeave}</Badge> : e.checkedIn ? <Badge tone="success">{P.checkedIn}</Badge> : <span className="muted small">{P.notCheckedIn}</span>}</td>
                        <td className="num">
                          {e.open}
                          {e.critical > 0 && <Badge tone="danger">{P.critical(e.critical)}</Badge>}
                        </td>
                        <td>
                          <span className="svc-week" aria-label={P.weekAria(e.week.join(', '))}>
                            {e.week.map((n, i) => (
                              <span key={i} className={n ? 'has-jobs' : ''} data-tooltip={P.dayTip(formatWeekday(addDays(today, i)), n)}>
                                {n || ''}
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="users" title={P.noEngineers} />
            )}
          </section>

          <section className="panel span-all">
            <div className="panel-head">
              <h2 className="panel-title dialog-title-row">
                {P.map}
                <InfoTip text={P.mapTip} label={P.mapTipLabel} />
              </h2>
            </div>
            <div className="svc-grid">
              {q.data.territories.map((t) => (
                <Link key={t.key} to={resourcePath(actor.workspaceId, 'tickets', { view: 'v_tkt_open' })} className={`svc-tile${t.critical ? ' is-hot' : ''}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="svc-tile-title">{t.label}</span>
                  <span className="small">
                    {P.tile(t.open, t.unassigned)}
                    {t.critical ? P.tileCritical(t.critical) : ''}
                  </span>
                  <span className="muted small">{t.engineers.length ? t.engineers.join(', ') : P.noCover}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
      {assign && <AssignDialog ticketId={assign} onClose={() => setAssign(null)} />}
      {incoming && <IncomingDialog onClose={() => setIncoming(false)} />}
    </div>
  );
}

/** FR-075 simulated incoming WhatsApp / email → ticket (customer identified by mobile / email). */
function IncomingDialog({ onClose }: { onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [from, setFrom] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const t = await serviceApi.incoming(actor, { channel, from, message });
      toast(S.toasts.ticketLogged(t.id, S.incoming.channels[channel]));
      onClose();
    } catch (e) {
      setErrors(e instanceof ServiceError && e.fieldErrors ? { ...e.fieldErrors, form: e.message } : { form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={S.incoming.title}
      description={S.incoming.description}
      footer={
        <>
          <Button onClick={onClose}>{S.actions.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {S.actions.createTicket}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="segmented" role="radiogroup" aria-label={S.incoming.channel}>
          {(['whatsapp', 'email'] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={channel === c} className={`seg-btn${channel === c ? ' is-on' : ''}`} onClick={() => setChannel(c)}>
              {S.incoming.channels[c]}
            </button>
          ))}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="in-from">
            {channel === 'whatsapp' ? S.incoming.fromMobile : S.incoming.fromEmail} <span className="req">*</span>
          </label>
          <input id="in-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={channel === 'whatsapp' ? S.incoming.fromMobilePlaceholder : S.incoming.fromEmailPlaceholder} aria-invalid={!!errors.from || undefined} data-autofocus />
          {errors.from && <p className="field-error">{errors.from}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="in-msg">
            {S.incoming.message} <span className="req">*</span>
          </label>
          <textarea id="in-msg" className="input textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={S.incoming.messagePlaceholder} aria-invalid={!!errors.description || undefined} />
          {errors.description && <p className="field-error">{errors.description}</p>}
        </div>
        {errors.form && !errors.from && !errors.description && (
          <p className="field-error" role="alert">
            {errors.form}
          </p>
        )}
      </div>
    </Dialog>
  );
}

