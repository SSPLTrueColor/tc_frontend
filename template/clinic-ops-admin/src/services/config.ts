/**
 * Configuration Studio service: Draft → Validate → Preview (diff) → Publish.
 * Published versions are immutable history entries; master keys are immutable
 * (values are deactivated, never deleted).
 */
import type { FieldDefinition, MasterDefinition } from '../metadata/types';
import { uid } from '../lib/ids';
import { type Actor, can } from './authz';
import { commit, getDb } from './db';
import { collectFields } from './filter';
import { appendAudit, emitEvent } from './ledger';
import { allResources, getMaster, getResource } from './registry';
import { type ConfigDraft, ServiceError } from './types';
import { systemViews } from './views';

export interface ConfigIssue {
  severity: 'error' | 'warning';
  message: string;
}

function requirePublisher(actor: Actor) {
  if (!can(actor, 'config.publish')) throw new ServiceError('forbidden', 'Your role cannot change configuration.');
}

export function getDraft(): ConfigDraft | null {
  return getDb().config.draft;
}

export function ensureDraft(actor: Actor): ConfigDraft {
  requirePublisher(actor);
  return commit((d) => {
    if (!d.config.draft) {
      const now = new Date().toISOString();
      d.config.draft = { id: uid('draft'), createdBy: actor.user.id, createdAt: now, updatedAt: now, masters: {}, newFields: [] };
    }
    return d.config.draft;
  });
}

export function setDraftMaster(actor: Actor, master: MasterDefinition) {
  requirePublisher(actor);
  commit((d) => {
    if (!d.config.draft) throw new ServiceError('invalid_state', 'Start a draft first.');
    d.config.draft.masters[master.key] = JSON.parse(JSON.stringify(master));
    d.config.draft.updatedAt = new Date().toISOString();
  });
}

export function revertDraftMaster(actor: Actor, key: string) {
  requirePublisher(actor);
  commit((d) => {
    if (d.config.draft) delete d.config.draft.masters[key];
  });
}

export interface NewFieldSpec {
  resource: string;
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'number' | 'date' | 'boolean' | 'master';
  master?: string;
  required: boolean;
  defaultValue?: unknown;
  sensitivity: FieldDefinition['sensitivity'];
  help?: string;
}

export function addDraftField(actor: Actor, spec: NewFieldSpec) {
  requirePublisher(actor);
  const field: FieldDefinition = {
    id: `fld_${spec.resource}_${spec.key}_${uid('v').slice(-4)}`,
    key: spec.key,
    label: spec.label.trim(),
    type: spec.type,
    master: spec.type === 'master' ? spec.master : undefined,
    required: spec.required,
    defaultValue: spec.defaultValue === '' ? undefined : spec.defaultValue,
    sensitivity: spec.sensitivity,
    help: spec.help,
    custom: true,
    capabilities: { list: spec.type !== 'longtext', sort: spec.type !== 'longtext', filter: true, search: spec.type === 'text', form: true, export: true },
  };
  commit((d) => {
    if (!d.config.draft) throw new ServiceError('invalid_state', 'Start a draft first.');
    d.config.draft.newFields.push({ resource: spec.resource, field });
    d.config.draft.updatedAt = new Date().toISOString();
  });
}

export function removeDraftField(actor: Actor, fieldId: string) {
  requirePublisher(actor);
  commit((d) => {
    if (d.config.draft) d.config.draft.newFields = d.config.draft.newFields.filter((f) => f.field.id !== fieldId);
  });
}

export function discardDraft(actor: Actor) {
  requirePublisher(actor);
  commit((d) => {
    d.config.draft = null;
  });
}

