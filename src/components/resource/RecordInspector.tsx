import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MoveStageButton } from './MoveStageButton';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import type { FieldDefinition, RecordData, ResourceDefinition } from '../../metadata/types';
import { formatTime, relativeTime } from '../../lib/dates';
import { cx } from '../../lib/format';
import { recordEditPath, recordListPeekPath, recordPagePath, recordPeekPath } from '../../lib/routes';
import { type Actor, canReadResource, perm } from '../../services/authz';
import { listComments } from '../../services/collab';
import { getDb } from '../../services/db';
import { useActor, useRevision } from '../../services/hooks';
import { getMaster, getResource, getUser, masterValue } from '../../services/registry';
import { availableTransitions, deleteRecord, getRecord, type Projected, queryRecords, recordTitle, transitionRecord } from '../../services/runtime';
import { togglePin, getSettings } from '../../services/settings';
import { hooksFor } from '../../services/resourceHooks';
import { isVisible } from '../../services/validation';
import { ServiceError } from '../../services/types';
import { Button, IconButton } from '../primitives/Button';
import { EmptyState, ErrorState, StatusChip, Tabs, useToast } from '../primitives/feedback';
import { Dialog, Menu, useFocusReturn, useFocusTrap, useLayer } from '../primitives/overlay';
import { RecordApprovalActions } from '../crm/ApprovalDecision';
import { getDefaultRecordTab, getRecordActions, getRecordBanner, getRecordTabs } from './extensions';
import { LineItemsTable, lineItemsOf } from './LineItems';
import { FieldValue } from './FieldValue';
import { ConflictPanel, FormBody, QuickCreateDialog, useRecordForm, useUnsavedGuard } from './RecordForm';
import { QuickComment } from './QuickComment';
import { DealHistoryTab } from './DealHistory';
import { DealChain } from './DealChain';
import { DEAL_CHAIN_RESOURCES, DEAL_HISTORY_RESOURCES } from '../../services/dealHistory';
import { InfoTip } from '../primitives/InfoTip';
import { DateText } from '../primitives/display';
import { Icon } from '../primitives/Icon';
import { fieldIcon } from './fieldIcon';
import { L } from '../../constants/labels';

const C = L.common;
const R = L.common.record;

