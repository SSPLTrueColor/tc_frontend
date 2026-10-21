import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { FieldDefinition, FilterCondition, FilterGroup, FilterOperator, ResourceDefinition } from '../../metadata/types';
import { cx } from '../../lib/format';
import { formatDate } from '../../lib/dates';
import type { Actor } from '../../services/authz';
import { activeMasterValues, masterLabel } from '../../services/registry';
import { displayText } from '../../services/runtime';
import { countConditions, newCondition, OPERATOR_LABELS, systemDateFields, VALUELESS } from '../../services/filter';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Popover } from '../primitives/overlay';
import { SelectMenu } from '../primitives/SelectMenu';
import { DatePicker } from '../primitives/DatePicker';
import { SearchInput, TextField } from '../primitives/controls';
import { relationOptions } from './FormFields';
import { fieldIcon } from './fieldIcon';
import { filterableFields, GroupEditor } from './ViewControls';
import { L } from '../../constants/labels';
import './NotionFilters.css';

const C = L.common;
const LS = L.common.list;

/*
 * Filter pill bar under the list toolbar ("Status: New, Qualified ▾"). Click a pill to edit just that filter;
 * "+ Add filter" opens a searchable property list. Every change applies at once — there is no Apply / Clear step.
 * The toolbar funnel opens the ClickUp-style panel (NotionFilters.tsx); both edit the same filter model.
 */

type Kind = 'choice' | 'multi' | 'boolean' | 'date' | 'number' | 'text';
const kindOf = (f: FieldDefinition): Kind =>
  f.type === 'master' || f.type === 'relation'
    ? 'choice'
    : f.type === 'multimaster' || f.type === 'people'
      ? 'multi'
      : f.type === 'boolean'
        ? 'boolean'
        : f.type === 'date' || f.type === 'datetime'
          ? 'date'
          : f.type === 'number' || f.type === 'money' || f.type === 'progress'
            ? 'number'
            : 'text';

const DATE_OPTIONS: { op: FilterOperator; label: string }[] = [
  { op: 'today', label: LS.datePresetToday },
  { op: 'thisWeek', label: LS.datePresetThisWeek },
  { op: 'thisMonth', label: LS.datePresetThisMonth },
  { op: 'next7', label: LS.datePresetNext7 },
  { op: 'last30', label: LS.datePresetLast30 },
  { op: 'past', label: LS.datePresetPast },
  { op: 'future', label: LS.datePresetFuture },
  { op: 'gte', label: LS.dateOnOrAfter },
  { op: 'lte', label: LS.dateOnOrBefore },
  { op: 'empty', label: LS.isEmpty },
  { op: 'notEmpty', label: LS.isNotEmpty },
];
const NUMBER_OPS: { op: FilterOperator; label: string }[] = (['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'notEmpty'] as const).map((op) => ({
  op,
  label: { eq: '=', neq: '≠', gt: '>', lt: '<', gte: '≥', lte: '≤', empty: LS.isEmpty, notEmpty: LS.isNotEmpty }[op],
}));
const TEXT_OPS: FilterOperator[] = ['contains', 'eq', 'neq', 'empty', 'notEmpty'];
const opsFor = (k: Kind): { op: FilterOperator; label: string }[] =>
  k === 'choice'
    ? [
        { op: 'in', label: LS.opIs },
        { op: 'nin', label: LS.opIsNot },
        { op: 'empty', label: LS.isEmpty },
        { op: 'notEmpty', label: LS.isNotEmpty },
      ]
    : k === 'multi'
      ? [
          { op: 'contains', label: LS.opHas },
          { op: 'empty', label: LS.isEmpty },
          { op: 'notEmpty', label: LS.isNotEmpty },
        ]
      : k === 'boolean'
        ? [{ op: 'eq', label: LS.opIs }]
        : k === 'number'
          ? NUMBER_OPS
          : k === 'date'
            ? DATE_OPTIONS
            : TEXT_OPS.map((op) => ({ op, label: op === 'empty' ? LS.isEmpty : op === 'notEmpty' ? LS.isNotEmpty : OPERATOR_LABELS[op] }));
