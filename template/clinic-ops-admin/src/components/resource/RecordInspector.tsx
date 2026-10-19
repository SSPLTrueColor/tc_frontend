import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import type { FieldDefinition, RecordData, ResourceDefinition } from '../../metadata/types';
import { relativeTime } from '../../lib/dates';
import { cx, formatMoney } from '../../lib/format';
import { recordPagePath, recordPeekPath } from '../../lib/routes';
import { type Actor, canReadResource, perm } from '../../services/authz';
import { listComments } from '../../services/collab';
import { getDb } from '../../services/db';
import { useActor, useRevision } from '../../services/hooks';
import { getResource, getUser, masterLabel, masterValue } from '../../services/registry';
import { availableTransitions, deleteRecord, getRecord, type Projected, queryRecords, recordTitle, transitionRecord } from '../../services/runtime';
import { togglePin, getSettings } from '../../services/settings';
import { ServiceError } from '../../services/types';
import { Button, IconButton } from '../primitives/Button';
import { EmptyState, ErrorState, StatusChip, Tabs, useToast } from '../primitives/feedback';
import { Dialog, Menu, useFocusReturn, useFocusTrap, useLayer } from '../primitives/overlay';
import { getRecordActions, getRecordBanner } from './extensions';
import { FieldValue } from './FieldValue';
import { ConflictPanel, FormBody, QuickCreateDialog, useRecordForm, useUnsavedGuard } from './RecordForm';
import { QuickComment } from './QuickComment';
import { InfoTip } from '../primitives/InfoTip';
import { DateText, EmptyValue } from '../primitives/display';

type Tab = 'details' | 'related' | 'activity' | 'comments';

