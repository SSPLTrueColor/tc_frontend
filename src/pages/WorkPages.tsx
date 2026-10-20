import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDate, relativeTime, todayKey } from '../lib/dates';
import { cx } from '../lib/format';
import { recordPeekPath, resourceKeyFromParams, resourcePath } from '../lib/routes';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { canReadRecord, canUpdateRecord, perm } from '../services/authz';
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
import { L } from '../constants/labels';

const C = L.common;
const I = L.common.inbox;

// ---------------------------------------------------------------- Notifications & Approvals (COM-03, QUO-06, SO-04)

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
      <PageHeader title={L.nav.pages.notifications.title} description={I.description} />
      <Tabs<InboxTab>
        label={I.sections}
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { id: 'notifications', label: I.tabs.notifications, count: notifications.filter((n) => !n.readAt).length },
          { id: 'approvals', label: I.tabs.approvals, count: approvals.filter((a) => a.status === 'pending').length },
          { id: 'tasks', label: I.tabs.tasks, count: tasks.length },
        ]}
      />
      <div className="content-surface inbox" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {inbox.error && (
          <ErrorState title={I.loadError} onRetry={inbox.retry}>
            {inbox.error}
          </ErrorState>
        )}
        {!inbox.data && !inbox.error && <Skeleton rows={6} />}
        {inbox.data && tab === 'notifications' && (
          <>
            <div className="toolbar">
              <InfoTip text={I.markReadAbout} label={C.notifications.aboutLabel} />
              <span className="spacer" />
              <Button onClick={() => markAllRead(actor)}>{C.notifications.markAllRead}</Button>
            </div>
            {notifications.length ? (
              <ul className="inbox-list">
                {notifications.map((n) => (
                  <li key={n.id} className={cx('inbox-item', !n.readAt && 'is-unread')}>
                    {!n.readAt && <span className="unread-dot" aria-label={C.notifications.unread} />}
                    <div className="inbox-main">
                      <span className="inbox-title">{n.title}</span>
                      <span className="muted small">
                        {C.notifications.kinds[n.kind] ?? n.kind.replace(/_/g, ' ')} · {relativeTime(n.createdAt)}
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
                        {C.actions.open}
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => markNotification(actor, n.id, !n.readAt)}>
                      {n.readAt ? C.notifications.markUnread : C.notifications.markRead}
                    </Button>
                    <Button variant="ghost" onClick={() => snoozeNotification(actor, n.id, 4)}>
                      {C.notifications.snooze}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="bell" title={I.noNotifications} />
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
                          {I.requestedBy(getUser(a.requestedBy)?.name ?? a.requestedBy, relativeTime(a.requestedAt))}
                          {a.status === 'pending' && level && I.level(a.currentLevel + 1, a.levels.length, level.label, levelHolders(level.capability).join(' / '))}
                          {a.decidedBy && I.decidedBy(I.status[a.status] ?? a.status, getUser(a.decidedBy)?.name ?? a.decidedBy, a.decisionNote || undefined)}
                        </span>
                      </div>
                      <StatusChip label={I.status[a.status] ?? a.status} tone={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'neutral'} />
                      {mine && (
                        <>
                          <Button variant="primary" onClick={() => setDeciding({ id: a.id, decision: 'approved' })}>
                            {C.actions.approve}
                          </Button>
                          <Button onClick={() => setDeciding({ id: a.id, decision: 'rejected' })}>{C.actions.reject}</Button>
                        </>
                      )}
                      {a.status === 'pending' && a.requestedBy === actor.user.id && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            try {
                              withdrawApproval(actor, a.id);
                              toast(C.toasts.withdrawn(a.id));
                            } catch (e) {
                              toast(e instanceof ServiceError ? e.message : C.toasts.failed, 'danger');
                            }
                          }}
                        >
                          {C.actions.withdraw}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="check" title={I.noApprovals}>
                {I.noApprovalsBody}
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
                        {I.due(formatDate(String(t.dueDate)), t.relatedLabel ? String(t.relatedLabel) : undefined)}
                      </span>
                    </div>
                    <Button
                      onClick={() => {
                        try {
                          transitionRecord(actor, 'tasks', t.id, 'done', t.version);
                          toast(C.toasts.completed(t.id));
                        } catch (e) {
                          toast(e instanceof ServiceError ? e.message : C.toasts.failed, 'danger');
                        }
                      }}
                    >
                      {C.actions.completeTask}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="check-square" title={I.noTasks} />
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
      title={I.decisionTitle(decision === 'approved', approvalId)}
      description={
        decision === 'approved'
          ? a.currentLevel < a.levels.length - 1
            ? I.approveLevel(a.currentLevel + 1, a.levels[a.currentLevel + 1].label)
            : I.approveFinal(a.summary)
          : I.rejectBody
      }
      footer={
        <>
          <Button onClick={onClose}>{C.actions.cancel}</Button>
          <Button
            variant={decision === 'approved' ? 'primary' : 'danger'}
            onClick={() => {
              try {
                decideApproval(actor, approvalId, decision, note, a.version);
                toast(C.toasts.decided(approvalId, (I.status[decision] ?? decision).toLowerCase()));
                onClose();
              } catch (e) {
                setError(e instanceof ServiceError ? e.message : C.toasts.failed);
              }
            }}
          >
            {decision === 'approved' ? C.actions.approve : C.actions.rejectRequest}
          </Button>
        </>
      }
    >
      <div className="form-field">
        <label className="field-label" htmlFor="decision-note">
          {I.note} {decision === 'rejected' ? <span className="req">*</span> : <span className="optional">{L.common.form.optional}</span>}
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
    // Out-of-scope records look exactly like missing ones (COM-01: a direct URL never reveals them).
    if (!raw || !canReadRecord(actor, res, raw)) return <ErrorState title={L.common.form.notFound} />;
    if (!canUpdateRecord(actor, res, raw)) return <NoAccess what={L.common.form.editing(res.labelPlural.toLowerCase())} />;
    if (res.lifecycle?.terminal.includes(String(raw[res.lifecycle.field]))) return <ErrorState title={L.common.form.notEditable}>{L.common.form.lockedForAudit(res.label.toLowerCase())}</ErrorState>;
  } else if (!perm(actor, resource).create) return <NoAccess what={L.common.form.creating(res.labelPlural.toLowerCase())} />;
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
  // "Save & Issue" only for documents whose lifecycle has an Issued step (not tasks, users …).
  const canIssue = !!form.res.lifecycle?.transitions.some((t) => t.to === 'issued');
  const save = async (issue: boolean) => {
    const out = await form.submit();
    if (!out) return;
    if (issue && canIssue) {
      try {
        transitionRecord(form.actor, resKey, out.record.id, 'issued', out.record.version);
      } catch (e) {
        toast(e instanceof ServiceError ? e.message : C.toasts.savedNotIssued, 'danger');
      }
    }
    toast(issue ? C.toasts.savedIssued(out.record.id) : canIssue ? C.toasts.savedDraft(out.record.id) : C.toasts.saved(out.record.id));
    navigate(recordPeekPath('tc', resKey, out.record.id));
  };
  return (
    <div className="page">
      <PageHeader
        title={recordId ? L.common.form.editTitle(form.res.label, recordId) : (form.res.form.primaryLabel ?? L.common.form.newTitle(form.res.label))}
        description={L.common.form.fullPageDescription}
        onBack={guard.requestClose}
      />
      <div className="full-form panel">
        <FormBody form={form}>
          <ConflictPanel form={form} onOverride={() => void save(false)} />
        </FormBody>
        <div className="full-form-bar">
          <Button onClick={guard.requestClose}>{C.actions.cancel}</Button>
          <span className="spacer" />
          <Button variant={canIssue ? undefined : 'primary'} loading={form.submitting} onClick={() => void save(false)}>
            {canIssue ? C.actions.saveDraft : recordId ? C.actions.save : (form.res.form.primaryLabel ?? C.actions.save)}
          </Button>
          {canIssue && (
            <Button variant="primary" loading={form.submitting} onClick={() => void save(true)}>
              {C.actions.saveAndIssue}
            </Button>
          )}
        </div>
      </div>
      {guard.dialog}
    </div>
  );
}
