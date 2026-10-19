import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { clinicRoles, demoUsers } from '../domain/clinic/pack';
import type { FieldAccess, MasterDefinition, Tone } from '../metadata/types';
import { cx } from '../lib/format';
import { recordPeekPath } from '../lib/routes';
import { tokenRegistry, railSkins } from '../tokens/tokens';
import { actorFor, can, fieldAccess } from '../services/authz';
import { addDraftField, discardDraft, draftSummary, ensureDraft, getDraft, type NewFieldSpec, publishDraft, removeDraftField, revertDraftMaster, setDraftMaster, validateDraft, type ConfigIssue } from '../services/config';
import { getDb } from '../services/db';
import { useActor, useRevision } from '../services/hooks';
import { allMasters, allResources, getMaster, getResource, getUser } from '../services/registry';
import { getSettings, updateSettings } from '../services/settings';
import { ServiceError } from '../services/types';
import { Button, IconButton } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { Badge, EmptyState, InlineAlert, NoAccess, StatusChip, Tabs, useToast } from '../components/primitives/feedback';
import { PageHeader } from '../components/shell/PageHeader';
import { SelectMenu } from '../components/primitives/SelectMenu';
import { DatePicker } from '../components/primitives/DatePicker';
import { InfoTip } from '../components/primitives/InfoTip';
import { ResetDialog } from '../components/shell/AppShell';
import { confirmDelete } from '../components/primitives/overlay';
import { relativeTime } from '../lib/dates';
import { DateText, EmptyValue } from '../components/primitives/display';

const TONES: Tone[] = ['neutral', 'info', 'success', 'warning', 'danger', 'accent'];

// ---------------------------------------------------------------- Configuration studio

type StudioTab = 'masters' | 'fields' | 'registry' | 'history';

export function StudioPage() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const [tab, setTab] = useState<StudioTab>('masters');
  const [issues, setIssues] = useState<ConfigIssue[] | null>(null);
  const draft = getDraft();
  if (!can(actor, 'config.publish')) return <NoAccess what="the configuration studio" />;
  const summary = draft ? draftSummary(draft) : [];
  const errors = issues?.filter((i) => i.severity === 'error') ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Configuration studio"
        description="Edit masters and add fields through Draft → Validate → Preview → Publish. Published versions are immutable; changes propagate to every form, grid, filter and inspector."
        crumbs={[{ label: 'Administration' }, { label: 'Configuration studio' }]}
        actions={
          draft ? (
            <>
              <Button
                onClick={() =>
                  confirmDelete({
                    title: 'Discard this draft?',
                    message: 'All unpublished master and field changes in the draft are lost. Published configuration is not affected.',
                    confirmLabel: 'Discard draft',
                    onConfirm: () => {
                      discardDraft(actor);
                      setIssues(null);
                      toast('Draft discarded', 'info');
                    },
                  })
                }
              >
                Discard draft
              </Button>
              <Button icon="check" onClick={() => setIssues(validateDraft(draft))}>
                Validate
              </Button>
              <Button
                variant="primary"
                disabledReason={!issues ? 'Validate the draft first' : errors.length ? `${errors.length} validation error(s)` : !summary.length ? 'No changes to publish' : undefined}
                onClick={() => {
                  try {
                    publishDraft(actor);
                    setIssues(null);
                    toast('Configuration published');
                  } catch (e) {
                    toast(e instanceof ServiceError ? e.message : 'Publish failed', 'danger');
                  }
                }}
              >
                Publish
              </Button>
            </>
          ) : (
            <Button variant="primary" icon="pencil" onClick={() => ensureDraft(actor)}>
              Start draft
            </Button>
          )
        }
      />
      {draft ? (
        <InlineAlert tone="info" title={`Draft by ${getUser(draft.createdBy)?.name} · updated ${relativeTime(draft.updatedAt)}`}>
          {summary.length ? `${summary.length} pending change(s). Changes are not live until published.` : 'No changes yet.'}
        </InlineAlert>
      ) : (
        <p className="muted">Published configuration v{getDb().config.version}. Start a draft to make changes.</p>
      )}
      {issues && (
        <section className="panel validation" aria-live="polite">
          <h2 className="panel-title">Validation & preview</h2>
          {issues.length === 0 && <p className="text-success">No issues found.</p>}
          <ul className="plain-list">
            {issues.map((i, n) => (
              <li key={n} className={i.severity === 'error' ? 'text-danger' : 'text-warning'}>
                <Icon name="alert" size={12} /> <strong>{i.severity === 'error' ? 'Error' : 'Warning'}:</strong> {i.message}
              </li>
            ))}
          </ul>
          {summary.length > 0 && (
            <>
              <h3 className="detail-section-title">Changes to publish</h3>
              <ul className="plain-list bullets">
                {summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <Tabs<StudioTab>
        label="Studio sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'masters', label: 'Masters' },
          { id: 'fields', label: 'Custom fields' },
          { id: 'registry', label: 'Metadata registry' },
          { id: 'history', label: 'Published versions', count: getDb().config.history.length },
        ]}
      />
      <div className="content-surface" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'masters' && <MastersEditor onChange={() => setIssues(null)} />}
        {tab === 'fields' && <FieldsEditor onChange={() => setIssues(null)} />}
        {tab === 'registry' && <Registry />}
        {tab === 'history' && <History />}
      </div>
    </div>
  );
}