export function RecordInspector({
  resKey,
  recordId,
  onClose,
  siblings = [],
  onNavigate,
  variant = 'panel',
}: {
  resKey: string;
  recordId: string;
  onClose: () => void;
  siblings?: string[];
  onNavigate?: (id: string) => void;
  variant?: 'panel' | 'page';
}) {
  useRevision();
  const actor = useActor();
  const res = getResource(resKey);
  const [tab, setTab] = useState<Tab>('details');
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const drawer = variant === 'panel';
  const ref = useRef<HTMLElement>(null);
  useLayer(drawer && !editing, onClose);
  useFocusReturn(drawer);
  useFocusTrap(ref, drawer);

  let projected: Projected | null = null;
  let error: ServiceError | null = null;
  try {
    projected = getRecord(actor, resKey, recordId);
  } catch (e) {
    error = e instanceof ServiceError ? e : new ServiceError('not_found', 'Record unavailable');
  }

  const idx = siblings.indexOf(recordId);
  const prev = idx > 0 ? siblings[idx - 1] : undefined;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : undefined;
  const commentCount = projected ? listComments(actor, resKey, recordId).length : 0;

  const statusField = projected ? (res.lifecycle ? res.fields.find((f) => f.key === res.lifecycle!.field) : res.fields.find((f) => f.key === 'status')) : undefined;
  const status = projected && statusField ? masterValue(statusField.master!, projected.record[statusField.key]) : undefined;

  const panel = (
    <aside
      ref={ref}
      className={cx('inspector', variant === 'page' && 'inspector-page', drawer && 'inspector-drawer', expanded && 'is-expanded')}
      aria-label={`${res.label} ${recordId}`}
      role={drawer ? 'dialog' : undefined}
      aria-modal={drawer || undefined}
      tabIndex={drawer ? -1 : undefined}
    >
      <div className="inspector-top">
        {/* Owner rule: record drawers open like the edit drawer — title in a top-bar-height header, no × (Cancel in the footer).
        {variant === 'panel' && <IconButton icon="x" label="Close inspector (Esc)" onClick={onClose} />} */}
        {drawer && projected && (
          <div className="inspector-top-title">
            <h2 className="inspector-title">{recordTitle(res.key, recordId, actor)}</h2>
            {status && <StatusChip label={status.label} tone={status.tone} />}
          </div>
        )}
        {!drawer && <span className="inspector-crumb muted">{res.labelPlural}</span>}
        {!drawer && <span className="spacer" />}
        {onNavigate && (
          <>
            <IconButton icon="chevron-left" label="Previous record" disabledReason={prev ? undefined : 'First record in this view'} onClick={() => prev && onNavigate(prev)} />
            <IconButton icon="chevron-right" label="Next record" disabledReason={next ? undefined : 'Last record in this view'} onClick={() => next && onNavigate(next)} />
          </>
        )}
        {variant === 'panel' && <IconButton icon={expanded ? 'minimize' : 'maximize'} label={expanded ? 'Collapse width' : 'Expand width'} onClick={() => setExpanded((e) => !e)} className="hide-phone" />}
        {variant === 'panel' && <IconButton icon="layout-dashboard" label="Open full page" onClick={() => navigate(recordPagePath(actor.workspaceId, resKey, recordId))} />}
        {projected && <PinButton actor={actor} res={res} id={recordId} />}
      </div>
      {error || !projected ? (
        <div className="inspector-body">
          <ErrorState title="Record unavailable">{error?.message ?? 'Not found.'}</ErrorState>
        </div>
      ) : (
        <>
          <InspectorHeader res={res} actor={actor} p={projected} onEdit={() => (setTab('details'), setEditing(true))} editing={editing} onDeleted={onClose} hideTitle={drawer} editInFooter={drawer} />
          <Tabs<Tab>
            label="Record sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'details', label: 'Details' },
              { id: 'related', label: 'Related' },
              { id: 'activity', label: 'Activity' },
              { id: 'comments', label: 'Comments', count: commentCount },
            ]}
          />
          <div className="inspector-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'details' && (editing ? <InlineEdit res={res} recordId={recordId} onDone={() => setEditing(false)} /> : <Details res={res} actor={actor} p={projected} />)}
            {tab === 'related' && <Related res={res} actor={actor} record={projected.record} />}
            {tab === 'activity' && <ActivityFeed resKey={resKey} recordId={recordId} />}
            {tab === 'comments' && <CommentThread actor={actor} resKey={resKey} recordId={recordId} />}
          </div>
          {/* Exactly one composer, outside the tab panels — persists across all four tabs. */}
          {!(drawer && editing) && <QuickComment key={`${resKey}:${recordId}`} actor={actor} resource={resKey} recordId={recordId} />}
        </>
      )}
      {drawer && !editing && (
        <footer className="dialog-footer">
          <Button onClick={onClose}>Cancel</Button>
          {projected && (
            <Button variant="primary" icon="pencil" onClick={() => (setTab('details'), setEditing(true))} disabledReason={projected.canUpdate ? undefined : `Read-only for ${actor.role.label}`}>
              Edit
            </Button>
          )}
        </footer>
      )}
    </aside>
  );

  if (!drawer) return panel;
  return createPortal(
    <div className="overlay-scrim overlay-scrim-drawer" onMouseDown={(e) => e.target === e.currentTarget && !editing && onClose()}>
      {panel}
    </div>,
    document.body,
  );
}

