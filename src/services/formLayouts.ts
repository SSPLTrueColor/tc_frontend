/**
 * Per-division form layouts (ADM-05, GLOSSARY G-A15) — extension point.
 * The shared RecordForm asks `getFormLayout(resKey, division)` before rendering; Administration
 * registers the implementation with `registerFormLayoutProvider` (no import from the shared form needed).
 * With nothing registered, forms render the resource's own section order.
 */
import type { FormSection, ResourceDefinition } from '../metadata/types';

export interface FormLayout {
  /** Section ids in display order; sections not listed keep their relative order after the listed ones. */
  sectionOrder?: string[];
  /** Sections hidden for this division. */
  hiddenSections?: string[];
  /** Fields hidden for this division (required fields are never hidden, so validation stays intact). */
  hiddenFields?: string[];
}

export type FormLayoutProvider = (resKey: string, division: string | undefined) => FormLayout | undefined;

let provider: FormLayoutProvider | null = null;

export function registerFormLayoutProvider(p: FormLayoutProvider | null) {
  provider = p;
}

export function getFormLayout(resKey: string, division: string | undefined): FormLayout | undefined {
  try {
    return provider?.(resKey, division) ?? undefined;
  } catch {
    return undefined; // a broken layout never breaks the form
  }
}

/** Division of a record (or form values) via the resource's `divisionField` (first value when multi). */
export function divisionOf(res: ResourceDefinition, values: Record<string, unknown>): string | undefined {
  if (!res.divisionField) return undefined;
  const v = values[res.divisionField];
  return Array.isArray(v) ? (v[0] as string | undefined) : v == null || v === '' ? undefined : String(v);
}

/** The resource with its form sections re-ordered / filtered by the registered layout. */
export function applyFormLayout(res: ResourceDefinition, division: string | undefined): ResourceDefinition {
  const layout = getFormLayout(res.key, division);
  if (!layout) return res;
  const required = new Set(res.fields.filter((f) => f.required).map((f) => f.key));
  const hiddenFields = new Set((layout.hiddenFields ?? []).filter((k) => !required.has(k)));
  const hiddenSections = new Set(layout.hiddenSections ?? []);
  const order = layout.sectionOrder ?? [];
  const rank = (s: FormSection) => {
    const i = order.indexOf(s.id);
    return i < 0 ? order.length : i;
  };
  const sections = res.form.sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !hiddenSections.has(s.id) || s.fields.some((k) => required.has(k)))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => ({ ...s, fields: s.fields.filter((k) => !hiddenFields.has(k)) }))
    .filter((s) => s.fields.length);
  return { ...res, form: { ...res.form, sections } };
}
