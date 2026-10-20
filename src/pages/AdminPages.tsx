/**
 * Administration & Configuration pages (BRD 4.14): Masters (ADM-03), Custom Fields & Form Layouts (ADM-05),
 * Roles & Permissions (ADM-02), Audit Trail with the System Events view (COM-09) and Demo Settings.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { L } from '../constants/labels';
import { ROUTES } from '../constants/routes';
import type { FieldAccess, FieldDefinition, MasterDefinition, ResourcePermission, RoleDefinition, RowScope, Tone } from '../metadata/types';
import { cx } from '../lib/format';
import { recordPeekPath, resourcePath } from '../lib/routes';
import { tokenRegistry } from '../tokens/tokens';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { errorMessage } from '../services/api/client';
import { resetLayout, resetRole, saveLayout, saveRole } from '../services/api/catalog';
import { actorFor, can, canReadResource, fieldAccess } from '../services/authz';
import { getRoleMatrix, LOCKED_ROLES, SCOPES, validateRolePermissions } from '../services/catalog/access';
import { getFormLayout, layoutResources, listFormLayouts, sectionHasRequired, validateFormLayout } from '../services/catalog/formLayouts';
import { addDraftField, discardDraft, draftSummary, ensureDraft, getDraft, type NewFieldSpec, publishDraft, removeDraftField, revertDraftMaster, setDraftMaster, validateDraft, type ConfigIssue } from '../services/config';
import { getDb, resetDb, STORAGE_KEY } from '../services/db';
import { demoUsers, NO_ACCESS } from '../domain/pack';
import { DataTransfer, DemoControls } from './DemoPages';
import { useActor, useRevision } from '../services/hooks';
import { activeMasterValues, allMasters, allResources, getMaster, getResource, getUser, masterLabel } from '../services/registry';
import { ServiceError } from '../services/types';
import { Button, IconButton } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, StatusChip, Tabs, useToast } from '../components/primitives/feedback';
import { SelectMenu } from '../components/primitives/SelectMenu';
import { DatePicker } from '../components/primitives/DatePicker';
import { InfoTip } from '../components/primitives/InfoTip';
import { confirmDelete } from '../components/primitives/overlay';
import { relativeTime } from '../lib/dates';
import { DateText, EmptyValue } from '../components/primitives/display';
import { DangerZone, SaveBar, SettingsField, SettingsPage, SettingsSection, SettingsSkeleton } from '../components/settings/kit';
import { byTime, QuickGuide, SortPicker, type SortDir, usePaged } from '../modules/catalog/kit';
import { AccessSimple } from '../modules/catalog/AccessSimple';
import { ExpiringAccess } from '../modules/catalog/ExpiringAccess';
import { PeopleAccess } from '../modules/catalog/PeopleAccess';
import { listActiveGrants, listPeople } from '../services/catalog/grants';

const A = L.admin;
const TONES: Tone[] = ['neutral', 'info', 'success', 'warning', 'danger', 'accent'];

// ---------------------------------------------------------------- shared configuration draft (Masters, Custom Fields)

/** Draft → Validate → Publish controls shared by Masters and Custom Fields & Form Layouts. */
function useConfigDraft() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const [issues, setIssues] = useState<ConfigIssue[] | null>(null);
  const draft = getDraft();
  const summary = draft ? draftSummary(draft) : [];
  const errors = issues?.filter((i) => i.severity === 'error') ?? [];
  const D = A.draft;

  const actions = draft ? (
    <>
      <Button
        onClick={() =>
          confirmDelete({
            title: D.discardTitle,
            message: D.discardMessage,
            confirmLabel: D.discard,
            onConfirm: () => {
              discardDraft(actor);
              setIssues(null);
              toast(D.discarded, 'info');
            },
          })
        }
      >
        {D.discard}
      </Button>
      <Button icon="check" onClick={() => setIssues(validateDraft(draft))}>
        {D.validate}
      </Button>
      <Button
        variant="primary"
        disabledReason={!issues ? D.validateFirst : errors.length ? D.validationErrors(errors.length) : !summary.length ? D.noChanges : undefined}
        onClick={() => {
          try {
            publishDraft(actor);
            setIssues(null);
            toast(D.published);
          } catch (e) {
            toast(e instanceof ServiceError ? e.message : D.publishFailed, 'danger');
          }
        }}
      >
        {D.publish}
      </Button>
    </>
  ) : (
    <Button variant="primary" icon="pencil" onClick={() => ensureDraft(actor)}>
      {D.start}
    </Button>
  );

  const banner = (
    <>
      {draft ? (
        <InlineAlert tone="info" title={D.by(getUser(draft.createdBy)?.name ?? draft.createdBy, relativeTime(draft.updatedAt))}>
          {summary.length ? D.pending(summary.length) : D.empty}
        </InlineAlert>
      ) : (
        <p className="muted">{D.publishedVersion(getDb().config.version)}</p>
      )}
      {issues && (
        <section className="panel validation" aria-live="polite">
          <h2 className="panel-title">{D.validationTitle}</h2>
          {issues.length === 0 && <p className="text-success">{D.noIssues}</p>}
          <ul className="plain-list">
            {issues.map((i, n) => (
              <li key={n} className={i.severity === 'error' ? 'text-danger' : 'text-warning'}>
                <Icon name="alert" size={12} /> <strong>{i.severity === 'error' ? D.error : D.warning}:</strong> {i.message}
              </li>
            ))}
          </ul>
          {summary.length > 0 && (
            <>
              <h3 className="detail-section-title">{D.changesToPublish}</h3>
              <ul className="plain-list bullets">
                {summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );

  return { actions, banner, onChange: () => setIssues(null) };
}

// ---------------------------------------------------------------- Masters (ADM-03)

type MastersTab = 'masters' | 'records' | 'history';

/** Resource lists that are masters in BRD terms (ADM-03): Product & Price Master, T&C templates. */
const RECORD_MASTERS = ['products', 'priceLists', 'priceListItems', 'termsTemplates'];

export function MastersPage() {
  const actor = useActor();
  const [tab, setTab] = useState<MastersTab>('masters');
  const d = useConfigDraft();
  if (!can(actor, 'config.publish')) return <NoAccess what={A.masters.noAccessWhat} />;
  const M = A.masters;
  return (
    <SettingsPage title={L.nav.pages.masters.title} description={M.short} actions={d.actions}>
      {d.banner}
      <Tabs<MastersTab>
        label={M.sectionsLabel}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'masters', label: M.tabs.masters, count: allMasters().length },
          { id: 'records', label: M.tabs.records },
          { id: 'history', label: M.tabs.history, count: getDb().config.history.length },
        ]}
      />
      <div className="st-stack" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'masters' && <MastersEditor onChange={d.onChange} />}
        {tab === 'records' && <RecordMasters />}
        {tab === 'history' && <History />}
      </div>
    </SettingsPage>
  );
}

/** @deprecated App.tsx still imports the old name; same page as MastersPage. */
export const StudioPage = MastersPage;

