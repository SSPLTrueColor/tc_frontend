/**
 * Per-division form layouts (ADM-05, FR-123, GLOSSARY G-A15). For one record type and one division an
 * administrator sets the order of the form sections and hides sections that division does not use.
 * Stored in the configuration store (config.formLayouts) with a published-version entry, audit and event.
 *
 * Forms apply it through `applyFormLayout(res, division)` (see `formLayoutDivision` for which division a form uses).
 */
import { L } from '../../constants/labels';
import { nowIso } from '../../lib/clock';
import { uid } from '../../lib/ids';
import type { FormSection, RecordData, ResourceDefinition } from '../../metadata/types';
import { type Actor, can } from '../authz';
import { commit, getDb } from '../db';
import { appendAudit, emitEvent } from '../ledger';
import { activeMasterValues, allResources, getResource, masterLabel } from '../registry';
import type { Db } from '../types';
import { ServiceError } from '../types';

export interface FormLayout {
  resource: string;
  division: string;
  /** Section ids in display order (every section of the form). */
  order: string[];
  /** Section ids that are not shown for this division. */
  hidden: string[];
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/** Local-store extension: per-division form layouts keyed `${resource}:${division}`. */
export type ConfigWithLayouts = Db['config'] & { formLayouts?: Record<string, FormLayout> };

const layoutKey = (resource: string, division: string) => `${resource}:${division}`;
const stored = (d: Db = getDb()) => (d.config as ConfigWithLayouts).formLayouts ?? {};

/** The saved layout for a record type in a division, or null when the shipped layout applies. */
export function getFormLayout(resKey: string, division: string | undefined | null): FormLayout | null {
  if (!division) return null;
  return stored()[layoutKey(resKey, division)] ?? null;
}

/** Every saved layout (for the "Customised Layouts" list). */
export function listFormLayouts(actor: Actor): FormLayout[] {
  requireConfig(actor);
  return Object.values(stored()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Record types whose form has more than one section (layouts only make sense there). */
export function layoutResources(): ResourceDefinition[] {
  return allResources().filter((r) => r.form.sections.length > 1);
}

export const sectionHasRequired = (res: ResourceDefinition, s: FormSection) => s.fields.some((k) => res.fields.find((f) => f.key === k)?.required);

/**
 * Sections to render, in order, for a record type and division. Falls back to the shipped order.
 * Sections added to the resource after the layout was saved are appended (never lost); a section with
 * required fields is always shown, even if an old layout hid it.
 */
export function applyFormLayout(res: ResourceDefinition, division?: string | string[] | null): FormSection[] {
  const div = Array.isArray(division) ? division[0] : division;
  const layout = getFormLayout(res.key, div ?? undefined);
  if (!layout) return res.form.sections;
  const byId = new Map(res.form.sections.map((s) => [s.id, s]));
  const ordered = [...layout.order.filter((id) => byId.has(id)), ...res.form.sections.map((s) => s.id).filter((id) => !layout.order.includes(id))];
  return ordered.map((id) => byId.get(id)!).filter((s) => !layout.hidden.includes(s.id) || sectionHasRequired(res, s));
}

/**
 * The division a form uses: the record's division field (first value), else the user's first division.
 * Pass the current form values so a division change re-lays the form.
 */
export function formLayoutDivision(res: ResourceDefinition, values: RecordData | Record<string, unknown> | undefined, actorDivisionIds: string[]): string | undefined {
  const raw = res.divisionField ? values?.[res.divisionField] : undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v ? String(v) : actorDivisionIds[0];
}

export interface FormLayoutInput {
  resource: string;
  division: string;
  order: string[];
  hidden: string[];
}

/** Errors for a proposed layout (empty = valid). */
export function validateFormLayout(input: FormLayoutInput): string[] {
  const res = getResource(input.resource);
  const ids = res.form.sections.map((s) => s.id);
  const E = L.admin.config;
  const errors: string[] = [];
  if (!activeMasterValues('division').some((d) => d.key === input.division)) errors.push(E.unknownDivision);
  input.order.filter((id) => !ids.includes(id)).forEach((id) => errors.push(E.unknownSection(id)));
  ids.filter((id) => !input.order.includes(id)).forEach((id) => errors.push(E.missingSection(id)));
  input.hidden.forEach((id) => {
    const s = res.form.sections.find((x) => x.id === id);
    if (!s) errors.push(E.unknownSection(id));
    else if (sectionHasRequired(res, s)) errors.push(E.requiredHidden(s.title || s.id));
  });
  if (ids.every((id) => input.hidden.includes(id))) errors.push(E.allHidden);
  return errors;
}

function requireConfig(actor: Actor) {
  if (!can(actor, 'config.publish')) throw new ServiceError('forbidden', L.admin.config.forbidden);
}

/** Publish history entry + audit + event for a layout change (one immutable configuration version). */
function record(d: Db, actor: Actor, summary: string, action: string, payload: Record<string, unknown>) {
  d.config.version += 1;
  d.config.history.unshift({ id: uid('cfg'), version: d.config.version, publishedAt: nowIso(), publishedBy: actor.user.id, summary: [summary] });
  const correlationId = uid('cor');
  appendAudit(d, actor, { action, summary: `${summary} (v${d.config.version})`, correlationId });
  emitEvent(d, actor, { eventType: action, correlationId, payload: { ...payload, version: d.config.version } });
}

export function saveFormLayout(actor: Actor, input: FormLayoutInput): FormLayout {
  requireConfig(actor);
  const errors = validateFormLayout(input);
  if (errors.length) throw new ServiceError('validation', errors.join(' · '));
  const res = getResource(input.resource);
  const divLabel = masterLabel('division', input.division);
  return commit((d) => {
    const cfg = d.config as ConfigWithLayouts;
    const all = { ...(cfg.formLayouts ?? {}) };
    const k = layoutKey(input.resource, input.division);
    const layout: FormLayout = { resource: input.resource, division: input.division, order: [...input.order], hidden: [...input.hidden], version: (all[k]?.version ?? 0) + 1, updatedAt: nowIso(), updatedBy: actor.user.id };
    all[k] = layout;
    cfg.formLayouts = all;
    record(d, actor, L.admin.config.layoutSummary(res.labelPlural, divLabel), 'config.form_layout', { resource: input.resource, division: input.division });
    return layout;
  });
}

export function resetFormLayout(actor: Actor, resource: string, division: string) {
  requireConfig(actor);
  const res = getResource(resource);
  const divLabel = masterLabel('division', division);
  commit((d) => {
    const cfg = d.config as ConfigWithLayouts;
    const all = { ...(cfg.formLayouts ?? {}) };
    if (!all[layoutKey(resource, division)]) return;
    delete all[layoutKey(resource, division)];
    cfg.formLayouts = all;
    record(d, actor, L.admin.config.layoutResetSummary(res.labelPlural, divLabel), 'config.form_layout_reset', { resource, division });
  });
}