/** Dependency-aware validation of the whole draft. */
export function validateDraft(draft: ConfigDraft): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const d = getDb();
  const allViews = [...allResources().flatMap((r) => systemViews(r.key)), ...d.views];

  for (const m of Object.values(draft.masters)) {
    const published = getMaster(m.key);
    const keys = new Set<string>();
    m.values.forEach((v) => {
      if (!/^[a-z][a-z0-9_]{1,39}$/.test(v.key)) issues.push({ severity: 'error', message: `${m.label}: key "${v.key}" must be lowercase snake_case.` });
      if (keys.has(v.key)) issues.push({ severity: 'error', message: `${m.label}: duplicate key "${v.key}".` });
      keys.add(v.key);
      if (!v.label.trim()) issues.push({ severity: 'error', message: `${m.label}: value "${v.key}" needs a label.` });
    });
    published.values.forEach((pv) => {
      if (!keys.has(pv.key)) issues.push({ severity: 'error', message: `${m.label}: value "${pv.label}" cannot be removed — deactivate it instead (keys are immutable).` });
    });
    if (!m.values.some((v) => v.active)) issues.push({ severity: 'error', message: `${m.label}: at least one value must remain active.` });

    const newlyInactive = m.values.filter((v) => !v.active && published.values.find((p) => p.key === v.key)?.active);
    for (const v of newlyInactive) {
      // Records keep historical meaning — warn only.
      let usage = 0;
      for (const res of allResources()) {
        res.fields
          .filter((f) => (f.type === 'master' || f.type === 'multimaster') && f.master === m.key)
          .forEach((f) => {
            usage += (d.records[res.key] ?? []).filter((r) => (Array.isArray(r[f.key]) ? (r[f.key] as string[]).includes(v.key) : r[f.key] === v.key)).length;
          });
        // Defaults and saved-view filters referencing the value are breaking dependencies.
        res.fields
          .filter((f) => f.master === m.key && f.defaultValue === v.key)
          .forEach((f) => issues.push({ severity: 'error', message: `${m.label}: "${v.label}" is the default for ${res.label} › ${f.label}. Choose another default before deactivating.` }));
      }
      if (usage) issues.push({ severity: 'warning', message: `${m.label}: ${usage} existing record(s) use "${v.label}". They keep it; it will no longer be selectable.` });
      allViews.forEach((view) => {
        const res = getResource(view.resource);
        const masterFields = res.fields.filter((f) => f.master === m.key).map((f) => f.key);
        const uses = JSON.stringify(view.filter).includes(`"value":"${v.key}"`) && collectFields(view.filter).some((k) => masterFields.includes(k));
        if (uses) issues.push({ severity: 'error', message: `${m.label}: saved view "${view.name}" (${res.labelPlural}) filters on "${v.label}". Update that view first.` });
      });
    }
  }

  const seen = new Set<string>();
  for (const { resource, field } of draft.newFields) {
    const res = getResource(resource);
    const id = `${resource}.${field.key}`;
    if (!/^[a-z][a-zA-Z0-9]{1,39}$/.test(field.key)) issues.push({ severity: 'error', message: `${res.label}: field key "${field.key}" must be camelCase letters/digits.` });
    if (res.fields.some((f) => f.key === field.key) || seen.has(id)) issues.push({ severity: 'error', message: `${res.label}: a field with key "${field.key}" already exists.` });
    seen.add(id);
    if (!field.label) issues.push({ severity: 'error', message: `${res.label}: new field needs a label.` });
    if (field.type === 'master' && !field.master) issues.push({ severity: 'error', message: `${res.label} › ${field.label}: choose a master list.` });
    const count = (d.records[resource] ?? []).length;
    if (field.required && field.defaultValue === undefined && count > 0) {
      issues.push({ severity: 'error', message: `${res.label} › ${field.label}: required on ${count} existing records — provide a default value.` });
    }
  }
  if (!Object.keys(draft.masters).length && !draft.newFields.length) issues.push({ severity: 'warning', message: 'The draft has no changes.' });
  return issues;
}

export function draftSummary(draft: ConfigDraft): string[] {
  const lines: string[] = [];
  for (const m of Object.values(draft.masters)) {
    const pub = getMaster(m.key);
    m.values.forEach((v) => {
      const p = pub.values.find((x) => x.key === v.key);
      if (!p) lines.push(`${m.label}: add "${v.label}"`);
      else {
        if (p.label !== v.label) lines.push(`${m.label}: rename "${p.label}" → "${v.label}"`);
        if (p.active !== v.active) lines.push(`${m.label}: ${v.active ? 'reactivate' : 'deactivate'} "${v.label}"`);
        if (p.order !== v.order) lines.push(`${m.label}: reorder "${v.label}"`);
        if (p.tone !== v.tone) lines.push(`${m.label}: change tone of "${v.label}"`);
      }
    });
  }
  draft.newFields.forEach(({ resource, field }) => lines.push(`${getResource(resource).labelPlural}: add field "${field.label}" (${field.type}${field.required ? ', required' : ''})`));
  return lines;
}

export function publishDraft(actor: Actor) {
  requirePublisher(actor);
  const draft = getDraft();
  if (!draft) throw new ServiceError('invalid_state', 'Nothing to publish.');
  const issues = validateDraft(draft);
  if (issues.some((i) => i.severity === 'error')) throw new ServiceError('validation', 'Fix validation errors before publishing.');
  const summary = draftSummary(draft);
  commit((d) => {
    for (const m of Object.values(draft.masters)) {
      d.config.masters[m.key] = { ...m, version: getMaster(m.key).version + 1 };
    }
    for (const { resource, field } of draft.newFields) {
      d.config.customFields[resource] = [...(d.config.customFields[resource] ?? []), field];
      d.config.resourceVersions[resource] = (d.config.resourceVersions[resource] ?? 1) + 1;
      if (field.defaultValue !== undefined) {
        d.records[resource] = d.records[resource].map((r) => (r[field.key] === undefined ? { ...r, [field.key]: field.defaultValue } : r));
      }
    }
    d.config.version += 1;
    d.config.history.unshift({ id: uid('cfg'), version: d.config.version, publishedAt: new Date().toISOString(), publishedBy: actor.user.id, summary });
    d.config.draft = null;
    const correlationId = uid('cor');
    appendAudit(d, actor, { action: 'config.published', summary: `Published configuration v${d.config.version}: ${summary.length} change(s)`, correlationId });
    emitEvent(d, actor, { eventType: 'config.published', correlationId, payload: { version: d.config.version, changes: summary.length } });
  });
}