type Tab = string;

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
  // Deal records (lead, opportunity, quotation, sales order, contract) open on the unified Deal History.
  const dealHistory = DEAL_HISTORY_RESOURCES.includes(resKey);
  const [tab, setTab] = useState<Tab>(() => getDefaultRecordTab(resKey) ?? (dealHistory ? 'dealHistory' : 'details'));
  const [expanded, setExpanded] = useState(variant === 'panel'); // record drawer opens wide by default (owner rule)
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
    error = e instanceof ServiceError ? e : new ServiceError('not_found', R.unavailable);
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
        {drawer && onNavigate && (
          <span className="inspector-nav">
            <IconButton icon="chevron-left" label={R.previous} disabledReason={prev ? undefined : R.firstInView} onClick={() => prev && onNavigate(prev)} />
            <IconButton icon="chevron-right" label={R.next} disabledReason={next ? undefined : R.lastInView} onClick={() => next && onNavigate(next)} />
          </span>
        )}
        {drawer && projected && (
          <div className="inspector-top-title">
            <h2 className="inspector-title">{recordTitle(res.key, recordId, actor)}</h2>
            {status && <StatusChip label={status.label} tone={status.tone} />}
          </div>
        )}
        {!drawer && <span className="inspector-crumb muted">{res.labelPlural}</span>}
        {!drawer && <span className="spacer" />}
        {!drawer && onNavigate && (
          <>
            <IconButton icon="chevron-left" label={R.previous} disabledReason={prev ? undefined : R.firstInView} onClick={() => prev && onNavigate(prev)} />
            <IconButton icon="chevron-right" label={R.next} disabledReason={next ? undefined : R.lastInView} onClick={() => next && onNavigate(next)} />
          </>
        )}
        {variant === 'panel' && <IconButton icon={expanded ? 'minimize' : 'maximize'} label={expanded ? R.collapseWidth : R.expandWidth} onClick={() => setExpanded((e) => !e)} className="hide-phone" />}
        {variant === 'panel' && <IconButton icon="layout-dashboard" label={R.openFullPage} onClick={() => navigate(recordPagePath(actor.workspaceId, resKey, recordId))} />}
        {projected && <PinButton actor={actor} res={res} id={recordId} />}
      </div>
      {error || !projected ? (
        <div className="inspector-body">
          <ErrorState title={R.unavailable}>{error?.message ?? R.notFound}</ErrorState>
        </div>
      ) : (
        <>
          <InspectorHeader res={res} actor={actor} p={projected} onEdit={() => (res.form.fullPage ? navigate(recordEditPath(resKey, recordId)) : (setTab('details'), setEditing(true)))} editing={editing} onDeleted={onClose} hideTitle={drawer} editInFooter={drawer} pageActions={variant === 'page'} />
          {!editing && DEAL_CHAIN_RESOURCES.includes(resKey) && <DealChain resKey={resKey} recordId={recordId} actor={actor} />}
          <Tabs<Tab>
            label={R.sections}
            value={tab}
            onChange={setTab}
            tabs={[
              ...(dealHistory ? [{ id: 'dealHistory', label: L.common.deal.tab }] : []),
              { id: 'details', label: R.tabs.details },
              ...getRecordTabs(res.key).map((t) => ({ id: t.id, label: t.label, count: t.count?.({ res, actor, record: projected!.record }) })),
              { id: 'related', label: R.tabs.related },
              { id: 'activity', label: dealHistory || getRecordTabs(res.key).some((t) => t.label === R.tabs.activityHistory) ? R.tabs.changes : R.tabs.activityHistory },
              { id: 'comments', label: R.tabs.comments, count: commentCount },
            ]}
          />
          <div className="inspector-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'dealHistory' && dealHistory && <DealHistoryTab res={res} actor={actor} record={projected.record} />}
            {tab === 'details' && (editing ? <InlineEdit res={res} recordId={recordId} onDone={() => setEditing(false)} /> : <Details res={res} actor={actor} p={projected} />)}
            {tab === 'related' && <Related res={res} actor={actor} record={projected.record} />}
            {tab === 'activity' && <ActivityFeed resKey={resKey} recordId={recordId} />}
            {tab === 'comments' && <CommentThread actor={actor} resKey={resKey} recordId={recordId} />}
            {getRecordTabs(res.key)
              .filter((t) => t.id === tab)
              .map((t) => (
                <t.component key={t.id} res={res} actor={actor} record={projected!.record} />
              ))}
          </div>
          {/* Exactly one composer, outside the tab panels — persists across all four tabs. */}
          {/* the full page shows the composer in its right-hand "Internal comments" card instead */}
          {!(drawer && editing) && variant !== 'page' && <QuickComment key={`${resKey}:${recordId}`} actor={actor} resource={resKey} recordId={recordId} />}
          {variant === 'page' && !editing && (
            <footer className="record-page-foot">
              <Button onClick={onClose}>{C.actions.close}</Button>
              <Button icon="pencil" onClick={() => (setTab('details'), setEditing(true))} disabledReason={editReason(resKey, actor, projected.record, projected.canUpdate)}>
                {C.actions.edit}
              </Button>
            </footer>
          )}
        </>
      )}
      {drawer && !editing && (
        <footer className="dialog-footer">
          <Button onClick={onClose}>{C.actions.close}</Button>
          {projected && (
            <Button variant="primary" icon="pencil" onClick={() => (setTab('details'), setEditing(true))} disabledReason={editReason(resKey, actor, projected.record, projected.canUpdate)}>
              {C.actions.edit}
            </Button>
          )}
        </footer>
      )}
    </aside>
  );

  if (!drawer) {
    if (variant !== 'page' || !projected) return panel;
    // Full record page: main card + right-hand overview cards (owner reference)
    return (
      <div className="record-page-layout">
        {panel}
        <RecordSide res={res} actor={actor} p={projected} />
      </div>
    );
  }
  return createPortal(
    <div className="overlay-scrim overlay-scrim-drawer" onMouseDown={(e) => e.target === e.currentTarget && !editing && onClose()}>
      {panel}
    </div>,
    document.body,
  );
}

