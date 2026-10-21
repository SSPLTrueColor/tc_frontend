import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { FieldDefinition, FilterCondition, FilterGroup, FilterOperator, ResourceDefinition } from '../../metadata/types';
import { cx } from '../../lib/format';
import type { Actor } from '../../services/authz';
import { activeMasterValues } from '../../services/registry';
import { cloneGroup, countComplete, newCondition, newGroup, pruneIncomplete, systemDateFields, VALUELESS } from '../../services/filter';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Popover } from '../primitives/overlay';
import { DatePicker } from '../primitives/DatePicker';
import { NumberInput } from '../primitives/NumberInput';
import { TextField } from '../primitives/controls';
import { relationOptions } from './FormFields';
import { fieldIcon } from './fieldIcon';
import { filterableFields } from './ViewControls';
import { L } from '../../constants/labels';
import './NotionFilters.css';

export { FilterBar } from './FilterPills';

const C = L.common;
const LS = L.common.list;

/*
 * ClickUp-style filter panel. The toolbar funnel (FilterButton) opens a panel of rows
 * "Where [field ▾] [operator ▾] [value ▾] 🗑", the 2nd row carrying the group's and/or join, plus nested groups.
 * Every change applies at once; rows that are not complete yet (no field / no value) are kept only in the panel
 * and are left out of the applied filter until they are complete.
 */

// ---------------------------------------------------------------- field kinds · operators

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

/** Relative date presets — the value of a date "is" row (they are operators in the model, so saved views stay current). */
const DATE_PRESETS: { op: FilterOperator; label: string }[] = [
  { op: 'today', label: LS.datePresetToday },
  { op: 'thisWeek', label: LS.datePresetThisWeek },
  { op: 'thisMonth', label: LS.datePresetThisMonth },
  { op: 'next7', label: LS.datePresetNext7 },
  { op: 'last30', label: LS.datePresetLast30 },
  { op: 'past', label: LS.datePresetPast },
  { op: 'future', label: LS.datePresetFuture },
];
const isPreset = (op: FilterOperator) => DATE_PRESETS.some((p) => p.op === op);
/** A date row on "is" whose preset is not picked yet (an incomplete `eq` — never applied). */
const DATE_IS: FilterOperator = 'eq';

type OpOption = { value: FilterOperator; label: string };
const NUMBER_OPS: OpOption[] = (['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'notEmpty'] as const).map((op) => ({
  value: op,
  label: { eq: '=', neq: '≠', gt: '>', lt: '<', gte: '≥', lte: '≤', empty: LS.opIsEmpty, notEmpty: LS.opIsNotEmpty }[op],
}));
const EMPTY_OPS: OpOption[] = [
  { value: 'empty', label: LS.opIsEmpty },
  { value: 'notEmpty', label: LS.opIsNotEmpty },
];
function opsFor(k: Kind): OpOption[] {
  switch (k) {
    case 'choice':
      return [{ value: 'in', label: LS.opIs }, { value: 'nin', label: LS.opIsNot }, ...EMPTY_OPS];
    case 'multi':
      return [{ value: 'contains', label: LS.opHas }, ...EMPTY_OPS];
    case 'boolean':
      return [{ value: 'eq', label: LS.opIs }];
    case 'number':
      return NUMBER_OPS;
    case 'date':
      return [{ value: DATE_IS, label: LS.opIs }, { value: 'gte', label: LS.opOnOrAfter }, { value: 'lte', label: LS.opOnOrBefore }, ...EMPTY_OPS];
    default:
      return [{ value: 'contains', label: LS.opContains }, { value: 'eq', label: LS.opIs }, { value: 'neq', label: LS.opIsNot }, ...EMPTY_OPS];
  }
}
const defaultOp = (k: Kind): FilterOperator => ({ choice: 'in', multi: 'contains', boolean: 'eq', date: DATE_IS, number: 'gte', text: 'contains' } as const)[k];
/** The operator the operator picker shows (date presets all read as "is"). */
const uiOp = (k: Kind, op: FilterOperator): FilterOperator => (k === 'date' && isPreset(op) ? DATE_IS : op);

