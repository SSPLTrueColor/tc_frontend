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


/** FR-079: unassigned queue with suggestions, engineer workload calendar and territory grid. */
export function DispatchBoardPage() {
  const actor = useActor();
  const q = useServiceQuery(loaders.board(actor), [actor.user.id]);
  const [assign, setAssign] = useState<string | null>(null);
  const [incoming, setIncoming] = useState(false);
  if (!can(actor, 'ticket.assign')) return <NoAccess what="the dispatch board" />;
  const today = todayKey();
  const header = (
    <PageHeader
      title="Dispatch board"
      description="Assign open tickets with suggestions by skill, territory, workload and availability. Engineer calendar shows open jobs by on-site due date."
      actions={
        <Button icon="message" onClick={() => setIncoming(true)}>
          Incoming message…
        </Button>
      }
    />
  );
  return (
    <div className="page">
      {header}
      {q.error ? (
        <ErrorState title="Could not load the dispatch board" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={10} />
      ) : (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Unassigned ({q.data.unassigned.length})</h2>
              <Link to="/tickets?view=v_tkt_unassigned" className="link small">
                Open list
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
                      <Link to={`/tickets?peek=${t.id}`} className="flow-main">
                        <span className="flow-title">
                          {t.id} · {customerName(t.customerId)}
                        </span>
                        <span className={`small ${resp && (resp.status === 'breached' || resp.status === 'at_risk') ? 'text-danger' : 'muted'}`}>
                          {masterValue('division', t.divisionId)?.label} · response {resp ? clockText(resp) : 'N/A'}
                        </span>
                      </Link>
                      <Button variant="primary" onClick={() => setAssign(t.id)}>
                        Assign
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="check" title="Every open ticket has an engineer" />
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title dialog-title-row">
                Engineers
                <InfoTip text="Open jobs per engineer; the 7 squares are the next 7 days by on-site due date." label="About engineer workload" />
              </h2>
            </div>
            {q.data.engineers.length ? (
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th scope="col">Engineer</th>
                      <th scope="col">Today</th>
                      <th scope="col" className="num">
                        Open
                      </th>
                      <th scope="col">
                        Next 7 days <span className="muted small">({formatWeekday(today)} →)</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.engineers.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <Link to={`/employees?peek=${e.id}`}>{e.name}</Link>
                          <div className="muted small">
                            {e.divisions.map((d) => masterValue('division', d)?.label ?? d).join(', ')} · {e.territories.map((t) => masterValue('territory', t)?.label ?? t).join(', ') || 'No territory'}
                          </div>
                        </td>
                        <td>{e.onLeave ? <Badge tone="warning">On leave</Badge> : e.checkedIn ? <Badge tone="success">Checked in</Badge> : <span className="muted small">Not checked in</span>}</td>
                        <td className="num">
                          {e.open}
                          {e.critical > 0 && <Badge tone="danger">{e.critical} critical</Badge>}
                        </td>
                        <td>
                          <span className="svc-week" aria-label={`Open jobs next 7 days: ${e.week.join(', ')}`}>
                            {e.week.map((n, i) => (
                              <span key={i} className={n ? 'has-jobs' : ''} data-tooltip={`${formatWeekday(addDays(today, i))}: ${n} job${n === 1 ? '' : 's'}`}>
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
              <EmptyState icon="users" title="No engineers in your divisions" />
            )}
          </section>

          <section className="panel span-all">
            <div className="panel-head">
              <h2 className="panel-title dialog-title-row">
                Territory map
                <InfoTip text="Open tickets by the customer’s territory and the engineers who cover it (map tiles are not part of this prototype)." label="About the territory map" />
              </h2>
            </div>
            <div className="svc-grid">
              {q.data.territories.map((t) => (
                <Link key={t.key} to="/tickets?view=v_tkt_open" className={`svc-tile${t.critical ? ' is-hot' : ''}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="svc-tile-title">{t.label}</span>
                  <span className="small">
                    {t.open} open · {t.unassigned} unassigned{t.critical ? ` · ${t.critical} critical` : ''}
                  </span>
                  <span className="muted small">{t.engineers.length ? t.engineers.join(', ') : 'No engineer covers this territory'}</span>
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
      toast(`Ticket ${t.id} logged from ${channel === 'whatsapp' ? 'WhatsApp' : 'email'}`);
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
      title="Simulate an incoming message"
      description="In the live system WhatsApp Business and email-to-ticket create tickets automatically. Here you type the message the customer would send."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Create ticket
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="segmented" role="radiogroup" aria-label="Channel">
          {(['whatsapp', 'email'] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={channel === c} className={`seg-btn${channel === c ? ' is-on' : ''}`} onClick={() => setChannel(c)}>
              {c === 'whatsapp' ? 'WhatsApp' : 'Email'}
            </button>
          ))}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="in-from">
            {channel === 'whatsapp' ? 'From mobile' : 'From email'} <span className="req">*</span>
          </label>
          <input id="in-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={channel === 'whatsapp' ? 'Registered contact mobile' : 'Registered contact email'} aria-invalid={!!errors.from || undefined} data-autofocus />
          {errors.from && <p className="field-error">{errors.from}</p>}
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="in-msg">
            Message <span className="req">*</span>
          </label>
          <textarea id="in-msg" className="input textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Printer stopped, head error on TX-1800" aria-invalid={!!errors.description || undefined} />
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