function PinButton({ actor, res, id }: { actor: Actor; res: ResourceDefinition; id: string }) {
  const path = recordListPeekPath(actor.workspaceId, res.key, id);
  const pinned = getSettings(actor.user.id).pins.some((p) => p.path === path);
  return <IconButton icon={pinned ? 'pin-off' : 'pin'} label={pinned ? R.unpin : R.pin} pressed={pinned} onClick={() => togglePin(actor, `${id} · ${recordTitle(res.key, id, actor)}`.slice(0, 48), path)} />;
}

/** Why Edit is unavailable: role/scope first, then the resource's own rule (resourceHooks.editBlocked). */
function editReason(resKey: string, actor: Actor, record: RecordData, canUpdate: boolean): string | undefined {
  if (!canUpdate) return C.states.readOnlyFor(actor.role.label);
  const res = getResource(resKey);
  // Closed records (lifecycle terminal, e.g. a Qualified lead) are locked for audit.
  if (res.lifecycle?.terminal.includes(String(record[res.lifecycle.field]))) return L.common.form.lockedForAudit(res.label.toLowerCase());
  return hooksFor(resKey).editBlocked?.(record);
}

function InspectorHeader({ res, actor, p, onEdit, editing, onDeleted, hideTitle, editInFooter, pageActions }: { res: ResourceDefinition; actor: Actor; p: Projected; onEdit: () => void; editing: boolean; onDeleted: () => void; hideTitle?: boolean; editInFooter?: boolean; pageActions?: boolean }) {
  // Full page: the action buttons render inside the right-hand "Actions" card
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (pageActions) setActionsSlot(document.getElementById('record-actions-slot'));
  }, [pageActions]);
  const r = p.record;
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ to: string; text: string; action: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const transitions = availableTransitions(actor, res, r);
  // Primary (purple) action = the next step forward that is allowed now, not whichever transition is listed first
  // (e.g. Proposal → "Mark Under Negotiation", never "Move to Demo").
  const stageMaster = res.lifecycle && res.fields.find((f) => f.key === res.lifecycle!.field)?.master;
  const stageOrder = stageMaster ? getMaster(stageMaster).values.map((v) => v.key) : [];
  const at = (k: unknown) => stageOrder.indexOf(String(k));
  const current = res.lifecycle ? r[res.lifecycle.field] : undefined;
  const allowed = transitions.filter((t) => !t.disabledReason);
  // No forward step allowed yet (e.g. Proposal without a quotation) → no purple button; never promote a step back.
  const primaryTo = (stageOrder.length ? allowed.find((t) => at(t.to) > at(current) && !['lost', 'cancelled'].includes(t.to)) : allowed[0])?.to;
  const statusField = res.lifecycle ? res.fields.find((f) => f.key === res.lifecycle!.field) : res.fields.find((f) => f.key === 'status');
  const status = statusField ? masterValue(statusField.master!, r[statusField.key]) : undefined;
  const Actions = getRecordActions(res.key);
  const Banner = getRecordBanner(res.key);

  const run = (to: string, overrideReason?: string) => {
    try {
      const t = transitions.find((x) => x.to === to)!;
      transitionRecord(actor, res.key, r.id, to, r.version, overrideReason ? { overrideReason } : {});
      toast(C.toasts.actionDone(recordTitle(res.key, r.id, actor), t.action));
    } catch (e) {
      if (e instanceof ServiceError && e.code === 'conflict') {
        toast(e.conflicts?.map((c) => c.message).join(' ') ?? e.message, 'danger');
      } else toast(e instanceof ServiceError ? e.message : C.toasts.actionFailed, 'danger');
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
      <div className={cx(editInFooter && 'inspector-subrow')}>
      <p className="inspector-sub">
        <span className="mono">{r.id}</span>
        <span aria-hidden="true"> · </span>
        <span>{R.updated(relativeTime(r.updatedAt))}</span>
        <span aria-hidden="true"> · </span>
        <span>{R.version(r.version)}</span>
      </p>
      {editInFooter && !editing && (
        // Drawer: workflow actions are icon buttons on the same line as "ID · Updated · version"
        <div className="inspector-icon-actions">
          <MoveStageButton res={res} actor={actor} record={r} onRun={(t) => (t.confirm ? setConfirm({ to: t.to, text: t.confirm, action: t.action }) : run(t.to))} />
          <RecordApprovalActions resource={res.key} recordId={r.id} />
          {Actions && <Actions res={res} actor={actor} record={r} />}
          <IconButton ref={moreRef} icon="more" label={C.actions.moreActions} aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)} />
        </div>
      )}
      </div>
      {Banner && <Banner res={res} actor={actor} record={r} />}
      {!editing && !editInFooter && (actionsSlot ? actionsSlot && createPortal(<div className="inspector-actions">
          {transitions.map((t) => (
            <Button
              key={t.to}
              icon={actionIcon(t.action)}
              variant={t.to === primaryTo ? 'primary' : 'secondary'}
              data-tooltip={t.disabledReason ? undefined : t.action}
              disabledReason={t.disabledReason}
              onClick={() => (t.confirm ? setConfirm({ to: t.to, text: t.confirm, action: t.action }) : run(t.to))}
            >
              {t.action}
            </Button>
          ))}
          {/* In drawers, Edit lives in the footer next to Cancel (owner rule) */}
          {!editInFooter && (
            <Button icon="pencil" variant="ghost" className="inspector-edit-btn" onClick={onEdit} disabledReason={editReason(res.key, actor, r, p.canUpdate)}>
              {C.actions.edit}
            </Button>
          )}
          <RecordApprovalActions resource={res.key} recordId={r.id} />
          {Actions && <Actions res={res} actor={actor} record={r} />}
          <IconButton ref={moreRef} icon="more" label={C.actions.moreActions} aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)} />
        </div>, actionsSlot) : (
        <div className="inspector-actions">
          {transitions.map((t) => (
            <Button
              key={t.to}
              icon={actionIcon(t.action)}
              variant={t.to === primaryTo ? 'primary' : 'secondary'}
              data-tooltip={t.disabledReason ? undefined : t.action}
              disabledReason={t.disabledReason}
              onClick={() => (t.confirm ? setConfirm({ to: t.to, text: t.confirm, action: t.action }) : run(t.to))}
            >
              {t.action}
            </Button>
          ))}
          {/* In drawers, Edit lives in the footer next to Cancel (owner rule) */}
          {!editInFooter && (
            <Button icon="pencil" variant="ghost" className="inspector-edit-btn" onClick={onEdit} disabledReason={editReason(res.key, actor, r, p.canUpdate)}>
              {C.actions.edit}
            </Button>
          )}
          <RecordApprovalActions resource={res.key} recordId={r.id} />
          {Actions && <Actions res={res} actor={actor} record={r} />}
          <IconButton ref={moreRef} icon="more" label={C.actions.moreActions} aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)} />
        </div>
      ))}
      {/* the More-actions menu lives outside the action rows so it works for both the drawer (icon line) and the page layout */}
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={moreRef}
        label={R.moreRecordActions}
        items={[
          {
            id: 'copy',
            label: C.actions.copyLink,
            icon: 'copy',
            onSelect: () => {
              navigator.clipboard?.writeText(window.location.origin + recordListPeekPath(actor.workspaceId, res.key, r.id)).catch(() => {}); // clipboard may be blocked — never crash
              toast(C.toasts.linkCopied);
            },
          },
          { id: 'delete', label: C.actions.delete, icon: 'trash', danger: true, separatorBefore: true, disabledReason: perm(actor, res.key).delete ? undefined : R.cannotDelete, onSelect: () => setDeleting(true) },
        ]}
      />
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.action ?? ''}
        size="sm"
        role="alertdialog"
        footer={
          <>
            <Button onClick={() => setConfirm(null)} data-autofocus>
              {C.actions.keepAsIs}
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
        title={C.confirm.deleteTitle(r.id)}
        size="sm"
        role="alertdialog"
        footer={
          <>
            <Button onClick={() => setDeleting(false)} data-autofocus>
              {C.actions.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                try {
                  deleteRecord(actor, res.key, r.id);
                  toast(C.toasts.deleted(r.id));
                  setDeleting(false);
                  onDeleted();
                } catch (e) {
                  toast(e instanceof ServiceError ? e.message : C.toasts.deleteFailed, 'danger');
                  setDeleting(false);
                }
              }}
            >
              {C.actions.delete}
            </Button>
          </>
        }
      >
        <p>{C.confirm.deleteBody}</p>
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
        // Same visibility rules as the form (visibleWhen): spec fields of another product sub-type are not listed.
        const fields = s.fields.map((k) => res.fields.find((f) => f.key === k)).filter((f): f is FieldDefinition => !!f && p.access[f.key] !== 'hide' && isVisible(f, p.record));
        if (!fields.length) return null;
        return (
          <section key={s.id} className="detail-section">
            <h3 className="detail-section-title">{s.title}</h3>
            <dl className="detail-list">
              {fields.map((f) => (
                <div key={f.key} className="detail-row" data-type={f.type}>
                  <dt>
                    <Icon name={fieldIcon(f)} size={16} className="detail-icon" />
                    {f.label}
                  </dt>
                  <dd>
                    {f.type === 'lineitems' && p.access[f.key] !== 'mask' ? (
                      <LineItemsTable items={lineItemsOf(p.record, f.key)} caption={L.common.lineItems.caption(f.label, p.record.id)} />
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
          <h3 className="detail-section-title">{R.calculated}</h3>
          <dl className="detail-list">
            {extra.map((f) => (
              <div key={f.key} className="detail-row" data-type={f.type}>
                <dt>
                  <Icon name={fieldIcon(f)} size={16} className="detail-icon" />
                  {f.label}
                </dt>
                <dd>
                  <FieldValue field={f} value={p.record[f.key]} access={p.access[f.key]} actor={actor} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="detail-section">
        <h3 className="detail-section-title">{R.system}</h3>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>{R.created}</dt>
            <dd>
              <DateText value={p.record.createdAt} showTime /> {R.by} {getUser(p.record.createdBy)?.name ?? (p.record.createdBy === 'system_seed' ? R.syntheticSeed : p.record.createdBy)}
            </dd>
          </div>
          <div className="detail-row">
            <dt>{R.versionLabel}</dt>
            <dd>{p.record.version}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function InlineEdit({ res, recordId, onDone }: { res: ResourceDefinition; recordId: string; onDone: () => void }) {
  const form = useRecordForm({ resKey: res.key, recordId });
  const toast = useToast();
  const guard = useUnsavedGuard(form.dirty, onDone);
  const save = async (overrideReason?: string) => {
    const out = await form.submit({ overrideReason });
    if (out) {
      toast(C.toasts.saved(recordId));
      onDone();
    }
  };
  return (
    <div className="inspector-edit">
      <FormBody form={form}>
        <ConflictPanel form={form} onOverride={(r) => save(r)} />
      </FormBody>
      <div className="inspector-edit-bar">
        <Button onClick={guard.requestClose}>{C.actions.cancel}</Button>
        <Button variant="primary" loading={form.submitting} onClick={() => save()}>
          {C.actions.saveChanges}
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
  if (!res.relationships.length && !relationFields.length) return <EmptyState title={R.noRelated}>{R.noRelationships}</EmptyState>;
  return (
    <div className="related">
      {relationFields.length > 0 && (
        <section className="detail-section">
          <h3 className="detail-section-title">{R.linkedTo}</h3>
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
                <span className="restricted">{C.states.notAvailableFor(actor.role.label)}</span>
              </p>
            </section>
          );
        }
        // Newest first: the calendar start, else the target's own default view sort (e.g. activities by date), else creation time.
        const viewSort = target.views[0]?.sort?.[0];
        const sort = target.calendar?.startField ? { field: target.calendar.startField, dir: 'desc' as const } : viewSort ?? { field: 'createdAt', dir: 'desc' as const };
        const { rows, total } = queryRecords(actor, rel.resource, { where: { [rel.foreignKey]: record.id }, sort: [sort], pageSize: 8 });
        const dateField = target.fields.find((f) => f.key === sort.field && (f.type === 'date' || f.type === 'datetime'));
        const byField = target.ownerField ? target.fields.find((f) => f.key === target.ownerField && f.type === 'relation') : undefined;
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
                  {C.actions.new}
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
                      {(dateField || byField) && (
                        <span className="muted small">
                          {dateField && r[dateField.key] ? <DateText value={String(r[dateField.key])} showTime={dateField.type === 'datetime'} /> : null}
                          {dateField && dateField.type === 'datetime' && r[dateField.key] ? ` ${formatTime(String(r[dateField.key]))}` : ''}
                          {byField && r[byField.key] ? ` · ${recordTitle(byField.relation!.resource, r[byField.key], actor)}` : ''}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">{R.noneVisible(total === 0 && perm(actor, rel.resource).read === 'own')}</p>
            )}
            {total > rows.length && <p className="muted">{R.showing(rows.length, total)}</p>}
          </section>
        );
      })}
      <QuickCreateDialog
        open={!!creating}
        resKey={creating?.resource ?? res.key}
        initial={creating ? { [creating.fk]: record.id } : undefined}
        onClose={() => setCreating(null)}
        onCreated={(r) => {
          toast(C.toasts.linked(r.id, record.id));
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
        {R.recentChanges}
        <InfoTip text={R.changesAbout} label={R.changesAboutLabel} />
      </h3>
      {items.length ? (
        <ol className="timeline">
          {items.map((a) => (
            <li key={a.id} className="timeline-item">
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <p>
                  <strong>{getUser(a.actorId)?.name ?? a.actorId}</strong> {a.actorType === 'workflow' && <span className="tag">{R.workflow}</span>} {a.summary}
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
        <EmptyState icon="activity" title={R.noChanges}>
          {R.noChangesBody}
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
                <span className="tag">{R.internal}</span>
                <time className="muted small" dateTime={c.createdAt}>
                  {relativeTime(c.createdAt)}
                </time>
              </div>
              <p className="thread-body">{c.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon="message" title={R.noComments}>
          {R.noCommentsBody}
        </EmptyState>
      )}
    </div>
  );
}

/** Icon for a workflow action, from its wording (Check in, No-show, Cancel, Start, Complete, Reopen, Issue…). */
function actionIcon(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('block')) return 'ban';
  if (a.includes('hold') || a.includes('pause')) return 'pause';
  if (a.includes('archive')) return 'archive';
  if (a.includes('paid') || a.includes('payment')) return 'f-money';
  if (a.includes('write off') || a.includes('write-off') || a.includes('void')) return 'x-circle';
  if (a.includes('check in') || a.includes('check-in')) return 'log-in';
  if (a.includes('no-show') || a.includes('no show')) return 'user-x';
  if (a.includes('cancel') || a.includes('reject') || a.includes('decline')) return 'x-circle';
  if (a.includes('start') || a.includes('begin')) return 'play';
  if (a.includes('complete') || a.includes('done') || a.includes('finish') || a.includes('confirm') || a.includes('approve')) return 'check-circle';
  if (a.includes('reopen') || a.includes('restore') || a.includes('reset')) return 'reset';
  if (a.includes('issue') || a.includes('send') || a.includes('submit')) return 'send';
  return 'arrow-right';
}

/** Right-hand cards on the full record page: overview (status + when), people, details, internal comments. */
function RecordSide({ res, actor, p }: { res: ResourceDefinition; actor: Actor; p: Projected }) {
  const r = p.record;
  const vis = (f: FieldDefinition) => p.access[f.key] && p.access[f.key] !== 'hide';
  const statusField = res.fields.find((f) => f.key === (res.lifecycle?.field ?? 'status'));
  const status = statusField?.master ? masterValue(statusField.master, r[statusField.key]) : undefined;
  const when = res.fields.find((f) => (f.type === 'datetime' || f.type === 'date') && vis(f) && r[f.key]);
  const duration = res.fields.find((f) => f.type === 'number' && /^(min|mins|minutes|h|hours)$/i.test(f.unit ?? '') && vis(f));
  const people = res.fields.filter((f) => f.type === 'relation' && f.relation!.resource === 'employees' && vis(f) && r[f.key]);
  const details = res.fields.filter((f) => vis(f) && !f.system && f !== statusField && f !== when && f !== duration && !people.includes(f) && ['master', 'relation', 'money', 'text', 'boolean'].includes(f.type) && f.key !== res.titleField).slice(0, 6);
  return (
    <div className="record-side">
      <section className="panel rs-card">
        <h2>{R.sideActions}</h2>
        <div id="record-actions-slot" className="rs-actions" />
      </section>
      <section className="panel rs-card">
        <div className="rs-head">
          <h2>{R.overview(res.label)}</h2>
          {status && <StatusChip label={status.label} tone={status.tone} />}
        </div>
        {when && (
          <div className="rs-when">
            <Icon name="f-datetime" size={18} className="rs-icon" />
            <span>
              <DateText value={String(r[when.key])} showTime={when.type === 'datetime'} />
              {when.type === 'datetime' && <span className="rs-time">{formatTime(String(r[when.key]))}</span>}
              {duration && r[duration.key] != null && (
                <span className="muted rs-sub">
                  {duration.label} · {String(r[duration.key])} {duration.unit}
                </span>
              )}
            </span>
          </div>
        )}
      </section>
      {people.length > 0 && (
        <section className="panel rs-card">
          <h2>{R.people}</h2>
          <ul className="rs-list">
            {people.map((f) => (
              <li key={f.key}>
                <Link className="rs-person" to={recordPagePath(actor.workspaceId, f.relation!.resource, String(r[f.key]))}>
                  <Icon name={f.relation!.resource === 'employees' ? 'f-person' : 'users'} size={18} className="rs-icon" />
                  <span>
                    <span className="muted rs-sub">{f.label}</span>
                    <span className="rs-link">{recordTitle(f.relation!.resource, r[f.key], actor)}</span>
                  </span>
                  <Icon name="chevron-right" size={16} className="rs-chev" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {details.length > 0 && (
        <section className="panel rs-card">
          <h2>{R.details}</h2>
          <ul className="rs-list">
            {details.map((f) => (
              <li key={f.key} className="rs-item">
                <Icon name={fieldIcon(f)} size={18} className="rs-icon" />
                <span>
                  <span className="muted rs-sub">{f.label}</span>
                  <FieldValue field={f} value={r[f.key]} access={p.access[f.key]} actor={actor} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel rs-card">
        <h2>
          <Icon name="message" size={16} /> {R.internalComments}
        </h2>
        <QuickComment key={`${res.key}:${r.id}`} actor={actor} resource={res.key} recordId={r.id} />
      </section>
    </div>
  );
}