const defaultOp = (k: Kind): FilterOperator => ({ choice: 'in', multi: 'contains', boolean: 'eq', date: 'today', number: 'gte', text: 'contains' } as const)[k];

/** A condition with nothing to compare yet ("Status is …" with no option picked). */
const isBlank = (c: FilterCondition) => !VALUELESS.includes(c.operator) && (c.value === undefined || c.value === '' || (Array.isArray(c.value) && c.value.length === 0));

// Opening the editor of a pill that is created from another component (the funnel button) — the bar picks it up when it renders.
let pendingEdit: string | null = null;
const editBus = new EventTarget();
function requestEdit(id: string) {
  pendingEdit = id;
  editBus.dispatchEvent(new Event('edit'));
}

function fieldsOf(res: ResourceDefinition, actor: Actor) {
  return filterableFields(res, actor);
}
function fieldByKey(res: ResourceDefinition, key: string) {
  return res.fields.find((f) => f.key === key) ?? systemDateFields().find((f) => f.key === key);
}

function optionsFor(actor: Actor, f: FieldDefinition): { value: string; label: string; tone?: string }[] {
  if (f.type === 'master' || f.type === 'multimaster') return activeMasterValues(f.master!).map((o) => ({ value: o.key, label: o.label, tone: o.tone }));
  if (f.type === 'boolean')
    return [
      { value: 'true', label: C.actions.yes },
      { value: 'false', label: C.actions.no },
    ];
  if (f.relation) return relationOptions(actor, { ...f, relation: { ...f.relation, filterBy: undefined } }, {}).map((o) => ({ value: o.id, label: o.label }));
  return [];
}

/** Pill text: at most two picked values, then a count — "Low, Medium +2" (the full list is in the pill's tooltip). */
function valueText(actor: Actor, f: FieldDefinition, v: unknown, all = false): string {
  if (Array.isArray(v)) {
    const labels = v.map((x) => valueText(actor, f, x));
    return all || labels.length <= 2 ? labels.join(', ') : `${labels.slice(0, 2).join(', ')} ${LS.plusCount(labels.length - 2)}`;
  }
  if (f.type === 'master' || f.type === 'multimaster') return masterLabel(f.master!, v);
  if (f.type === 'boolean') return v === true || v === 'true' ? C.actions.yes : C.actions.no;
  if (f.type === 'date' || f.type === 'datetime') return formatDate(String(v));
  return displayText(f, v, actor);
}

/** "Status: New, Qualified" · "Budget ≥ ₹5,00,000" · "Due date: This week" */
function pillText(actor: Actor, f: FieldDefinition, c: FilterCondition): { op?: string; value?: string } {
  const k = kindOf(f);
  if (isBlank(c)) return {};
  if (c.operator === 'empty') return { value: LS.isEmpty.toLowerCase() };
  if (c.operator === 'notEmpty') return { value: LS.isNotEmpty.toLowerCase() };
  if (k === 'date') {
    const preset = DATE_OPTIONS.find((o) => o.op === c.operator);
    if (c.operator === 'gte') return { value: LS.chipFrom(valueText(actor, f, c.value)) };
    if (c.operator === 'lte') return { value: LS.chipUntil(valueText(actor, f, c.value)) };
    return { value: preset?.label ?? OPERATOR_LABELS[c.operator] };
  }
  if (k === 'number') return { op: NUMBER_OPS.find((o) => o.op === c.operator)?.label, value: valueText(actor, f, c.value) };
  if (c.operator === 'nin' || c.operator === 'neq') return { op: LS.opIsNot, value: valueText(actor, f, c.value) };
  if (k === 'text' && c.operator === 'contains') return { value: `“${String(c.value)}”` };
  return { value: valueText(actor, f, c.value) };
}

// ---------------------------------------------------------------- property picker

