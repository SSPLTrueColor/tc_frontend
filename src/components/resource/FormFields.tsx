/**
 * Universal Form runtime: field inputs generated from canonical metadata.
 * Layout (sections/columns) is presentation only; validation and access come
 * from the resource schema + Authorization Service.
 */
import { createContext, useContext, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FieldAccess, FieldDefinition, LineItemColumn, RecordData, ResourceDefinition } from '../../metadata/types';
import { cx, formatMoney } from '../../lib/format';
import type { Actor } from '../../services/authz';
import { canReadRecord } from '../../services/authz';
import { getDb } from '../../services/db';
import { activeMasterValues, getMaster, getResource } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { evalCondition, isEmpty, isRequired, isVisible } from '../../services/validation';
import { SelectMenu } from '../primitives/SelectMenu';
import { MultiSelectMenu } from '../primitives/MultiSelectMenu';
import { DatePicker } from '../primitives/DatePicker';
import { InfoTip } from '../primitives/InfoTip';
import { ImageTile } from '../primitives/People';
import { fieldIcon } from './fieldIcon';
import { Button, IconButton } from '../primitives/Button';
import { Menu, type MenuItem } from '../primitives/overlay';
import { Icon } from '../primitives/Icon';
import { FieldValue } from './FieldValue';
import { L } from '../../constants/labels';
import { FileButton, Switch, TextField, Textarea } from '../primitives/controls';

type Values = Record<string, unknown>;

export function relationOptions(actor: Actor, field: FieldDefinition, values: Values) {
  const rel = field.relation!;
  const res = getResource(rel.resource);
  let rows = (getDb().records[rel.resource] ?? []).filter((r) => canReadRecord(actor, res, r));
  if (rel.where) rows = rows.filter((r) => evalCondition(rel.where, r));
  if (rel.filterBy) {
    const want = values[rel.filterBy.fromField];
    rows = want ? rows.filter((r) => r[rel.filterBy!.field] === want) : [];
  }
  if (rel.resource === 'employees') rows = rows.filter((r) => r.status !== 'inactive');
  return rows.map((r) => ({ id: r.id, label: recordTitle(rel.resource, r.id, actor) })).sort((a, b) => a.label.localeCompare(b.label));
}

