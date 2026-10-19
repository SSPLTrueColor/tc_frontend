import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { ColumnState, FieldAccess, FieldDefinition, RecordData, ResourceDefinition } from '../../metadata/types';
import { cx, formatMoney } from '../../lib/format';
import { PHONE, useMedia } from '../../lib/useMedia';
import { type Actor, canUpdateRecord, fieldAccessMap } from '../../services/authz';
import { getDb } from '../../services/db';
import { displayText, recordTitle, updateRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { masterLabel } from '../../services/registry';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { useToast } from '../primitives/feedback';
import { Menu, type MenuItem } from '../primitives/overlay';
import { FieldInput } from './FormFields';
import { FieldValue } from './FieldValue';
import { EmptyValue } from '../primitives/display';
import { ImageTile } from '../primitives/People';
import { isEmpty } from '../../services/validation';

const INLINE_TYPES = new Set(['text', 'number', 'money', 'master', 'date', 'relation']);
/** Row action icons (view, edit, more): column width fits exactly this many 30px icons. */
const ROW_ACTION_ICONS = 3;
const ACTIONS_W = ROW_ACTION_ICONS * 30 + (ROW_ACTION_ICONS - 1) * 2 + 16;
const DEFAULT_W = 150;

export interface GridProps {
  res: ResourceDefinition;
  actor: Actor;
  rows: RecordData[];
  columns: ColumnState[];
  onColumnsChange: (c: ColumnState[]) => void;
  sort: { field: string; dir: 'asc' | 'desc' }[];
  onSortChange: (s: { field: string; dir: 'asc' | 'desc' }[]) => void;
  density: 'compact' | 'comfortable';
  /** Lines per row (1–3): extra lines come from each field's `subFields`. */
  rowLines?: 1 | 2 | 3;
  groupBy?: string;
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  activeId?: string;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  rowMenu: (r: RecordData) => MenuItem[];
}

export function DataGrid(props: GridProps) {
  const phone = useMedia(PHONE);
  if (phone) return <CardList {...props} />;
  return <Table {...props} />;
}

function colLabel(res: ResourceDefinition, key: string) {
  return key === 'id' ? 'ID' : res.fields.find((f) => f.key === key)?.label ?? key;
}

function Table({ res, actor, rows, columns, onColumnsChange, sort, onSortChange, density, rowLines = 1, groupBy, selected, onSelectedChange, activeId, onOpen, onEdit, rowMenu }: GridProps) {
  const access = useMemo(() => fieldAccessMap(actor, res), [actor, res]);
  const visible = columns.filter((c) => !c.hidden && (c.key === 'id' || (access[c.key] && access[c.key] !== 'hide')));
  const ordered = [...visible.filter((c) => c.pinned), ...visible.filter((c) => !c.pinned)];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [menu, setMenu] = useState<{ row: RecordData } | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  // Shadow before the sticky Actions column only while more columns are hidden behind it.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  const [wrapW, setWrapW] = useState(0);
  const measureRight = () => {
    const el = wrapRef.current;
    if (!el) return;
    setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    setWrapW((w) => (Math.abs(w - el.clientWidth) > 1 ? el.clientWidth : w));
  };
  useLayoutEffect(() => {
    measureRight();
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureRight);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [columns, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const masterDetail = res.fields.some((f) => f.type === 'lineitems' && access[f.key] !== 'hide' && access[f.key] !== 'mask');

  // Pinned column offsets (sticky left after the select column).
  // Configured widths are minimums. When the table has spare room, share it across the data
  // columns in proportion to their width (Actions/checkbox keep their fixed size).
  const baseW = (c: ColumnState) => c.width ?? fieldWidth(res, c.key);
  const fixedW = 40 + (masterDetail ? 32 : 0) + ACTIONS_W;
  const dataW = ordered.reduce((sum, c) => sum + baseW(c), 0);
  const scale = wrapW && dataW ? Math.max(1, (wrapW - fixedW) / dataW) : 1;
  const widths = new Map(ordered.map((c) => [c.key, Math.floor(baseW(c) * scale)]));
  if (scale > 1 && ordered.length) {
    // Last data column absorbs rounding so Actions sits exactly at the right edge.
    const used = [...widths.values()].reduce((a, b) => a + b, 0);
    const last = ordered[ordered.length - 1].key;
    widths.set(last, widths.get(last)! + Math.max(0, Math.floor(wrapW - fixedW - used)));
  }
  const colW = (c: ColumnState) => widths.get(c.key) ?? baseW(c);
  const offsets: Record<string, number> = {};
  let acc = 40 + (masterDetail ? 32 : 0);
  ordered.forEach((c) => {
    if (c.pinned) {
      offsets[c.key] = acc;
      acc += colW(c);
    }
  });

  const groups = useMemo(() => {
    if (!groupBy) return [{ key: '', label: '', rows }];
    const f = res.fields.find((x) => x.key === groupBy);
    const map = new Map<string, RecordData[]>();
    rows.forEach((r) => {
      const label = f ? displayText(f, r[groupBy], actor) || 'Not set' : 'Not set';
      map.set(label, [...(map.get(label) ?? []), r]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, rs]) => ({ key: label, label, rows: rs }));
  }, [rows, groupBy, res, actor]);

  const sortedKey = sort[0]?.field;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  const toggleSort = (key: string) => {
    const cur = sort.find((s) => s.field === key);
    if (!cur) onSortChange([{ field: key, dir: 'asc' }]);
    else if (cur.dir === 'asc') onSortChange([{ field: key, dir: 'desc' }]);
    else onSortChange([]);
  };

  const startResize = (key: string, startX: number, startW: number) => {
    const move = (e: PointerEvent) => {
      const w = Math.max(80, Math.min(520, startW + e.clientX - startX));
      onColumnsChange(columns.map((c) => (c.key === key ? { ...c, width: w } : c)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onRowKey = (e: ReactKeyboardEvent<HTMLTableRowElement>, r: RecordData) => {
    if (e.target !== e.currentTarget) return;
    const rowsEls = Array.from(tbodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? []);
    const i = rowsEls.indexOf(e.currentTarget);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowsEls[i + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rowsEls[i - 1]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(r.id);
    } else if (e.key === ' ') {
      e.preventDefault();
      toggle(r.id);
    }
  };

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onSelectedChange(n);
  };

  return (
    <div ref={wrapRef} onScroll={measureRight} className={cx('grid-wrap', density === 'compact' ? 'density-compact' : 'density-comfortable', rowLines > 1 && `rows-${rowLines}`, moreRight && 'has-more-right')}>
      <table className="grid" aria-label={`${res.labelPlural} table`} aria-rowcount={rows.length}>
        <thead>
          <tr>
            <th className="col-select sticky-left" style={{ left: 0 }} scope="col">
              <input
                type="checkbox"
                aria-label="Select all rows on this page"
                checked={allSelected}
                ref={(el) => el && (el.indeterminate = !allSelected && someSelected)}
                onChange={() => onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              />
            </th>
            {masterDetail && (
              <th className="col-expand sticky-left" style={{ left: 40 }} scope="col">
                <span className="sr-only">Expand</span>
              </th>
            )}
            {ordered.map((c) => {
              const s = sort.find((x) => x.field === c.key);
              const w = colW(c);
              const f = res.fields.find((x) => x.key === c.key);
              const sortable = c.key === 'id' || (f?.capabilities.sort && access[c.key] !== 'mask');
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: w, minWidth: w, maxWidth: w, left: c.pinned ? offsets[c.key] : undefined }}
                  className={cx(c.pinned && 'sticky-left', f && ['money', 'number'].includes(f.type) && 'th-num', s && 'is-sorted', c === ordered[ordered.length - 1] && 'is-last')}
                  aria-sort={s ? (s.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {sortable ? (
                    <button type="button" className="th-btn" onClick={() => toggleSort(c.key)}>
                      <span className="th-label">{colLabel(res, c.key)}</span>
                      <Icon name={s ? (s.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} className={cx(!s && 'th-sort-idle')} />
                    </button>
                  ) : (
                    <span className="th-label th-static">
                      {colLabel(res, c.key)}
                      {access[c.key] === 'mask' && <Icon name="lock" size={12} className="muted" />}
                    </span>
                  )}
                  <span
                    className="col-resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${colLabel(res, c.key)} column`}
                    aria-valuenow={w}
                    tabIndex={0}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startResize(c.key, e.clientX, baseW(c));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        const nw = Math.max(80, Math.min(520, baseW(c) + (e.key === 'ArrowRight' ? 16 : -16)));
                        onColumnsChange(columns.map((x) => (x.key === c.key ? { ...x, width: nw } : x)));
                      }
                    }}
                  />
                </th>
              );
            })}
            <th className="col-actions sticky-right" scope="col" style={{ width: ACTIONS_W, minWidth: ACTIONS_W, maxWidth: ACTIONS_W }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {groups.map((g) => (
            <Fragment key={g.key || 'all'}>
              {groupBy && (
                <tr className="group-row">
                  <td colSpan={ordered.length + 2 + (masterDetail ? 1 : 0)}>
                    <button
                      type="button"
                      className="group-toggle"
                      aria-expanded={!collapsed.has(g.key)}
                      onClick={() => {
                        const n = new Set(collapsed);
                        if (n.has(g.key)) n.delete(g.key);
                        else n.add(g.key);
                        setCollapsed(n);
                      }}
                    >
                      <Icon name={collapsed.has(g.key) ? 'chevron-right' : 'chevron-down'} size={14} />
                      <strong>{g.label}</strong>
                      <span className="muted">{g.rows.length}</span>
                    </button>
                  </td>
                </tr>
              )}
              {!collapsed.has(g.key) &&
                g.rows.map((r) => {
                  const isOpen = expanded.has(r.id);
                  const raw = getDb().records[res.key].find((x) => x.id === r.id);
                  const rowCanEdit = !!raw && canUpdateRecord(actor, res, raw);
                  return (
                    <Fragment key={r.id}>
                      <tr
                        data-row
                        tabIndex={0}
                        className={cx(selected.has(r.id) && 'is-selected', activeId === r.id && 'is-active')}
                        aria-selected={selected.has(r.id)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        onClick={() => onOpen(r.id)}
                      >
                        <td className="col-select sticky-left" style={{ left: 0 }} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Select ${recordTitle(res.key, r.id, actor)}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                        </td>
                        {masterDetail && (
                          <td className="col-expand sticky-left" style={{ left: 40 }} onClick={(e) => e.stopPropagation()}>
                            <IconButton
                              icon={isOpen ? 'chevron-down' : 'chevron-right'}
                              label={isOpen ? 'Collapse details' : 'Expand line items'}
                              aria-expanded={isOpen}
                              onClick={() => {
                                const n = new Set(expanded);
                                if (n.has(r.id)) n.delete(r.id);
                                else n.add(r.id);
                                setExpanded(n);
                              }}
                            />
                          </td>
                        )}
                        {ordered.map((c) => {
                          const f = res.fields.find((x) => x.key === c.key);
                          const w = colW(c);
                          const isEditing = editing?.id === r.id && editing.key === c.key;
                          const inline = !!f && rowCanEdit && access[c.key] === 'edit' && INLINE_TYPES.has(f.type) && !f.visibleWhen && !f.relation?.filterBy;
                          return (
                            <td
                              key={c.key}
                              style={{ width: w, minWidth: w, maxWidth: w, left: c.pinned ? offsets[c.key] : undefined }}
                              className={cx(c.pinned && 'sticky-left', f && ['money', 'number'].includes(f.type) && 'td-num', sortedKey === c.key && 'is-sorted', inline && 'is-editable', isEditing && 'is-editing')}
                              onDoubleClick={(e) => {
                                if (!inline) return;
                                e.stopPropagation();
                                setEditing({ id: r.id, key: c.key });
                              }}
                            >
                              {isEditing && f ? (
                                <InlineEditor res={res} actor={actor} field={f} record={r} onDone={() => setEditing(null)} />
                              ) : c.key === 'id' ? (
                                <span className="mono">{r.id}</span>
                              ) : f ? (
                                <span className="cell">
                                  <RichCell res={res} actor={actor} field={f} record={r} access={access} lines={rowLines} />
                                  {inline && (
                                    <button
                                      type="button"
                                      className="cell-edit"
                                      aria-label={`Edit ${f.label}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditing({ id: r.id, key: c.key });
                                      }}
                                    >
                                      <Icon name="pencil" size={12} />
                                    </button>
                                  )}
                                </span>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="col-actions sticky-right" style={{ width: ACTIONS_W, minWidth: ACTIONS_W, maxWidth: ACTIONS_W }} onClick={(e) => e.stopPropagation()}>
                          <span className="row-actions">
                            <IconButton icon="eye" label={`View ${r.id}`} onClick={() => onOpen(r.id)} />
                            <IconButton icon="pencil" label={`Edit ${r.id}`} onClick={() => onEdit(r.id)} disabledReason={rowCanEdit ? undefined : 'Read-only for your role'} />
                            <IconButton
                              icon="more"
                              label={`More actions for ${r.id}`}
                              aria-haspopup="menu"
                              onClick={(e) => {
                                menuAnchor.current = e.currentTarget;
                                setMenu({ row: r });
                              }}
                            />
                          </span>
                        </td>
                      </tr>
                      {isOpen && masterDetail && (
                        <tr className="detail-row-expanded">
                          <td colSpan={ordered.length + 3}>
                            <div className="detail-card" style={wrapW ? { width: Math.max(320, wrapW - 56 - ACTIONS_W - 12) } : undefined}>
                              <LineItemsSummary record={r} title={`${res.label} line items`} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </Fragment>
          ))}
        </tbody>
      </table>
      {menu && <Menu open onClose={() => setMenu(null)} anchor={menuAnchor} label={`Actions for ${menu.row.id}`} items={rowMenu(menu.row)} />}
    </div>
  );
}

/**
 * Cell content for every row style: optional leading picture (image field or initials tile), the value,
 * and — in two-/three-line rows — the field's `subFields` as muted lines 2 and 3 (permission-aware).
 */
function RichCell({ res, actor, field, record, access, lines }: { res: ResourceDefinition; actor: Actor; field: FieldDefinition; record: RecordData; access: Record<string, FieldAccess>; lines: number }) {
  const main = <FieldValue field={field} value={record[field.key]} access={access[field.key]} actor={actor} rich={lines > 1} />;
  const subs = lines > 1 ? (field.subFields ?? []).slice(0, lines - 1).map((k) => res.fields.find((x) => x.key === k)).filter((x): x is FieldDefinition => !!x && !!access[x.key] && access[x.key] !== 'hide' && !isEmpty(record[x.key])) : []; // empty lines are skipped, never "N/A"
  let leading: ReactNode = null;
  if (field.leadingImage && lines >= (field.leadingImageMinLines ?? 2)) {
    const size = lines >= 3 ? 40 : lines === 2 ? 32 : 24;
    const name = String(record[field.key] ?? record.id);
    const src = field.leadingImage === 'initials' || access[field.leadingImage] === 'hide' ? null : ((record[field.leadingImage] as string | null) ?? null);
    leading = <ImageTile src={src} name={name} size={size} />;
  }
  if (!leading && !subs.length) return main;
  return (
    <span className="cell-rich">
      {leading}
      <span className="cell-lines">
        <span className="cell-line cell-line-1">{main}</span>
        {subs.map((sf) => (
          <span key={sf.key} className="cell-line cell-line-sub">
            <FieldValue field={sf} value={record[sf.key]} access={access[sf.key]} actor={actor} linkRelations={false} />
          </span>
        ))}
      </span>
    </span>
  );
}

/** Expanded row (master–detail): a plain numbered table — no card, no title line. */
function LineItemsSummary({ record, title }: { record: RecordData; title: string }) {
  const items = (record.lineItems as { serviceCode: string; description?: string; qty: number; unitPrice: number }[] | undefined) ?? [];
  const total = items.reduce((t, li) => t + li.qty * li.unitPrice, 0);
  return (
    <div className="detail-items">
      {/* Owner rule: no title line above the expanded table (screen readers still get the caption).
      <div className="detail-items-head">
        <strong className="detail-items-title">{title}</strong>
        <span className="muted">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div> */}
      <table className="mini-table detail-items-table">
        <caption className="sr-only">
          {title} for {record.id}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="col-n">
              #
            </th>
            <th scope="col">Service</th>
            <th scope="col">Description</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, i) => (
            <tr key={i}>
              <td className="col-n">{i + 1}</td>
              <td>{masterLabel('serviceCode', li.serviceCode)}</td>
              <td>{li.description || <EmptyValue />}</td>
              <td>{li.qty}</td>
              <td>{formatMoney(li.unitPrice)}</td>
              <td>{formatMoney(li.qty * li.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
        {items.length > 1 && (
          <tfoot>
            <tr>
              <td colSpan={5} className="detail-items-total-label">
                Total
              </td>
              <td className="detail-items-total">{formatMoney(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function InlineEditor({ res, actor, field, record, onDone }: { res: ResourceDefinition; actor: Actor; field: FieldDefinition; record: RecordData; onDone: () => void }) {
  const [value, setValue] = useState<unknown>(record[field.key]);
  const [error, setError] = useState('');
  const toast = useToast();
  const saving = useRef(false);
  const save = (v: unknown = value) => {
    if (saving.current) return;
    if (JSON.stringify(v ?? null) === JSON.stringify(record[field.key] ?? null)) return onDone();
    saving.current = true;
    try {
      updateRecord(actor, res.key, record.id, { [field.key]: v }, record.version);
      toast(`${record.id}: ${field.label} updated`);
      onDone();
    } catch (e) {
      const msg = e instanceof ServiceError ? e.fieldErrors?.[field.key] ?? e.message : 'Save failed';
      setError(msg);
      toast(msg, 'danger');
      saving.current = false;
    }
  };
  return (
    <div
      className="inline-editor"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone();
        if (e.key === 'Enter') save();
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null;
        // Focus moving into the dropdown's floating list is not "leaving" the editor.
        if (e.currentTarget.contains(to) || to?.closest?.('.popover')) return;
        save();
      }}
    >
      <FieldInput
        field={field}
        value={value}
        onChange={(v) => {
          setValue(v);
          // Picking from a dropdown commits immediately.
          if (field.type === 'master' || field.type === 'relation') save(v);
        }}
        values={{ ...record, [field.key]: value }}
        actor={actor}
        id={`inline-${record.id}-${field.key}`}
        invalid={!!error}
        compact
      />
      {error && <span className="sr-only">{error}</span>}
    </div>
  );
}

/** Responsive / mobile row variant: deliberate card list instead of a squeezed table. */
function CardList({ res, actor, rows, onOpen, activeId, columns, selected, onSelectedChange }: GridProps) {
  const access = fieldAccessMap(actor, res);
  const extra = columns.filter((c) => !c.hidden && c.key !== res.titleField && c.key !== 'id' && access[c.key] && access[c.key] !== 'hide').slice(0, 3);
  return (
    <ul className="card-list" aria-label={`${res.labelPlural} list`}>
      {rows.map((r) => (
        <li key={r.id} className={cx('card-row', activeId === r.id && 'is-active')}>
          <input
            type="checkbox"
            aria-label={`Select ${r.id}`}
            checked={selected.has(r.id)}
            onChange={() => {
              const n = new Set(selected);
              if (n.has(r.id)) n.delete(r.id);
              else n.add(r.id);
              onSelectedChange(n);
            }}
          />
          <button type="button" className="card-main" onClick={() => onOpen(r.id)}>
            <span className="card-title">{recordTitle(res.key, r.id, actor)}</span>
            <span className="card-meta mono">{r.id}</span>
            <span className="card-fields">
              {extra.map((c) => {
                const f = res.fields.find((x) => x.key === c.key)!;
                return (
                  <span key={c.key} className="card-field">
                    <span className="muted">{f.label}: </span>
                    <FieldValue field={f} value={r[c.key]} access={access[c.key]} actor={actor} linkRelations={false} />
                  </span>
                );
              })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function fieldWidth(res: ResourceDefinition, key: string) {
  if (key === 'id') return 96;
  const f = res.fields.find((x) => x.key === key);
  if (!f) return DEFAULT_W;
  if (f.width) return f.width;
  if (f.type === 'date' || f.type === 'money' || f.type === 'number') return 120;
  if (f.type === 'datetime') return 170;
  return DEFAULT_W;
}
