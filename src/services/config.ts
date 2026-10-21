/**
 * Configuration Studio service: Draft → Validate → Preview (diff) → Publish.
 * Published versions are immutable history entries; master keys are immutable
 * (values are deactivated, never deleted).
 */
import { nowIso } from '../lib/clock';
import { fyCode, fyLabel } from '../lib/fy';
import type { FieldDefinition, MasterDefinition } from '../metadata/types';
import { uid } from '../lib/ids';
import { type Actor, can } from './authz';
import { commit, getDb } from './db';
import { collectFields } from './filter';
import { appendAudit, emitEvent } from './ledger';
import { allResources, getMaster, getResource } from './registry';
import { type ConfigDraft, type Db, ServiceError } from './types';
import { systemViews } from './views';
import { L } from '../constants/labels';
import { MASTER_PARENTS } from '../domain/masters';

const E = L.common.errors;
const CI = L.common.configIssues;

export interface ConfigIssue {
  severity: 'error' | 'warning';
  message: string;
}

function requirePublisher(actor: Actor) {
  if (!can(actor, 'config.publish')) throw new ServiceError('forbidden', E.configOnly);
}

export function getDraft(): ConfigDraft | null {
  return getDb().config.draft;
}

export function ensureDraft(actor: Actor): ConfigDraft {
  requirePublisher(actor);
  return commit((d) => {
    if (!d.config.draft) {
      const now = nowIso();
      d.config.draft = { id: uid('draft'), createdBy: actor.user.id, createdAt: now, updatedAt: now, masters: {}, newFields: [] };
    }
    return d.config.draft;
  });
}

