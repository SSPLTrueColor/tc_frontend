import { getCardActions } from './extensions';
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { ColumnState, FieldAccess, FieldDefinition, RecordData, ResourceDefinition } from '../../metadata/types';
import { cx } from '../../lib/format';
import { PHONE, useMedia } from '../../lib/useMedia';
import { type Actor, canUpdateRecord, fieldAccessMap } from '../../services/authz';
import { getDb } from '../../services/db';
import { displayText, recordTitle, updateRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { masterValue } from '../../services/registry';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { useToast } from '../primitives/feedback';
import { Menu, type MenuItem } from '../primitives/overlay';
import { FieldInput } from './FormFields';
import { FieldValue } from './FieldValue';
import { StatusCellMenu, useStageMove } from './MoveStageButton';
import { useUnsavedGuard } from '../settings/kit';
import { LineItemsTable, lineItemsOf } from './LineItems';
import { ImageTile } from '../primitives/People';
import { isEmpty } from '../../services/validation';
import { isDragClick } from '../../lib/dragGuard';
import { L } from '../../constants/labels';

const C = L.common;
const LS = L.common.list;

const INLINE_TYPES = new Set(['text', 'number', 'money', 'master', 'date', 'relation']);
/** Row action icons (view, edit, more): column width fits exactly this many 30px icons. */
const ROW_ACTION_ICONS = 3;
const ACTIONS_W = ROW_ACTION_ICONS * 30 + (ROW_ACTION_ICONS - 1) * 2 + 16;
/** Extra room for a module's row action icon (e.g. "Create Opportunity" on leads). */
const CARD_ACTION_W = 32;
const DEFAULT_W = 150;
/**
 * Virtualization rule: when a flat, one-line table renders more than this many rows, only the rows in
 * (and just around) the viewport are in the DOM; spacer rows keep the scroll height exact.
 */
export const VIRTUAL_THRESHOLD = 100;
const VIRTUAL_OVERSCAN = 12;

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
  // In-place edits are staged per row: nothing is saved until the row's ✓ (Apply) is clicked; ✕ discards them.
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  useUnsavedGuard(Object.keys(drafts).length > 0);
  const toast = useToast();
  const { move, dialog } = useStageMove(res, actor);
  const CardActions = getCardActions(res.key);
  const stage = (r: RecordData, key: string, v: unknown) =>
    setDrafts((d) => {
      const row = { ...d[r.id] };
      if (JSON.stringify(v ?? null) === JSON.stringify(r[key] ?? null)) delete row[key];
      else row[key] = v;
      const next = { ...d };
      if (Object.keys(row).length) next[r.id] = row;
      else delete next[r.id];
      return next;
    });
  const discard = (id: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  const apply = (r: RecordData) => {
    const patch = drafts[r.id];
    if (!patch) return;
    try {
      const raw = getDb().records[res.key].find((x) => x.id === r.id);
      updateRecord(actor, res.key, r.id, patch, raw?.version ?? r.version);
      discard(r.id);
      toast(C.toasts.saved(r.id));
    } catch (e) {
      const fe = e instanceof ServiceError ? e.fieldErrors : undefined;
      const first = fe && Object.keys(fe)[0];
      toast(first ? `${colLabel(res, first)}: ${fe![first]}` : e instanceof ServiceError ? e.message : C.toasts.saveFailed, 'danger');
    }
  };
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
  }, [columns, rows.length]);  
  const masterDetail = res.fields.some((f) => f.type === 'lineitems' && access[f.key] !== 'hide' && access[f.key] !== 'mask');

  // Pinned column offsets (sticky left after the select column).
  // Configured widths are minimums. When the table has spare room, share it across the data
  // columns in proportion to their width (Actions/checkbox keep their fixed size).
  const baseW = (c: ColumnState) => c.width ?? fieldWidth(res, c.key);
  // Room for a module row action, or for the "Edited" tag while a row has staged edits.
  const actionsW = ACTIONS_W + Math.max(CardActions ? CARD_ACTION_W : 0, Object.keys(drafts).length ? 52 : 0);
  const fixedW = 40 + (masterDetail ? 32 : 0) + actionsW;
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
      const label = f ? displayText(f, r[groupBy], actor) || C.states.notSet : C.states.notSet;
      map.set(label, [...(map.get(label) ?? []), r]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, rs]) => ({ key: label, label, rows: rs }));
  }, [rows, groupBy, res, actor]);

  // ---- virtualization (flat one-line tables with many rows)
  const virtual = !groupBy && rowLines === 1 && expanded.size === 0 && rows.length > VIRTUAL_THRESHOLD;
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  const [rowPx, setRowPx] = useState(density === 'compact' ? 35 : 41);
  // Measures after every render on purpose (row height and viewport can change with any update); the guards stop loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!virtual) return;
    const el = wrapRef.current;
    if (el && Math.abs(el.clientHeight - scroll.height) > 1) setScroll({ top: el.scrollTop, height: el.clientHeight });
    const tr = tbodyRef.current?.querySelector<HTMLTableRowElement>('tr[data-row]');
    if (tr && tr.offsetHeight > 0 && Math.abs(tr.offsetHeight - rowPx) > 0.5) setRowPx(tr.offsetHeight);
  });
  const vStart = virtual ? Math.max(0, Math.floor(scroll.top / rowPx) - VIRTUAL_OVERSCAN) : 0;
  const vEnd = virtual ? Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / rowPx) + VIRTUAL_OVERSCAN) : rows.length;

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
    <div
      ref={wrapRef}
      onScroll={(e) => {
        measureRight();
        if (virtual) setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
      }}
      data-virtual={virtual || undefined}
      className={cx('grid-wrap', density === 'compact' ? 'density-compact' : 'density-comfortable', rowLines > 1 && `rows-${rowLines}`, moreRight && 'has-more-right')}>
      <table className="grid" aria-label={LS.tableAria(res.labelPlural)} aria-rowcount={rows.length + 1}>
        <thead>
          <tr>
            <th className="col-select sticky-left" style={{ left: 0 }} scope="col">
              <Checkbox
                
                aria-label={LS.selectAll}
                checked={allSelected}
                ref={(el) => el && (el.indeterminate = !allSelected && someSelected)}
                onChange={() => onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              />
            </th>
            {masterDetail && (
              <th className="col-expand sticky-left" style={{ left: 40 }} scope="col">
                <span className="sr-only">{LS.expand}</span>
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
                      {/* column-type icon on the RIGHT end of the title cell (owner rule) */}
                      <Icon name={fieldIcon(f)} size={14} className="th-type th-type-right" />
                    </button>
                  ) : (
                    <span className="th-label th-static">
                      {colLabel(res, c.key)}
                      {access[c.key] === 'mask' && <Icon name="lock" size={12} className="muted" />}
                      <Icon name={fieldIcon(f)} size={14} className="th-type th-type-right" />
                    </span>
                  )}
                  <span
                    className="col-resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={LS.resizeColumn(colLabel(res, c.key))}
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
            <th className="col-actions sticky-right" scope="col" style={{ width: actionsW, minWidth: actionsW, maxWidth: actionsW }}>
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
              {virtual && vStart > 0 && (
                <tr className="virtual-spacer" aria-hidden="true" style={{ height: vStart * rowPx }}>
                  <td colSpan={ordered.length + 2 + (masterDetail ? 1 : 0)} />
                </tr>
              )}
              {!collapsed.has(g.key) &&
                (virtual ? g.rows.slice(vStart, vEnd) : g.rows).map((r) => {
                  const isOpen = expanded.has(r.id);
                  const raw = getDb().records[res.key].find((x) => x.id === r.id);
                  const rowCanEdit = !!raw && canUpdateRecord(actor, res, raw);
                  const draft = drafts[r.id];
                  const shown = draft ? { ...r, ...draft } : r;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        data-row
                        tabIndex={0}
                        className={cx(selected.has(r.id) && 'is-selected', activeId === r.id && 'is-active', draft && 'is-dirty')}
                        aria-selected={selected.has(r.id)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        // selecting / copying text in a row must not open the record
                        onClick={(e) => {
                          if (isDragClick(e)) return;
                          onOpen(r.id);
                        }}
                      >
                        <td className="col-select sticky-left" style={{ left: 0 }} onClick={(e) => e.stopPropagation()}>
                          <Checkbox aria-label={LS.selectRow(recordTitle(res.key, r.id, actor))} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                        </td>
                        {masterDetail && (
                          <td className="col-expand sticky-left" style={{ left: 40 }} onClick={(e) => e.stopPropagation()}>
                            <IconButton
                              icon={isOpen ? 'chevron-down' : 'chevron-right'}
                              label={isOpen ? LS.collapseDetails : LS.expandLineItems}
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
                          const isStatus = !!res.lifecycle && c.key === res.lifecycle.field;
                          const dirtyCell = !!draft && c.key in draft;
                          const inline = !!f && !isStatus && rowCanEdit && access[c.key] === 'edit' && INLINE_TYPES.has(f.type) && !f.visibleWhen && !f.relation?.filterBy;
                          return (
                            <td
                              key={c.key}
                              style={{ width: w, minWidth: w, maxWidth: w, left: c.pinned ? offsets[c.key] : undefined }}
                              className={cx(c.pinned && 'sticky-left', f && ['money', 'number'].includes(f.type) && 'td-num', sortedKey === c.key && 'is-sorted', inline && 'is-editable', inline && f?.type === 'master' && 'is-choice', isEditing && 'is-editing', dirtyCell && 'is-dirty')}
                              // ClickUp-style: hovering an editable cell outlines it; a single click edits it in place
                              onClick={(e) => {
                                if (isDragClick(e)) {
                                  e.stopPropagation();
                                  return;
                                }
                                if (!inline || isEditing) return;
                                e.stopPropagation();
                                setEditing({ id: r.id, key: c.key });
                              }}
                            >
                              {isEditing && f ? (
                                <InlineEditor actor={actor} field={f} record={shown} onStage={(v) => stage(r, f.key, v)} onDone={() => setEditing(null)} />
                              ) : c.key === 'id' ? (
                                <IdCell id={r.id} onOpen={() => onOpen(r.id)} />
                              ) : isStatus ? (
                                <span className="cell" onClick={(e) => e.stopPropagation()}>
                                  {rowCanEdit && !draft ? <StatusCellMenu res={res} actor={actor} record={r} move={move} /> : <RichCell res={res} actor={actor} field={f!} record={r} access={access} lines={rowLines} />}
                                </span>
                              ) : f ? (
                                <span className="cell">
                                  <RichCell res={res} actor={actor} field={f} record={shown} access={access} lines={rowLines} />
                                  {inline && (
                                    <button
                                      type="button"
                                      className="cell-edit"
                                      aria-label={LS.editField(f.label)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditing({ id: r.id, key: c.key });
                                      }}
                                    >
                                      <Icon name={f && ['master', 'relation', 'date'].includes(f.type) ? 'chevron-down' : 'pencil'} size={14} />
                                    </button>
                                  )}
                                </span>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="col-actions sticky-right" style={{ width: actionsW, minWidth: actionsW, maxWidth: actionsW }} onClick={(e) => e.stopPropagation()}>
                          <span className="row-actions">
                            {draft ? (
                              <>
                                <span className="row-edited-tag">{LS.edited}</span>
                                <IconButton icon="check" className="row-apply" label={LS.applyRow(r.id)} onClick={() => apply(r)} />
                                <IconButton icon="x" label={LS.discardRow(r.id)} onClick={() => discard(r.id)} />
                              </>
                            ) : (
                              <>
                                {CardActions && (
                                  <span className="row-card-actions">
                                    <CardActions res={res} actor={actor} record={r} />
                                  </span>
                                )}
                                <IconButton icon="eye" label={LS.viewRow(r.id)} onClick={() => onOpen(r.id)} />
                                <IconButton icon="pencil" label={LS.editRow(r.id)} onClick={() => onEdit(r.id)} disabledReason={rowCanEdit ? undefined : C.states.readOnlyForRole} />
                              </>
                            )}
                            <IconButton
                              icon="more"
                              label={LS.rowActions(r.id)}
                              aria-haspopup="menu"
                              onClick={(e) => {
                                menuAnchor.current = e.currentTarget;
                                setMenu((m) => (m?.row.id === r.id ? null : { row: r })); // click again closes
                              }}
                            />
                          </span>
                        </td>
                      </tr>
                      {isOpen && masterDetail && (
                        <tr className="detail-row-expanded">
                          <td colSpan={ordered.length + 3}>
                            <div className="detail-card" style={wrapW ? { width: Math.max(320, wrapW - 56 - actionsW - 12) } : undefined}>
                              <LineItemsSummary res={res} record={r} title={LS.lineItems(res.label)} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              {virtual && vEnd < rows.length && (
                <tr className="virtual-spacer" aria-hidden="true" style={{ height: (rows.length - vEnd) * rowPx }}>
                  <td colSpan={ordered.length + 2 + (masterDetail ? 1 : 0)} />
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {menu && <Menu open onClose={() => setMenu(null)} anchor={menuAnchor} label={LS.actionsFor(menu.row.id)} items={rowMenu(menu.row)} />}
      {dialog}
    </div>
  );
}

/** Record ID as a visible hyperlink (opens the record) + a copy button pinned to the cell's right edge. */
function IdCell({ id, onOpen }: { id: string; onOpen: () => void }) {
  const toast = useToast();
  return (
    <span className="id-cell">
      <button
        type="button"
        className="id-link mono"
        onClick={(e) => {
          e.stopPropagation();
          if (isDragClick(e)) return; // selecting the ID to copy it never opens the record
          onOpen();
        }}
      >
        {id}
      </button>
      <button
        type="button"
        className="cell-trail"
        aria-label={LS.copyIdAria(id)}
        data-tooltip={LS.copyId}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(id).catch(() => {}); // clipboard may be blocked — never crash
          toast(C.toasts.copiedId(id), 'info');
        }}
      >
        <Icon name="copy" size={14} />
      </button>
    </span>
  );
}

export { fieldIcon } from './fieldIcon';
import { fieldIcon } from './fieldIcon';
import { Checkbox } from '../primitives/controls';

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
function LineItemsSummary({ res, record, title }: { res: ResourceDefinition; record: RecordData; title: string }) {
  const key = res.fields.find((f) => f.type === 'lineitems')?.key ?? 'lineItems';
  return (
    <div className="detail-items">
      <LineItemsTable items={lineItemsOf(record, key)} caption={`${title} for ${record.id}`} />
    </div>
  );
}

/** In-place cell editor: commits into the row's staged draft (never saves); the row's ✓ applies all its edits. */
function InlineEditor({ actor, field, record, onStage, onDone }: { actor: Actor; field: FieldDefinition; record: RecordData; onStage: (v: unknown) => void; onDone: () => void }) {
  const [value, setValue] = useState<unknown>(record[field.key]);
  const done = useRef(false);
  const save = (v: unknown = value) => {
    if (done.current) return;
    done.current = true;
    if (JSON.stringify(v ?? null) !== JSON.stringify(record[field.key] ?? null)) onStage(v);
    onDone();
  };
  // One click: the cell click opened the editor — open its dropdown / calendar (or focus the input) right away
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    const trigger = el?.querySelector<HTMLElement>('.select-menu-trigger, .date-trigger');
    if (trigger) trigger.click();
    else el?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);
  return (
    <div
      ref={boxRef}
      className={cx('inline-editor', field.type === 'master' && `is-pill tone-${masterValue(field.master!, value)?.tone ?? 'neutral'}`, field.type === 'master' && ['status', 'priority', 'urgency'].includes(field.key) && 'is-status', (field.type === 'relation' || field.type === 'date') && 'is-pill-plain')}
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
        compact
      />
    </div>
  );
}

/** Responsive / mobile row variant: deliberate card list instead of a squeezed table. */
function CardList({ res, actor, rows, onOpen, activeId, columns, selected, onSelectedChange }: GridProps) {
  const CardActions = getCardActions(res.key);
  const { move, dialog } = useStageMove(res, actor);
  const access = fieldAccessMap(actor, res);
  const extra = columns.filter((c) => !c.hidden && c.key !== res.titleField && c.key !== 'id' && access[c.key] && access[c.key] !== 'hide').slice(0, 3);
  return (
    <>
      <ul className="card-list" aria-label={LS.listAria(res.labelPlural)}>
        {rows.map((r) => (
          <li key={r.id} className={cx('card-row', activeId === r.id && 'is-active')}>
            <Checkbox
              
              aria-label={LS.selectRow(r.id)}
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
            {(CardActions || res.lifecycle) && (
              <div className="mobile-card-actions">
                {res.lifecycle && canUpdateRecord(actor, res, r) && <StatusCellMenu res={res} actor={actor} record={r} move={move} />}
                {CardActions && <CardActions res={res} actor={actor} record={r} />}
              </div>
            )}
          </li>
        ))}
      </ul>
      {dialog}
    </>
  );
}

export function fieldWidth(res: ResourceDefinition, key: string) {
  if (key === 'id') return 176; // ID link + copy button fit our longer IDs (e.g. LD-2627-0001) without truncating
  const f = res.fields.find((x) => x.key === key);
  if (!f) return DEFAULT_W;
  if (f.width) return f.width;
  if (f.type === 'date') return 140;
  if (f.type === 'email') return 330; // whole masked email + icons fit
  if (f.type === 'phone') return 220; // calendar icon + "19 Oct, 2026"
  if (f.type === 'money' || f.type === 'number') return 120;
  if (f.type === 'datetime') return 170;
  return DEFAULT_W;
}