function RecordMasters() {
  const actor = useActor();
  const keys = RECORD_MASTERS.filter((k) => allResources().some((r) => r.key === k) && canReadResource(actor, k));
  return (
    <div className="cat-stack">
      <p className="muted">{A.masters.recordMastersIntro}</p>
      <ul className="plain-list">
        {keys.map((k) => {
          const r = getResource(k);
          return (
            <li key={k} className="row-between">
              <span>
                <strong>{r.labelPlural}</strong> <span className="muted small">· {r.description}</span>
              </span>
              <Link className="link" to={resourcePath(actor.workspaceId, k)}>
                {A.masters.open}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MastersEditor({ onChange }: { onChange: () => void }) {
  const actor = useActor();
  const M = A.masters;
  const masters = allMasters();
  const [sel, setSel] = useState(masters[0].key);
  const [newLabel, setNewLabel] = useState('');
  const draft = getDraft();
  const editing = draft?.masters[sel];
  const m: MasterDefinition = editing ?? getMaster(sel);
  const editable = !!draft;
  const write = (next: MasterDefinition) => {
    setDraftMaster(actor, next);
    onChange();
  };
  const setVal = (key: string, patch: Partial<MasterDefinition['values'][number]>) => write({ ...m, values: m.values.map((v) => (v.key === key ? { ...v, ...patch } : v)) });
  const move = (key: string, dir: -1 | 1) => {
    const sorted = [...m.values].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((v) => v.key === key);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    write({ ...m, values: sorted.map((v, k) => ({ ...v, order: k })) });
  };
  const duplicate = !!newLabel.trim() && m.values.some((v) => v.label.toLowerCase() === newLabel.trim().toLowerCase());
  return (
    <section className="st-card st-editor">
      <SettingsField label={M.pick} htmlFor="master-pick">
        <SelectMenu
          id="master-pick"
          searchable
          label={M.pick}
          value={sel}
          options={masters.map((x) => ({ value: x.key, label: `${x.label}${draft?.masters[x.key] ? ` · ${M.draftBadge}` : ''}` }))}
          onChange={setSel}
        />
      </SettingsField>
      <div className="st-section-head">
        <h2 className="st-section-title">{m.label}</h2>
        <p className="st-help">
          {M.meta(m.key, getMaster(sel).version)}
          {m.description ? ` · ${m.description}` : ''}
        </p>
        {editing && (
          <div className="st-section-actions">
            <Button variant="ghost" icon="reset" onClick={() => revertDraftMaster(actor, sel)}>
              {M.revert}
            </Button>
          </div>
        )}
      </div>
      {!editable && <InlineAlert tone="info">{M.readOnly}</InlineAlert>}
      <div className="table-scroll">
        <table className="mini-table st-masters">
          <thead>
            <tr>
              <th scope="col">{M.columns.label}</th>
              <th scope="col">{M.columns.tone}</th>
              <th scope="col">{M.columns.active}</th>
              <th scope="col">
                <span className="sr-only">{M.columns.order}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...m.values]
              .sort((a, b) => a.order - b.order)
              .map((v) => (
                <tr key={v.key} className={cx(!v.active && 'is-inactive')}>
                  <td>
                    <input className="input" aria-label={M.labelFor(v.key)} value={v.label} maxLength={80} disabled={!editable} onChange={(e) => setVal(v.key, { label: e.target.value })} />
                    <span className="field-help">
                      <code>{v.key}</code>
                      {v.parent ? ` · ${v.parent}` : ''}
                    </span>
                  </td>
                  <td>
                    <SelectMenu label={M.toneFor(v.key)} value={v.tone ?? 'neutral'} disabled={!editable} options={TONES.map((t) => ({ value: t, label: A.tones[t] }))} onChange={(t) => setVal(v.key, { tone: t as Tone })} />
                  </td>
                  <td>
                    <label className="switch st-switch">
                      <input type="checkbox" role="switch" checked={v.active} disabled={!editable} onChange={(e) => setVal(v.key, { active: e.target.checked })} aria-label={M.activeFor(v.key)} />
                      <span className="switch-track" aria-hidden="true" />
                    </label>
                  </td>
                  <td className="li-actions">
                    <IconButton icon="arrow-up" label={M.moveUp(v.key)} disabled={!editable} onClick={() => move(v.key, -1)} />
                    <IconButton icon="arrow-down" label={M.moveDown(v.key)} disabled={!editable} onClick={() => move(v.key, 1)} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <form
          className="st-add"
          onSubmit={(e) => {
            e.preventDefault();
            const label = newLabel.trim();
            if (!label || duplicate) return;
            const key = label
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_|_$/g, '')
              .replace(/^(\d)/, 'v_$1');
            if (!key) return;
            write({ ...m, values: [...m.values, { key, label, tone: 'neutral', active: true, order: m.values.length }] });
            setNewLabel('');
          }}
        >
          <SettingsField label={M.newValue} htmlFor="new-master-value" error={duplicate ? M.duplicateValue : undefined}>
            <input id="new-master-value" className="input" maxLength={80} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} aria-invalid={duplicate || undefined} />
          </SettingsField>
          <Button type="submit" icon="plus" disabledReason={!newLabel.trim() ? M.newValue : duplicate ? M.duplicateValue : undefined}>
            {M.addValue}
          </Button>
        </form>
      )}
    </section>
  );
}

function History() {
  const h = getDb().config.history;
  const paged = usePaged(h);
  if (!h.length) return <EmptyState icon="scroll-text" title={A.history.emptyTitle}>{A.history.emptyBody}</EmptyState>;
  return (
    <>
      <ol className="timeline">
        {paged.shown.map((v) => (
          <li key={v.id} className="timeline-item">
            <span className="timeline-dot" aria-hidden="true" />
            <div>
              <p>
                <strong>v{v.version}</strong> {A.history.publishedBy(getUser(v.publishedBy)?.name ?? v.publishedBy)} ·{' '}
                <span className="muted">
                  <DateText value={v.publishedAt} showTime />
                </span>
              </p>
              <ul className="change-list">
                {v.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      {paged.footer(A.masters.tabs.history.toLowerCase())}
    </>
  );
}

// ---------------------------------------------------------------- Custom Fields & Form Layouts (ADM-05)

type FieldsTab = 'fields' | 'layouts' | 'registry' | 'history';

export function CustomFieldsPage() {
  const actor = useActor();
  const [tab, setTab] = useState<FieldsTab>('fields');
  const d = useConfigDraft();
  if (!can(actor, 'config.publish')) return <NoAccess what={A.customFields.noAccessWhat} />;
  const C = A.customFields;
  return (
    <SettingsPage title={L.nav.pages.customFields.title} description={C.short} actions={tab === 'fields' ? d.actions : undefined}>
      {tab === 'fields' && d.banner}
      <Tabs<FieldsTab>
        label={C.sectionsLabel}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'fields', label: C.tabs.fields },
          { id: 'layouts', label: C.tabs.layouts },
          { id: 'registry', label: C.tabs.registry },
          { id: 'history', label: C.tabs.history, count: getDb().config.history.length },
        ]}
      />
      <div className="st-stack" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'fields' && <FieldsEditor onChange={d.onChange} />}
        {tab === 'layouts' && <FormLayoutsEditor />}
        {tab === 'registry' && <Registry />}
        {tab === 'history' && <History />}
      </div>
    </SettingsPage>
  );
}

const SENSITIVITY_OPTIONS = ['none', 'identifier', 'health', 'financial'] as const;
const FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'boolean', 'master'] as const;

function FieldsEditor({ onChange }: { onChange: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const C = A.customFields;
  const draft = getDraft();
  const resources = allResources();
  const [spec, setSpec] = useState<NewFieldSpec>({ resource: resources[0].key, key: '', label: '', type: 'text', required: false, sensitivity: 'none' });
  const set = (p: Partial<NewFieldSpec>) => setSpec((s) => ({ ...s, ...p }));
  const custom = resources.flatMap((r) => (getDb().config.customFields[r.key] ?? []).map((f) => ({ r, f })));
  return (
    <div className="fields-editor">
      <section className="panel">
        <h2 className="panel-title">{C.addTitle}</h2>
        {!draft && <InlineAlert tone="info">{C.startDraftToAdd}</InlineAlert>}
        <form
          className="form-grid cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              addDraftField(actor, spec);
              onChange();
              toast(C.added(spec.label));
              setSpec((s) => ({ ...s, key: '', label: '', defaultValue: undefined, help: '' }));
            } catch (err) {
              toast(err instanceof ServiceError ? err.message : A.common.failed, 'danger');
            }
          }}
        >
          <div className="form-field">
            <label className="field-label" htmlFor="nf-res">
              {A.common.recordType}
            </label>
            <SelectMenu id="nf-res" block searchable label={A.common.recordType} value={spec.resource} disabled={!draft} options={resources.map((r) => ({ value: r.key, label: r.labelPlural }))} onChange={(v) => set({ resource: v })} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-label">
              {C.label} <span className="req">*</span>
            </label>
            <input
              id="nf-label"
              className="input"
              value={spec.label}
              disabled={!draft}
              onChange={(e) =>
                set({
                  label: e.target.value,
                  key: e.target.value
                    .trim()
                    .replace(/[^a-zA-Z0-9 ]/g, '')
                    .split(/\s+/)
                    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]?.toUpperCase() + w.slice(1).toLowerCase()))
                    .join(''),
                })
              }
            />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-key">
              {C.key}
            </label>
            <input id="nf-key" className="input mono" value={spec.key} disabled={!draft} onChange={(e) => set({ key: e.target.value })} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-type">
              {C.type}
            </label>
            <SelectMenu id="nf-type" block label={C.type} value={spec.type} disabled={!draft} options={FIELD_TYPES.map((t) => ({ value: t, label: A.fieldTypes[t] }))} onChange={(v) => set({ type: v as NewFieldSpec['type'], defaultValue: undefined })} />
          </div>
          {spec.type === 'master' && (
            <div className="form-field">
              <label className="field-label" htmlFor="nf-master">
                {C.masterList}
              </label>
              <SelectMenu id="nf-master" block searchable label={C.masterList} placeholder={C.choose} value={spec.master ?? ''} disabled={!draft} options={allMasters().map((m) => ({ value: m.key, label: m.label }))} onChange={(v) => set({ master: v })} />
            </div>
          )}
          <div className="form-field">
            <label className="field-label" htmlFor="nf-sens">
              {C.sensitivity}
            </label>
            <SelectMenu id="nf-sens" block label={C.sensitivity} value={spec.sensitivity ?? 'none'} disabled={!draft} options={SENSITIVITY_OPTIONS.map((s) => ({ value: s, label: L.common.sensitivity[s] }))} onChange={(v) => set({ sensitivity: v as NewFieldSpec['sensitivity'] })} />
          </div>
          <div className="form-field">
            <label className="check">
              <input type="checkbox" checked={spec.required} disabled={!draft} onChange={(e) => set({ required: e.target.checked })} /> {C.required}
            </label>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-default">
              {C.defaultValue} {spec.required ? C.defaultNeeded : C.optional}
            </label>
            {spec.type === 'boolean' ? (
              <SelectMenu
                id="nf-default"
                block
                label={C.defaultValue}
                value={spec.defaultValue === undefined ? '' : String(spec.defaultValue)}
                disabled={!draft}
                options={[
                  { value: '', label: A.common.none },
                  { value: 'true', label: A.common.yes },
                  { value: 'false', label: A.common.no },
                ]}
                onChange={(v) => set({ defaultValue: v === '' ? undefined : v === 'true' })}
              />
            ) : spec.type === 'master' && spec.master ? (
              <SelectMenu id="nf-default" block label={C.defaultValue} value={String(spec.defaultValue ?? '')} disabled={!draft} options={[{ value: '', label: A.common.none }, ...getMaster(spec.master).values.map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => set({ defaultValue: v || undefined })} />
            ) : spec.type === 'date' ? (
              <DatePicker id="nf-default" block label={C.defaultValue} value={String(spec.defaultValue ?? '')} disabled={!draft} onChange={(v) => set({ defaultValue: v ?? undefined })} />
            ) : (
              <input
                id="nf-default"
                className="input"
                type={spec.type === 'number' ? 'number' : 'text'}
                value={String(spec.defaultValue ?? '')}
                disabled={!draft}
                onChange={(e) => set({ defaultValue: e.target.value === '' ? undefined : spec.type === 'number' ? Number(e.target.value) : e.target.value })}
              />
            )}
          </div>
          <div className="form-field span-2">
            <label className="field-label" htmlFor="nf-help">
              {C.help} <span className="optional">{C.optional}</span>
            </label>
            <input id="nf-help" className="input" value={spec.help ?? ''} disabled={!draft} onChange={(e) => set({ help: e.target.value })} />
          </div>
          <div className="span-2">
            <Button type="submit" icon="plus" disabledReason={!draft ? C.startDraftFirst : !spec.label.trim() || !spec.key ? C.enterLabel : undefined}>
              {C.addToDraft}
            </Button>
          </div>
        </form>
      </section>
      {draft && draft.newFields.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">{C.inDraft}</h2>
          <ul className="plain-list">
            {draft.newFields.map(({ resource, field }) => (
              <li key={field.id} className="row-between">
                <span>
                  {getResource(resource).labelPlural} › <strong>{field.label}</strong> <code>{field.key}</code> · {A.fieldTypes[field.type as keyof typeof A.fieldTypes] ?? field.type}
                  {field.required ? ` · ${C.requiredSuffix}` : ''}
                  {field.sensitivity && field.sensitivity !== 'none' ? ` · ${A.sensitivity[field.sensitivity]}` : ''}
                </span>
                <IconButton
                  icon="trash"
                  label={C.removeFromDraft(field.label)}
                  onClick={() =>
                    confirmDelete({
                      title: C.removeTitle(field.label),
                      message: C.removeMessage,
                      confirmLabel: A.common.remove,
                      onConfirm: () => removeDraftField(actor, field.id),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel">
        <h2 className="panel-title">{C.published}</h2>
        {custom.length ? (
          <ul className="plain-list">
            {custom.map(({ r, f }) => (
              <li key={f.id}>
                {r.labelPlural} › <strong>{f.label}</strong> <code>{f.key}</code> · {A.fieldTypes[f.type as keyof typeof A.fieldTypes] ?? f.type} — {C.publishedLine}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{C.noneYet}</p>
        )}
      </section>
    </div>
  );
}

/** Per-division form layout editor (G-A15): section order + visibility for one record type and division. */
function FormLayoutsEditor() {
  const actor = useActor();
  const toast = useToast();
  const F = A.formLayouts;
  const resources = layoutResources();
  const divisions = activeMasterValues('division');
  const [resKey, setResKey] = useState(resources[0]?.key ?? '');
  const [division, setDivision] = useState(divisions[0]?.key ?? '');
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const saved = useServiceQuery(() => listFormLayouts(actor), [actor.user.id]);
  const res = resKey ? getResource(resKey) : undefined;
  const current = getFormLayout(resKey, division);
  const shippedOrder = res?.form.sections.map((s) => s.id) ?? [];
  const savedOrder = current ? [...current.order.filter((id) => shippedOrder.includes(id)), ...shippedOrder.filter((id) => !current.order.includes(id))] : shippedOrder;
  const savedHidden = current?.hidden ?? [];
  const sig = `${resKey}|${division}|${current?.version ?? 0}`;

  // Load the stored layout whenever the record type, division or stored version changes.
  useEffect(() => {
    setOrder(savedOrder);
    setHidden(savedHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!res) return <EmptyState icon="columns" title={F.noResources} />;
  const dirty = JSON.stringify(order) !== JSON.stringify(savedOrder) || JSON.stringify([...hidden].sort()) !== JSON.stringify([...savedHidden].sort());
  const errors = order.length ? validateFormLayout({ resource: resKey, division, order, hidden }) : [];
  const sections = order.map((id) => res.form.sections.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  const divLabel = masterLabel('division', division);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const save = async () => {
    if (errors.length) {
      toast(errors[0], 'danger');
      return;
    }
    setBusy(true);
    try {
      await saveLayout(actor, { resource: resKey, division, order, hidden });
      toast(F.saved(res.labelPlural, divLabel));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-stack st-stack-flush">
      <p className="st-help">{F.intro}</p>
      <div className="st-pair">
        <SettingsField label={F.resource} htmlFor="fl-res">
          <SelectMenu id="fl-res" searchable label={F.resource} value={resKey} options={resources.map((r) => ({ value: r.key, label: r.labelPlural }))} onChange={setResKey} />
        </SettingsField>
        <SettingsField label={F.division} htmlFor="fl-div">
          <SelectMenu id="fl-div" label={F.division} value={division} options={divisions.map((d) => ({ value: d.key, label: d.label }))} onChange={setDivision} />
        </SettingsField>
      </div>
      <div>{current ? <Badge tone="accent">{F.customised}</Badge> : <Badge tone="neutral">{F.shipped}</Badge>}</div>
      {current && <p className="muted small">{F.lastChanged(getUser(current.updatedBy)?.name ?? current.updatedBy, relativeTime(current.updatedAt))}</p>}
      <div className="cat-grid">
        <section className="panel">
          <h2 className="panel-title">{F.sectionsTitle}</h2>
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">{F.position}</th>
                  <th scope="col">{F.section}</th>
                  <th scope="col" className="num">
                    {F.fields}
                  </th>
                  <th scope="col">{F.visible}</th>
                  <th scope="col">
                    <span className="sr-only">{F.position}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sections.map((s, i) => {
                  const locked = sectionHasRequired(res, s);
                  const isHidden = hidden.includes(s.id);
                  const title = s.title || s.id;
                  return (
                    <tr key={s.id} className={cx(isHidden && 'is-inactive')}>
                      <td>{i + 1}</td>
                      <td>
                        {title}
                        {locked && (
                          <span className="muted small">
                            {' '}
                            · {F.hasRequired}
                          </span>
                        )}
                      </td>
                      <td className="num">{s.fields.length}</td>
                      <td>
                        <label className="switch" data-tooltip={locked ? F.requiredLocked : undefined}>
                          <input type="checkbox" role="switch" checked={!isHidden} disabled={locked} onChange={(e) => setHidden(e.target.checked ? hidden.filter((h) => h !== s.id) : [...hidden, s.id])} aria-label={F.visibleFor(title)} />
                          <span className="switch-track" aria-hidden="true" />
                          <span className="small">{isHidden ? F.hidden : F.shown}</span>
                        </label>
                      </td>
                      <td className="li-actions">
                        <IconButton icon="arrow-up" label={F.moveUp(title)} disabled={i === 0} onClick={() => move(i, -1)} />
                        <IconButton icon="arrow-down" label={F.moveDown(title)} disabled={i === sections.length - 1} onClick={() => move(i, 1)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.length > 0 && (
            <ul className="plain-list">
              {errors.map((e) => (
                <li key={e} className="field-error">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            {F.preview}
            <InfoTip text={F.previewHint} label={A.common.about(F.preview)} />
          </h2>
          <ol className="plain-list bullets">
            {sections
              .filter((s) => !hidden.includes(s.id))
              .map((s) => (
                <li key={s.id}>
                  <strong>{s.title || s.id}</strong>{' '}
                  <span className="muted small">
                    · {s.fields.map((k) => res.fields.find((f) => f.key === k)?.label ?? k).join(', ')}
                  </span>
                </li>
              ))}
          </ol>
          <h3 className="detail-section-title">{F.customisedList}</h3>
          {saved.error ? (
            <ErrorState title={F.loadError} onRetry={saved.retry}>
              {saved.error}
            </ErrorState>
          ) : !saved.data ? (
            <Skeleton rows={3} />
          ) : saved.data.length ? (
            <ul className="plain-list">
              {saved.data.map((l) => (
                <li key={`${l.resource}:${l.division}`} className="row-between">
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setResKey(l.resource);
                      setDivision(l.division);
                    }}
                  >
                    {getResource(l.resource).labelPlural} · {masterLabel('division', l.division)}
                  </button>
                  <span className="muted small">{relativeTime(l.updatedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{F.noneCustomised}</p>
          )}
        </section>
      </div>
      <SaveBar
        dirty={dirty}
        busy={busy}
        errorCount={errors.length}
        saveLabel={F.save}
        onSave={save}
        onCancel={() => {
          setOrder(savedOrder);
          setHidden(savedHidden);
        }}
      />
      {current && (
        <DangerZone
          title={F.resetTitle}
          description={F.resetMessage(res.labelPlural, divLabel)}
          actionLabel={F.reset}
          confirmWord={L.settingsKit.resetWord}
          confirmTitle={F.resetTitle}
          confirmBody={F.resetMessage(res.labelPlural, divLabel)}
          onConfirm={async () => {
            try {
              await resetLayout(actor, resKey, division);
              toast(F.resetDone);
            } catch (e) {
              toast(errorMessage(e), 'danger');
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}

function Registry() {
  const R = A.registry;
  const resources = allResources();
  const [sel, setSel] = useState(resources[0].key);
  const [search, setSearch] = useState('');
  const res = getResource(sel);
  const listed = resources.filter((r) => !search || r.labelPlural.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="studio-split">
      <nav className="studio-list" aria-label={R.listLabel}>
        <input type="search" className="input input-compact" placeholder={A.common.search} aria-label={R.listLabel} value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="nav-list">
          {listed.map((r) => (
            <li key={r.key}>
              <button type="button" className={cx('nav-row', sel === r.key && 'is-active')} onClick={() => setSel(r.key)}>
                <span className="nav-label">{r.labelPlural}</span>
                <span className="nav-meta">v{r.version}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="studio-editor">
        <h2 className="panel-title">{res.labelPlural}</h2>
        <p className="muted small">
          {R.meta(res.id, res.module, res.fields.length, res.status)}
          {res.lifecycle ? R.lifecycle(res.lifecycle.field, res.lifecycle.transitions.length) : ''}
        </p>
        <div className="table-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">{R.columns.field}</th>
                <th scope="col">{R.columns.key}</th>
                <th scope="col">{R.columns.type}</th>
                <th scope="col">{R.columns.rules}</th>
                <th scope="col">{R.columns.sensitivity}</th>
                <th scope="col">{R.columns.usedIn}</th>
              </tr>
            </thead>
            <tbody>
              {res.fields.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.label} {f.custom && <Badge tone="accent">{R.custom}</Badge>}
                  </td>
                  <td>
                    <code>{f.key}</code>
                  </td>
                  <td>
                    {f.type}
                    {f.master ? ` → ${f.master}` : f.relation ? ` → ${f.relation.resource}` : ''}
                  </td>
                  <td className="small">
                    {[
                      f.required && R.rules.required,
                      f.requiredWhen && R.rules.requiredWhen(f.requiredWhen.field, f.requiredWhen.op, String(f.requiredWhen.value)),
                      f.visibleWhen && R.rules.conditional,
                      f.computed && R.rules.computed,
                      f.compare && R.rules.compare(f.compare.field),
                      f.masterParentField && R.rules.dependsOn(f.masterParentField),
                      f.relation?.filterBy && R.rules.filteredBy(f.relation.filterBy.fromField),
                    ]
                      .filter(Boolean)
                      .join(', ') || <EmptyValue />}
                  </td>
                  <td>{f.sensitivity && f.sensitivity !== 'none' ? <Badge tone="warning">{A.sensitivity[f.sensitivity]}</Badge> : <EmptyValue />}</td>
                  <td className="small muted">
                    {Object.entries(f.capabilities)
                      .filter(([, v]) => v)
                      .map(([k]) => k)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Roles & Permissions (ADM-02)

const ACCESS_TONE: Record<FieldAccess, Tone> = { edit: 'success', view: 'info', mask: 'warning', hide: 'neutral' };
const ACCESS_VALUES: FieldAccess[] = ['edit', 'view', 'mask', 'hide'];
type AccessTab = 'people' | 'simple' | 'expiring' | 'edit' | 'matrix' | 'preview';

interface RoleDraft {
  roleId: string;
  resources: Record<string, ResourcePermission>;
  fields: Record<string, FieldAccess | null>;
}

const isSensitive = (f: FieldDefinition) => !!f.sensitivity && f.sensitivity !== 'none' && f.sensitivity !== 'contact';

export function AccessPage() {
  const actor = useActor();
  const toast = useToast();
  const X = A.access;
  const resources = allResources();
  const q = useServiceQuery(() => getRoleMatrix(actor), [actor.user.id]);
  const [tab, setTab] = useState<AccessTab>('people');
  const [roleId, setRoleId] = useState('sales_manager');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldRes, setFieldRes] = useState(resources.find((r) => r.fields.some(isSensitive))?.key ?? resources[0].key);
  const [previewRes, setPreviewRes] = useState(resources[0].key);
  const [cmpRes, setCmpRes] = useState(resources[0].key);
  const [resetting, setResetting] = useState(false);
  const filtered = useMemo(() => resources.filter((r) => !search || r.labelPlural.toLowerCase().includes(search.toLowerCase())), [resources, search]);
  const paged = usePaged(filtered);

  if (!can(actor, 'access.view')) return <NoAccess what={X.noAccessWhat} />;
  const pageTitle = L.nav.pages.rolesPermissions.title;
  const activeGrants = can(actor, 'access.view') ? listActiveGrants(actor) : [];
  if (q.error)
    return (
      <SettingsPage title={pageTitle} description={X.short}>
        <ErrorState title={X.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </SettingsPage>
    );
  if (!q.data)
    return (
      <SettingsPage title={pageTitle} description={X.short}>
        <SettingsSkeleton sections={3} />
      </SettingsPage>
    );

  const { roles, shipped, overrides } = q.data;
  const role = roles.find((r) => r.id === roleId) ?? roles[0];
  const base = shipped.find((r) => r.id === role.id)!;
  const locked = LOCKED_ROLES.includes(role.id) || !can(actor, 'access.manage');
  const fresh: RoleDraft = { roleId: role.id, resources: Object.fromEntries(resources.map((r) => [r.key, { ...NO_ACCESS, ...(role.resources[r.key] ?? {}) }])), fields: { ...(overrides[role.id]?.fieldOverrides ?? {}) } };
  const work = draft && draft.roleId === role.id ? draft : fresh;
  const rowErrors = validateRolePermissions(work.resources);
  const dirty = JSON.stringify(work) !== JSON.stringify(fresh);
  const setPerm = (k: string, patch: Partial<ResourcePermission>) => setDraft({ ...work, resources: { ...work.resources, [k]: { ...work.resources[k], ...patch } } });
  const scopeOptions = SCOPES.map((s) => ({ value: s, label: A.scopes[s].short }));
  const fieldResDef = getResource(fieldRes);
  const sensitiveFields = fieldResDef.fields.filter(isSensitive);
  const defaultAccess = (f: FieldDefinition): FieldAccess => base.fieldOverrides?.[`${fieldResDef.key}.${f.key}`] ?? base.sensitivity[f.sensitivity as keyof RoleDefinition['sensitivity']];

  const save = async () => {
    setTried(true);
    const n = Object.keys(rowErrors).length;
    if (n) {
      toast(X.fixErrors(n), 'danger');
      return;
    }
    setBusy(true);
    try {
      await saveRole(actor, role.id, { resources: work.resources, fieldOverrides: work.fields });
      toast(X.saved(role.label));
      setDraft(null);
      setTried(false);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const yes = (b: boolean | string) => (b === true ? '✓' : b === false ? '✗' : A.scopes[b as RowScope]?.short ?? String(b));
  const preview = actorFor(demoUsers.find((u) => u.roleId === role.id)?.id ?? actor.user.id, actor.workspaceId);
  const previewDef = getResource(previewRes);

  const roleCard = (
    <section className="st-card st-role">
      <div className="st-role-pick">
        <label className="field-label" htmlFor="ap-role">
          {X.role}
        </label>
        <SelectMenu
          id="ap-role"
          label={X.role}
          value={role.id}
          options={roles.map((r) => ({ value: r.id, label: overrides[r.id] ? `${r.label} · ${X.customised}` : r.label }))}
          onChange={(v) => {
            setRoleId(v);
            setDraft(null);
            setTried(false);
          }}
        />
        {tab === 'simple' && !locked && (
          <SelectMenu
            label={X.simple.copyFrom}
            value=""
            options={[{ value: '', label: X.simple.copyPlaceholder }, ...roles.filter((r) => r.id !== role.id).map((r) => ({ value: r.id, label: r.label }))]}
            onChange={(v) => {
              const from = roles.find((r) => r.id === v);
              if (!from) return;
              setDraft({ ...work, resources: Object.fromEntries(resources.map((r) => [r.key, { ...NO_ACCESS, ...(from.resources[r.key] ?? {}), sensitive_data: work.resources[r.key].sensitive_data }])) });
              toast(X.simple.copied(from.label), 'info');
            }}
          />
        )}
      </div>
      <p className="st-help">{role.description}</p>
    </section>
  );

  return (
    <SettingsPage title={pageTitle} description={L.grants.short}>
      <Tabs<AccessTab>
        label={X.sectionsLabel}
        value={tab === 'matrix' || tab === 'preview' ? 'edit' : tab}
        onChange={setTab}
        tabs={[
          { id: 'people', label: L.grants.tabs.people },
          { id: 'simple', label: L.grants.tabs.roles },
          { id: 'expiring', label: L.grants.tabs.expiring, count: activeGrants.length },
          { id: 'edit', label: L.grants.tabs.advanced },
        ]}
      />
      {(tab === 'edit' || tab === 'matrix' || tab === 'preview') && (
        <div className="segmented" role="group" aria-label={L.grants.tabs.advanced}>
          {(['edit', 'matrix', 'preview'] as const).map((v) => (
            <button key={v} type="button" className={cx('seg-btn', tab === v && 'is-on')} aria-pressed={tab === v} onClick={() => setTab(v)}>
              {L.grants.advancedViews[v]}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="st-stack">
        {(tab === 'simple' || tab === 'edit' || tab === 'preview') && roleCard}
        {tab === 'people' && <PeopleAccess actor={actor} people={listPeople(actor)} />}
        {tab === 'expiring' && <ExpiringAccess actor={actor} />}
        {tab === 'simple' && (
          <>
            {LOCKED_ROLES.includes(role.id) && <InlineAlert tone="info">{X.adminLocked}</InlineAlert>}
            <QuickGuide id="access" steps={X.simple.guide} />
            <AccessSimple
              resources={resources}
              perms={work.resources}
              disabled={locked}
              summary={X.simple.summary(
                role.label,
                resources.filter((r) => work.resources[r.key].read !== 'none').length,
                resources.filter((r) => work.resources[r.key].update !== 'none').length,
                resources.filter((r) => work.resources[r.key].delete).length,
                resources.length,
              )}
              onChange={(next) => setDraft({ ...work, resources: next })}
            />
          </>
        )}

        {tab === 'edit' && (
          <>
            {LOCKED_ROLES.includes(role.id) && <InlineAlert tone="info">{X.adminLocked}</InlineAlert>}
            <section className="panel">
              <div className="toolbar">
                <input type="search" className="input input-compact" placeholder={X.searchRecordTypes} aria-label={X.searchRecordTypes} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th scope="col">{X.columns.recordType}</th>
                      <th scope="col">{X.columns.read}</th>
                      <th scope="col">{X.columns.update}</th>
                      <th scope="col">{X.columns.create}</th>
                      <th scope="col">{X.columns.delete}</th>
                      <th scope="col">{X.columns.export}</th>
                      <th scope="col">{X.columns.contact}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.shown.map((rs) => {
                      const p = work.resources[rs.key];
                      const err = tried ? rowErrors[rs.key] : undefined;
                      const flag = (k: 'create' | 'delete' | 'export' | 'sensitive_data', label: string) => (
                        <td>
                          <input type="checkbox" className="checkbox" checked={!!p[k]} disabled={locked} aria-label={X.flagFor(label, rs.labelPlural)} onChange={(e) => setPerm(rs.key, { [k]: e.target.checked })} />
                        </td>
                      );
                      return (
                        <Fragment key={rs.key}>
                          <tr className={cx(err && 'cat-row-error')}>
                            <th scope="row">{rs.labelPlural}</th>
                            <td>
                              <SelectMenu label={X.readFor(rs.labelPlural)} value={p.read} disabled={locked} options={scopeOptions} onChange={(v) => setPerm(rs.key, { read: v as RowScope })} />
                            </td>
                            <td>
                              <SelectMenu label={X.updateFor(rs.labelPlural)} value={p.update} disabled={locked} options={scopeOptions} onChange={(v) => setPerm(rs.key, { update: v as RowScope })} />
                            </td>
                            {flag('create', X.columns.create)}
                            {flag('delete', X.columns.delete)}
                            {flag('export', X.columns.export)}
                            {flag('sensitive_data', X.columns.contact)}
                          </tr>
                          {err && (
                            <tr>
                              <td colSpan={7} className="field-error">
                                {err}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {paged.footer(A.common.recordType.toLowerCase())}
            </section>
            <section className="panel">
              <h2 className="panel-title dialog-title-row">
                {X.fieldsTitle}
                <InfoTip text={X.fieldsIntro} label={A.common.about(X.fieldsTitle)} />
              </h2>
              <div className="toolbar">
                <SelectMenu searchable label={X.fieldsResource} value={fieldRes} options={resources.filter((r) => r.fields.some(isSensitive)).map((r) => ({ value: r.key, label: r.labelPlural }))} onChange={setFieldRes} />
              </div>
              {sensitiveFields.length ? (
                <div className="table-scroll">
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th scope="col">{X.field}</th>
                        <th scope="col">{X.sensitivity}</th>
                        <th scope="col">{X.access}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sensitiveFields.map((f) => {
                        const key = `${fieldResDef.key}.${f.key}`;
                        return (
                          <tr key={key}>
                            <td>{f.label}</td>
                            <td>{A.sensitivity[f.sensitivity!]}</td>
                            <td>
                              <SelectMenu
                                label={X.accessFor(f.label)}
                                value={work.fields[key] ?? 'default'}
                                disabled={locked}
                                options={[{ value: 'default', label: X.defaultIs(A.fieldAccess[defaultAccess(f)]) }, ...ACCESS_VALUES.map((a) => ({ value: a, label: A.fieldAccess[a] }))]}
                                onChange={(v) => setDraft({ ...work, fields: { ...work.fields, [key]: v === 'default' ? null : (v as FieldAccess) } })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">{X.noSensitiveFields}</p>
              )}
            </section>
          </>
        )}

        {tab === 'matrix' && (
          <section className="st-card">
            <div className="st-section-head">
              <h2 className="st-section-title">{X.simple.compareTitle}</h2>
              <p className="st-help">{X.simple.compareHelp}</p>
            </div>
            <div className="st-compare-pick">
              <label className="field-label" htmlFor="ap-cmp">
                {X.previewResource}
              </label>
              <SelectMenu id="ap-cmp" searchable label={X.previewResource} value={cmpRes} options={resources.map((r) => ({ value: r.key, label: r.labelPlural }))} onChange={setCmpRes} />
            </div>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">{X.role}</th>
                    {Object.values(X.matrixShort)
                      .slice(0, 5)
                      .map((h) => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => {
                    const p = r.resources[cmpRes] ?? NO_ACCESS;
                    return (
                      <tr key={r.id}>
                        <th scope="row">
                          <span className="st-clip" data-tooltip={r.label}>
                            {r.label}
                          </span>
                        </th>
                        <td>{yes(p.read)}</td>
                        <td>{yes(p.create)}</td>
                        <td>{yes(p.update)}</td>
                        <td>{yes(p.delete)}</td>
                        <td>{yes(p.export)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'preview' && (
          <section className="panel">
            <h2 className="panel-title">{X.previewTitle}</h2>
            <div className="toolbar">
              <label className="field-label" htmlFor="ap-res">
                {X.previewResource}
              </label>
              <SelectMenu id="ap-res" searchable label={X.previewResource} value={previewRes} options={resources.map((r) => ({ value: r.key, label: r.labelPlural }))} onChange={setPreviewRes} />
            </div>
            {preview.role.resources[previewRes]?.read === undefined || preview.role.resources[previewRes]?.read === 'none' ? (
              <p>
                <Badge tone="neutral">{X.noAccessBadge}</Badge> {X.previewNoAccess(preview.role.label, previewDef.labelPlural.toLowerCase())}
              </p>
            ) : (
              <div className="table-scroll">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th scope="col">{X.field}</th>
                      <th scope="col">{X.sensitivity}</th>
                      <th scope="col">{X.onRead}</th>
                      <th scope="col">{X.onEdit}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewDef.fields.map((f) => {
                      const r = fieldAccess(preview, previewDef, f, 'read');
                      const u = fieldAccess(preview, previewDef, f, 'update');
                      return (
                        <tr key={f.key}>
                          <td>{f.label}</td>
                          <td>{f.sensitivity && f.sensitivity !== 'none' ? A.sensitivity[f.sensitivity] : <EmptyValue />}</td>
                          <td>
                            <StatusChip label={A.fieldAccess[r]} tone={ACCESS_TONE[r]} />
                          </td>
                          <td>
                            <StatusChip label={A.fieldAccess[u]} tone={ACCESS_TONE[u]} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">{X.rowScope(A.scopes[preview.role.resources[previewRes]?.read ?? 'none'].long)}</p>
          </section>
        )}
        <p className="muted small">{X.simulation}</p>
      </div>
      <SaveBar dirty={dirty && !locked} busy={busy} errorCount={tried ? Object.keys(rowErrors).length : 0} onSave={save} onCancel={() => { setDraft(null); setTried(false); }} saveLabel={X.save} />
      {!locked && !!overrides[role.id] && (
        <DangerZone
          title={X.resetTitle(role.label)}
          description={X.resetMessage}
          actionLabel={X.resetRole}
          confirmWord={L.settingsKit.resetWord}
          confirmTitle={X.resetTitle(role.label)}
          confirmBody={X.resetMessage}
          onConfirm={async () => {
            setResetting(true);
            try {
              await resetRole(actor, role.id);
              setDraft(null);
              toast(X.resetDone(role.label));
            } catch (e) {
              toast(errorMessage(e), 'danger');
              throw e;
            } finally {
              setResetting(false);
            }
          }}
          disabledReason={resetting ? X.resetRole : undefined}
        />
      )}
    </SettingsPage>
  );
}

// ---------------------------------------------------------------- Audit Trail (COM-09) + System Events view

type AuditView = 'entries' | 'events';

export function AuditPage() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const view: AuditView = params.get('view') === 'events' && can(actor, 'events.view') ? 'events' : 'entries';
  if (!can(actor, 'audit.view')) return <NoAccess what={A.audit.noAccessWhat} />;
  return (
    <SettingsPage title={L.nav.pages.auditTrail.title} description={view === 'events' ? A.events.short : A.audit.short}>
      {can(actor, 'events.view') && (
        <Tabs<AuditView>
          label={A.audit.sectionsLabel}
          value={view}
          onChange={(v) => setParams(v === 'events' ? { view: 'events' } : {}, { replace: true })}
          tabs={[
            { id: 'entries', label: A.audit.tabs.entries },
            { id: 'events', label: A.audit.tabs.events },
          ]}
        />
      )}
      <div className="st-stack">{view === 'events' ? <EventsView /> : <AuditEntries />}</div>
    </SettingsPage>
  );
}

function AuditEntries() {
  const actor = useActor();
  const T = A.audit;
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [sort, setSort] = useState<SortDir>('desc');
  const [open, setOpen] = useState<string | null>(null);
  const data = useServiceQuery(() => getDb().audit.filter((a) => a.workspaceId === actor.workspaceId), [actor.user.id, actor.workspaceId]);
  const all = useMemo(() => data.data ?? [], [data.data]);
  const actions = useMemo(() => [...new Set(all.map((a) => a.action))].sort(), [all]);
  const rows = byTime(
    all.filter((a) => (!action || a.action === action) && (!q || `${a.summary} ${a.recordId ?? ''} ${getUser(a.actorId)?.name ?? ''} ${a.correlationId}`.toLowerCase().includes(q.toLowerCase()))),
    (a) => a.at,
    sort,
  );
  const paged = usePaged(rows);
  return (
    <>
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder={T.searchPlaceholder} aria-label={T.searchLabel} value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectMenu searchable label={T.filterAction} value={action} options={[{ value: '', label: T.allActions }, ...actions.map((a) => ({ value: a, label: a }))]} onChange={setAction} />
        <SortPicker value={sort} onChange={setSort} />
      </div>
      <div className="content-surface">
        {data.error ? (
          <ErrorState onRetry={data.retry}>{data.error}</ErrorState>
        ) : !data.data ? (
          <Skeleton rows={8} />
        ) : rows.length ? (
          <>
            <div className="table-scroll">
              <table className="mini-table audit-table">
                <thead>
                  <tr>
                    <th scope="col">{T.columns.when}</th>
                    <th scope="col">{T.columns.actor}</th>
                    <th scope="col">{T.columns.action}</th>
                    <th scope="col">{T.columns.record}</th>
                    <th scope="col">{T.columns.summary}</th>
                    <th scope="col">{T.columns.correlation}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.shown.map((a) => (
                    <Fragment key={a.id}>
                      <tr>
                        <td className="nowrap">
                          <DateText value={a.at} showTime />
                        </td>
                        <td>
                          {getUser(a.actorId)?.name ?? a.actorId}
                          <div className="muted small">
                            {a.actorRole}
                            {a.actorType !== 'user' ? ` · ${a.actorType}` : ''}
                          </div>
                        </td>
                        <td>
                          <code>{a.action}</code>
                        </td>
                        <td>{a.recordId && a.resource ? <Link to={recordPeekPath(actor.workspaceId, a.resource, a.recordId)}>{a.recordId}</Link> : <EmptyValue />}</td>
                        <td>
                          {a.summary}
                          {a.changes && a.changes.length > 0 && (
                            <button type="button" className="link small" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                              {' '}
                              {open === a.id ? T.hideChanges : T.showChanges} {T.changes(a.changes.length)}
                            </button>
                          )}
                        </td>
                        <td>
                          <code className="small">{a.correlationId.slice(-8)}</code>
                        </td>
                      </tr>
                      {open === a.id && (
                        <tr>
                          <td colSpan={6}>
                            <ul className="change-list">
                              {a.changes!.map((c) => (
                                <li key={c.field}>
                                  {c.label}: <span className="muted">{c.before}</span> → {c.after}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {paged.footer(T.entries)}
          </>
        ) : all.length ? (
          <EmptyState icon="search" title={T.noMatchTitle}>
            {T.noMatchBody}
          </EmptyState>
        ) : (
          <EmptyState icon="scroll-text" title={T.emptyTitle}>
            {T.emptyBody}
          </EmptyState>
        )}
      </div>
    </>
  );
}

function EventsView() {
  const actor = useActor();
  const E = A.events;
  const [sel, setSel] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [sort, setSort] = useState<SortDir>('desc');
  const data = useServiceQuery(() => getDb().events.filter((e) => e.workspaceId === actor.workspaceId), [actor.user.id, actor.workspaceId]);
  const all = useMemo(() => data.data ?? [], [data.data]);
  const types = useMemo(() => [...new Set(all.map((e) => e.eventType))].sort(), [all]);
  const events = byTime(
    all.filter((e) => !type || e.eventType === type),
    (e) => e.occurredAt,
    sort,
  );
  const paged = usePaged(events);
  const selected = events.find((e) => e.eventId === sel);
  return (
    <>
      <div className="toolbar">
        <SelectMenu searchable label={E.filterType} value={type} options={[{ value: '', label: E.allTypes }, ...types.map((t) => ({ value: t, label: t }))]} onChange={setType} />
        <SortPicker value={sort} onChange={setSort} />
        <span className="spacer" />
        <Button icon="reset" disabledReason={E.replayReason}>
          {E.replay}
        </Button>
      </div>
      <div className="events-split">
        <div className="content-surface">
          {data.error ? (
            <ErrorState onRetry={data.retry}>{data.error}</ErrorState>
          ) : !data.data ? (
            <Skeleton rows={8} />
          ) : events.length ? (
            <>
              <ul className="event-list">
                {paged.shown.map((e) => (
                  <li key={e.eventId}>
                    <button type="button" className={cx('event-row', sel === e.eventId && 'is-active')} onClick={() => setSel(e.eventId)} aria-pressed={sel === e.eventId}>
                      <code>{e.eventType}</code>
                      <span className="mono small">{e.recordId ?? <EmptyValue />}</span>
                      <span className="muted small">
                        {getUser(e.actorId)?.name} · {relativeTime(e.occurredAt)}
                      </span>
                      <Badge tone="neutral">{E.simulated}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
              {paged.footer(E.events)}
            </>
          ) : (
            <EmptyState icon="activity" title={E.emptyTitle}>
              {E.emptyBody}
            </EmptyState>
          )}
        </div>
        <aside className="panel event-detail" aria-label={E.envelope}>
          {selected ? <pre className="json">{JSON.stringify(selected, null, 2)}</pre> : <p className="muted">{E.selectHint}</p>}
        </aside>
      </div>
    </>
  );
}

/** Old System Events page: now a view of the Audit Trail (GLOSSARY G-B3). Kept so old routes keep working. */
export function EventsPage() {
  return <Navigate to={`${ROUTES.auditTrail}?view=events`} replace />;
}

// ---------------------------------------------------------------- Demo Settings

export function DemoSettingsPage() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const S = A.settings;
  const db = getDb();
  const recordLabel = (k: string) => {
    try {
      return getResource(k).labelPlural.toLowerCase();
    } catch {
      return k;
    }
  };
  return (
    <SettingsPage title={L.nav.pages.demoSettings.title} description={S.short}>
      <SettingsSection title={S.demoData} help={S.demoDataHelp}>
        <dl className="st-facts">
          <dt>{S.dataset}</dt>
          <dd>
            {S.datasetValue(db.seed)}
            <DateText value={db.seededAt} showTime />
          </dd>
          <dt>{S.storage}</dt>
          <dd>{S.storageValue(STORAGE_KEY)}</dd>
          <dt>{S.records}</dt>
          <dd>
            <details className="st-details">
              <summary>{S.recordsSummary(Object.keys(db.records).length, Object.values(db.records).reduce((n, v) => n + v.length, 0))}</summary>
              <p className="muted small">
                {Object.entries(db.records)
                  .map(([k, v]) => `${v.length} ${recordLabel(k)}`)
                  .join(' · ')}
              </p>
            </details>
          </dd>
        </dl>
        {can(actor, 'demo.settings') && (
          <div className="st-actions">
            <DataTransfer />
          </div>
        )}
      </SettingsSection>
      {can(actor, 'demo.settings') && <DemoControls />}
      <SettingsSection wide title={S.tokens} help={S.tokensTip}>
        <div className="table-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">{S.tokenColumns.token}</th>
                <th scope="col">{S.tokenColumns.cssVar}</th>
                <th scope="col">{S.tokenColumns.value}</th>
                <th scope="col">{S.tokenColumns.status}</th>
              </tr>
            </thead>
            <tbody>
              {tokenRegistry.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td>
                    <code>{t.cssVar}</code>
                  </td>
                  <td>
                    {t.value}
                    {t.note && <span className="muted small"> · {t.note}</span>}
                  </td>
                  <td>
                    <Badge tone={t.status.startsWith('locked') ? 'success' : 'warning'}>{t.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>
      <DangerZone
        title={S.reset}
        description={S.resetHelp}
        actionLabel={S.resetAction}
        confirmWord={L.settingsKit.resetWord}
        confirmTitle={L.common.confirm.resetTitle}
        confirmBody={L.common.confirm.resetBody}
        onConfirm={() => {
          resetDb();
          toast(L.common.toasts.demoReset, 'info');
        }}
      />
    </SettingsPage>
  );
}