function PinButton({ actor, res, id }: { actor: Actor; res: ResourceDefinition; id: string }) {
  const path = recordPeekPath(actor.workspaceId, res.key, id);
  const pinned = getSettings(actor.user.id).pins.some((p) => p.path === path);
  return <IconButton icon={pinned ? 'pin-off' : 'pin'} label={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'} pressed={pinned} onClick={() => togglePin(actor, `${id} · ${recordTitle(res.key, id, actor)}`.slice(0, 48), path)} />;
}

function InspectorHeader({ res, actor, p, onEdit, editing, onDeleted, hideTitle, editInFooter }: { res: ResourceDefinition; actor: Actor; p: Projected; onEdit: () => void; editing: boolean; onDeleted: () => void; hideTitle?: boolean; editInFooter?: boolean }) {
  const r = p.record;
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ to: string; text: string; action: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const transitions = availableTransitions(actor, res, r);
  const statusField = res.lifecycle ? res.fields.find((f) => f.key === res.lifecycle!.field) : res.fields.find((f) => f.key === 'status');
  const status = statusField ? masterValue(statusField.master!, r[statusField.key]) : undefined;
  const Actions = getRecordActions(res.key);
  const Banner = getRecordBanner(res.key);

  const run = (to: string, overrideReason?: string) => {
    try {
      const t = transitions.find((x) => x.to === to)!;
      transitionRecord(actor, res.key, r.id, to, r.version, { overrideReason });
      toast(`${r.id}: ${t.action}`);
    } catch (e) {
      if (e instanceof ServiceError && e.code === 'conflict') {
        toast(e.conflicts?.map((c) => c.message).join(' ') ?? e.message, 'danger');
      } else toast(e instanceof ServiceError ? e.message : 'Action failed', 'danger');
    }
  };

  return (
    <header className="inspector-header">
      {!hideTitle && (
        <div className="inspector-title-row">
          <h2 className="inspector-title">{recordTitle(res.key, r.id, actor)}</h2>
          {status && <StatusChip label={status.label} tone={status.tone} />}
        </div>
      )}
      <p className="inspector-sub">
        <span className="mono">{r.id}</span>
        <span aria-hidden="true"> · </span>
        <span>Updated {relativeTime(r.updatedAt)}</span>
        <span aria-hidden="true"> · </span>
        <span>v{r.version}</span>
      </p>
      {Banner && <Banner res={res} actor={actor} record={r} />}
      {!editing && (
        <div className="inspector-actions">
          {transitions.map((t, i) => (
            <Button
              key={t.to}
              variant={i === 0 && !t.disabledReason ? 'primary' : 'secondary'}
              disabledReason={t.disabledReason}
              onClick={() => (t.confirm ? setConfirm({ to: t.to, text: t.confirm, action: t.action }) : run(t.to))}
            >
              {t.action}
            </Button>
          ))}
          {/* In drawers, Edit lives in the footer next to Cancel (owner rule) */}
          {!editInFooter && (
            <Button icon="pencil" onClick={onEdit} disabledReason={p.canUpdate ? undefined : `Read-only for ${actor.role.label}`}>
              Edit
            </Button>
          )}
          {Actions && <Actions res={res} actor={actor} record={r} />}
          <IconButton ref={moreRef} icon="more" label="More actions" aria-haspopup="menu" onClick={() => setMenuOpen(true)} />
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchor={moreRef}
            label="More record actions"
            items={[
              {
                id: 'copy',
                label: 'Copy link',
                icon: 'copy',
                onSelect: () => {
                  void navigator.clipboard?.writeText(window.location.origin + recordPeekPath(actor.workspaceId, res.key, r.id));
                  toast('Link copied — opening it still requires access');
                },
              },
              { id: 'delete', label: 'Delete', icon: 'trash', danger: true, separatorBefore: true, disabledReason: perm(actor, res.key).delete ? undefined : 'Your role cannot delete', onSelect: () => setDeleting(true) },
            ]}
          />
        </div>
      )}
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.action ?? ''}
        size="sm"
        role="alertdialog"
        footer={
          <>
            <Button onClick={() => setConfirm(null)} data-autofocus>
              Keep as is
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const c = confirm!;
                setConfirm(null);
                run(c.to);
              }}
            >
              {confirm?.action}
            </Button>
          </>
        }
      >
        <p>{confirm?.text}</p>
      </Dialog>
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${r.id}?`}
        size="sm"
        role="alertdialog"
        footer={
          <>
            <Button onClick={() => setDeleting(false)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                try {
                  deleteRecord(actor, res.key, r.id);
                  toast(`${r.id} deleted`);
                  setDeleting(false);
                  onDeleted();
                } catch (e) {
                  toast(e instanceof ServiceError ? e.message : 'Delete failed', 'danger');
                  setDeleting(false);
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p>This removes the record from this local prototype. Records referenced elsewhere cannot be deleted.</p>
      </Dialog>
    </header>
  );
}

function Details({ res, actor, p }: { res: ResourceDefinition; actor: Actor; p: Projected }) {
  const inSections = new Set(res.form.sections.flatMap((s) => s.fields));
  const extra = res.fields.filter((f) => !inSections.has(f.key) && p.access[f.key] !== 'hide');
  return (
    <div className="details">
      {res.form.sections.map((s) => {
        const fields = s.fields.map((k) => res.fields.find((f) => f.key === k)).filter((f): f is FieldDefinition => !!f && p.access[f.key] !== 'hide');
        if (!fields.length) return null;
        return (
          <section key={s.id} className="detail-section">
            <h3 className="detail-section-title">{s.title}</h3>
            <dl className="detail-list">
              {fields.map((f) => (
                <div key={f.key} className="detail-row">
                  <dt>{f.label}</dt>
                  <dd>
                    {f.type === 'lineitems' && p.access[f.key] !== 'mask' ? (
                      <LineItemsRead items={p.record[f.key] as { serviceCode: string; description?: string; qty: number; unitPrice: number }[]} />
                    ) : (
                      <FieldValue field={f} value={p.record[f.key]} access={p.access[f.key]} actor={actor} />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
      {extra.length > 0 && (
        <section className="detail-section">
          <h3 className="detail-section-title">Calculated & system</h3>
          <dl className="detail-list">
            {extra.map((f) => (
              <div key={f.key} className="detail-row">
                <dt>{f.label}</dt>
                <dd>
                  <FieldValue field={f} value={p.record[f.key]} access={p.access[f.key]} actor={actor} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="detail-section">
        <h3 className="detail-section-title">System</h3>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>Created</dt>
            <dd>
              <DateText value={p.record.createdAt} showTime /> by {getUser(p.record.createdBy)?.name ?? (p.record.createdBy === 'system_seed' ? 'Synthetic seed' : p.record.createdBy)}
            </dd>
          </div>
          <div className="detail-row">
            <dt>Version</dt>
            <dd>{p.record.version}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function LineItemsRead({ items = [] }: { items?: { serviceCode: string; description?: string; qty: number; unitPrice: number }[] }) {
  if (!items.length) return <EmptyValue />;
  return (
    <ul className="plain-list li-read">
      {items.map((li, i) => (
        <li key={i}>
          <span>
            {masterLabel('serviceCode', li.serviceCode)} × {li.qty}
          </span>
          <span className="num">{formatMoney(li.qty * li.unitPrice)}</span>
        </li>
      ))}
    </ul>
  );
}

function InlineEdit({ res, recordId, onDone }: { res: ResourceDefinition; recordId: string; onDone: () => void }) {
  const form = useRecordForm({ resKey: res.key, recordId });
  const toast = useToast();
  const guard = useUnsavedGuard(form.dirty, onDone);
  const save = async (overrideReason?: string) => {
    const out = await form.submit({ overrideReason });
    if (out) {
      toast(`${recordId} saved`);
      onDone();
    }
  };
  return (
    <div className="inspector-edit">
      <FormBody form={form}>
        <ConflictPanel form={form} onOverride={(r) => save(r)} />
      </FormBody>
      <div className="inspector-edit-bar">
        <Button onClick={guard.requestClose}>Cancel</Button>
        <Button variant="primary" loading={form.submitting} onClick={() => save()}>
          Save changes
        </Button>
      </div>
      {guard.dialog}
    </div>
  );
}

function Related({ res, actor, record }: { res: ResourceDefinition; actor: Actor; record: RecordData }) {
  const [creating, setCreating] = useState<{ resource: string; fk: string } | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const relationFields = res.fields.filter((f) => f.type === 'relation' && record[f.key]);
  if (!res.relationships.length && !relationFields.length) return <EmptyState title="No related records">This record type has no configured relationships.</EmptyState>;
  return (
    <div className="related">
      {relationFields.length > 0 && (
        <section className="detail-section">
          <h3 className="detail-section-title">Linked to</h3>
          <ul className="related-list">
            {relationFields.map((f) => (
              <li key={f.key}>
                <span className="muted">{f.label}</span>
                <FieldValue field={f} value={record[f.key]} access="view" actor={actor} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {res.relationships.map((rel) => {
        const target = getResource(rel.resource);
        if (!canReadResource(actor, rel.resource)) {
          return (
            <section key={rel.id} className="detail-section">
              <h3 className="detail-section-title">{rel.label}</h3>
              <p className="muted">
                <span className="restricted">Not available for {actor.role.label}</span>
              </p>
            </section>
          );
        }
        const { rows, total } = queryRecords(actor, rel.resource, { where: { [rel.foreignKey]: record.id }, sort: [{ field: target.calendar?.startField ?? target.titleField, dir: 'desc' }], pageSize: 8 });
        const statusKey = target.lifecycle?.field;
        const statusMaster = statusKey ? target.fields.find((f) => f.key === statusKey)?.master : undefined;
        return (
          <section key={rel.id} className="detail-section">
            <div className="detail-section-head">
              <h3 className="detail-section-title">
                {rel.label} <span className="muted">{total}</span>
              </h3>
              {perm(actor, rel.resource).create && (
                <Button variant="ghost" icon="plus" onClick={() => setCreating({ resource: rel.resource, fk: rel.foreignKey })}>
                  New
                </Button>
              )}
            </div>
            {rows.length ? (
              <ul className="related-list">
                {rows.map((r) => {
                  const mv = statusMaster && statusKey ? masterValue(statusMaster, r[statusKey]) : undefined;
                  return (
                    <li key={r.id}>
                      <Link to={recordPeekPath(actor.workspaceId, rel.resource, r.id)} className="rel-link">
                        <span className="mono">{r.id}</span> {recordTitle(rel.resource, r.id, actor).replace(recordTitle(res.key, record.id, actor) + ' · ', '')}
                      </Link>
                      {mv && <StatusChip label={mv.label} tone={mv.tone} />}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">None{total === 0 && perm(actor, rel.resource).read === 'own' ? ' that you can see (your role sees only your own)' : ''}.</p>
            )}
            {total > rows.length && <p className="muted">Showing {rows.length} of {total}.</p>}
          </section>
        );
      })}
      <QuickCreateDialog
        open={!!creating}
        resKey={creating?.resource ?? res.key}
        initial={creating ? { [creating.fk]: record.id } : undefined}
        onClose={() => setCreating(null)}
        onCreated={(r) => {
          toast(`Linked ${r.id} to ${record.id}`);
          navigate(recordPeekPath(actor.workspaceId, creating!.resource, r.id));
        }}
      />
    </div>
  );
}

function ActivityFeed({ resKey, recordId }: { resKey: string; recordId: string }) {
  const actor = useActor();
  const items = useMemo(
    () => getDb().audit.filter((a) => a.workspaceId === actor.workspaceId && a.resource === resKey && a.recordId === recordId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resKey, recordId, actor.workspaceId, getDb().audit.length],
  );
  return (
    <div>
      <h3 className="detail-section-title dialog-title-row">
        Recent changes
        <InfoTip text="Activity is a readable view of changes. The tamper-evident audit ledger is separate (Administration › Audit log)." label="About activity" />
      </h3>
      {items.length ? (
        <ol className="timeline">
          {items.map((a) => (
            <li key={a.id} className="timeline-item">
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <p>
                  <strong>{getUser(a.actorId)?.name ?? a.actorId}</strong> {a.actorType === 'workflow' && <span className="tag">workflow</span>} {a.summary}
                </p>
                {a.changes && a.changes.length > 0 && (
                  <ul className="change-list">
                    {a.changes.map((c) => (
                      <li key={c.field}>
                        {c.label}: <span className="muted">{c.before}</span> → {c.after}
                      </li>
                    ))}
                  </ul>
                )}
                <time className="muted small" dateTime={a.at}>
                  {relativeTime(a.at)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon="activity" title="No activity yet">
          Changes made in this prototype session will appear here. Synthetic seed history is not shown.
        </EmptyState>
      )}
    </div>
  );
}

function CommentThread({ actor, resKey, recordId }: { actor: Actor; resKey: string; recordId: string }) {
  const comments = listComments(actor, resKey, recordId);
  return (
    <div>
      {comments.length ? (
        <ol className="thread">
          {comments.map((c) => (
            <li key={c.id} className="thread-item">
              <div className="thread-head">
                <strong>{getUser(c.authorId)?.name ?? c.authorId}</strong>
                <span className="tag">Internal</span>
                <time className="muted small" dateTime={c.createdAt}>
                  {relativeTime(c.createdAt)}
                </time>
              </div>
              <p className="thread-body">{c.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon="message" title="No comments yet">
          Use the composer below to add an internal note.
        </EmptyState>
      )}
    </div>
  );
}