function PropertyList({ res, actor, onPick, onAdvanced }: { res: ResourceDefinition; actor: Actor; onPick: (f: FieldDefinition) => void; onAdvanced: () => void }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const all = fieldsOf(res, actor);
  const shown = all.filter((f) => f.label.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => setHi(0), [q]);
  return (
    <div className="nf-picker">
      <div className="nf-search">
        <SearchInput
          data-autofocus
          placeholder={LS.filterBy}
          aria-label={LS.searchProperties}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter' && shown[hi]) {
              e.preventDefault();
              onPick(shown[hi]);
            }
          }}
        />
      </div>
      <ul className="nf-list" role="listbox" aria-label={LS.searchProperties}>
        {shown.map((f, i) => (
          <li key={f.key} role="option" aria-selected={i === hi}>
            <button type="button" className={cx('nf-item', i === hi && 'is-hi')} onMouseEnter={() => setHi(i)} onClick={() => onPick(f)}>
              <Icon name={fieldIcon(f)} size={14} />
              <span>{f.label}</span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="nf-empty">{LS.noMatchingProps}</li>}
      </ul>
      <div className="nf-picker-foot">
        <button type="button" className="nf-item" onClick={onAdvanced}>
          <Icon name="plus" size={14} />
          <span>{LS.advancedFilter}</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one filter's editor

function ValueEditor({ actor, field, cond, onChange }: { actor: Actor; field: FieldDefinition; cond: FilterCondition; onChange: (c: FilterCondition) => void }) {
  const k = kindOf(field);
  const [q, setQ] = useState('');
  const options = useMemo(() => (k === 'choice' || k === 'multi' || k === 'boolean' ? optionsFor(actor, field) : []), [actor, field, k]);
  if (VALUELESS.includes(cond.operator) && k !== 'date') return null;

  if (k === 'choice' || k === 'multi' || k === 'boolean') {
    const multi = k === 'choice';
    const selected: string[] = Array.isArray(cond.value) ? cond.value.map(String) : cond.value === undefined || cond.value === '' ? [] : [String(cond.value)];
    const shown = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
    const toggle = (v: string) => {
      if (k === 'boolean') return onChange({ ...cond, value: v === 'true' });
      if (!multi) return onChange({ ...cond, value: selected.includes(v) ? '' : v });
      const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
      onChange({ ...cond, value: next });
    };
    return (
      <div className="nf-options">
        {options.length > 7 && (
          <div className="nf-search">
            <SearchInput data-autofocus placeholder={LS.searchOptions} aria-label={LS.searchOptions} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        <ul className="nf-list" role="listbox" aria-multiselectable={multi} aria-label={field.label}>
          {shown.map((o, i) => {
            const on = k === 'boolean' ? String(cond.value) === o.value : selected.includes(o.value);
            return (
              <li key={o.value} role="option" aria-selected={on}>
                <button type="button" data-autofocus={options.length <= 7 && i === 0 ? true : undefined} className={cx('nf-item nf-option', on && 'is-on')} onClick={() => toggle(o.value)}>
                  <span className={cx('nf-check', multi ? 'is-box' : 'is-radio')} aria-hidden="true">
                    {on && <Icon name="check" size={12} />}
                  </span>
                  {o.tone && <span className={cx('nf-dot', `tone-${o.tone}`)} aria-hidden="true" />}
                  <span className="nf-option-label">{o.label}</span>
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="nf-empty">{LS.noOptions}</li>}
        </ul>
      </div>
    );
  }

  if (k === 'date') {
    if (cond.operator !== 'gte' && cond.operator !== 'lte') return null;
    return (
      <div className="nf-value">
        <DatePicker block label={LS.pickDate} value={(cond.value as string) || ''} onChange={(v) => onChange({ ...cond, value: v ?? '' })} />
      </div>
    );
  }

  const numeric = k === 'number';
  return (
    <div className="nf-value">
      <span className="nf-input">
        {field.type === 'money' && <span className="nf-prefix">₹</span>}
        <TextField
          data-autofocus
          dense
          type={numeric ? 'number' : 'text'}
          inputMode={numeric ? 'decimal' : undefined}
          placeholder={LS.typeValue}
          aria-label={field.label}
          value={cond.value === undefined ? '' : String(cond.value)}
          onChange={(e) => onChange({ ...cond, value: numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })}
        />
      </span>
    </div>
  );
}

function FilterPill({ res, actor, cond, open, onOpen, onClose, onChange, onRemove }: { res: ResourceDefinition; actor: Actor; cond: FilterCondition; open: boolean; onOpen: () => void; onClose: () => void; onChange: (c: FilterCondition) => void; onRemove: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const field = fieldByKey(res, cond.field);
  if (!field) return null;
  const k = kindOf(field);
  const text = pillText(actor, field, cond);
  const blank = isBlank(cond);
  const ops = opsFor(k);
  return (
    <>
      <span className={cx('nf-pill', !blank && 'is-set', open && 'is-open')}>
        <button
          ref={ref}
          type="button"
          className="nf-pill-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={LS.editFilter(field.label)}
          data-tooltip={Array.isArray(cond.value) && cond.value.length > 2 ? `${field.label}: ${valueText(actor, field, cond.value, true)}` : undefined}
          onClick={() => (open ? onClose() : onOpen())}
        >
          <Icon name={fieldIcon(field)} size={13} />
          <span className="nf-pill-field">
            {field.label}
            {text.value !== undefined && !text.op && ':'}
          </span>
          {text.op && <span className="nf-pill-op">{text.op}</span>}
          {text.value !== undefined && <span className="nf-pill-value">{text.value}</span>}
          <Icon name="chevron-down" size={12} className="nf-pill-chev" />
        </button>
        <button type="button" className="nf-pill-x" aria-label={LS.removeFilter} data-tooltip={LS.removeFilter} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      </span>
      <Popover open={open} onClose={onClose} anchor={ref} label={LS.editFilter(field.label)} width={k === 'choice' || k === 'multi' ? 300 : 280} className="nf-pop">
        <div className="nf-edit">
          <div className="nf-edit-head">
            <span className="nf-edit-field">
              <Icon name={fieldIcon(field)} size={14} />
              {field.label}
            </span>
            {ops.length > 1 && k !== 'date' && (
              <SelectMenu
                label={LS.operator}
                value={cond.operator}
                options={ops.map((o) => ({ value: o.op, label: o.label }))}
                onChange={(op) => {
                  const next = op as FilterOperator;
                  // keep the picked options when switching is ↔ is not; drop the value when it no longer applies
                  const keep = !VALUELESS.includes(next) && !VALUELESS.includes(cond.operator);
                  onChange({ ...cond, operator: next, value: keep ? cond.value : undefined });
                }}
              />
            )}
            <span className="spacer" />
            <IconButton icon="trash" label={LS.deleteFilter} onClick={onRemove} />
          </div>
          {k === 'date' && (
            <ul className="nf-list nf-date-list" role="listbox" aria-label={field.label}>
              {DATE_OPTIONS.map((o) => {
                const on = cond.operator === o.op;
                return (
                  <li key={o.op} role="option" aria-selected={on}>
                    <button type="button" data-autofocus={on ? true : undefined} className={cx('nf-item nf-option', on && 'is-on')} onClick={() => onChange({ ...cond, operator: o.op, value: o.op === 'gte' || o.op === 'lte' ? (on ? cond.value : '') : undefined })}>
                      <span className="nf-check is-radio" aria-hidden="true">
                        {on && <Icon name="check" size={12} />}
                      </span>
                      <span className="nf-option-label">{o.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <ValueEditor actor={actor} field={field} cond={cond} onChange={onChange} />
        </div>
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------- bar + funnel button

function useAddFilter(filter: FilterGroup, onChange: (g: FilterGroup) => void) {
  return (f: FieldDefinition) => {
    // One pill per property: picking a property that already has a pill opens that pill instead of adding a duplicate.
    const existing = (filter.join === 'and' || filter.children.length <= 1) && filter.children.find((x): x is FilterCondition => x.kind === 'condition' && x.field === f.key);
    if (existing) return requestEdit(existing.id);
    const c = newCondition(f.key, defaultOp(kindOf(f)));
    // Next tick: the property list closes first (and hands focus back to its button), then the new filter's editor takes focus.
    setTimeout(() => {
      onChange({ ...filter, join: filter.children.length > 1 ? filter.join : 'and', children: [...filter.children, c] });
      requestEdit(c.id);
    }, 0);
  };
}

function AdvancedPopover({ res, actor, filter, onChange, anchor, open, onClose }: { res: ResourceDefinition; actor: Actor; filter: FilterGroup; onChange: (g: FilterGroup) => void; anchor: RefObject<HTMLElement>; open: boolean; onClose: () => void }) {
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} label={LS.advanced} width={520} className="nf-pop filter-pop" align="end">
      <div className="qf-adv">
        <div className="pop-head">
          <strong>{LS.advanced}</strong>
        </div>
        <GroupEditor res={res} actor={actor} group={filter} onChange={onChange} depth={0} />
      </div>
    </Popover>
  );
}

/** The pill row under the toolbar. Renders nothing until a filter exists. */
export function FilterBar({ res, actor, filter, onChange }: { res: ResourceDefinition; actor: Actor; filter: FilterGroup; onChange: (g: FilterGroup) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<'pick' | 'advanced' | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const add = useAddFilter(filter, onChange);
  const conds = filter.children.filter((c): c is FilterCondition => c.kind === 'condition');
  const nested = filter.children.length - conds.length;
  // Only a flat AND list is shown as independent pills; OR or nested groups are edited in the advanced editor.
  const flat = filter.join === 'and' || filter.children.length <= 1;
  const pills = flat ? conds.filter((c) => fieldByKey(res, c.field)) : [];

  // One line only: show the pills that fit, fold the rest into "+N more" (measured from hidden copies of every pill).
  const barRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(Infinity);
  const [width, setWidth] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const layoutKey = JSON.stringify(pills.map((c) => [c.id, c.field, c.operator, c.value]));
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [filter.children.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const bar = barRef.current;
    const ghost = ghostRef.current;
    // While a filter is being edited its pill text changes with every pick; keep the split between the line and
    // "+N more" steady so the pill being edited (and its open editor) never jumps out from under the cursor.
    if (!bar || !ghost || editing || moreOpen) return;
    const GAP = 4;
    const ws = [...ghost.querySelectorAll<HTMLElement>('[data-ghost-pill]')].map((x) => x.offsetWidth);
    const moreW = ghost.querySelector<HTMLElement>('[data-ghost-more]')?.offsetWidth ?? 72;
    const tail = [...bar.querySelectorAll<HTMLElement>('[data-bar-tail]')].reduce((sum, x) => sum + x.offsetWidth + GAP, 0);
    const room = bar.clientWidth - tail;
    let used = 0;
    let k = 0;
    for (; k < ws.length; k++) {
      const next = used + ws[k] + GAP;
      const needMore = k < ws.length - 1;
      if (next + (needMore ? moreW + GAP : 0) > room) break;
      used = next;
    }
    if (k !== fit) setFit(k);
    // Re-measure when the pills, the bar width or the editing state change. `fit` is a dependency too, but the
    // guard above only sets it when the measured split differs, so this settles after at most one extra pass.
  }, [editing, moreOpen, fit, width, layoutKey, filter.children.length]);
  const shown = pills.slice(0, fit);
  const hidden = pills.slice(fit);
  // A pill opened for editing (e.g. just added) that sits in the overflow opens the "+N more" list.
  useEffect(() => {
    if (editing && hidden.some((c) => c.id === editing)) setMoreOpen(true);
  }, [editing, hidden.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const take = () => {
      if (pendingEdit && conds.some((c) => c.id === pendingEdit)) {
        setEditing(pendingEdit);
        pendingEdit = null;
      }
    };
    take();
    editBus.addEventListener('edit', take);
    return () => editBus.removeEventListener('edit', take);
  });

  if (!filter.children.length) return null;

  const update = (c: FilterCondition) => onChange({ ...filter, children: filter.children.map((x) => (x.id === c.id ? c : x)) });
  const remove = (id: string) => {
    if (editing === id) setEditing(null);
    onChange({ ...filter, children: filter.children.filter((x) => x.id !== id) });
  };
  const closeEditor = (c: FilterCondition) => {
    setEditing(null);
    // A filter left without a value does nothing — drop it instead of leaving an empty pill behind.
    if (isBlank(c)) remove(c.id);
  };

  return (
    <div ref={barRef} className="nf-bar" role="region" aria-label={LS.filterBar}>
      {/* Hidden copies of every pill, only to measure how many fit on the line */}
      <div ref={ghostRef} className="nf-ghost" aria-hidden="true">
        {pills.map((c) => {
          const f = fieldByKey(res, c.field)!;
          const t = pillText(actor, f, c);
          return (
            <span key={c.id} data-ghost-pill className={cx('nf-pill', !isBlank(c) && 'is-set')}>
              <span className="nf-pill-btn">
                <Icon name={fieldIcon(f)} size={13} />
                <span className="nf-pill-field">
                  {f.label}
                  {t.value !== undefined && !t.op && ':'}
                </span>
                {t.op && <span className="nf-pill-op">{t.op}</span>}
                {t.value !== undefined && <span className="nf-pill-value">{t.value}</span>}
                <Icon name="chevron-down" size={12} className="nf-pill-chev" />
              </span>
              <span className="nf-pill-x">
                <Icon name="x" size={12} />
              </span>
            </span>
          );
        })}
        <span data-ghost-more className="nf-pill nf-pill-btn is-set nf-more">
          <span className="nf-pill-value">{LS.moreFilters(pills.length)}</span>
          <Icon name="chevron-down" size={12} className="nf-pill-chev" />
        </span>
      </div>
      {shown.map((c) => (
          <FilterPill
            key={c.id}
            res={res}
            actor={actor}
            cond={c}
            open={editing === c.id}
            onOpen={() => setEditing(c.id)}
            onClose={() => closeEditor(c)}
            onChange={update}
            onRemove={() => remove(c.id)}
          />
      ))}
      {hidden.length > 0 && (
        <>
          <button ref={moreRef} type="button" className={cx('nf-pill nf-pill-btn is-set nf-more', moreOpen && 'is-open')} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            <span className="nf-pill-value">{LS.moreFilters(hidden.length)}</span>
            <Icon name="chevron-down" size={12} className="nf-pill-chev" />
          </button>
          <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchor={moreRef} label={LS.filterBar} width={320} className="nf-pop nf-more-pop">
            <div className="nf-more-list">
              {hidden.map((c) => (
                <FilterPill
                  key={c.id}
                  res={res}
                  actor={actor}
                  cond={c}
                  open={editing === c.id}
                  onOpen={() => setEditing(c.id)}
                  onClose={() => closeEditor(c)}
                  onChange={update}
                  onRemove={() => remove(c.id)}
                />
              ))}
            </div>
          </Popover>
        </>
      )}
      {(!flat || nested > 0) && (
        <button type="button" data-bar-tail className="nf-pill nf-pill-btn is-set nf-advanced" onClick={() => setAdding('advanced')}>
          <Icon name="sliders" size={13} />
          <span className="nf-pill-value">{LS.advancedRules(flat ? nested : countConditions(filter))}</span>
          <Icon name="chevron-down" size={12} className="nf-pill-chev" />
        </button>
      )}
      <button ref={addRef} type="button" data-bar-tail className={cx('nf-add', adding && 'is-open')} aria-haspopup="dialog" aria-expanded={!!adding} onClick={() => setAdding(adding ? null : 'pick')}>
        <Icon name="plus" size={13} />
        {L.common.views.addFilter}
      </button>
      {pills.length + nested > 0 && (
        <button
          type="button"
          data-bar-tail
          className="nf-clear"
          onClick={() => {
            setEditing(null);
            setMoreOpen(false);
            onChange({ ...filter, join: 'and', children: [] });
          }}
        >
          {L.common.actions.clearAll}
        </button>
      )}
      <Popover open={adding === 'pick'} onClose={() => setAdding(null)} anchor={addRef} label={LS.filters} width={260} className="nf-pop">
        <PropertyList
          res={res}
          actor={actor}
          onPick={(f) => {
            setAdding(null);
            add(f);
          }}
          onAdvanced={() => setAdding('advanced')}
        />
      </Popover>
      <AdvancedPopover res={res} actor={actor} filter={filter} onChange={onChange} anchor={addRef} open={adding === 'advanced'} onClose={() => setAdding(null)} />
    </div>
  );
}
