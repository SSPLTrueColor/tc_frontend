import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDate, relativeTime, todayKey } from '../lib/dates';
import { cx } from '../lib/format';
import { recordPagePath, recordPeekPath, resourceKeyFromParams, resourcePath } from '../lib/routes';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { canReadRecord, canUpdateRecord, perm } from '../services/authz';
import { getDb } from '../services/db';
import { listNotifications, markAllRead, markNotification, snoozeNotification } from '../services/collab';
import { useActor, useRevision } from '../services/hooks';
import { getResource, getUser } from '../services/registry';
import { queryRecords, transitionRecord } from '../services/runtime';
import { ServiceError } from '../services/types';
import { approvalTypeLabel, canDecide, levelHolders, listApprovals, withdrawApproval } from '../services/workflow';
import { Button, IconButton } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { Avatar, ErrorState, NoAccess, StatusChip, useToast } from '../components/primitives/feedback';
import { ConflictPanel, FormBody, useRecordForm, useUnsavedGuard } from '../components/resource/RecordForm';
import { PageHeader } from '../components/shell/PageHeader';
import { ListPage } from '../components/shell/ListPage';
import { DataTable, type Column } from '../components/primitives/DataTable';
import { SelectMenu } from '../components/primitives/SelectMenu';
import { L } from '../constants/labels';
import type { Tone } from '../metadata/types';
import { DecisionDialog } from '../components/crm/ApprovalDecision';

const C = L.common;
const I = L.common.inbox;

// ---------------------------------------------------------------- Notifications & Approvals (COM-03, QUO-06, SO-04)

type InboxTab = 'notifications' | 'approvals' | 'tasks';

const KIND_ICON: Record<string, { icon: string; tone: Tone }> = {
  assignment: { icon: 'user-check', tone: 'accent' },
  mention: { icon: 'message', tone: 'info' },
  approval_request: { icon: 'shield-check', tone: 'warning' },
  approval_decision: { icon: 'thumbs-up', tone: 'success' },
  reminder: { icon: 'clock', tone: 'info' },
  escalation: { icon: 'alert', tone: 'danger' },
  exception: { icon: 'ban', tone: 'danger' },
  info: { icon: 'info', tone: 'neutral' },
  system: { icon: 'settings', tone: 'neutral' },
};

const APPROVAL_TONE: Record<string, Tone> = { pending: 'warning', approved: 'success', rejected: 'danger', withdrawn: 'neutral' };

/** "Not attended lead: LD-1 · North Star …" → a short bold heading + the detail underneath. */
function splitTitle(title: string): { head: string; rest: string } {
  const i = title.indexOf(': ');
  if (i > 0 && i < 60) return { head: title.slice(0, i), rest: title.slice(i + 2) };
  const j = title.indexOf(' — ');
  if (j > 0 && j < 80) return { head: title.slice(0, j), rest: title.slice(j + 3) };
  return { head: title, rest: '' };
}

