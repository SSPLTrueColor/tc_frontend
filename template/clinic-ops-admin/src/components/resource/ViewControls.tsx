import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ColumnState, FieldDefinition, FilterCondition, FilterGroup, ResourceDefinition, ViewDefinition, ViewScope, ViewType } from '../../metadata/types';
import { cx } from '../../lib/format';
import { type Actor, fieldAccess, queryableField } from '../../services/authz';
import { activeMasterValues } from '../../services/registry';
import { canCreateScope, canManageView, deleteView, isSystemView, moveView, saveView } from '../../services/views';
import { getSettings, updateSettings } from '../../services/settings';
import { cloneGroup, newCondition, newGroup, OPERATOR_LABELS, operatorsFor, VALUELESS, countConditions } from '../../services/filter';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { useToast } from '../primitives/feedback';
import { confirmDelete, Menu, Popover } from '../primitives/overlay';
import { relationOptions } from './FormFields';
import { SelectMenu } from '../primitives/SelectMenu';
import { MultiSelectMenu } from '../primitives/MultiSelectMenu';
import { DatePicker } from '../primitives/DatePicker';
import { DateRangePicker } from '../primitives/DateRangePicker';
import { InfoTip } from '../primitives/InfoTip';
import { ServiceError } from '../../services/types';

const canCreateScopeLabel = (s: ViewScope) => (s === 'team' ? 'requires team sharing permission' : 'requires organization sharing permission');

const TYPE_ICON: Record<ViewType, string> = { table: 'list', board: 'board', calendar: 'calendar' };

// ---------------------------------------------------------------- View Bar

