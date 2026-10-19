import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { relativeTime, todayKey } from '../lib/dates';
import { cx, formatMoney } from '../lib/format';
import { pagePath, recordPeekPath, wsBase } from '../lib/routes';
import { can, perm } from '../services/authz';
import { getDb } from '../services/db';
import { listNotifications, markAllRead, markNotification, snoozeNotification } from '../services/collab';
import { useActor, useRevision } from '../services/hooks';
import { getResource, getUser } from '../services/registry';
import { queryRecords, transitionRecord } from '../services/runtime';
import { ServiceError } from '../services/types';
import { decideApproval, listApprovals } from '../services/workflow';
import { Button } from '../components/primitives/Button';
import { EmptyState, ErrorState, InlineAlert, NoAccess, StatusChip, Tabs, useToast } from '../components/primitives/feedback';
import { Dialog } from '../components/primitives/overlay';
import { CalendarView } from '../components/resource/CalendarView';
import { ConflictPanel, FormBody, QuickCreateDialog, useRecordForm, useUnsavedGuard } from '../components/resource/RecordForm';
import { RecordInspector } from '../components/resource/RecordInspector';
import { PageHeader } from '../components/shell/PageHeader';
import { InfoTip } from '../components/primitives/InfoTip';

// ---------------------------------------------------------------- Day schedule

export function SchedulePage() {
  useRevision();
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState<Record<string, unknown> | null>(null);
  const date = params.get('date') ?? todayKey();
  const peek = params.get('peek') ?? undefined;
  const res = getResource('appointments');
  if (perm(actor, 'appointments').read === 'none') return <NoAccess what="the schedule" />;
  const rows = queryRecords(actor, 'appointments', {}).rows;
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };
  return (
    <div className={cx('page page-resource', peek && 'has-inspector')}>
      <div className="page-main">
        <PageHeader
          title="Day schedule"
          description={actor.role.resources.appointments.read === 'own' ? 'Your bookings only (your role sees its own schedule).' : 'Rooms and clinicians for the selected day. Click a free slot to book.'}
          crumbs={[{ label: 'Scheduling' }, { label: 'Day schedule' }]}
          actions={
            <Button variant="primary" icon="plus" onClick={() => setCreating({})} disabledReason={perm(actor, 'appointments').create ? undefined : `${actor.role.label} cannot book appointments`}>
              New appointment
            </Button>
          }
        />
        <div className="content-surface">
          <CalendarView
            res={res}
            actor={actor}
            rows={rows}
            date={date}
            onDateChange={(d) => set({ date: d === todayKey() ? undefined : d })}
            onOpen={(id) => set({ peek: id })}
            activeId={peek}
            onCreateAt={perm(actor, 'appointments').create ? (v) => setCreating(v) : undefined}
          />
        </div>
      </div>
      {peek && <RecordInspector resKey="appointments" recordId={peek} onClose={() => set({ peek: undefined })} />}
      <QuickCreateDialog open={!!creating} resKey="appointments" initial={creating ?? undefined} onClose={() => setCreating(null)} onCreated={(r) => set({ peek: r.id, date: String(r.start).slice(0, 10) === todayKey() ? undefined : String(r.start).slice(0, 10) })} />
    </div>
  );
}

// ---------------------------------------------------------------- Work inbox

type InboxTab = 'notifications' | 'approvals' | 'tasks';