export function setDraftMaster(actor: Actor, master: MasterDefinition) {
  requirePublisher(actor);
  commit((d) => {
    if (!d.config.draft) throw new ServiceError('invalid_state', E.startDraft);
    d.config.draft.masters[master.key] = JSON.parse(JSON.stringify(master));
    d.config.draft.updatedAt = nowIso();
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
    if (!d.config.draft) throw new ServiceError('invalid_state', E.startDraft);
    d.config.draft.newFields.push({ resource: spec.resource, field });
    d.config.draft.updatedAt = nowIso();
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

/** ADM-03: the parent master of a child master (Complaint Sub-category → Complaint Category, Territory → State), if any. */
export function parentMasterOf(masterKey: string): string | undefined {
  for (const res of allResources()) {
    for (const f of res.fields) {
      if (f.master !== masterKey || !f.masterParentField) continue;
      const parent = res.fields.find((p) => p.key === f.masterParentField);
      if (parent?.master) return parent.master;
    }
  }
  return MASTER_PARENTS[masterKey];
}

/** Workflow start / end states (e.g. Won, Lost) drive lifecycles; they can be renamed or reordered but never switched off or removed. */
export function isWorkflowValue(masterKey: string, valueKey: string): boolean {
  return allResources().some((r) => {
    const lc = r.lifecycle;
    if (!lc) return false;
    const f = r.fields.find((x) => x.key === lc.field);
    return f?.master === masterKey && (lc.initial === valueKey || lc.terminal.includes(valueKey));
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
    const shippedKeys = new Set(published.values.map((p) => p.key));
    const parentKey = parentMasterOf(m.key);
    const parentMaster = parentKey ? draft.masters[parentKey] ?? getMaster(parentKey) : undefined;
    const parentValues = new Set(parentMaster?.values.map((p) => p.key) ?? []);
    const parentLabel = parentMaster?.label ?? '';
    m.values.forEach((v) => {
      // ADM-03: the key format applies to values added now. Shipped keys (TX, 01, 18, 1_3m…) are immutable and stay valid.
      if (!shippedKeys.has(v.key) && !/^[a-z][a-z0-9_]{1,39}$/.test(v.key)) issues.push({ severity: 'error', message: CI.keySnake(m.label, v.key) });
      if (keys.has(v.key)) issues.push({ severity: 'error', message: CI.duplicateKey(m.label, v.key) });
      keys.add(v.key);
      if (!v.label.trim()) issues.push({ severity: 'error', message: CI.needsLabel(m.label, v.key) });
      // A new child value without (or with an unknown) parent would never appear in its dependent dropdown.
      if (parentKey && !shippedKeys.has(v.key) && !(v.parent && parentValues.has(v.parent))) issues.push({ severity: 'error', message: CI.needsParent(m.label, v.label, parentLabel) });
    });
    published.values.forEach((pv) => {
      if (!keys.has(pv.key)) issues.push({ severity: 'error', message: isWorkflowValue(m.key, pv.key) ? CI.workflowLocked(m.label, pv.label) : CI.cannotRemove(m.label, pv.label) });
    });
    // Matches the UI lock in Settings › Masters: workflow start / end values stay active.
    m.values.forEach((v) => {
      if (!v.active && shippedKeys.has(v.key) && isWorkflowValue(m.key, v.key)) issues.push({ severity: 'error', message: CI.workflowLocked(m.label, v.label) });
    });
    if (!m.values.some((v) => v.active)) issues.push({ severity: 'error', message: CI.oneActive(m.label) });

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
          .forEach((f) => issues.push({ severity: 'error', message: CI.isDefault(m.label, v.label, res.label, f.label) }));
      }
      if (usage) issues.push({ severity: 'warning', message: CI.inUse(m.label, usage, v.label) });
      allViews.forEach((view) => {
        const res = getResource(view.resource);
        const masterFields = res.fields.filter((f) => f.master === m.key).map((f) => f.key);
        const uses = JSON.stringify(view.filter).includes(`"value":"${v.key}"`) && collectFields(view.filter).some((k) => masterFields.includes(k));
        if (uses) issues.push({ severity: 'error', message: CI.viewFilters(m.label, view.name, res.labelPlural, v.label) });
      });
    }
  }

  const seen = new Set<string>();
  for (const { resource, field } of draft.newFields) {
    const res = getResource(resource);
    const id = `${resource}.${field.key}`;
    if (!/^[a-z][a-zA-Z0-9]{1,39}$/.test(field.key)) issues.push({ severity: 'error', message: CI.fieldKey(res.label, field.key) });
    if (res.fields.some((f) => f.key === field.key) || seen.has(id)) issues.push({ severity: 'error', message: CI.fieldExists(res.label, field.key) });
    seen.add(id);
    if (!field.label) issues.push({ severity: 'error', message: CI.fieldLabel(res.label) });
    if (field.type === 'master' && !field.master) issues.push({ severity: 'error', message: CI.chooseMaster(res.label, field.label) });
    const count = (d.records[resource] ?? []).length;
    if (field.required && field.defaultValue === undefined && count > 0) {
      issues.push({ severity: 'error', message: CI.requiredDefault(res.label, field.label, count) });
    }
  }
  if (!Object.keys(draft.masters).length && !draft.newFields.length) issues.push({ severity: 'warning', message: CI.noChanges });
  return issues;
}

const masterLabelOf = (key: string | undefined, value: string) => (key ? getMaster(key).values.find((x) => x.key === value)?.label ?? value : value);

export function draftSummary(draft: ConfigDraft): string[] {
  const lines: string[] = [];
  for (const m of Object.values(draft.masters)) {
    const pub = getMaster(m.key);
    m.values.forEach((v) => {
      const p = pub.values.find((x) => x.key === v.key);
      if (!p) lines.push(`${m.label}: add "${v.label}"${v.parent ? ` (${CI.under(masterLabelOf(parentMasterOf(m.key), v.parent))})` : ''}`);
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
  if (!draft) throw new ServiceError('invalid_state', E.nothingToPublish);
  const issues = validateDraft(draft);
  if (issues.some((i) => i.severity === 'error')) throw new ServiceError('validation', E.fixBeforePublish);
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
    d.config.history.unshift({ id: uid('cfg'), version: d.config.version, publishedAt: nowIso(), publishedBy: actor.user.id, summary });
    d.config.draft = null;
    const correlationId = uid('cor');
    appendAudit(d, actor, { action: 'config.published', summary: L.common.audit.configPublished(d.config.version, summary.length), correlationId });
    emitEvent(d, actor, { eventType: 'config.published', correlationId, payload: { version: d.config.version, changes: summary.length } });
  });
}

// ---------------------------------------------------------------- numbering series (BR-13, ADM-09)

/** Document types whose numbers an administrator can configure in Settings › Numbering Series. */
export const DOC_TYPES = ['quotation', 'salesOrder', 'lead', 'opportunity', 'ticket'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface NumberSeries {
  prefix: string;
  /** Include the division code (division-wise series: one counter per division). */
  division: boolean;
  /** Financial year in the number: "label" = 26-27, "code" = 2627, "none" = one running series. */
  fy: 'label' | 'code' | 'none';
  separator: '/' | '-';
  /** Digits of the running number (zero-padded). */
  padding: number;
}

/** Shipped series: exactly the formats the app has always issued, so existing numbers continue. */
export const DEFAULT_SERIES: Record<DocType, NumberSeries> = {
  quotation: { prefix: 'QT', division: true, fy: 'label', separator: '/', padding: 4 },
  salesOrder: { prefix: 'SO', division: true, fy: 'label', separator: '/', padding: 4 },
  lead: { prefix: 'LD', division: false, fy: 'code', separator: '-', padding: 5 },
  opportunity: { prefix: 'OPP', division: false, fy: 'code', separator: '-', padding: 5 },
  ticket: { prefix: 'TKT', division: false, fy: 'code', separator: '-', padding: 5 },
};

/** Resource whose record id is the document number (others keep the number in a field). */
export const DOC_RESOURCE: Record<DocType, string> = { quotation: 'quotations', salesOrder: 'salesOrders', lead: 'leads', opportunity: 'opportunities', ticket: 'tickets' };
const COUNTER_BASE: Record<DocType, string> = { quotation: 'quoteNo', salesOrder: 'soNo', lead: 'leads', opportunity: 'opportunities', ticket: 'tickets' };
const ID_DOCS: Partial<Record<string, DocType>> = { leads: 'lead', opportunities: 'opportunity', tickets: 'ticket' };

type ConfigWithSeries = Db['config'] & { numbering?: Partial<Record<DocType, NumberSeries>> };

export function getNumberSeries(docType: DocType, d: Db = getDb()): NumberSeries {
  return { ...DEFAULT_SERIES[docType], ...((d.config as ConfigWithSeries).numbering?.[docType] ?? {}) };
}

/** Counter key: same keys the app always used, so a saved series continues the running number. */
function counterKey(docType: DocType, series: NumberSeries, divisionId?: string) {
  const fyPart = docType === 'quotation' || docType === 'salesOrder' ? fyLabel() : fyCode();
  return [COUNTER_BASE[docType], series.division ? divisionId || 'ALL' : null, series.fy === 'none' ? null : fyPart].filter((x) => x !== null).join(':');
}

export function formatNumber(series: NumberSeries, n: number, divisionId?: string): string {
  const fy = series.fy === 'label' ? fyLabel() : series.fy === 'code' ? fyCode() : '';
  return [series.prefix, series.division ? divisionId || 'ALL' : '', fy, String(n).padStart(series.padding, '0')].filter(Boolean).join(series.separator);
}

/** Last number issued in the current period (for the division, when the series is division-wise). */
export function lastIssued(docType: DocType, divisionId?: string, d: Db = getDb()): number {
  return d.counters[counterKey(docType, getNumberSeries(docType, d), divisionId)] ?? 0;
}

/** Issues the next document number of a series (inside a commit). Used by every number generator. */
export function nextNumber(d: Db, docType: DocType, divisionId?: string): string {
  const series = getNumberSeries(docType, d);
  const key = counterKey(docType, series, divisionId);
  d.counters[key] = (d.counters[key] ?? 0) + 1;
  return formatNumber(series, d.counters[key], divisionId);
}

/** Record-id generator hook for resources whose id is a document number (leads, opportunities, tickets). */
export const docTypeForResource = (resKey: string): DocType | undefined => ID_DOCS[resKey];

export function previewNumber(docType: DocType, series: NumberSeries, divisionId = 'TX', d: Db = getDb()): string {
  return formatNumber(series, (d.counters[counterKey(docType, series, divisionId)] ?? 0) + 1, divisionId);
}

export type SeriesErrors = Partial<Record<'prefix' | 'padding' | 'nextNumber', string>>;
const NS = L.admin.numbering;

export function validateSeries(docType: DocType, series: NumberSeries, nextNo: number | null, d: Db = getDb()): SeriesErrors {
  const e: SeriesErrors = {};
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(series.prefix)) e.prefix = NS.errors.prefix;
  if (!Number.isInteger(series.padding) || series.padding < 3 || series.padding > 8) e.padding = NS.errors.padding;
  if (nextNo !== null) {
    const highest = Math.max(0, ...Object.entries(d.counters).filter(([k]) => counterKeysOf(docType, series).includes(k)).map(([, v]) => v));
    if (!Number.isInteger(nextNo) || nextNo < 1 || nextNo > 99_999_999) e.nextNumber = NS.errors.nextRange;
    else if (nextNo <= highest) e.nextNumber = NS.errors.nextTooLow(highest);
    else if (String(nextNo).length > series.padding) e.nextNumber = NS.errors.nextTooLong(series.padding);
  }
  // Two series must not produce the same numbers.
  const clash = DOC_TYPES.find((t) => t !== docType && getNumberSeries(t, d).prefix === series.prefix);
  if (clash && !e.prefix) e.prefix = NS.errors.prefixUsed(NS.docTypes[clash]);
  return e;
}

/** Current-period counter keys of a series (every division when division-wise). */
function counterKeysOf(docType: DocType, series: NumberSeries): string[] {
  const divs = getMaster('division').values.map((v) => v.key);
  return series.division ? divs.map((div) => counterKey(docType, series, div)) : [counterKey(docType, series)];
}

/** Saves a numbering series; `nextNo` (optional) moves the running number forward for the current period. */
export function saveNumberSeries(actor: Actor, docType: DocType, series: NumberSeries, nextNo: number | null) {
  requirePublisher(actor);
  const errors = validateSeries(docType, series, nextNo);
  const first = Object.values(errors)[0];
  if (first) throw new ServiceError('validation', first, { fieldErrors: errors as Record<string, string> });
  commit((d) => {
    const cfg = d.config as ConfigWithSeries;
    const before = getNumberSeries(docType, d);
    cfg.numbering = { ...(cfg.numbering ?? {}), [docType]: { ...series } };
    if (nextNo !== null) counterKeysOf(docType, series).forEach((k) => (d.counters[k] = nextNo - 1));
    const changes = (Object.keys(series) as (keyof NumberSeries)[])
      .filter((k) => before[k] !== series[k])
      .map((k) => ({ field: `numbering.${docType}.${k}`, label: `${NS.docTypes[docType]} › ${NS.fields[k]}`, before: String(before[k]), after: String(series[k]) }));
    if (nextNo !== null) changes.push({ field: `numbering.${docType}.next`, label: `${NS.docTypes[docType]} › ${NS.fields.nextNumber}`, before: '', after: String(nextNo) });
    appendAudit(d, actor, { action: 'config.numbering', summary: NS.audit(NS.docTypes[docType], formatNumber(series, nextNo ?? 1, 'TX')), changes, correlationId: uid('cor') });
  });
}
