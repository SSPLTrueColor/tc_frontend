import { useRef, useState } from 'react';
import type { RecordData, ResourceDefinition } from '../../metadata/types';
import { cx } from '../../lib/format';
import { type Actor, fieldAccessMap } from '../../services/authz';
import { activeMasterValues, getMaster } from '../../services/registry';
import { availableTransitions, recordTitle, transitionRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { IconButton } from '../primitives/Button';
import { StatusChip, useToast } from '../primitives/feedback';
import { Menu } from '../primitives/overlay';
import { FieldValue } from './FieldValue';

/** Board: columns are lifecycle states; moves go through the same guarded transition API. */
export function BoardView({ res, actor, rows, boardField, cardFields, onOpen, activeId }: { res: ResourceDefinition; actor: Actor; rows: RecordData[]; boardField: string; cardFields: string[]; onOpen: (id: string) => void; activeId?: string }) {
  const field = res.fields.find((f) => f.key === boardField)!;
  const values = getMaster(field.master!).values.filter((v) => v.active).sort((a, b) => a.order - b.order);
  const access = fieldAccessMap(actor, res);
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<RecordData | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  const move = (r: RecordData, to: string) => {
    if (r[boardField] === to) return;
    const t = availableTransitions(actor, res, r).find((x) => x.to === to);
    if (!t) {
      toast(`Cannot move ${r.id} directly to "${values.find((v) => v.key === to)?.label}" — not an allowed step.`, 'danger');
      return;
    }
    if (t.disabledReason) {
      toast(t.disabledReason, 'danger');
      return;
    }
    if (t.confirm && !window.confirm(t.confirm)) return;
    try {
      transitionRecord(actor, res.key, r.id, to, r.version);
      toast(`${r.id}: ${t.action}`);
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : 'Move failed', 'danger');
    }
  };

  const shownFields = cardFields.filter((k) => k !== boardField && k !== res.titleField && access[k] && access[k] !== 'hide').slice(0, 4);

  return (
    <div className="board" aria-label={`${res.labelPlural} board`}>
      {values.map((col) => {
        const items = rows.filter((r) => r[boardField] === col.key);
        return (
          <section
            key={col.key}
            className={cx('board-col', over === col.key && 'is-over')}
            aria-label={`${col.label}, ${items.length} items`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const r = rows.find((x) => x.id === dragId);
              if (r) move(r, col.key);
            }}
          >
            <header className="board-col-head">
              <StatusChip label={col.label} tone={col.tone} />
              <span className="muted">{items.length}</span>
            </header>
            <ul className="board-cards">
              {items.map((r) => (
                <li
                  key={r.id}
                  className={cx('board-card', activeId === r.id && 'is-active')}
                  draggable
                  onDragStart={() => setDragId(r.id)}
                  onDragEnd={() => setDragId(null)}
                >
                  <button type="button" className="board-card-main" onClick={() => onOpen(r.id)}>
                    <span className="card-title">{recordTitle(res.key, r.id, actor)}</span>
                    <span className="mono muted">{r.id}</span>
                    {shownFields.map((k) => {
                      const f = res.fields.find((x) => x.key === k)!;
                      return (
                        <span key={k} className="card-field">
                          <FieldValue field={f} value={r[k]} access={access[k]} actor={actor} linkRelations={false} />
                        </span>
                      );
                    })}
                  </button>
                  <IconButton
                    icon="more"
                    label={`Move ${r.id}`}
                    aria-haspopup="menu"
                    className="board-card-menu"
                    onClick={(e) => {
                      anchor.current = e.currentTarget;
                      setMenu(r);
                    }}
                  />
                </li>
              ))}
              {!items.length && <li className="board-empty muted">Nothing here</li>}
            </ul>
          </section>
        );
      })}
      {menu && (
        <Menu
          open
          onClose={() => setMenu(null)}
          anchor={anchor}
          label={`Move ${menu.id}`}
          items={
            availableTransitions(actor, res, menu).length
              ? availableTransitions(actor, res, menu).map((t) => ({ id: t.to, label: t.action, icon: 'chevron-right', disabledReason: t.disabledReason, onSelect: () => move(menu, t.to) }))
              : [{ id: 'none', label: 'No further steps', onSelect: () => {}, disabledReason: 'This item is in a final state' }]
          }
        />
      )}
      {!activeMasterValues(field.master!).length && <p className="muted">No active statuses configured.</p>}
    </div>
  );
}
