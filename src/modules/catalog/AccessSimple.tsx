import { useMemo, useState } from "react";
import { L } from "../../constants/labels";
import type {
  ResourceDefinition,
  ResourcePermission,
  RowScope,
} from "../../metadata/types";
import { SCOPES } from "../../services/catalog/access";
import { Icon } from "../../components/primitives/Icon";
import { SelectMenu } from "../../components/primitives/SelectMenu";

const S = L.admin.access.simple;

export type Level = "none" | "view" | "edit" | "full" | "custom";
const LEVELS: Exclude<Level, "custom">[] = ["none", "view", "edit", "full"];
const WHOSE: RowScope[] = ["own", "team", "division", "all"];
const rank = (s: RowScope) => SCOPES.indexOf(s);

/** Collapses a permission into one of four plain levels; anything else is "custom" (editable in the Advanced table). */
export function levelOf(p: ResourcePermission): Level {
  if (p.read === "none") return "none";
  if (p.update === "none" && !p.create && !p.delete && !p.export) return "view";
  if (p.update === p.read && p.create && !p.delete && !p.export) return "edit";
  if (p.update === p.read && p.create && p.delete && p.export) return "full";
  return "custom";
}

/** Applies a level at a scope. Contact-data access is untouched. */
export function applyLevel(
  p: ResourcePermission,
  level: Exclude<Level, "custom">,
  scope: RowScope = p.read === "none" ? "own" : p.read,
): ResourcePermission {
  const sensitive_data = p.sensitive_data;
  if (level === "none")
    return {
      read: "none",
      update: "none",
      create: false,
      delete: false,
      export: false,
      sensitive_data,
    };
  if (level === "view")
    return {
      read: scope,
      update: "none",
      create: false,
      delete: false,
      export: false,
      sensitive_data,
    };
  if (level === "edit")
    return {
      read: scope,
      update: scope,
      create: true,
      delete: false,
      export: false,
      sensitive_data,
    };
  return {
    read: scope,
    update: scope,
    create: true,
    delete: true,
    export: true,
    sensitive_data,
  };
}

/** Moves the "whose records" scope while keeping the rest of the permission valid (update never wider than read). */
export function applyScope(
  p: ResourcePermission,
  scope: RowScope,
): ResourcePermission {
  if (p.update === "none") return { ...p, read: scope };
  const keep = levelOf(p) === "custom" && rank(p.update) <= rank(scope);
  return { ...p, read: scope, update: keep ? p.update : scope };
}

/** One plain sentence describing a permission, e.g. "Can see their own Leads, edit their own, add new ones." */
export function sentence(p: ResourcePermission, plural: string): string {
  const res = plural.toLowerCase();
  if (p.read === "none") return S.sentenceNone(res);
  const parts = [
    p.update !== "none" ? S.editScope(S.who[p.update]) : "",
    p.create ? S.add : "",
    p.delete ? S.remove : "",
    p.export ? S.exportIt : "",
  ].join("");
  return S.sentence(res, S.who[p.read], parts);
}

export const moduleName = (id: string) =>
  (L.nav.modules as Record<string, { nav: string }>)[id]?.nav ?? id;

interface Props {
  resources: ResourceDefinition[];
  perms: Record<string, ResourcePermission>;
  disabled: boolean;
  summary: string;
  onChange: (next: Record<string, ResourcePermission>) => void;
}

/** ADM-02 simple view: one row per record type with a plain "what can they do" level and "whose records" choice. */
export function AccessSimple({
  resources,
  perms,
  disabled,
  summary,
  onChange,
}: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const m = new Map<string, ResourceDefinition[]>();
    for (const r of resources) m.set(r.module, [...(m.get(r.module) ?? []), r]);
    return [...m.entries()];
  }, [resources]);
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const set = (key: string, p: ResourcePermission) =>
    onChange({ ...perms, [key]: p });
  const levelOptions = (withCustom: boolean, withMixed = false) => [
    ...(withMixed ? [{ value: "mixed", label: S.mixed }] : []),
    ...LEVELS.map((l) => ({ value: l, label: S.levels[l] })),
    ...(withCustom ? [{ value: "custom", label: S.levels.custom }] : []),
  ];

  return (
    <section className="panel access-areas">
      <div className="area-top">
        <strong>{summary}</strong>
        <span className="muted small">{S.sensitiveHint}</span>
      </div>
      {groups.map(([mod, list]) => {
        const levels = new Set(list.map((r) => levelOf(perms[r.key])));
        const same = levels.size === 1 ? [...levels][0] : null;
        const isOpen = open.has(mod);
        return (
          <div key={mod} className="area">
            <div className="area-row area-main">
              <span className="area-name">{moduleName(mod)}</span>
              <SelectMenu
                label={`${S.applyAll}: ${moduleName(mod)}`}
                value={same ?? "mixed"}
                disabled={disabled}
                options={levelOptions(same === "custom", same === null)}
                onChange={(v) => {
                  if (v === "mixed" || v === "custom") return;
                  const next = { ...perms };
                  for (const r of list)
                    next[r.key] = applyLevel(
                      perms[r.key],
                      v as Exclude<Level, "custom">,
                    );
                  onChange(next);
                }}
              />
              <button
                type="button"
                className="area-toggle"
                aria-expanded={isOpen}
                onClick={() => toggle(mod)}
              >
                {isOpen ? S.collapse : S.expand(list.length)}
                <Icon name={isOpen ? "minimize" : "plus"} size={14} />
              </button>
            </div>
            {isOpen &&
              list.map((r) => {
                const p = perms[r.key];
                const lv = levelOf(p);
                return (
                  <div key={r.key} className="area-row area-sub">
                    <span className="area-name">
                      {r.labelPlural}
                      <span className="muted small">
                        {sentence(p, r.labelPlural)}
                      </span>
                    </span>
                    <SelectMenu
                      label={`${S.level}: ${r.labelPlural}`}
                      value={lv}
                      disabled={disabled}
                      options={levelOptions(lv === "custom")}
                      onChange={(v) =>
                        v !== "custom" &&
                        set(r.key, applyLevel(p, v as Exclude<Level, "custom">))
                      }
                    />
                    {p.read === "none" ? (
                      <span />
                    ) : (
                      <SelectMenu
                        label={`${S.whose}: ${r.labelPlural}`}
                        value={p.read}
                        disabled={disabled}
                        options={WHOSE.map((w) => ({
                          value: w,
                          label: S.scopes[w],
                        }))}
                        onChange={(v) =>
                          set(r.key, applyScope(p, v as RowScope))
                        }
                      />
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </section>
  );
}