export function FieldInput({
  field,
  value,
  onChange,
  values,
  actor,
  id,
  invalid,
  describedBy,
  compact,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  values: Values;
  actor: Actor;
  id: string;
  invalid?: boolean;
  describedBy?: string;
  compact?: boolean;
}) {
  const common = {
    id,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    'aria-required': isRequired(field, values) || undefined,
    className: cx('input', compact && 'input-compact'),
  };
  switch (field.type) {
    case 'longtext':
      return <Textarea {...common} className="textarea" rows={3} maxLength={field.maxLength} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    case 'number':
    case 'money':
      return (
        <div className={cx('input-affix', field.type === 'money' && 'has-start', field.unit && 'has-end')}>
          {field.type === 'money' && <span className="affix affix-start">₹</span>}
          <TextField
            {...common}
            type="number"
            inputMode="decimal"
            min={field.min}
            max={field.max}
            step={field.type === 'money' ? '0.01' : '1'}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          />
          {field.unit && <span className="affix affix-end">{field.unit}</span>}
        </div>
      );
    case 'date':
      return <DatePicker id={id} block label={field.label} value={(value as string) || ''} onChange={onChange} invalid={invalid} describedBy={describedBy} clearable={!isRequired(field, values)} />;
    case 'datetime':
      return <DatePicker id={id} block withTime label={field.label} value={(value as string) || ''} onChange={onChange} invalid={invalid} describedBy={describedBy} clearable={!isRequired(field, values)} />;
    case 'boolean':
      return (
        <Switch id={id} checked={!!value} onChange={onChange} label={field.label} describedBy={describedBy} text={value ? L.common.actions.yes : L.common.actions.no} />
      );
    case 'master': {
      const parent = field.masterParentField ? values[field.masterParentField] : undefined;
      const opts = field.masterParentField ? (parent ? activeMasterValues(field.master!, parent) : []) : activeMasterValues(field.master!);
      const current = getMaster(field.master!).values.find((v) => v.key === value);
      return (
        <SelectMenu
          icon={fieldIcon(field)}
          id={id}
          block
          label={field.label}
          value={String(value ?? '')}
          invalid={invalid}
          describedBy={describedBy}
          disabled={field.masterParentField ? !parent : undefined}
          placeholder={field.masterParentField && !parent ? L.common.form.chooseParentFirst : L.common.form.select}
          options={[
            ...(!isRequired(field, values) && !isEmpty(value) ? [{ value: '', label: L.common.states.none }] : []),
            ...(current && !current.active ? [{ value: current.key, label: `${current.label} (inactive)` }] : []),
            ...opts.map((o) => ({ value: o.key, label: o.label })),
          ]}
          onChange={(v) => onChange(v || null)}
        />
      );
    }
    case 'multimaster':
      return (
        <MultiSelectMenu
          id={id}
          block
          label={field.label}
          values={(value as string[] | undefined) ?? []}
          options={activeMasterValues(field.master!).map((o) => ({ value: o.key, label: o.label }))}
          onChange={(vs) => onChange(vs)}
          invalid={invalid}
          describedBy={describedBy}
        />
      );
    case 'people':
      return (
        <MultiSelectMenu
          id={id}
          block
          label={field.label}
          values={(value as string[] | undefined) ?? []}
          options={relationOptions(actor, field, values).map((o) => ({ value: o.id, label: o.label }))}
          onChange={(vs) => onChange(vs)}
          invalid={invalid}
          describedBy={describedBy}
        />
      );
    case 'image':
      return <ImageInput id={id} label={field.label} value={(value as string | null) ?? null} onChange={onChange} describedBy={describedBy} />;
    case 'relation': {
      const opts = relationOptions(actor, field, values);
      const dependent = field.relation?.filterBy && !values[field.relation.filterBy.fromField];
      return (
        <SelectMenu
          icon={fieldIcon(field)}
          id={id}
          block
          label={field.label}
          value={String(value ?? '')}
          invalid={invalid}
          describedBy={describedBy}
          disabled={!!dependent || !opts.length}
          placeholder={dependent ? L.common.form.chooseRelatedFirst : opts.length ? L.common.form.select : L.common.form.noOptions}
          options={[...(!isRequired(field, values) && !isEmpty(value) ? [{ value: '', label: L.common.states.none }] : []), ...opts.map((o) => ({ value: o.id, label: `${o.label} (${o.id})` }))]}
          onChange={(v) => onChange(v || null)}
        />
      );
    }
    case 'lineitems':
      return <LineItemsEditor field={field} value={(value as Values[]) ?? []} onChange={onChange} id={id} />;
    case 'email':
    case 'phone':
      // phone / email icon inside the input (same icon as in tables and details)
      return (
        <div className="input-affix has-start has-icon">
          <span className="affix affix-start">
            <Icon name={field.type === 'phone' ? 'f-phone' : 'f-email'} size={14} />
          </span>
          <TextField
            {...common}
            type={field.type === 'email' ? 'email' : 'tel'}
            autoComplete="off"
            maxLength={field.maxLength}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
        </div>
      );
    default:
      return (
        <TextField
          {...common}
          type="text"
          autoComplete="off"
          maxLength={field.maxLength}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      );
  }
}