type Opt = { value: string; label: string; icon?: string; tone?: string };
function optionsFor(actor: Actor, f: FieldDefinition): Opt[] {
  if (f.type === 'master' || f.type === 'multimaster') return activeMasterValues(f.master!).map((o) => ({ value: o.key, label: o.label, tone: o.tone }));
  if (f.type === 'boolean')
    return [
      { value: 'true', label: C.actions.yes },
      { value: 'false', label: C.actions.no },
    ];
  if (f.relation) return relationOptions(actor, { ...f, relation: { ...f.relation, filterBy: undefined } }, {}).map((o) => ({ value: o.id, label: o.label }));
  return [];
}

const fieldByKey = (res: ResourceDefinition, key: string) => res.fields.find((f) => f.key === key) ?? systemDateFields().find((f) => f.key === key);
const blankRow = () => newCondition('', 'in');
const same = (a: FilterGroup, b: FilterGroup) => JSON.stringify(pruneIncomplete(a)) === JSON.stringify(pruneIncomplete(b));

// ---------------------------------------------------------------- option list (no default highlight)

/**
 * Listbox used by every picker in the panel. Nothing is highlighted when it opens: the mouse highlights the hovered
 * row, and ↑/↓/Tab switch to "keyboard mode" which shows the highlighted row. Enter picks it; Esc closes the popover.
 */
function PickList({ label, items, selected, multi, search, onPick, emptyText }: { label: string; items: Opt[]; selected: string[]; multi?: boolean; search?: boolean; onPick: (v: string) => void; emptyText?: string }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(-1);
  const [kbd, setKbd] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((o) => o.label.toLowerCase().includes(t)) : items;
  }, [q, items]);
  useEffect(() => {
    if (kbd && hi >= 0) listRef.current?.querySelector<HTMLElement>(`[data-index="${hi}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [hi, kbd]);
  const move = (d: 1 | -1) => {
    if (!shown.length) return;
    setKbd(true);
    setHi((h) => (h < 0 ? (d === 1 ? 0 : shown.length - 1) : (h + d + shown.length) % shown.length));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter' || (e.key === ' ' && !search)) {
      const o = hi >= 0 ? shown[hi] : q.trim() && shown.length === 1 ? shown[0] : undefined;
      if (o) {
        e.preventDefault();
        onPick(o.value);
      }
    }
  };
  return (
    <div className="fp-picklist">
      {search && (
        <div className="fp-search">
          <Icon name="search" size={14} />
          <TextField
            bare
            data-autofocus
            className="fp-search-input"
            placeholder={LS.searchFieldsPh}
            aria-label={C.pickers.searchIn(label)}
            aria-controls={baseId}
            aria-activedescendant={kbd && hi >= 0 ? `${baseId}-${hi}` : undefined}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(-1);
            }}
            onKeyDown={onKey}
          />
        </div>
      )}
      <ul
        ref={listRef}
        id={baseId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multi || undefined}
        aria-activedescendant={!search && kbd && hi >= 0 ? `${baseId}-${hi}` : undefined}
        tabIndex={search ? -1 : 0}
        data-autofocus={search ? undefined : true}
        className={cx('fp-list', kbd && 'is-kbd')}
        onKeyDown={search ? undefined : onKey}
        onMouseLeave={() => !kbd && setHi(-1)}
      >
        {shown.map((o, i) => {
          const on = selected.includes(o.value);
          return (
            <li
              key={o.value}
              id={`${baseId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={on}
              className={cx('fp-option', i === hi && 'is-hi', on && 'is-on')}
              onMouseMove={() => {
                if (kbd) setKbd(false);
                if (hi !== i) setHi(i);
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(o.value)}
            >
              {multi && (
                <span className={cx('fp-check', on && 'is-on')} aria-hidden="true">
                  {on && <Icon name="check" size={12} />}
                </span>
              )}
              {o.icon && <Icon name={o.icon} size={14} className="fp-option-icon" />}
              {o.tone && <span className={cx('fp-dot', `tone-${o.tone}`)} aria-hidden="true" />}
              <span className="fp-option-label">{o.label}</span>
              {!multi && on && <Icon name="check" size={14} className="fp-option-tick" />}
            </li>
          );
        })}
        {!shown.length && <li className="fp-empty">{emptyText ?? C.states.noMatches}</li>}
      </ul>
    </div>
  );
}