function MastersEditor({ onChange }: { onChange: () => void }) {
  const actor = useActor();
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
  const move = (key: string, d: -1 | 1) => {
    const sorted = [...m.values].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((v) => v.key === key);
    const j = i + d;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    write({ ...m, values: sorted.map((v, k) => ({ ...v, order: k })) });
  };
  return (
    <div className="studio-split">
      <nav className="studio-list" aria-label="Masters">
        <ul className="nav-list">
          {masters.map((x) => (
            <li key={x.key}>
              <button type="button" className={cx('nav-row', sel === x.key && 'is-active')} onClick={() => setSel(x.key)} aria-current={sel === x.key ? 'true' : undefined}>
                <span className="nav-label">{x.label}</span>
                {draft?.masters[x.key] && <span className="nav-meta">draft</span>}
                <span className="nav-meta">v{x.version}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="studio-editor">
        <div className="panel-head">
          <div>
            <h2 className="panel-title dialog-title-row">
              {m.label}
              <InfoTip text="Values cannot be deleted — deactivate them so historical records keep their meaning." label="About master values" />
            </h2>
            <p className="muted small">
              Key <code>{m.key}</code> · published v{getMaster(sel).version}
              {m.description ? ` · ${m.description}` : ''}
            </p>
          </div>
          {editing && (
            <Button variant="ghost" icon="reset" onClick={() => revertDraftMaster(actor, sel)}>
              Revert changes
            </Button>
          )}
        </div>
        {!editable && <InlineAlert tone="info">Read-only. Start a draft to edit values.</InlineAlert>}
        <table className="mini-table studio-table">
          <thead>
            <tr>
              <th scope="col">Key (immutable)</th>
              <th scope="col">Label</th>
              <th scope="col">Tone</th>
              <th scope="col">Active</th>
              <th scope="col">Parent</th>
              <th scope="col">
                <span className="sr-only">Order</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...m.values]
              .sort((a, b) => a.order - b.order)
              .map((v) => (
                <tr key={v.key} className={cx(!v.active && 'is-inactive')}>
                  <td>
                    <code>{v.key}</code>
                  </td>
                  <td>
                    <input className="input input-compact" aria-label={`Label for ${v.key}`} value={v.label} disabled={!editable} onChange={(e) => setVal(v.key, { label: e.target.value })} />
                  </td>
                  <td>
                    <SelectMenu label={`Tone for ${v.key}`} value={v.tone ?? 'neutral'} disabled={!editable} options={TONES.map((t) => ({ value: t, label: t }))} onChange={(t) => setVal(v.key, { tone: t as Tone })} />
                    <StatusChip label={v.label || v.key} tone={v.tone} />
                  </td>
                  <td>
                    <label className="switch">
                      <input type="checkbox" role="switch" checked={v.active} disabled={!editable} onChange={(e) => setVal(v.key, { active: e.target.checked })} aria-label={`${v.key} active`} />
                      <span className="switch-track" aria-hidden="true" />
                      <span className="small">{v.active ? 'Active' : 'Inactive'}</span>
                    </label>
                  </td>
                  <td>{v.parent ?? <EmptyValue />}</td>
                  <td className="li-actions">
                    <IconButton icon="arrow-up" label={`Move ${v.key} up`} disabled={!editable} onClick={() => move(v.key, -1)} />
                    <IconButton icon="arrow-down" label={`Move ${v.key} down`} disabled={!editable} onClick={() => move(v.key, 1)} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {editable && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const label = newLabel.trim();
              if (!label) return;
              const key = label
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_|_$/g, '')
                .replace(/^(\d)/, 'v_$1');
              write({ ...m, values: [...m.values, { key, label, tone: 'neutral', active: true, order: m.values.length }] });
              setNewLabel('');
            }}
          >
            <label className="sr-only" htmlFor="new-master-value">
              New value label
            </label>
            <input id="new-master-value" className="input input-compact" placeholder="New value label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <Button type="submit" icon="plus" disabled={!newLabel.trim()}>
              Add value
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

function FieldsEditor({ onChange }: { onChange: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const draft = getDraft();
  const resources = allResources();
  const [spec, setSpec] = useState<NewFieldSpec>({ resource: 'patients', key: '', label: '', type: 'text', required: false, sensitivity: 'none' });
  const set = (p: Partial<NewFieldSpec>) => setSpec((s) => ({ ...s, ...p }));
  const custom = resources.flatMap((r) => (getDb().config.customFields[r.key] ?? []).map((f) => ({ r, f })));
  return (
    <div className="fields-editor">
      <section className="panel">
        <h2 className="panel-title">Add a field</h2>
        {!draft && <InlineAlert tone="info">Start a draft to add fields.</InlineAlert>}
        <form
          className="form-grid cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              addDraftField(actor, spec);
              onChange();
              toast(`Field "${spec.label}" added to draft`);
              setSpec((s) => ({ ...s, key: '', label: '', defaultValue: undefined, help: '' }));
            } catch (err) {
              toast(err instanceof ServiceError ? err.message : 'Failed', 'danger');
            }
          }}
        >
          <div className="form-field">
            <label className="field-label" htmlFor="nf-res">
              Record type
            </label>
            <SelectMenu id="nf-res" block label="Record type" value={spec.resource} disabled={!draft} options={resources.map((r) => ({ value: r.key, label: r.labelPlural }))} onChange={(v) => set({ resource: v })} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-label">
              Label <span className="req">*</span>
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
              Key (immutable after publish)
            </label>
            <input id="nf-key" className="input mono" value={spec.key} disabled={!draft} onChange={(e) => set({ key: e.target.value })} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-type">
              Type
            </label>
            <SelectMenu
              id="nf-type"
              block
              label="Type"
              value={spec.type}
              disabled={!draft}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'longtext', label: 'Long text' },
                { value: 'number', label: 'Number' },
                { value: 'date', label: 'Date' },
                { value: 'boolean', label: 'Yes / No' },
                { value: 'master', label: 'Choice from master list' },
              ]}
              onChange={(v) => set({ type: v as NewFieldSpec['type'], defaultValue: undefined })}
            />
          </div>
          {spec.type === 'master' && (
            <div className="form-field">
              <label className="field-label" htmlFor="nf-master">
                Master list
              </label>
              <SelectMenu id="nf-master" block label="Master list" placeholder="Choose…" value={spec.master ?? ''} disabled={!draft} options={allMasters().map((m) => ({ value: m.key, label: m.label }))} onChange={(v) => set({ master: v })} />
            </div>
          )}
          <div className="form-field">
            <label className="field-label" htmlFor="nf-sens">
              Sensitivity
            </label>
            <SelectMenu
              id="nf-sens"
              block
              label="Sensitivity"
              value={spec.sensitivity ?? 'none'}
              disabled={!draft}
              options={[
                { value: 'none', label: 'None' },
                { value: 'identifier', label: 'Identifier (masked for some roles)' },
                { value: 'health', label: 'Health-related (hidden from front desk & billing)' },
                { value: 'financial', label: 'Financial (hidden from clinicians)' },
              ]}
              onChange={(v) => set({ sensitivity: v as NewFieldSpec['sensitivity'] })}
            />
          </div>
          <div className="form-field">
            <label className="check">
              <input type="checkbox" checked={spec.required} disabled={!draft} onChange={(e) => set({ required: e.target.checked })} /> Required
            </label>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-default">
              Default value {spec.required ? '(needed for existing records)' : '(optional)'}
            </label>
            {spec.type === 'boolean' ? (
              <SelectMenu
                id="nf-default"
                block
                label="Default value"
                value={spec.defaultValue === undefined ? '' : String(spec.defaultValue)}
                disabled={!draft}
                options={[
                  { value: '', label: 'None' },
                  { value: 'true', label: 'Yes' },
                  { value: 'false', label: 'No' },
                ]}
                onChange={(v) => set({ defaultValue: v === '' ? undefined : v === 'true' })}
              />
            ) : spec.type === 'master' && spec.master ? (
              <SelectMenu id="nf-default" block label="Default value" value={String(spec.defaultValue ?? '')} disabled={!draft} options={[{ value: '', label: 'None' }, ...getMaster(spec.master).values.map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => set({ defaultValue: v || undefined })} />
            ) : spec.type === 'date' ? (
              <DatePicker id="nf-default" block label="Default value" value={String(spec.defaultValue ?? '')} disabled={!draft} onChange={(v) => set({ defaultValue: v ?? undefined })} />
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
              Help text <span className="optional">(optional)</span>
            </label>
            <input id="nf-help" className="input" value={spec.help ?? ''} disabled={!draft} onChange={(e) => set({ help: e.target.value })} />
          </div>
          <div className="span-2">
            <Button type="submit" icon="plus" disabledReason={!draft ? 'Start a draft first' : !spec.label.trim() || !spec.key ? 'Enter a label' : undefined}>
              Add to draft
            </Button>
          </div>
        </form>
      </section>
      {draft && draft.newFields.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">In this draft</h2>
          <ul className="plain-list">
            {draft.newFields.map(({ resource, field }) => (
              <li key={field.id} className="row-between">
                <span>
                  {getResource(resource).labelPlural} › <strong>{field.label}</strong> <code>{field.key}</code> · {field.type}
                  {field.required ? ' · required' : ''}
                  {field.sensitivity && field.sensitivity !== 'none' ? ` · ${field.sensitivity}` : ''}
                </span>
                <IconButton icon="trash" label={`Remove ${field.label} from draft`} onClick={() =>
                    confirmDelete({
                      title: `Remove "${field.label}" from the draft?`,
                      message: 'The new field is taken out of this draft. You can add it again before publishing.',
                      confirmLabel: 'Remove',
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
        <h2 className="panel-title">Published custom fields</h2>
        {custom.length ? (
          <ul className="plain-list">
            {custom.map(({ r, f }) => (
              <li key={f.id}>
                {r.labelPlural} › <strong>{f.label}</strong> <code>{f.key}</code> · {f.type} — available in forms, grid columns, filters and the inspector.
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None yet. Published fields appear in the Column manager, filters, forms (“Additional fields”) and inspector for every permitted role.</p>
        )}
      </section>
    </div>
  );
}

function Registry() {
  const resources = allResources();
  const [sel, setSel] = useState(resources[0].key);
  const res = getResource(sel);
  return (
    <div className="studio-split">
      <nav className="studio-list" aria-label="Resources">
        <ul className="nav-list">
          {resources.map((r) => (
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
          <code>{res.id}</code> · module {res.module} · {res.fields.length} fields · {res.status}
          {res.lifecycle ? ` · lifecycle on “${res.lifecycle.field}” (${res.lifecycle.transitions.length} transitions)` : ''}
        </p>
        <div className="table-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Key</th>
                <th scope="col">Type</th>
                <th scope="col">Rules</th>
                <th scope="col">Sensitivity</th>
                <th scope="col">Used in</th>
              </tr>
            </thead>
            <tbody>
              {res.fields.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.label} {f.custom && <Badge tone="accent">custom</Badge>}
                  </td>
                  <td>
                    <code>{f.key}</code>
                  </td>
                  <td>
                    {f.type}
                    {f.master ? ` → ${f.master}` : f.relation ? ` → ${f.relation.resource}` : ''}
                  </td>
                  <td className="small">
                    {[f.required && 'required', f.requiredWhen && `required when ${f.requiredWhen.field} ${f.requiredWhen.op} ${String(f.requiredWhen.value)}`, f.visibleWhen && 'conditional', f.computed && 'computed', f.compare && `≥ ${f.compare.field}`, f.masterParentField && `depends on ${f.masterParentField}`, f.relation?.filterBy && `filtered by ${f.relation.filterBy.fromField}`]
                      .filter(Boolean)
                      .join(', ') || <EmptyValue />}
                  </td>
                  <td>{f.sensitivity && f.sensitivity !== 'none' ? <Badge tone="warning">{f.sensitivity}</Badge> : <EmptyValue />}</td>
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

function History() {
  const h = getDb().config.history;
  if (!h.length) return <EmptyState icon="scroll-text" title="No published changes yet">The shipped domain pack is version 1.</EmptyState>;
  return (
    <ol className="timeline">
      {h.map((v) => (
        <li key={v.id} className="timeline-item">
          <span className="timeline-dot" aria-hidden="true" />
          <div>
            <p>
              <strong>v{v.version}</strong> published by {getUser(v.publishedBy)?.name} · <span className="muted"><DateText value={v.publishedAt} showTime /></span>
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
  );
}

// ---------------------------------------------------------------- Roles & access

const ACCESS_LABEL: Record<FieldAccess, string> = { edit: 'Edit', view: 'View', mask: 'Masked', hide: 'Hidden' };
const ACCESS_TONE: Record<FieldAccess, Tone> = { edit: 'success', view: 'info', mask: 'warning', hide: 'neutral' };

export function AccessPage() {
  useRevision();
  const actor = useActor();
  const resources = allResources();
  const [role, setRole] = useState(clinicRoles[1].id);
  const [resKey, setResKey] = useState('patients');
  if (!can(actor, 'access.view')) return <NoAccess what="roles & access" />;
  const preview = actorFor(demoUsers.find((u) => u.roleId === role)!.id, actor.workspaceId);
  const res = getResource(resKey);
  const yes = (b: boolean | string) => (b === true || b === 'all' ? '✓' : b === 'own' ? 'Own' : '✗');
  return (
    <div className="page">
      <PageHeader title="Roles & access" description="Effective permissions per role. Policies ship with the clinic domain pack; editing roles needs a server-side authorization service, which this prototype does not include." crumbs={[{ label: 'Administration' }, { label: 'Roles & access' }]} />
      <InlineAlert tone="warning" title="Simulation">
        These rules are enforced by the in-browser service layer so the prototype behaves realistically. They are not a security boundary — a production build must enforce them on the server.
      </InlineAlert>
      <section className="panel">
        <h2 className="panel-title">Permission matrix</h2>
        <div className="table-scroll">
          <table className="mini-table matrix">
            <thead>
              <tr>
                <th scope="col">Record type</th>
                {clinicRoles.map((r) => (
                  <th key={r.id} scope="col" colSpan={6} className="matrix-role">
                    {r.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th scope="col" />
                {clinicRoles.map((r) => (
                  <Fragment key={r.id}>
                    {['Read', 'Add', 'Edit', 'Del', 'Export', 'Sensitive data'].map((h) => (
                      <th key={h} scope="col" className="matrix-sub">
                        {h}
                      </th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((rs) => (
                <tr key={rs.key}>
                  <th scope="row">{rs.labelPlural}</th>
                  {clinicRoles.map((r) => {
                    const p = r.resources[rs.key];
                    const hasContact = rs.fields.some((f) => f.sensitivity === 'contact');
                    return (
                      <Fragment key={r.id}>
                        <td>{yes(p.read)}</td>
                        <td>{yes(p.create)}</td>
                        <td>{yes(p.update)}</td>
                        <td>{yes(p.delete)}</td>
                        <td>{yes(p.export)}</td>
                        <td data-tooltip={hasContact ? 'Raw phone/email (masked by default with reveal)' : 'No contact fields'}>{hasContact ? (p.sensitive_data ? '✓' : 'Masked') : 'N/A'}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-title">Effective field access preview</h2>
        <div className="toolbar">
          <label className="field-label" htmlFor="ap-role">
            Role
          </label>
          <InfoTip text={clinicRoles.find((r) => r.id === role)?.description ?? ''} label="About this role" />
          <SelectMenu id="ap-role" label="Role" value={role} options={clinicRoles.map((r) => ({ value: r.id, label: r.label }))} onChange={setRole} />
          <label className="field-label" htmlFor="ap-res">
            Record type
          </label>
          <SelectMenu id="ap-res" label="Record type" value={resKey} options={resources.map((r) => ({ value: r.key, label: r.labelPlural }))} onChange={setResKey} />
        </div>
        {preview.role.resources[resKey]?.read === 'none' ? (
          <p>
            <Badge tone="neutral">No access</Badge> {preview.role.label} cannot see {res.labelPlural.toLowerCase()} at all — they are excluded from navigation, search and related lists.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Sensitivity</th>
                  <th scope="col">On read</th>
                  <th scope="col">On edit</th>
                </tr>
              </thead>
              <tbody>
                {res.fields.map((f) => {
                  const r = fieldAccess(preview, res, f, 'read');
                  const u = fieldAccess(preview, res, f, 'update');
                  return (
                    <tr key={f.key}>
                      <td>{f.label}</td>
                      <td>{f.sensitivity && f.sensitivity !== 'none' ? f.sensitivity : <EmptyValue />}</td>
                      <td>
                        <StatusChip label={ACCESS_LABEL[r]} tone={ACCESS_TONE[r]} />
                      </td>
                      <td>
                        <StatusChip label={ACCESS_LABEL[u]} tone={ACCESS_TONE[u]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Row scope: {preview.role.resources[resKey]?.read === 'own' ? 'only records linked to the user (e.g. their own appointments).' : 'all records in the current clinic workspace.'}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Audit log

export function AuditPage() {
  useRevision();
  const actor = useActor();
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const all = getDb().audit.filter((a) => a.workspaceId === actor.workspaceId);
  const actions = useMemo(() => [...new Set(all.map((a) => a.action))].sort(), [all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can(actor, 'audit.view')) return <NoAccess what="the audit log" />;
  const rows = all.filter((a) => (!action || a.action === action) && (!q || `${a.summary} ${a.recordId ?? ''} ${getUser(a.actorId)?.name ?? ''} ${a.correlationId}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="page">
      <PageHeader title="Audit log" description="Append-only record of who changed what. Sensitive values are redacted. Local simulation — not tamper-evident; a production ledger lives server-side." crumbs={[{ label: 'Administration' }, { label: 'Audit log' }]} />
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder="Search summary, record, person, correlation ID" aria-label="Search audit log" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectMenu label="Filter by action" value={action} options={[{ value: '', label: 'All actions' }, ...actions.map((a) => ({ value: a, label: a }))]} onChange={setAction} />
        <span className="toolbar-count muted">{rows.length} entries</span>
      </div>
      <div className="content-surface">
        {rows.length ? (
          <div className="table-scroll">
            <table className="mini-table audit-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Record</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Correlation</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((a) => (
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
                            {open === a.id ? 'Hide' : 'Show'} {a.changes.length} change(s)
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
        ) : (
          <EmptyState icon="scroll-text" title="No audit entries yet">
            Create, edit or change the status of a record and it will be recorded here.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Event trace

export function EventsPage() {
  useRevision();
  const actor = useActor();
  const [sel, setSel] = useState<string | null>(null);
  const [type, setType] = useState('');
  if (!can(actor, 'events.view')) return <NoAccess what="the event trace" />;
  const events = getDb().events.filter((e) => e.workspaceId === actor.workspaceId && (!type || e.eventType === type));
  const types = [...new Set(getDb().events.map((e) => e.eventType))].sort();
  const selected = events.find((e) => e.eventId === sel);
  return (
    <div className="page">
      <PageHeader title="Event trace" description="Versioned domain events written to a simulated outbox. Nothing is delivered to other systems; events with a repeated idempotency key are recorded once." crumbs={[{ label: 'Administration' }, { label: 'Event trace' }]} />
      <div className="toolbar">
        <SelectMenu label="Filter by event type" value={type} options={[{ value: '', label: 'All event types' }, ...types.map((t) => ({ value: t, label: t }))]} onChange={setType} />
        <span className="toolbar-count muted">{events.length} events</span>
        <span className="spacer" />
        <Button icon="reset" disabledReason="Replay requires an authorized server-side workflow runtime">
          Replay selected
        </Button>
      </div>
      <div className="events-split">
        <div className="content-surface">
          {events.length ? (
            <ul className="event-list">
              {events.slice(0, 300).map((e) => (
                <li key={e.eventId}>
                  <button type="button" className={cx('event-row', sel === e.eventId && 'is-active')} onClick={() => setSel(e.eventId)} aria-pressed={sel === e.eventId}>
                    <code>{e.eventType}</code>
                    <span className="mono small">{e.recordId ?? <EmptyValue />}</span>
                    <span className="muted small">
                      {getUser(e.actorId)?.name} · {relativeTime(e.occurredAt)}
                    </span>
                    <Badge tone="neutral">simulated</Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="activity" title="No events yet">
              Events appear when records, comments, approvals or configuration change.
            </EmptyState>
          )}
        </div>
        <aside className="panel event-detail" aria-label="Event envelope">
          {selected ? <pre className="json">{JSON.stringify(selected, null, 2)}</pre> : <p className="muted">Select an event to see its full envelope.</p>}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Settings

export function SettingsPage() {
  useRevision();
  const actor = useActor();
  const s = getSettings(actor.user.id);
  const [reset, setReset] = useState(false);
  const set = (p: Parameters<typeof updateSettings>[1]) => updateSettings(actor.user.id, p);
  const db = getDb();
  return (
    <div className="page">
      <PageHeader title="Settings" description="Personal preferences are stored for your demo user in this browser. Platform rules (accessibility, security) cannot be overridden." crumbs={[{ label: 'Administration' }, { label: 'Settings' }]} />
      <div className="settings-grid">
        <section className="panel">
          <h2 className="panel-title">Appearance</h2>
          <fieldset className="form-field">
            <legend className="field-label">Theme</legend>
            <div className="segmented">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button key={t} type="button" className={cx('seg-btn', s.theme === t && 'is-on')} aria-pressed={s.theme === t} onClick={() => set({ theme: t })}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="form-field">
            <legend className="field-label">Icon rail skin</legend>
            <div className="skin-grid">
              {railSkins.map((k) => (
                <button key={k.id} type="button" className={cx('skin', s.railSkin === k.id && 'is-on')} aria-pressed={s.railSkin === k.id} onClick={() => set({ railSkin: k.id })}>
                  <span className="skin-swatch" style={{ background: k.swatch }} aria-hidden="true" />
                  {k.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="form-field">
            <legend className="field-label">Navigation density</legend>
            <div className="segmented">
              {(['balanced', 'compact'] as const).map((d) => (
                <button key={d} type="button" className={cx('seg-btn', s.navDensity === d && 'is-on')} aria-pressed={s.navDensity === d} onClick={() => set({ navDensity: d })}>
                  {d === 'balanced' ? 'Balanced (34px)' : 'Compact (30px)'}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="form-field">
            <span className="field-label">Sidebar</span>
            <div className="row-gap">
              <span className="muted">Width {s.sidebarWidth}px</span>
              <Button onClick={() => set({ sidebarWidth: 240, sidebarCollapsed: false })}>Reset to 240px</Button>
              <Button onClick={() => set({ sidebarCollapsed: !s.sidebarCollapsed })}>{s.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}</Button>
            </div>
          </div>
        </section>
        <section className="panel">
          <h2 className="panel-title">Workspace & locale</h2>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Clinic time</dt>
              <dd>Times are clinic wall-clock times (no timezone conversion in this prototype).</dd>
            </div>
            <div className="detail-row">
              <dt>Currency</dt>
              <dd>USD — display formatting only; stored amounts are never converted.</dd>
            </div>
            <div className="detail-row">
              <dt>Date & number format</dt>
              <dd>Follows your browser locale ({navigator.language}).</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2 className="panel-title">Demo data</h2>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Dataset</dt>
              <dd>
                Synthetic seed {db.seed}, generated <DateText value={db.seededAt} showTime />
              </dd>
            </div>
            <div className="detail-row">
              <dt>Storage</dt>
              <dd>This browser’s localStorage only (key “uab.clinic-ops.db.v1”).</dd>
            </div>
            <div className="detail-row">
              <dt>Records</dt>
              <dd>
                {Object.entries(db.records)
                  .map(([k, v]) => `${v.length} ${k}`)
                  .join(' · ')}
              </dd>
            </div>
          </dl>
          <Button variant="danger" icon="reset" onClick={() => setReset(true)}>
            Reset demo data…
          </Button>
          <ResetDialog open={reset} onClose={() => setReset(false)} />
        </section>
        <section className="panel span-all">
          <h2 className="panel-title dialog-title-row">
            Design tokens
            <InfoTip text="Soft Enterprise tokens. “Locked” values come from the UAB 2.0 master specification; “proposed” values fill gaps and need design approval." label="About design tokens" />
          </h2>
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">CSS variable</th>
                  <th scope="col">Value</th>
                  <th scope="col">Status</th>
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
        </section>
      </div>
    </div>
  );
}