export function InboxPage() {
  useRevision();
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const tab = (params.get('tab') as InboxTab) || 'notifications';
  const notifications = listNotifications(actor);
  const approvals = listApprovals(actor);
  const tasks = queryRecords(actor, 'tasks', { where: { assigneeId: actor.staffId }, sort: [{ field: 'dueDate', dir: 'asc' }] }).rows.filter((t) => t.status !== 'done');
  const [deciding, setDeciding] = useState<{ id: string; decision: 'approved' | 'rejected' } | null>(null);

  return (
    <div className="page">
      <PageHeader title="Work inbox" description="Notifications, formal approvals and your tasks are separate: each has its own owner and outcome." crumbs={[{ label: 'Work' }, { label: 'Inbox' }]} />
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
        {tab === 'notifications' && (
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
                          if ('page' in link) navigate(link.page === 'inbox' ? `${pagePath(actor.workspaceId, 'work', 'inbox')}?tab=approvals` : pagePath(actor.workspaceId, link.page === 'schedule' ? 'scheduling' : 'work', link.page));
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
        {tab === 'approvals' && (
          <>
            {!can(actor, 'approve.writeoff') && <InlineAlert tone="info">You can see requests you submitted. Only practice managers decide write-offs, and never their own requests.</InlineAlert>}
            {approvals.length ? (
              <ul className="inbox-list">
                {approvals.map((a) => (
                  <li key={a.id} className="inbox-item approval">
                    <div className="inbox-main">
                      <span className="inbox-title">
                        {a.id} · Write-off {formatMoney(a.amount)} on{' '}
                        <Link to={recordPeekPath(actor.workspaceId, 'invoices', a.recordId)} className="rel-link">
                          {a.recordId}
                        </Link>
                      </span>
                      <span className="small">“{a.reason}”</span>
                      <span className="muted small">
                        Requested by {getUser(a.requestedBy)?.name} · {relativeTime(a.requestedAt)}
                        {a.decidedBy && ` · ${a.status} by ${getUser(a.decidedBy)?.name}${a.decisionNote ? ` — “${a.decisionNote}”` : ''}`}
                      </span>
                    </div>
                    <StatusChip label={a.status[0].toUpperCase() + a.status.slice(1)} tone={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : 'neutral'} />
                    {a.status === 'pending' && can(actor, 'approve.writeoff') && (
                      <>
                        <Button variant="primary" onClick={() => setDeciding({ id: a.id, decision: 'approved' })} disabledReason={a.requestedBy === actor.user.id ? 'Separation of duties: you requested this' : undefined}>
                          Approve
                        </Button>
                        <Button onClick={() => setDeciding({ id: a.id, decision: 'rejected' })} disabledReason={a.requestedBy === actor.user.id ? 'Separation of duties: you requested this' : undefined}>
                          Reject
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="check" title="No approval requests" />
            )}
          </>
        )}
        {tab === 'tasks' && (
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
                        Due {String(t.dueDate)} {t.relatedLabel ? `· ${t.relatedLabel}` : ''}
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
      description={decision === 'approved' ? `The invoice ${a.recordId} will be marked “Written off” by the workflow and the decision audited.` : 'The invoice stays open. The requester is notified.'}
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
            {decision === 'approved' ? 'Approve write-off' : 'Reject request'}
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

/** Personal URL alias: /u/:userSlug/my-work resolves to the actor's permitted inbox, never another user's. */
export function MyWorkRedirect() {
  const { userSlug } = useParams();
  const actor = useActor();
  if (userSlug !== actor.user.id) {
    return (
      <div className="page">
        <ErrorState title="Link not available">This personal link belongs to another user. Personal links never grant access to someone else’s work.</ErrorState>
        <p className="center">
          <Link to={`/u/${actor.user.id}/my-work`}>Go to my work</Link>
        </p>
      </div>
    );
  }
  return <Navigate to={`${pagePath(actor.workspaceId, 'work', 'inbox')}?tab=tasks`} replace />;
}

// ---------------------------------------------------------------- Full-page form (invoices)

export function FullPageFormPage() {
  const { resource = '', recordId } = useParams();
  const actor = useActor();
  const res = getResource(resource);
  if (recordId) {
    const raw = getDb().records[resource]?.find((r) => r.id === recordId);
    if (!raw) return <ErrorState title="Record not found" />;
    if (res.key === 'invoices' && raw.status !== 'draft') return <ErrorState title="Not editable">Only draft invoices can have their line items changed. Issued invoices are locked for audit.</ErrorState>;
  } else if (!perm(actor, resource).create) return <NoAccess what={`creating ${res.labelPlural.toLowerCase()}`} />;
  return <FullPageForm resKey={resource} recordId={recordId} />;
}

function FullPageForm({ resKey, recordId }: { resKey: string; recordId?: string }) {
  const form = useRecordForm({ resKey, recordId });
  const navigate = useNavigate();
  const toast = useToast();
  const back = `${wsBase(form.actor.workspaceId)}/${form.res.module}/${resKey}${recordId ? `?peek=${recordId}` : ''}`;
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
    navigate(`${wsBase(form.actor.workspaceId)}/${form.res.module}/${resKey}?peek=${out.record.id}`);
  };
  return (
    <div className="page">
      <PageHeader
        title={recordId ? `Edit ${form.res.label.toLowerCase()} ${recordId}` : `New ${form.res.label.toLowerCase()}`}
        description="Full-page editor. Totals are calculated; payments are recorded separately after issuing."
        crumbs={[{ label: form.res.labelPlural, to: back }, { label: recordId ?? 'New' }]}
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