/** Compact dropdown trigger (template SelectMenu look) + a PickList popover. `open` may be driven by the row. */
function PickMenu({
  label,
  text,
  placeholder,
  icon,
  open,
  onOpen,
  onClose,
  anchorRef,
  width,
  className,
  children,
  trigger,
}: {
  label: string;
  text?: string;
  placeholder: string;
  icon?: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  anchorRef?: RefObject<HTMLButtonElement>;
  width?: number;
  className?: string;
  children: ReactNode;
  /** Custom trigger (multi-value chips); the default is a SelectMenu-style button. */
  trigger?: ReactNode;
}) {
  const own = useRef<HTMLButtonElement>(null);
  const ref = anchorRef ?? own;
  return (
    <>
      {trigger ?? (
        <button
          ref={ref}
          type="button"
          className={cx('select-menu-trigger fp-trigger', open && 'is-open', !text && 'is-placeholder', className)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${text ?? placeholder}`}
          onClick={() => (open ? onClose() : onOpen())}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              onOpen();
            }
          }}
        >
          {icon && <Icon name={icon} size={14} className="fp-trigger-icon" />}
          <span className="select-menu-value">{text ?? placeholder}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
      )}
      <Popover open={open} onClose={onClose} anchor={ref} label={label} width={width} align="start" className="fp-menu-pop">
        {children}
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------- one condition row

type Part = 'field' | 'op' | 'value';

function ConditionRow({
  res,
  actor,
  fields,
  cond,
  index,
  join,
  onJoin,
  autoOpen,
  onAutoDone,
  onChange,
  onRemove,
}: {
  res: ResourceDefinition;
  actor: Actor;
  fields: FieldDefinition[];
  cond: FilterCondition;
  index: number;
  join: 'and' | 'or';
  onJoin: (j: 'and' | 'or') => void;
  autoOpen: boolean;
  onAutoDone: () => void;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState<Part | null>(null);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const valueRef = useRef<HTMLButtonElement>(null);
  const field = cond.field ? fieldByKey(res, cond.field) : undefined;
  const unavailable = !!cond.field && (!field || !fields.includes(field));
  const k = field ? kindOf(field) : undefined;

  // "+ Add filter" / the empty panel open this row's field picker. A tick later, so the panel has taken focus first
  // and the picker hands focus back to its own trigger when it closes.
  useEffect(() => {
    if (!autoOpen) return;
    const t = setTimeout(() => {
      fieldRef.current?.focus();
      setOpen('field');
      onAutoDone();
    }, 0);
    return () => clearTimeout(t);
  }, [autoOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickField = (key: string) => {
    const f = fields.find((x) => x.key === key);
    setOpen(null);
    if (!f || f.key === cond.field) return;
    onChange({ ...cond, field: f.key, operator: defaultOp(kindOf(f)), value: undefined });
  };
  const pickOp = (op: FilterOperator) => {
    setOpen(null);
    if (!k || op === uiOp(k, cond.operator)) return;
    const was = uiOp(k, cond.operator);
    // keep picked options when switching is ↔ is not (and between number comparisons); drop the value otherwise
    const keep = k !== 'date' && !VALUELESS.includes(op) && !VALUELESS.includes(was);
    onChange({ ...cond, operator: op, value: keep ? cond.value : undefined });
  };

  const ops = k ? opsFor(k) : [];
  const opText = k ? ops.find((o) => o.value === uiOp(k, cond.operator))?.label : undefined;
  const joinCell =
    index === 0 ? (
      <span className="fp-where">{LS.where}</span>
    ) : index === 1 ? (
      <JoinMenu join={join} onJoin={onJoin} />
    ) : (
      <span className="fp-where is-join">{join === 'and' ? LS.joinAnd : LS.joinOr}</span>
    );

  return (
    <div className="fp-row" role="group" aria-label={field ? field.label : LS.selectFilter}>
      <div className="fp-cell-join">{joinCell}</div>
      <div className="fp-cell-field">
        <PickMenu
          label={LS.field}
          text={unavailable ? LS.unavailableField : field?.label}
          placeholder={LS.selectFilter}
          icon={field ? fieldIcon(field) : undefined}
          open={open === 'field'}
          onOpen={() => setOpen('field')}
          onClose={() => setOpen(null)}
          anchorRef={fieldRef}
          width={240}
        >
          <PickList label={LS.field} search items={fields.map((f) => ({ value: f.key, label: f.label, icon: fieldIcon(f) }))} selected={cond.field ? [cond.field] : []} onPick={pickField} emptyText={LS.noMatchingProps} />
        </PickMenu>
      </div>
      <div className="fp-cell-op">
        {k && !unavailable ? (
          ops.length > 1 ? (
            <PickMenu label={LS.operator} text={opText} placeholder={LS.opIs} open={open === 'op'} onOpen={() => setOpen('op')} onClose={() => setOpen(null)} width={180}>
              <PickList label={LS.operator} items={ops.map((o) => ({ value: o.value, label: o.label }))} selected={[uiOp(k, cond.operator)]} onPick={(v) => pickOp(v as FilterOperator)} />
            </PickMenu>
          ) : (
            <span className="fp-static-op">{opText}</span>
          )
        ) : (
          <span className="fp-placeholder-ctl" aria-hidden="true" />
        )}
      </div>
      <div className="fp-cell-value">
        {field && k && !unavailable && <ValueControl actor={actor} field={field} kind={k} cond={cond} open={open === 'value'} onOpen={() => setOpen('value')} onClose={() => setOpen(null)} anchorRef={valueRef} onChange={onChange} />}
      </div>
      <div className="fp-cell-x">
        <IconButton icon="trash" label={LS.removeFilter} onClick={onRemove} className="fp-remove" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- value control (per kind)

function ValueControl({ actor, field, kind, cond, open, onOpen, onClose, anchorRef, onChange }: { actor: Actor; field: FieldDefinition; kind: Kind; cond: FilterCondition; open: boolean; onOpen: () => void; onClose: () => void; anchorRef: RefObject<HTMLButtonElement>; onChange: (c: FilterCondition) => void }) {
  const options = useMemo(() => (kind === 'choice' || kind === 'multi' || kind === 'boolean' ? optionsFor(actor, field) : []), [actor, field, kind]);
  const boxRef = useRef<HTMLDivElement>(null);
  if (kind !== 'date' && VALUELESS.includes(cond.operator)) return null;

  if (kind === 'choice') {
    const selected: string[] = Array.isArray(cond.value) ? cond.value.map(String) : cond.value === undefined || cond.value === '' ? [] : [String(cond.value)];
    const toggle = (v: string) => {
      const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
      onChange({ ...cond, value: options.filter((o) => next.includes(o.value)).map((o) => o.value) });
    };
    const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
    return (
      <PickMenu
        label={field.label}
        placeholder={LS.selectOption}
        open={open}
        onOpen={onOpen}
        onClose={onClose}
        anchorRef={boxRef as unknown as RefObject<HTMLButtonElement>}
        width={260}
        trigger={
          <div ref={boxRef} className={cx('select-menu-trigger fp-multi', open && 'is-open', !selected.length && 'is-placeholder')} onClick={(e) => {
            if ((e.target as HTMLElement).closest('.fp-chip-x')) return;
            if (open) onClose();
            else onOpen();
          }}>
            {selected.map((v) => (
              <span key={v} className="fp-chip">
                <span className="fp-chip-label">{labelOf(v)}</span>
                <button type="button" className="fp-chip-x" aria-label={LS.removeValue(labelOf(v))} onClick={() => toggle(v)}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
            <button
              ref={anchorRef}
              type="button"
              className="fp-multi-open"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={`${field.label}: ${selected.length ? selected.map(labelOf).join(', ') : LS.selectOption}`}
              onKeyDown={(e) => {
                if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault();
                  onOpen();
                }
              }}
            >
            </button>
            {!selected.length && <span className="select-menu-value fp-multi-ph">{LS.selectOption}</span>}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} className="fp-multi-chev" />
          </div>
        }
      >
        <PickList label={field.label} search multi items={options} selected={selected} onPick={toggle} emptyText={LS.noOptions} />
      </PickMenu>
    );
  }

  if (kind === 'multi' || kind === 'boolean') {
    const current = cond.value === undefined || cond.value === '' ? '' : String(cond.value);
    return (
      <PickMenu label={field.label} text={options.find((o) => o.value === current)?.label} placeholder={LS.selectOption} open={open} onOpen={onOpen} onClose={onClose} anchorRef={anchorRef} width={240}>
        <PickList
          label={field.label}
          search={options.length > 7}
          items={options}
          selected={current ? [current] : []}
          onPick={(v) => {
            onClose();
            onChange({ ...cond, value: kind === 'boolean' ? v === 'true' : v });
          }}
          emptyText={LS.noOptions}
        />
      </PickMenu>
    );
  }

  if (kind === 'date') {
    if (cond.operator === 'empty' || cond.operator === 'notEmpty') return null;
    if (cond.operator === 'gte' || cond.operator === 'lte') {
      return <DatePicker block label={field.label} value={(cond.value as string) || ''} onChange={(v) => onChange({ ...cond, value: v ?? '' })} />;
    }
    const preset = DATE_PRESETS.find((p) => p.op === cond.operator);
    return (
      <PickMenu label={field.label} text={preset?.label} placeholder={LS.selectValue} open={open} onOpen={onOpen} onClose={onClose} anchorRef={anchorRef} width={200}>
        <PickList
          label={field.label}
          items={DATE_PRESETS.map((p) => ({ value: p.op, label: p.label }))}
          selected={preset ? [preset.op] : []}
          onPick={(v) => {
            onClose();
            onChange({ ...cond, operator: v as FilterOperator, value: undefined });
          }}
        />
      </PickMenu>
    );
  }

  if (kind === 'number') {
    const n = typeof cond.value === 'number' ? cond.value : cond.value === undefined || cond.value === '' ? null : Number(cond.value);
    return (
      <NumberInput
        dense
        className="fp-input"
        aria-label={field.label}
        placeholder={LS.typeValue}
        prefix={field.type === 'money' ? '₹' : undefined}
        suffix={field.type === 'progress' ? '%' : undefined}
        showError={false}
        value={n}
        onValueChange={(v) => onChange({ ...cond, value: v === null || Number.isNaN(v) ? '' : v })}
      />
    );
  }

  return <TextField dense className="fp-input" placeholder={LS.typeValue} aria-label={field.label} value={cond.value === undefined ? '' : String(cond.value)} onChange={(e) => onChange({ ...cond, value: e.target.value })} />;
}

// ---------------------------------------------------------------- rows of one group (root or nested)

function GroupRows({
  res,
  actor,
  fields,
  group,
  depth,
  autoOpen,
  onAutoDone,
  onChange,
  onAddRow,
}: {
  res: ResourceDefinition;
  actor: Actor;
  fields: FieldDefinition[];
  group: FilterGroup;
  depth: number;
  autoOpen: string | null;
  onAutoDone: () => void;
  onChange: (g: FilterGroup) => void;
  onAddRow: (groupId: string) => void;
}) {
  const update = (id: string, child: FilterCondition | FilterGroup | null) =>
    onChange({ ...group, children: child ? group.children.map((c) => (c.id === id ? child : c)) : group.children.filter((c) => c.id !== id) });
  const join = group.join;
  const setJoin = (j: 'and' | 'or') => onChange({ ...group, join: j });
  return (
    <>
      {group.children.map((c, i) =>
        c.kind === 'group' ? (
          <div key={c.id} className="fp-row fp-group-row" role="group" aria-label={LS.filterGroupLabel}>
            <div className="fp-cell-join">
              {i === 0 ? (
                <span className="fp-where">{LS.where}</span>
              ) : i === 1 ? (
                <JoinMenu join={join} onJoin={setJoin} />
              ) : (
                <span className="fp-where is-join">{join === 'and' ? LS.joinAnd : LS.joinOr}</span>
              )}
            </div>
            <div className="fp-group-box">
              <GroupRows res={res} actor={actor} fields={fields} group={c} depth={depth + 1} autoOpen={autoOpen} onAutoDone={onAutoDone} onChange={(g) => update(c.id, g.children.length ? g : null)} onAddRow={onAddRow} />
              <div className="fp-group-foot">
                <button type="button" className="fp-add" onClick={() => onAddRow(c.id)}>
                  <Icon name="plus" size={14} />
                  {LS.addFilterRow}
                </button>
              </div>
            </div>
            <div className="fp-cell-x">
              <IconButton icon="trash" label={LS.removeFilterGroup} onClick={() => update(c.id, null)} className="fp-remove" />
            </div>
          </div>
        ) : (
          <ConditionRow
            key={c.id}
            res={res}
            actor={actor}
            fields={fields}
            cond={c}
            index={i}
            join={join}
            onJoin={setJoin}
            autoOpen={autoOpen === c.id}
            onAutoDone={onAutoDone}
            onChange={(x) => update(c.id, x)}
            onRemove={() => update(c.id, null)}
          />
        ),
      )}
    </>
  );
}

function JoinMenu({ join, onJoin }: { join: 'and' | 'or'; onJoin: (j: 'and' | 'or') => void }) {
  const [open, setOpen] = useState(false);
  return (
    <PickMenu label={LS.match} text={join === 'and' ? LS.joinAnd : LS.joinOr} placeholder={LS.joinAnd} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} width={120} className="fp-join">
      <PickList
        label={LS.match}
        items={[
          { value: 'and', label: LS.joinAnd },
          { value: 'or', label: LS.joinOr },
        ]}
        selected={[join]}
        onPick={(v) => {
          setOpen(false);
          onJoin(v as 'and' | 'or');
        }}
      />
    </PickMenu>
  );
}

// ---------------------------------------------------------------- the toolbar button + panel

/** Funnel button in the list toolbar (count badge when filters are on; label in its tooltip); opens the filter panel. */
export function FilterButton({ res, actor, filter, onChange }: { res: ResourceDefinition; actor: Actor; filter: FilterGroup; onChange: (g: FilterGroup) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterGroup>(filter);
  const [autoOpen, setAutoOpen] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const fields = filterableFields(res, actor);
  const n = countComplete(filter);

  const openPanel = () => {
    const d = cloneGroup(filter);
    if (!d.children.length) {
      const row = blankRow();
      d.children = [row];
      setAutoOpen(row.id);
    }
    setDraft(d);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setAutoOpen(null);
  };
  /** Edit the draft; apply its complete rows at once (only when that changes what is applied). */
  const edit = (next: FilterGroup) => {
    const shown = next.children.length ? next : { ...next, children: [blankRow()] };
    setDraft(shown);
    if (!same(shown, filter)) onChange(pruneIncomplete(shown));
  };
  const addRow = (groupId: string) => {
    const row = blankRow();
    const add = (g: FilterGroup): FilterGroup => (g.id === groupId ? { ...g, children: [...g.children, row] } : { ...g, children: g.children.map((c) => (c.kind === 'group' ? add(c) : c)) });
    setDraft((d) => add(d));
    setAutoOpen(row.id);
  };
  const addGroup = () => {
    const row = blankRow();
    setDraft((d) => ({ ...d, children: [...d.children, { ...newGroup('and'), children: [row] }] }));
    setAutoOpen(row.id);
  };
  const clearAll = () => {
    const row = blankRow();
    setDraft({ ...draft, join: 'and', children: [row] });
    setAutoOpen(null);
    if (countComplete(filter)) onChange({ ...filter, join: 'and', children: [] });
  };
  const hasRows = draft.children.length > 1 || draft.children.some((c) => c.kind === 'group' || !!c.field);

  return (
    <>
      <Button
        ref={ref}
        icon="filter"
        title={n ? LS.filtersActive(n) : LS.filters}
        onClick={() => (open ? close() : openPanel())}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={n ? LS.filtersActive(n) : LS.filters}
        className={cx('filter-btn', 'is-icon-only', open && 'is-open', n > 0 && 'is-active')}
      >
        {n > 0 && <span className="filter-count" aria-hidden="true">{n}</span>}
      </Button>
      <Popover open={open} onClose={close} anchor={ref} label={LS.filters} width={600} className="fp-pop" align="end">
        <div className="fp-head">
          <strong className="fp-title">{LS.filters}</strong>
          <button type="button" className="fp-clear" disabled={!n && !hasRows} onClick={clearAll}>
            {LS.clearAllFilters}
          </button>
        </div>
        <div className="fp-body">
          <GroupRows res={res} actor={actor} fields={fields} group={draft} depth={0} autoOpen={autoOpen} onAutoDone={() => setAutoOpen(null)} onChange={edit} onAddRow={addRow} />
        </div>
        <div className="fp-foot">
          <button type="button" className="fp-add" onClick={() => addRow(draft.id)}>
            <Icon name="plus" size={14} />
            {LS.addFilterRow}
          </button>
          <button type="button" className="fp-add" onClick={addGroup}>
            <Icon name="plus" size={14} />
            {LS.addFilterGroup}
          </button>
        </div>
      </Popover>
    </>
  );
}