export function ViewBar({
  res,
  views,
  activeId,
  onSelect,
  actor,
  working,
  dirty,
  onReset,
}: {
  res: ResourceDefinition;
  views: ViewDefinition[];
  activeId: string;
  onSelect: (id: string) => void;
  actor: Actor;
  working: ViewDefinition;
  dirty: boolean;
  onReset: () => void;
}) {
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'rename' | 'duplicate'; view?: ViewDefinition; anchor: 'add' | 'menu' | 'dirty' }>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const toast = useToast();
  const settings = getSettings(actor.user.id);
  const active = views.find((v) => v.id === activeId);

  const saveCurrent = () => {
    if (!active) return;
    try {
      saveView(actor, { ...working, id: active.id, name: active.name, scope: active.scope });
      toast(`View "${active.name}" updated`);
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : 'Could not save view', 'danger');
    }
  };

  // Overflow: tabs scroll behind a divider; edge shadows show hidden views.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [dirtyOpen, setDirtyOpen] = useState(false);
  const dirtyRef = useRef<HTMLButtonElement>(null);
  const measure = () => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  };
  useLayoutEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [views.length]);
  // Keep the active view visible by scrolling ONLY the tab strip (scrollIntoView would also shift the page).
  useEffect(() => {
    const el = scrollRef.current;
    const tab = el?.querySelector<HTMLElement>(`[data-view-id="${activeId}"]`);
    if (!el || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < el.scrollLeft) el.scrollLeft = Math.max(0, left - 8);
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 8;
    measure();
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // One sliding underline: it glides from the old tab to the newly selected one (smooth transition).
  const tabsRef = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const tab = tabsRef.current?.querySelector<HTMLElement>(`[data-view-id="${activeId}"]`);
      setInk(tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null);
    };
    place();
    const el = tabsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeId, views.length, dirty]);

  const menuView = views.find((v) => v.id === menuFor);
  const manageReason = (v: ViewDefinition) => (isSystemView(v) ? 'Built-in views cannot be changed — duplicate instead' : canManageView(actor, v) ? undefined : 'You do not own this shared view');

  return (
    <div className="viewbar" role="navigation" aria-label={`${res.labelPlural} views`}>
      <div className={cx('viewbar-scroll-wrap', edges.left && 'fade-left', edges.right && 'fade-right')}>
      <div ref={scrollRef} className="viewbar-scroll" onScroll={measure}>
        <div ref={tabsRef} className="viewbar-tabs" role="tablist" aria-label="Saved views">
          {ink && <span className="view-tab-ink" aria-hidden="true" style={{ transform: `translateX(${ink.left + 4}px)`, width: Math.max(0, ink.width - 8) }} />}
          {views.map((v) => (
            <div key={v.id} className={cx('view-tab', v.id === activeId && 'is-active')} data-view-id={v.id}>
              <button type="button" role="tab" aria-selected={v.id === activeId} className="view-tab-btn" onClick={() => onSelect(v.id)} data-tooltip={`${v.name} · ${v.scope === 'personal' ? 'only you' : v.scope === 'team' ? 'shared with team' : 'organization'}`}>
                <Icon name={TYPE_ICON[v.type]} size={14} />
                <span>{v.name}</span>
                {settings.defaultViews[res.key] === v.id && <Icon name="star" size={12} className="muted" />}
                {v.id === activeId && dirty && <span className="dirty-dot" aria-label="unsaved changes" />}
              </button>
              <button
                type="button"
                className="view-tab-menu"
                aria-label={`Options for view ${v.name}`}
                aria-haspopup="menu"
                onClick={(e) => {
                  menuAnchor.current = e.currentTarget;
                  setMenuFor(v.id);
                }}
              >
                <Icon name="more-vertical" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
      </div>
      <button ref={addRef} type="button" className={cx('view-add', dialog?.anchor === 'add' && 'is-open')} aria-label="Add view" data-tooltip="Add view" aria-haspopup="dialog" aria-expanded={dialog?.anchor === 'add'} onClick={() => setDialog(dialog?.anchor === 'add' ? null : { mode: 'create', anchor: 'add' })}>
        <Icon name="plus" size={16} />
      </button>
      {dirty && (
        <>
          <Button ref={dirtyRef} variant="ghost" iconRight="chevron-down" onClick={() => setDirtyOpen(true)} aria-haspopup="menu" className="viewbar-unsaved">
            Unsaved
          </Button>
          <Menu
            open={dirtyOpen}
            onClose={() => setDirtyOpen(false)}
            anchor={dirtyRef}
            label="Unsaved view changes"
            align="start"
            items={[
              ...(active && !isSystemView(active) && canManageView(actor, active) ? [{ id: 'save', label: `Save to “${active.name}”`, icon: 'check', onSelect: saveCurrent }] : []),
              { id: 'saveas', label: 'Save as new view…', icon: 'plus', onSelect: () => setDialog({ mode: 'create', anchor: 'dirty' }) },
              { id: 'reset', label: 'Reset changes', icon: 'reset', onSelect: onReset },
            ]}
          />
        </>
      )}
      {/* + follows the last view; once the bar is full it stops here and extra views slide under it. */}
      <span className="viewbar-spacer" />
      <span className="viewbar-divider" aria-hidden="true" />
      {menuView && (
        <Menu
          open={!!menuFor}
          onClose={() => setMenuFor(null)}
          anchor={menuAnchor}
          label="View options"
          align="start"
          items={[
            { id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => setDialog({ mode: 'rename', view: menuView, anchor: 'menu' }), disabledReason: manageReason(menuView) },
            { id: 'dup', label: 'Duplicate', icon: 'copy', onSelect: () => setDialog({ mode: 'duplicate', view: menuView, anchor: 'menu' }) },
            {
              id: 'default',
              label: settings.defaultViews[res.key] === menuView.id ? 'Unset as my default' : 'Set as my default',
              icon: 'star',
              onSelect: () => {
                const dv = { ...settings.defaultViews };
                if (dv[res.key] === menuView.id) delete dv[res.key];
                else dv[res.key] = menuView.id;
                updateSettings(actor.user.id, { defaultViews: dv });
                toast('Default view updated');
              },
            },
            { id: 'left', label: 'Move left', icon: 'chevron-left', onSelect: () => moveView(actor, menuView.id, -1), disabledReason: manageReason(menuView) },
            { id: 'right', label: 'Move right', icon: 'chevron-right', onSelect: () => moveView(actor, menuView.id, 1), disabledReason: manageReason(menuView) },
            {
              id: 'link',
              label: 'Copy link to view',
              icon: 'copy',
              onSelect: () => {
                void navigator.clipboard?.writeText(window.location.href);
                toast('Link copied — recipients still need access');
              },
            },
            {
              id: 'delete',
              label: 'Delete view',
              icon: 'trash',
              danger: true,
              separatorBefore: true,
              disabledReason: manageReason(menuView),
              onSelect: () =>
                confirmDelete({
                  title: `Delete view "${menuView.name}"?`,
                  message: 'The view and its saved filters, columns and sort are removed for everyone it is shared with. Records are not affected.',
                  confirmLabel: 'Delete view',
                  onConfirm: () => {
                    deleteView(actor, menuView.id);
                    onSelect(views[0].id);
                    toast(`View "${menuView.name}" deleted`);
                  },
                }),
            },
          ]}
        />
      )}
      {dialog && (
        <SaveViewDialog
          res={res}
          actor={actor}
          mode={dialog.mode}
          view={dialog.view}
          working={working}
          anchor={dialog.anchor === 'add' ? addRef : dialog.anchor === 'dirty' ? dirtyRef : menuAnchor}
          onClose={() => setDialog(null)}
          onSaved={(v) => {
            setDialog(null);
            onSelect(v.id);
          }}
        />
      )}
    </div>
  );
}

function SaveViewDialog({
  res,
  actor,
  mode,
  view,
  working,
  anchor,
  onClose,
  onSaved,
}: {
  res: ResourceDefinition;
  actor: Actor;
  mode: 'create' | 'rename' | 'duplicate';
  view?: ViewDefinition;
  working: ViewDefinition;
  anchor: RefObject<HTMLElement>;
  onClose: () => void;
  onSaved: (v: ViewDefinition) => void;
}) {
  const [name, setName] = useState(mode === 'rename' ? view!.name : mode === 'duplicate' ? `${view!.name} (copy)` : '');
  const [scope, setScope] = useState<ViewScope>(mode === 'rename' ? view!.scope : 'personal');
  const [type, setType] = useState<ViewType>(mode === 'create' ? working.type : view!.type);
  const [error, setError] = useState('');
  const types: ViewType[] = ['table', 'board', ...(res.calendar ? (['calendar'] as ViewType[]) : [])].filter((t) => t !== 'board' || !!res.lifecycle) as ViewType[];
  const submit = () => {
    try {
      const base = mode === 'create' ? working : view!;
      const v = saveView(actor, {
        ...base,
        id: mode === 'rename' ? view!.id : undefined,
        name,
        scope,
        type,
        boardField: type === 'board' ? res.lifecycle?.field : base.boardField,
        isDefault: false,
      });
      onSaved(v);
    } catch (e) {
      setError(e instanceof ServiceError ? e.message : 'Could not save view');
    }
  };
  const title = mode === 'rename' ? 'Rename view' : mode === 'duplicate' ? 'Duplicate view' : 'New view';
  // Anchored panel (same pattern as Columns), not a centred modal.
  return (
    <Popover open onClose={onClose} anchor={anchor} label={title} width={340} className="view-form-pop">
      <div className="pop-head">
        <span className="dialog-title-row">
          <strong>{title}</strong>
          {mode === 'create' && <InfoTip text="Saves the current filters, sort, columns, grouping and density." label="About new views" />}
        </span>
      </div>
      <div className="form-grid view-form">
        <div className="form-field">
          <label className="field-label" htmlFor="view-name">
            Name <span className="req">*</span>
          </label>
          <input id="view-name" className="input input-compact" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} data-autofocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} />
        </div>
        {mode !== 'rename' && (
          <fieldset className="form-field">
            <legend className="field-label">Layout</legend>
            <div className="segmented">
              {types.map((t) => (
                <label key={t} className={cx('seg', type === t && 'is-on')}>
                  <input type="radio" name="vtype" value={t} checked={type === t} onChange={() => setType(t)} />
                  <Icon name={TYPE_ICON[t]} size={14} /> {t[0].toUpperCase() + t.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="form-field">
          <legend className="field-label field-label-row">
            Who can see it
            <InfoTip text="Shared views share the definition only — each person still sees only the records their role allows." label="About view sharing" />
          </legend>
          {(['personal', 'team', 'org'] as ViewScope[]).map((s) => {
            const allowed = canCreateScope(actor, s);
            return (
              <label key={s} className={cx('radio', !allowed && 'is-disabled')} data-tooltip={allowed ? undefined : `Not available: ${canCreateScopeLabel(s)}`}>
                <input type="radio" name="scope" value={s} checked={scope === s} disabled={!allowed} onChange={() => setScope(s)} />
                <span>
                  {s === 'personal' ? 'Only me' : s === 'team' ? 'My clinic team (this workspace)' : 'Whole organization'}
                </span>
              </label>
            );
          })}
        </fieldset>
        {error && <p className="field-error">{error}</p>}
      </div>
      <div className="pop-foot-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!name.trim()}>
          Save view
        </Button>
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------- Filter builder

/** Fields offered in the quick (form-style) filter panel: status first, then choice fields, then dates. */
function quickFields(res: ResourceDefinition, actor: Actor) {
  const ok = (f: FieldDefinition) => f.capabilities.filter && queryableField(actor, res, f);
  const statusKey = res.lifecycle?.field ?? (res.fields.some((f) => f.key === 'status' && f.type === 'master') ? 'status' : undefined);
  const status = res.fields.find((f) => f.key === statusKey && ok(f));
  const choices = res.fields.filter((f) => f !== status && ok(f) && (f.type === 'master' || f.type === 'relation' || f.type === 'boolean')).slice(0, 6);
  const dates = res.fields.filter((f) => ok(f) && (f.type === 'date' || f.type === 'datetime')).slice(0, 2);
  return { status, choices, dates };
}

const QUICK_OPS = ['eq', 'in', 'gte', 'lte'];
/** The quick panel can edit a filter when it is a flat AND list (nested groups / OR need the advanced editor). */
const quickCompatible = (g: FilterGroup) => g.children.every((c) => c.kind === 'condition') && (g.join === 'and' || g.children.length <= 1);

/** "A is x OR A is y" on one field is the same as "A is any of [x, y]" — convert so the quick panel can show it. */
function normalizeForQuick(g: FilterGroup): FilterGroup {
  const conds = g.children;
  if (g.join === 'or' && conds.length > 1 && conds.every((c) => c.kind === 'condition' && c.operator === 'eq') && new Set(conds.map((c) => (c as FilterCondition).field)).size === 1) {
    const field = (conds[0] as FilterCondition).field;
    return { ...g, join: 'and', children: [newCondition(field, 'in', conds.map((c) => (c as FilterCondition).value))] };
  }
  return g;
}

export function FilterButton({ res, actor, filter, onChange }: { res: ResourceDefinition; actor: Actor; filter: FilterGroup; onChange: (g: FilterGroup) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'quick' | 'advanced'>('quick');
  const [draft, setDraft] = useState<FilterGroup>(filter);
  const ref = useRef<HTMLButtonElement>(null);
  const n = countConditions(filter);
  const { status, choices, dates } = quickFields(res, actor);

  const openPanel = () => {
    const copy = normalizeForQuick(cloneGroup(filter));
    setDraft({ ...copy, join: quickCompatible(copy) ? 'and' : copy.join });
    setMode(quickCompatible(copy) ? 'quick' : 'advanced');
    setOpen(true);
  };
  const close = () => setOpen(false);

  // --- quick-form helpers operating on the draft's top-level conditions
  const conds = draft.children.filter((c): c is FilterCondition => c.kind === 'condition');
  const eqOf = (key: string) => conds.find((c) => c.field === key && c.operator === 'eq')?.value;
  const valuesOf = (key: string): string[] => {
    const c = conds.find((x) => x.field === key && (x.operator === 'eq' || x.operator === 'in'));
    if (!c) return [];
    return c.operator === 'in' ? ((c.value as unknown[]) ?? []).map(String) : [String(c.value)];
  };
  const rangeOf = (key: string) => ({
    from: conds.find((c) => c.field === key && c.operator === 'gte')?.value as string | undefined,
    to: conds.find((c) => c.field === key && c.operator === 'lte')?.value as string | undefined,
  });
  const replace = (key: string, ops: string[], add: FilterCondition[]) =>
    setDraft((d) => ({ ...d, join: 'and', children: [...d.children.filter((c) => !(c.kind === 'condition' && c.field === key && ops.includes(c.operator))), ...add] }));
  const setEq = (key: string, v: unknown) => replace(key, ['eq', 'in'], v === '' || v === undefined ? [] : [newCondition(key, 'eq', v)]);
  const setIn = (key: string, vs: string[]) => replace(key, ['eq', 'in'], !vs.length ? [] : vs.length === 1 ? [newCondition(key, 'eq', vs[0])] : [newCondition(key, 'in', vs)]);
  const setRange = (key: string, r: { from?: string; to?: string }) =>
    replace(key, ['gte', 'lte'], [...(r.from ? [newCondition(key, 'gte', r.from)] : []), ...(r.to ? [newCondition(key, 'lte', r.to)] : [])]);
  const managed = new Set([status?.key, ...choices.map((f) => f.key), ...dates.map((f) => f.key)]);
  const others = conds.filter((c) => !(managed.has(c.field) && QUICK_OPS.includes(c.operator))).length;

  const statusValues = status ? activeMasterValues(status.master!) : [];
  const optionsFor = (f: FieldDefinition) =>
    f.type === 'boolean'
      ? [
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ]
      : f.type === 'master'
        ? activeMasterValues(f.master!).map((o) => ({ value: o.key, label: o.label }))
        : relationOptions(actor, { ...f, relation: { ...f.relation!, filterBy: undefined } }, {}).map((o) => ({ value: o.id, label: o.label }));

  return (
    <>
      <Button
        ref={ref}
        icon="sliders"
        iconRight={open ? 'chevron-up' : 'chevron-down'}
        onClick={() => (open ? close() : openPanel())}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={n ? `Filters, ${n} active` : 'Filters'}
        className={cx(open && 'is-open')}
      >
        Filters
        {n > 0 && <span className="btn-dot" aria-hidden="true" />}
      </Button>
      <Popover open={open} onClose={close} anchor={ref} label="Filters" width={mode === 'quick' ? 320 : 480} className="filter-pop" align="end">
        {mode === 'quick' ? (
          <div className="qf">
            {status && (
              <div className="qf-field">
                <span className="qf-label" id="qf-status">
                  {status.label}
                </span>
                {statusValues.length <= 3 ? (
                  <div className="segmented qf-seg" role="radiogroup" aria-labelledby="qf-status">
                    {[{ key: '', label: 'All' }, ...statusValues].map((o) => {
                      const sel = valuesOf(status.key);
                      const on = o.key === '' ? sel.length === 0 : sel.length === 1 && sel[0] === o.key;
                      return (
                        <button key={o.key || 'all'} type="button" role="radio" aria-checked={on} className={cx('seg-btn', on && 'is-on')} onClick={() => setEq(status.key, o.key)}>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <MultiSelectMenu block label={status.label} emptyLabel="All" values={valuesOf(status.key)} options={statusValues.map((o) => ({ value: o.key, label: o.label }))} onChange={(vs) => setIn(status.key, vs)} />
                )}
              </div>
            )}
            {choices.map((f) => (
              <div key={f.key} className="qf-field">
                <span className="qf-label">{f.label}</span>
                {f.type === 'boolean' ? (
                  <SelectMenu
                    block
                    label={f.label}
                    value={eqOf(f.key) === undefined ? '' : String(eqOf(f.key))}
                    options={[{ value: '', label: 'All' }, ...optionsFor(f)]}
                    onChange={(v) => setEq(f.key, v === '' ? '' : v === 'true')}
                  />
                ) : (
                  <MultiSelectMenu block label={f.label} emptyLabel="All" values={valuesOf(f.key)} options={optionsFor(f)} onChange={(vs) => setIn(f.key, vs)} />
                )}
              </div>
            ))}
            {dates.length > 0 && <div className="qf-sep" />}
            {dates.map((f) => (
              <div key={f.key} className="qf-field">
                <span className="qf-label">{f.label}</span>
                <DateRangePicker label={f.label} value={rangeOf(f.key)} onChange={(r) => setRange(f.key, r)} />
              </div>
            ))}
            <button type="button" className="link qf-advanced" onClick={() => setMode('advanced')}>
              Advanced conditions{others > 0 ? ` (${others} more)` : ''}
            </button>
          </div>
        ) : (
          <div className="qf-adv">
            <div className="pop-head">
              <strong>Advanced conditions</strong>
              {quickCompatible(draft) && (
                <button type="button" className="link" onClick={() => setMode('quick')}>
                  Simple filters
                </button>
              )}
            </div>
            <GroupEditor res={res} actor={actor} group={draft} onChange={setDraft} depth={0} />
          </div>
        )}
        <div className="qf-foot">
          <Button
            variant="ghost"
            onClick={() => {
              onChange(newGroup('and'));
              close();
            }}
          >
            Clear
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onChange(draft);
              close();
            }}
          >
            Apply
          </Button>
        </div>
      </Popover>
    </>
  );
}

function filterableFields(res: ResourceDefinition, actor: Actor) {
  return res.fields.filter((f) => f.capabilities.filter && queryableField(actor, res, f));
}

function GroupEditor({ res, actor, group, onChange, depth, onRemove }: { res: ResourceDefinition; actor: Actor; group: FilterGroup; onChange: (g: FilterGroup) => void; depth: number; onRemove?: () => void }) {
  const fields = filterableFields(res, actor);
  const update = (id: string, child: FilterCondition | FilterGroup | null) =>
    onChange({ ...group, children: child ? group.children.map((c) => (c.id === id ? child : c)) : group.children.filter((c) => c.id !== id) });
  return (
    <div className={cx('filter-group', depth > 0 && 'is-nested')}>
      {group.children.length > 1 && (
        <div className="filter-join" role="radiogroup" aria-label="Match">
          <span className="muted">Match</span>
          {(['and', 'or'] as const).map((j) => (
            <button key={j} type="button" role="radio" aria-checked={group.join === j} className={cx('seg-btn', group.join === j && 'is-on')} onClick={() => onChange({ ...group, join: j })}>
              {j === 'and' ? 'All (AND)' : 'Any (OR)'}
            </button>
          ))}
        </div>
      )}
      {group.children.length === 0 && <p className="muted filter-empty">No conditions — showing all records you can access.</p>}
      {group.children.map((c) =>
        c.kind === 'group' ? (
          <GroupEditor key={c.id} res={res} actor={actor} group={c} depth={depth + 1} onChange={(g) => update(c.id, g)} onRemove={() => update(c.id, null)} />
        ) : (
          <ConditionRow key={c.id} res={res} actor={actor} cond={c} fields={fields} onChange={(x) => update(c.id, x)} onRemove={() => update(c.id, null)} />
        ),
      )}
      <div className="filter-actions">
        <Button
          variant="ghost"
          icon="plus"
          onClick={() => {
            const f = fields[0];
            if (f) onChange({ ...group, children: [...group.children, newCondition(f.key, operatorsFor(f)[0])] });
          }}
        >
          Add condition
        </Button>
        {depth === 0 && (
          <Button variant="ghost" icon="plus" onClick={() => onChange({ ...group, children: [...group.children, { ...newGroup('or'), children: fields[0] ? [newCondition(fields[0].key, operatorsFor(fields[0])[0])] : [] }] })}>
            Add group
          </Button>
        )}
        {onRemove && (
          <Button variant="ghost" icon="trash" onClick={onRemove}>
            Remove group
          </Button>
        )}
      </div>
    </div>
  );
}

function ConditionRow({ res, actor, cond, fields, onChange, onRemove }: { res: ResourceDefinition; actor: Actor; cond: FilterCondition; fields: FieldDefinition[]; onChange: (c: FilterCondition) => void; onRemove: () => void }) {
  const field = res.fields.find((f) => f.key === cond.field);
  const unavailable = !field || !fields.includes(field);
  const ops = field ? operatorsFor(field) : [];
  return (
    <div className="filter-row">
      <SelectMenu
        block
        label="Field"
        value={cond.field}
        options={[...(unavailable ? [{ value: cond.field, label: 'Unavailable field' }] : []), ...fields.map((f) => ({ value: f.key, label: f.label }))]}
        onChange={(k) => {
          const f = res.fields.find((x) => x.key === k)!;
          onChange({ ...cond, field: f.key, operator: operatorsFor(f)[0], value: undefined });
        }}
      />
      <SelectMenu
        block
        label="Operator"
        value={cond.operator}
        disabled={unavailable}
        options={ops.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))}
        onChange={(o) => onChange({ ...cond, operator: o as FilterCondition['operator'] })}
      />
      {field && !VALUELESS.includes(cond.operator) ? <ValueInput field={field} actor={actor} value={cond.value} onChange={(v) => onChange({ ...cond, value: v })} /> : <span className="filter-novalue" />}
      <IconButton icon="x" label="Remove condition" onClick={onRemove} />
      {unavailable && <p className="field-help span-all">This condition references a field you cannot query; it is ignored.</p>}
    </div>
  );
}

function ValueInput({ field, actor, value, onChange }: { field: FieldDefinition; actor: Actor; value: unknown; onChange: (v: unknown) => void }) {
  const cls = 'input input-compact';
  if (field.type === 'master' || field.type === 'multimaster') {
    return <SelectMenu block label="Value" placeholder="Choose…" value={String(value ?? '')} options={activeMasterValues(field.master!).map((o) => ({ value: o.key, label: o.label }))} onChange={(v) => onChange(v)} />;
  }
  if (field.type === 'relation') {
    const opts = relationOptions(actor, { ...field, relation: { ...field.relation!, filterBy: undefined } }, {});
    return <SelectMenu block label="Value" placeholder="Choose…" value={String(value ?? '')} options={opts.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => onChange(v)} />;
  }
  if (field.type === 'boolean') {
    return (
      <SelectMenu
        block
        label="Value"
        placeholder="Choose…"
        value={value === undefined || value === '' ? '' : String(value)}
        options={[
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ]}
        onChange={(v) => onChange(v === 'true')}
      />
    );
  }
  if (field.type === 'date' || field.type === 'datetime') {
    return <DatePicker block label="Value" value={(value as string) || ''} onChange={(v) => onChange(v ?? '')} />;
  }
  const type = ['number', 'money', 'progress'].includes(field.type) ? 'number' : 'text';
  return <input className={cls} aria-label="Value" type={type} value={String(value ?? '')} onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />;
}

// ---------------------------------------------------------------- Column manager

export function ColumnManager({
  res,
  actor,
  columns,
  onChange,
  density,
  onDensity,
  groupBy,
  onGroupBy,
  onReset,
}: {
  res: ResourceDefinition;
  actor: Actor;
  columns: ColumnState[];
  onChange: (c: ColumnState[]) => void;
  density: 'compact' | 'comfortable';
  onDensity: (d: 'compact' | 'comfortable') => void;
  groupBy?: string;
  onGroupBy: (g: string | undefined) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  // Only fields the actor can see at all are offered; masking still applies per cell.
  const available = res.fields.filter((f) => f.capabilities.list && queryableOrMasked(actor, res, f));
  const known = new Set(columns.map((c) => c.key));
  const all: ColumnState[] = [...columns.filter((c) => c.key === 'id' || available.some((f) => f.key === c.key)), ...available.filter((f) => !known.has(f.key)).map((f) => ({ key: f.key, hidden: true }))];
  if (!known.has('id')) all.push({ key: 'id', hidden: true });
  const label = (k: string) => (k === 'id' ? 'ID' : res.fields.find((f) => f.key === k)?.label ?? k);
  const shown = all.filter((c) => label(c.key).toLowerCase().includes(q.toLowerCase()));
  const move = (key: string, d: -1 | 1) => {
    const i = all.findIndex((c) => c.key === key);
    const j = i + d;
    if (j < 0 || j >= all.length) return;
    const next = [...all];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const groupable = available.filter((f) => ['master', 'relation', 'boolean'].includes(f.type) && queryableField(actor, res, f));
  return (
    <>
      <Button ref={ref} icon="columns" iconRight={open ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" className={cx(open && 'is-open')}>
        Columns
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Column manager" width={320} align="end">
        <div className="pop-head">
          <strong>Columns</strong>
          <Button variant="ghost" icon="reset" onClick={onReset}>
            Reset
          </Button>
        </div>
        <input className="input input-compact" placeholder="Search fields" aria-label="Search fields" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
        <ul className="col-list">
          {shown.map((c) => (
            <li key={c.key} className="col-item">
              <label className="check">
                <input type="checkbox" checked={!c.hidden} onChange={() => onChange(all.map((x) => (x.key === c.key ? { ...x, hidden: !x.hidden } : x)))} />
                {label(c.key)}
              </label>
              <span className="colmgr-actions">
                <IconButton icon={c.pinned ? 'pin-off' : 'pin'} label={c.pinned ? `Unpin ${label(c.key)}` : `Pin ${label(c.key)} left`} pressed={!!c.pinned} onClick={() => onChange(all.map((x) => (x.key === c.key ? { ...x, pinned: !x.pinned } : x)))} />
                <IconButton icon="arrow-up" label={`Move ${label(c.key)} up`} onClick={() => move(c.key, -1)} />
                <IconButton icon="arrow-down" label={`Move ${label(c.key)} down`} onClick={() => move(c.key, 1)} />
              </span>
            </li>
          ))}
        </ul>
        <div className="pop-section">
          <label className="field-label" htmlFor="group-by">
            Group rows by
          </label>
          <SelectMenu
            id="group-by"
            block
            label="Group rows by"
            value={groupBy ?? ''}
            options={[{ value: '', label: 'No grouping' }, ...groupable.map((f) => ({ value: f.key, label: f.label }))]}
            onChange={(v) => onGroupBy(v || undefined)}
          />
        </div>
        <div className="pop-section">
          <span className="field-label">Density</span>
          <div className="segmented">
            {(['compact', 'comfortable'] as const).map((d) => (
              <button key={d} type="button" className={cx('seg-btn', density === d && 'is-on')} aria-pressed={density === d} onClick={() => onDensity(d)}>
                {d === 'compact' ? 'Compact' : 'Comfortable'}
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}

function queryableOrMasked(actor: Actor, res: ResourceDefinition, f: FieldDefinition) {
  return fieldAccess(actor, res, f) !== 'hide';
}
