import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDate, relativeTime, todayKey } from '../lib/dates';
import { cx } from '../lib/format';
import { recordPeekPath, resourceKeyFromParams, resourcePath } from '../lib/routes';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { perm } from '../services/authz';
import { getDb } from '../services/db';
import { listNotifications, markAllRead, markNotification, snoozeNotification } from '../services/collab';
import { useActor, useRevision } from '../services/hooks';
import { getResource, getUser } from '../services/registry';
import { queryRecords, transitionRecord } from '../services/runtime';
import { ServiceError } from '../services/types';
import { approvalTypeLabel, canDecide, decideApproval, levelHolders, listApprovals, withdrawApproval } from '../services/workflow';
import { Button } from '../components/primitives/Button';
import { EmptyState, ErrorState, NoAccess, Skeleton, StatusChip, Tabs, useToast } from '../components/primitives/feedback';
import { Dialog } from '../components/primitives/overlay';
import { ConflictPanel, FormBody, useRecordForm, useUnsavedGuard } from '../components/resource/RecordForm';
import { PageHeader } from '../components/shell/PageHeader';
import { InfoTip } from '../components/primitives/InfoTip';

// ---------------------------------------------------------------- Work inbox

type InboxTab = 'notifications' | 'approvals' | 'tasks';

export function InboxPage() {
  useRevision();
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const tab = (params.get('tab') as InboxTab) || 'notifications';
  const inbox = useServiceQuery(
    () => ({
      notifications: listNotifications(actor),
      approvals: listApprovals(actor),
      tasks: queryRecords(actor, 'tasks', { where: { assigneeId: actor.staffId }, sort: [{ field: 'dueDate', dir: 'asc' }] }).rows.filter((t) => t.status === 'todo' || t.status === 'in_progress'),
    }),
    [actor.user.id],
  );
  const [deciding, setDeciding] = useState<{ id: string; decision: 'approved' | 'rejected' } | null>(null);
  const { notifications = [], approvals = [], tasks = [] } = inbox.data ?? {};

  return (
    <div className="page">
      <PageHeader title="Work inbox" description="Notifications, formal approvals and your tasks are separate: each has its own owner and outcome." />
      <Tabs<InboxTab>
        label="Inbox sections"
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { id: 'notifications', label: 'Notifications', count: notifications.filter((n) => !n.readAt).length },
          { id: 'approvals', label: 'Approvals', count: approvals.filter((a) => a.status === 'pending').length },
          { id: 'tasks', label: 'My tasks', count: tasks.length },
        ]}
      />
      <div className="content-surface inbox" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {inbox.error && (
          <ErrorState title="Could not load your inbox" onRetry={inbox.retry}>
            {inbox.error}
          </ErrorState>
        )}
        {!inbox.data && !inbox.error && <Skeleton rows={6} />}
        {inbox.data && tab === 'notifications' && (
          <>
            <div className="toolbar">
              <InfoTip text="Marking read only changes delivery state — it never approves or completes anything." label="About notifications" />
              <span className="spacer" />
              <Button onClick={() => markAllRead(actor)}>Mark all read</Button>
            </div>
            {notifications.length ? (
              <ul className="inbox-list">
                {notifications.map((n) => (
                  <li key={n.id} className={cx('inbox-item', !n.readAt && 'is-unread')}>
                    {!n.readAt && <span className="unread-dot" aria-label="Unread" />}
                    <div className="inbox-main">
                      <span className="inbox-title">{n.title}</span>
                      <span className="muted small">
                        {n.kind.replace('_', ' ')} · {relativeTime(n.createdAt)}
                      </span>
                    </div>
                    {n.link && (
                      <Button
                        onClick={() => {
                          markNotification(actor, n.id, true);
                          const link = n.link!;
                          if ('page' in link) {
                            if (link.page === 'inbox') setParams({ tab: 'approvals' });
                            else navigate(`/${link.page}`);
                          }
                          else navigate(recordPeekPath(actor.workspaceId, link.resource, link.recordId));
                        }}
                      >
                        Open
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => markNotification(actor, n.id, !n.readAt)}>
                      {n.readAt ? 'Mark unread' : 'Mark read'}
                    </Button>
                    <Button variant="ghost" onClick={() => snoozeNotification(actor, n.id, 4)}>
                      Snooze 4h
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="bell" title="No notifications" />
            )}
          </>
        )}
        {inbox.data && tab === 'approvals' && (
          <>
            {approvals.length ? (
              <ul className="inbox-list">
                {approvals.map((a) => {
                  const mine = canDecide(actor, a);
                  const level = a.levels[a.currentLevel];
                  return (
                    <li key={a.id} className="inbox-item approval">
                      <div className="inbox-main">
                        <span className="inbox-title">
                          {a.id} · {approvalTypeLabel(a.type)} ·{' '}
                          <Link to={recordPeekPath(actor.workspaceId, a.resource, a.recordId)} className="rel-link">
                            {a.summary}
                          </Link>
                        </span>
                        {a.reason && <span className="small">“{a.reason}”</span>}
                        <span className="muted small">
                          Requested by {getUser(a.requestedBy)?.name} · {relativeTime(a.requestedAt)}
                          {a.status === 'pending' && level && ` · Level ${a.currentLevel + 1} of ${a.levels.length}: ${level.label} (${levelHolders(level.capability).join(' / ')})`}
                          {a.decidedBy && ` · ${a.status} by ${getUser(a.decidedBy)?.name}${a.decisionNote ? ` — “${a.decisionNote}”` : ''}`}
                        </span>
                      </div>
                      <StatusChip label={a.status[0].toUpperCase() + a.status.slice(1)} tone={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'neutral'} />
                      {mine && (
                        <>
                          <Button variant="primary" onClick={() => setDeciding({ id: a.id, decision: 'approved' })}>
                            Approve
                          </Button>
                          <Button onClick={() => setDeciding({ id: a.id, decision: 'rejected' })}>Reject</Button>
                        </>
                      )}
                      {a.status === 'pending' && a.requestedBy === actor.user.id && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            try {
                              withdrawApproval(actor, a.id);
                              toast(`${a.id} withdrawn`);
                            } catch (e) {
                              toast(e instanceof ServiceError ? e.message : 'Failed', 'danger');
                            }
                          }}
                        >
                          Withdraw
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="check" title="No approval requests">
                Requests you raise and requests waiting for your decision appear here.
              </EmptyState>
            )}
          </>
        )}
        {inbox.data && tab === 'tasks' && (
          <>
            {tasks.length ? (
              <ul className="inbox-list">
                {tasks.map((t) => (
                  <li key={t.id} className="inbox-item">
                    <div className="inbox-main">
                      <Link to={recordPeekPath(actor.workspaceId, 'tasks', t.id)} className="inbox-title rel-link">
                        {t.title as string}
                      </Link>
                      <span className={cx('small', String(t.dueDate) < todayKey() ? 'text-danger' : 'muted')}>
                        Due {formatDate(String(t.dueDate))} {t.relatedLabel ? `· ${t.relatedLabel}` : ''}
                      </span>
                    </div>
                    <Button
                      onClick={() => {
                        try {
                          transitionRecord(actor, 'tasks', t.id, 'done', t.version);
                          toast(`${t.id} completed`);
                        } catch (e) {
                          toast(e instanceof ServiceError ? e.message : 'Failed', 'danger');
                        }
                      }}
                    >
                      Complete task
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="check-square" title="No open tasks assigned to you" />
            )}
          </>
        )}
      </div>
      {deciding && <DecisionDialog approvalId={deciding.id} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function DecisionDialog({ approvalId, decision, onClose }: { approvalId: string; decision: 'approved' | 'rejected'; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const a = getDb().approvals.find((x) => x.id === approvalId)!;
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`${decision === 'approved' ? 'Approve' : 'Reject'} ${approvalId}?`}
      description={
        decision === 'approved'
          ? a.currentLevel < a.levels.length - 1
            ? `Approves level ${a.currentLevel + 1}; the request then goes to ${a.levels[a.currentLevel + 1].label}. The decision is audited.`
            : `Final approval for ${a.summary}. The decision is audited and the requester is notified.`
          : 'The request is closed as rejected and the requester is notified with your note.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={decision === 'approved' ? 'primary' : 'danger'}
            onClick={() => {
              try {
                decideApproval(actor, approvalId, decision, note, a.version);
                toast(`${approvalId} ${decision}`);
                onClose();
              } catch (e) {
                setError(e instanceof ServiceError ? e.message : 'Failed');
              }
            }}
          >
            {decision === 'approved' ? 'Approve' : 'Reject request'}
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="decision-note">
          Note {decision === 'rejected' ? <span className="req">*</span> : <span className="optional">(optional)</span>}
        </label>
        <textarea id="decision-note" className="input textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Full-page form (line-item documents)

export function FullPageFormPage() {
  const params = useParams();
  const resource = resourceKeyFromParams(params);
  const recordId = params.recordId;
  const actor = useActor();
  const res = getResource(resource);
  if (recordId) {
    const raw = getDb().records[resource]?.find((r) => r.id === recordId);
    if (!raw) return <ErrorState title="Record not found" />;
    if (res.lifecycle?.terminal.includes(String(raw[res.lifecycle.field]))) return <ErrorState title="Not editable">This {res.label.toLowerCase()} is closed and locked for audit.</ErrorState>;
  } else if (!perm(actor, resource).create) return <NoAccess what={`creating ${res.labelPlural.toLowerCase()}`} />;
  return <FullPageForm resKey={resource} recordId={recordId} />;
}

function FullPageForm({ resKey, recordId }: { resKey: string; recordId?: string }) {
  const form = useRecordForm({ resKey, recordId });
  const navigate = useNavigate();
  const toast = useToast();
  const back = recordId ? recordPeekPath('tc', resKey, recordId) : resourcePath('tc', resKey);
  const guard = useUnsavedGuard(form.dirty, () => navigate(back));
  useEffect(() => {
    if (!form.dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [form.dirty]);
  const save = async (issue: boolean) => {
    const out = await form.submit();
    if (!out) return;
    if (issue && form.res.lifecycle) {
      try {
        transitionRecord(form.actor, resKey, out.record.id, 'issued', out.record.version);
      } catch (e) {
        toast(e instanceof ServiceError ? e.message : 'Saved, but could not issue', 'danger');
      }
    }
    toast(`${out.record.id} ${issue ? 'saved and issued' : 'saved as draft'}`);
    navigate(recordPeekPath('tc', resKey, out.record.id));
  };
  return (
    <div className="page">
      <PageHeader
        title={recordId ? `Edit ${form.res.label.toLowerCase()} ${recordId}` : `New ${form.res.label.toLowerCase()}`}
        description="Full-page editor. Totals are calculated; payments are recorded separately after issuing."
        onBack={guard.requestClose}
      />
      <div className="full-form panel">
        <FormBody form={form}>
          <ConflictPanel form={form} onOverride={() => void save(false)} />
        </FormBody>
        <div className="full-form-bar">
          <Button onClick={guard.requestClose}>Cancel</Button>
          <span className="spacer" />
          <Button loading={form.submitting} onClick={() => void save(false)}>
            Save draft
          </Button>
          {form.res.lifecycle && (
            <Button variant="primary" loading={form.submitting} onClick={() => void save(true)}>
              Save & issue
            </Button>
          )}
        </div>
      </div>
      {guard.dialog}
    </div>
  );
}