export function InboxPage() {
  useRevision();
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const tab = (params.get('tab') as InboxTab) || 'notifications';
  // Filters (per tab; all live in the page so the table's filter panel can show and clear them)
  const [kind, setKind] = useState('');
  const [readState, setReadState] = useState('');
  const [apStatus, setApStatus] = useState('');
  const [apType, setApType] = useState('');
  const [dueWhen, setDueWhen] = useState('');
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
  type N = (typeof notifications)[number];
  type A = (typeof approvals)[number];
  type Tk = (typeof tasks)[number];

  const today = todayKey();
  const unreadCount = notifications.filter((n) => !n.readAt).length;
  const pendingCount = approvals.filter((a) => a.status === 'pending').length;
  const dueOf = (t: Tk) => {
    const d = String(t.dueDate);
    return d < today ? 'overdue' : d === today ? 'today' : 'upcoming';
  };

  const openNotification = (n: N) => {
    markNotification(actor, n.id, true);
    if (!n.link) return;
    const link = n.link;
    if ('page' in link) {
      if (link.page === 'inbox') setParams({ tab: 'approvals' });
      else navigate(`/${link.page}`);
    } else navigate(recordPeekPath(actor.workspaceId, link.resource, link.recordId));
  };
  const completeTask = (t: Tk) => {
    try {
      transitionRecord(actor, 'tasks', t.id, 'done', t.version);
      toast(C.toasts.completed(t.id));
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : C.toasts.failed, 'danger');
    }
  };
  const withdraw = (a: A) => {
    try {
      withdrawApproval(actor, a.id);
      toast(C.toasts.withdrawn(a.id));
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : C.toasts.failed, 'danger');
    }
  };

  const tabs: { id: InboxTab; label: string; icon: string; count: number }[] = [
    { id: 'notifications', label: I.tabs.notifications, icon: 'bell', count: unreadCount },
    { id: 'approvals', label: I.tabs.approvals, icon: 'shield-check', count: pendingCount },
    { id: 'tasks', label: I.tabs.tasks, icon: 'check-square', count: tasks.length },
  ];
  // Same look as the saved-view tabs on the other list pages
  const tabBar = (
    <nav className="page-nav" role="tablist" aria-label={I.sections}>
      {tabs.map((t) => (
        <div key={t.id} className={cx('view-tab', tab === t.id && 'is-active')}>
          <button type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} className="view-tab-btn" onClick={() => setParams({ tab: t.id })}>
            <Icon name={t.icon} size={14} />
            <span>{t.label}</span>
            {inbox.data && <span className="page-nav-count">{t.count}</span>}
          </button>
        </div>
      ))}
    </nav>
  );

  const kindOptions = [...new Set(notifications.map((n) => n.kind))].map((k) => ({ value: k, label: C.notifications.kinds[k] ?? k }));
  const notifRows = notifications
    .filter((n) => (!kind || n.kind === kind) && (!readState || (readState === 'unread' ? !n.readAt : !!n.readAt)))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const notifColumns: Column<N>[] = [
    {
      key: 'title',
      label: I.cols.title,
      sort: (n) => n.title,
      render: (n) => {
        const { head, rest } = splitTitle(n.title);
        return (
          <span className={cx('nt-cell', !n.readAt && 'is-unread')} title={n.title}>
            <span className="nt-dot" aria-label={n.readAt ? undefined : I.unread} />
            <span className="nt-cell-text">
              <span className="nt-head">{head}</span>
              {rest && <span className="nt-rest">{rest}</span>}
            </span>
          </span>
        );
      },
    },
    {
      key: 'kind',
      label: I.cols.type,
      sort: (n) => C.notifications.kinds[n.kind] ?? n.kind,
      render: (n) => {
        const meta = KIND_ICON[n.kind] ?? KIND_ICON.info;
        return <StatusChip label={C.notifications.kinds[n.kind] ?? n.kind} tone={meta.tone} />;
      },
    },
    {
      key: 'record',
      label: I.cols.record,
      sort: (n) => (n.link ? ('page' in n.link ? n.link.page : n.link.recordId) : ''),
      render: (n) => (!n.link ? <span className="muted">—</span> : 'page' in n.link ? I.page(n.link.page) : <span className="mono">{n.link.recordId}</span>),
    },
    { key: 'received', label: I.cols.received, sort: (n) => n.createdAt, icon: 'f-date', render: (n) => <span title={formatDate(n.createdAt.slice(0, 10))}>{relativeTime(n.createdAt)}</span> },
    {
      key: 'act',
      label: I.cols.actions,
      render: (n) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          {n.link && <IconButton icon="eye" label={C.actions.open} onClick={() => openNotification(n)} />}
          <IconButton icon={n.readAt ? 'f-email' : 'check'} label={n.readAt ? C.notifications.markUnread : C.notifications.markRead} onClick={() => markNotification(actor, n.id, !n.readAt)} />
          <IconButton
            icon="clock"
            label={C.notifications.snoozeAria}
            onClick={() => {
              snoozeNotification(actor, n.id, 4);
              toast(I.snoozed);
            }}
          />
        </span>
      ),
    },
  ];

  const typeOptions = [...new Set(approvals.map((a) => a.type))].map((t) => ({ value: t, label: approvalTypeLabel(t) }));
  const apRows = approvals.filter((a) => (!apStatus || a.status === apStatus) && (!apType || a.type === apType));
  const apColumns: Column<A>[] = [
    { key: 'id', label: I.cols.id, sort: (a) => a.id, render: (a) => <span className="mono">{a.id}</span> },
    {
      key: 'request',
      label: I.cols.request,
      sort: (a) => a.summary,
      render: (a) => (
        <span className="nt-cell-text ap-request" title={a.reason ? `${a.summary} — “${a.reason}”` : a.summary}>
          <Link to={recordPeekPath(actor.workspaceId, a.resource, a.recordId)} className="nt-head rel-link" onClick={(e) => e.stopPropagation()}>
            {a.summary}
          </Link>
          {a.reason && <span className="nt-rest">“{a.reason}”</span>}
        </span>
      ),
    },
    { key: 'type', label: I.cols.type, sort: (a) => approvalTypeLabel(a.type), render: (a) => approvalTypeLabel(a.type) },
    {
      key: 'by',
      label: I.cols.requestedBy,
      sort: (a) => getUser(a.requestedBy)?.name ?? a.requestedBy,
      icon: 'f-person',
      render: (a) => {
        const name = getUser(a.requestedBy)?.name ?? a.requestedBy;
        return (
          <span className="person-inline">
            <Avatar name={name} size={22} />
            {name}
          </span>
        );
      },
    },
    {
      key: 'level',
      label: I.cols.level,
      sort: (a) => a.currentLevel,
      render: (a) => {
        const level = a.levels[a.currentLevel];
        if (a.status !== 'pending' || !level) return a.decidedBy ? <span className="muted">{getUser(a.decidedBy)?.name ?? a.decidedBy}</span> : <span className="muted">—</span>;
        return <span title={levelHolders(level.capability).join(' / ')}>{`${I.levelOf(a.currentLevel + 1, a.levels.length)} · ${level.label}`}</span>;
      },
    },
    { key: 'status', label: I.cols.status, sort: (a) => a.status, render: (a) => <StatusChip label={I.status[a.status] ?? a.status} tone={APPROVAL_TONE[a.status] ?? 'neutral'} /> },
    { key: 'requested', label: I.cols.requested, sort: (a) => a.requestedAt, icon: 'f-date', render: (a) => relativeTime(a.requestedAt) },
    {
      key: 'act',
      label: I.cols.actions,
      render: (a) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          {canDecide(actor, a) && (
            <>
              <Button variant="primary" icon="check" onClick={() => setDeciding({ id: a.id, decision: 'approved' })}>
                {C.actions.approve}
              </Button>
              <Button icon="x" onClick={() => setDeciding({ id: a.id, decision: 'rejected' })}>
                {C.actions.reject}
              </Button>
            </>
          )}
          {a.status === 'pending' && a.requestedBy === actor.user.id && (
            <Button variant="ghost" icon="undo" onClick={() => withdraw(a)}>
              {C.actions.withdraw}
            </Button>
          )}
        </span>
      ),
    },
  ];

  const taskRows = tasks.filter((t) => !dueWhen || dueOf(t) === dueWhen);
  const taskColumns: Column<Tk>[] = [
    { key: 'id', label: I.cols.id, sort: (t) => t.id, render: (t) => <span className="mono">{t.id}</span> },
    {
      key: 'title',
      label: I.cols.task,
      sort: (t) => String(t.title),
      render: (t) => (
        <Link to={recordPeekPath(actor.workspaceId, 'tasks', t.id)} className="nt-head rel-link" onClick={(e) => e.stopPropagation()}>
          {String(t.title)}
        </Link>
      ),
    },
    { key: 'related', label: I.cols.related, sort: (t) => String(t.relatedLabel ?? ''), render: (t) => (t.relatedLabel ? String(t.relatedLabel) : <span className="muted">—</span>) },
    {
      key: 'due',
      label: I.cols.due,
      sort: (t) => String(t.dueDate),
      icon: 'f-date',
      render: (t) => {
        const w = dueOf(t);
        return (
          <span className="task-due-cell">
            {formatDate(String(t.dueDate))}
            {w !== 'upcoming' && <StatusChip label={w === 'overdue' ? I.overdue : I.dueToday} tone={w === 'overdue' ? 'danger' : 'warning'} />}
          </span>
        );
      },
    },
    {
      key: 'act',
      label: I.cols.actions,
      render: (t) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <Button icon="check" onClick={() => completeTask(t)}>
            {C.actions.completeTask}
          </Button>
        </span>
      ),
    },
  ];

  const common = { loading: !inbox.data && !inbox.error, error: inbox.error, onRetry: inbox.retry };

  return (
    <ListPage
      key={tab}
      title={L.nav.pages.notifications.title}
      tabs={tabBar}
      actions={
        tab === 'notifications' ? (
          <Button
            icon="check"
            disabledReason={unreadCount ? undefined : C.notifications.nothingUnread}
            onClick={() => {
              markAllRead(actor);
              toast(I.markedAllRead);
            }}
          >
            {C.notifications.markAllRead}
          </Button>
        ) : undefined
      }
    >
      {tab === 'notifications' && (
        <DataTable<N>
          {...common}
          label={I.tabs.notifications}
          noun={I.nouns.notifications}
          rows={notifRows}
          columns={notifColumns}
          rowKey={(n) => n.id}
          search={(n) => `${n.title} ${C.notifications.kinds[n.kind] ?? n.kind}`}
          onRowClick={openNotification}
          activeFilters={Number(!!kind) + Number(!!readState)}
          onClearFilters={() => {
            setKind('');
            setReadState('');
          }}
          filters={
            <>
              <SelectMenu label={I.cols.type} value={kind} onChange={setKind} options={[{ value: '', label: I.allTypes }, ...kindOptions]} />
              <SelectMenu
                label={I.readState}
                value={readState}
                onChange={setReadState}
                options={[
                  { value: '', label: I.allStates },
                  { value: 'unread', label: I.unread },
                  { value: 'read', label: I.read },
                ]}
              />
            </>
          }
          empty={{ icon: 'bell', title: I.noNotifications, body: C.notifications.allCaughtUp }}
        />
      )}
      {tab === 'approvals' && (
        <DataTable<A>
          {...common}
          label={I.tabs.approvals}
          noun={I.nouns.approvals}
          rows={apRows}
          columns={apColumns}
          rowKey={(a) => a.id}
          search={(a) => `${a.id} ${a.summary} ${approvalTypeLabel(a.type)} ${getUser(a.requestedBy)?.name ?? ''} ${a.reason ?? ''}`}
          initialSort={{ key: 'requested', dir: 'desc' }}
          onRowClick={(a) => navigate(recordPeekPath(actor.workspaceId, a.resource, a.recordId))}
          activeFilters={Number(!!apStatus) + Number(!!apType)}
          onClearFilters={() => {
            setApStatus('');
            setApType('');
          }}
          filters={
            <>
              <SelectMenu label={I.cols.status} value={apStatus} onChange={setApStatus} options={[{ value: '', label: I.allStatuses }, ...Object.entries(I.status).map(([value, label]) => ({ value, label }))]} />
              <SelectMenu label={I.cols.type} value={apType} onChange={setApType} options={[{ value: '', label: I.allTypes }, ...typeOptions]} />
            </>
          }
          empty={{ icon: 'check', title: I.noApprovals, body: I.noApprovalsBody }}
        />
      )}
      {tab === 'tasks' && (
        <DataTable<Tk>
          {...common}
          label={I.tabs.tasks}
          noun={I.nouns.tasks}
          rows={taskRows}
          columns={taskColumns}
          rowKey={(t) => t.id}
          search={(t) => `${t.id} ${String(t.title)} ${String(t.relatedLabel ?? '')}`}
          initialSort={{ key: 'due', dir: 'asc' }}
          onRowClick={(t) => navigate(recordPeekPath(actor.workspaceId, 'tasks', t.id))}
          activeFilters={Number(!!dueWhen)}
          onClearFilters={() => setDueWhen('')}
          filters={<SelectMenu label={I.cols.due} value={dueWhen} onChange={setDueWhen} options={[{ value: '', label: I.allDue }, ...Object.entries(I.dueFilter).map(([value, label]) => ({ value, label }))]} />}
          empty={{ icon: 'check-square', title: I.noTasks, body: I.noTasksBody }}
        />
      )}
      {deciding && <DecisionDialog approvalId={deciding.id} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </ListPage>
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
  // Cancel / Back from an edit returns to the record page; from a new form to the list.
  const back = recordId ? recordPagePath('tc', resKey, recordId) : resourcePath('tc', resKey);
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
    // Saving lands on the record itself (not a list drawer); the form is replaced so Back does not reopen it.
    navigate(recordPagePath('tc', resKey, out.record.id), { replace: true });
  };
  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: form.res.labelPlural, onClick: guard.requestClose }]}
        title={recordId ? L.common.form.editTitle(form.res.label, recordId) : (form.res.form.primaryLabel ?? L.common.form.newTitle(form.res.label))}
        // The totals / payments note only applies to issuable documents (invoices), not contacts, companies etc.
        description={canIssue ? L.common.form.fullPageDescription : undefined}
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