/** Repeater / line items with reorder, row validation and currency-safe totals (integer cents). */
function LineItemsEditor({ field, value, onChange, id }: { field: FieldDefinition; value: Values[]; onChange: (v: unknown) => void; id: string }) {
  const cols = field.lineItemColumns ?? [];
  const totalCents = value.reduce((s, r) => s + Math.round((Number(r.qty) || 0) * (Number(r.unitPrice) || 0) * 100), 0);
  const set = (i: number, key: string, v: unknown) => onChange(value.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="line-items" id={id}>
      <div className="table-scroll">
        <table className="li-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                  {c.required && <span className="req" aria-hidden="true"> *</span>}
                </th>
              ))}
              <th scope="col" className="num">
                {L.common.form.amount}
              </th>
              <th scope="col">
                <span className="sr-only">{L.common.form.rowActions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key}>
                    <LineCell col={c} value={row[c.key]} onChange={(v) => set(i, c.key, v)} label={L.common.form.rowLabel(i + 1, c.label)} />
                  </td>
                ))}
                <td className="num">{formatMoney((Number(row.qty) || 0) * (Number(row.unitPrice) || 0))}</td>
                <td className="li-actions">
                  {/* one ⋯ menu per row (Move up / Move down / Remove) instead of three icons */}
                  <RowMenu
                    label={L.common.form.row(i + 1)}
                    items={[
                      { id: 'up', label: L.common.form.moveUpRow, icon: 'arrow-up', onSelect: () => move(i, -1), disabledReason: i === 0 ? L.common.form.alreadyFirst : undefined },
                      { id: 'down', label: L.common.form.moveDownRow, icon: 'arrow-down', onSelect: () => move(i, 1), disabledReason: i === value.length - 1 ? L.common.form.alreadyLast : undefined },
                      { id: 'rm', label: L.common.form.removeLine, icon: 'trash', danger: true, separatorBefore: true, onSelect: () => onChange(value.filter((_, j) => j !== i)) },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {!value.length && (
              <tr>
                <td colSpan={cols.length + 2} className="muted li-empty">
                  {L.common.form.noLineItems}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={cols.length}>
                <Button icon="plus" onClick={() => onChange([...value, { serviceCode: '', description: '', qty: 1, unitPrice: 0 }])}>
                  {L.common.form.addLine}
                </Button>
              </td>
              <td className="num li-total">{formatMoney(totalCents / 100)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function LineCell({ col, value, onChange, label }: { col: LineItemColumn; value: unknown; onChange: (v: unknown) => void; label: string }) {
  if (col.type === 'master') {
    return (
      <SelectMenu block label={label} value={String(value ?? '')} options={activeMasterValues(col.master!).map((o) => ({ value: o.key, label: o.label }))} onChange={(v) => onChange(v)} />
    );
  }
  if (col.type === 'number' || col.type === 'money') {
    return (
      <TextField
        dense className="li-num"
        type="number"
        aria-label={label}
        min={col.min}
        step={col.type === 'money' ? '0.01' : '1'}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }
  return <TextField dense aria-label={label} placeholder={col.key === 'description' ? L.common.form.optionalDescription : undefined} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
}

function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={ref} icon="more" label={`${label} actions`} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} />
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref} label={`${label} actions`} items={items} />
    </>
  );
}

/** Renders one field row with label, help, error association and access-aware read-only states. */
export function FormField({
  field,
  access,
  values,
  setValue,
  error,
  actor,
  record,
}: {
  field: FieldDefinition;
  access: FieldAccess;
  values: Values;
  setValue: (key: string, v: unknown) => void;
  error?: string;
  actor: Actor;
  record?: RecordData;
}) {
  const id = useId();
  const errorLink = useContext(ErrorLinksContext)[field.key];
  if (access === 'hide' || !isVisible(field, values)) return null;
  const helpId = field.help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const required = isRequired(field, values);
  const wide = field.type === 'longtext' || field.type === 'lineitems' || field.type === 'multimaster' || field.type === 'people';
  if (access !== 'edit') {
    return (
      <div className={cx('form-field', wide && 'span-2')}>
        <span className="field-label" id={`${id}-label`}>
          <Icon name={fieldIcon(field)} size={16} className="field-icon" />
          {field.label}
          {access === 'mask' && (
            <span className="field-flag">
              <Icon name="lock" size={12} /> Masked
            </span>
          )}
          {access === 'view' && !field.computed && !field.readOnly && !field.system && <span className="field-flag">{L.common.form.readOnlyFlag}</span>}
        </span>
        <div className="field-readonly">
          <FieldValue field={field} value={record ? record[field.key] : values[field.key]} access={access} actor={actor} />
        </div>
      </div>
    );
  }
  return (
    <div className={cx('form-field', wide && 'span-2', error && 'has-error')} data-field={field.key} data-type={field.type}>
      <span className="field-label-row">
        <label className="field-label" htmlFor={id} id={`${id}-label`}>
          <Icon name={fieldIcon(field)} size={16} className="field-icon" />
          {field.label}
          {required ? <span className="req"> *</span> : <span className="optional"> (optional)</span>}
        </label>
        {field.help && <InfoTip text={field.help} label={L.common.form.about(field.label)} />}
      </span>
      <FieldInput
        field={field}
        value={values[field.key]}
        onChange={(v) => setValue(field.key, v)}
        values={values}
        actor={actor}
        id={id}
        invalid={!!error}
        describedBy={[helpId, errId].filter(Boolean).join(' ') || undefined}
      />
      {field.help && (
        <span className="sr-only" id={helpId}>
          {field.help}
        </span>
      )}
      {error && (
        <p className="field-error" id={errId}>
          <Icon name="alert" size={12} /> {error}
          {errorLink && (
            <>
              {' '}
              <Link to={errorLink.to}>{errorLink.label}</Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Optional links under field errors (ServiceError.fieldLinks), provided by the record form. */
export const ErrorLinksContext = createContext<Record<string, { label: string; to: string }>>({});

export function FormSections({
  res,
  sectionIds,
  fieldKeys,
  values,
  setValue,
  errors,
  access,
  actor,
  record,
  layout = 'simple',
}: {
  layout?: 'simple' | 'canvas';
  res: ResourceDefinition;
  sectionIds?: string[];
  fieldKeys?: string[];
  values: Values;
  setValue: (key: string, v: unknown) => void;
  errors: Record<string, string>;
  access: Record<string, FieldAccess>;
  actor: Actor;
  record?: RecordData;
}) {
  const sections = useMemo(() => {
    if (fieldKeys) return [{ id: 'quick', title: '', fields: fieldKeys, columns: 1 as const }];
    return res.form.sections.filter((s) => !sectionIds || sectionIds.includes(s.id));
  }, [res, sectionIds, fieldKeys]);
  if (layout === 'canvas') {
    // Canvas: the title field as a large borderless heading, then every field as an icon · label | value row
    const all = sections.flatMap((s) => s.fields).map((k) => res.fields.find((f) => f.key === k)).filter((f): f is FieldDefinition => !!f && access[f.key] !== 'hide');
    const title = all.find((f) => f.key === res.titleField && f.type === 'text' && access[f.key] === 'edit');
    return (
      <div className="form-canvas">
        {title && (
          <TextField bare
            className={cx('canvas-title', errors[title.key] && 'is-invalid')}
            aria-label={title.label}
            placeholder={title.label}
            value={String(values[title.key] ?? '')}
            maxLength={title.maxLength}
            onChange={(e) => setValue(title.key, e.target.value)}
          />
        )}
        {title && errors[title.key] && <p className="field-error">{errors[title.key]}</p>}
        <div className="canvas-rows">
          {all
            .filter((f) => f !== title)
            .map((f) => (
              <FormField key={f.key} field={f} access={access[f.key]} values={values} setValue={setValue} error={errors[f.key]} actor={actor} record={record} />
            ))}
        </div>
      </div>
    );
  }
  return (
    <>
      {sections.map((s) => {
        const fields = s.fields.map((k) => res.fields.find((f) => f.key === k)).filter((f): f is FieldDefinition => !!f && access[f.key] !== 'hide');
        if (!fields.length) return null;
        return (
          <fieldset key={s.id} className="form-section">
            {/* Owner rule: form section titles ("Who", "Details", "Restricted"…) are hidden — fields flow as one even grid.
            {s.title && <legend className="form-section-title">{s.title}</legend>} */}
            {s.title && <legend className="sr-only">{s.title}</legend>}
            <div className="form-grid">
              {fields.map((f) => (
                <FormField key={f.key} field={f} access={access[f.key]} values={values} setValue={setValue} error={errors[f.key]} actor={actor} record={record} />
              ))}
            </div>
          </fieldset>
        );
      })}
    </>
  );
}

export function ErrorSummary({ errors, res, message }: { errors: Record<string, string>; res: ResourceDefinition; message?: string }) {
  const keys = Object.keys(errors);
  if (!keys.length && !message) return null;
  return (
    <div className="error-summary" role="alert" tabIndex={-1} data-error-summary>
      <strong>
        <Icon name="alert" size={14} /> {message ?? L.common.form.fixFollowing}
      </strong>
      {keys.length > 0 && (
        <ul>
          {keys.map((k) => (
            <li key={k}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  const el = document.querySelector<HTMLElement>(`[data-field="${k}"] input, [data-field="${k}"] select, [data-field="${k}"] textarea`);
                  el?.focus();
                }}
              >
                {res.fields.find((f) => f.key === k)?.label ?? k}
              </button>
              : {errors[k]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Local-only picture picker: preview tile + Upload / Remove (the image stays in this browser). */
function ImageInput({ id, label, value, onChange, describedBy }: { id: string; label: string; value: string | null; onChange: (v: unknown) => void; describedBy?: string }) {
  return (
    <span className="image-input">
      <ImageTile src={value} name={label} size={40} />
      <FileButton
        className="image-input-btn"
        id={id}
        accept="image/*"
        aria-describedby={describedBy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onChange(String(reader.result));
          reader.readAsDataURL(file);
        }}
      >
        {value ? L.common.actions.replace : L.common.actions.upload}
      </FileButton>
      {value && (
        <button type="button" className="multi-clear" onClick={() => onChange(null)}>
          {L.common.actions.remove}
        </button>
      )}
    </span>
  );
}
