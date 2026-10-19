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
import { FieldValue, photoOf } from './FieldValue';
import { Icon } from '../primitives/Icon';
import { ImageTile } from '../primitives/People';
import { L } from '../../constants/labels';

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
      toast(L.common.list.notAllowedStep(r.id, values.find((v) => v.key === to)?.label ?? to), 'danger');
      return;
    }
    if (t.disabledReason) {
      toast(t.disabledReason, 'danger');
      return;
    }
    if (t.confirm && !window.confirm(t.confirm)) return;
    try {
      transitionRecord(actor, res.key, r.id, to, r.version);
      toast(L.common.toasts.moved(recordTitle(res.key, r.id, actor), values.find((v) => v.key === to)?.label ?? to));
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : L.common.toasts.moveFailed, 'danger');
    }
  };

  const shownFields = cardFields.filter((k) => k !== boardField && k !== res.titleField && access[k] && access[k] !== 'hide').slice(0, 4);
  // The first person (staff relation) becomes the avatar in the card's top-right corner; the rest are meta lines.
  const personKey = shownFields.find((k) => res.fields.find((x) => x.key === k)?.relation?.resource === 'staff');
  const metaFields = shownFields.filter((k) => k !== personKey);

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
                    <span className="card-top">
                      <span className="mono card-id">{r.id}</span>
                      {personKey && r[personKey] != null && access[personKey] !== 'hide' && (
                        <span className="card-person" data-tooltip={recordTitle('staff', r[personKey], actor)}>
                          <ImageTile src={photoOf('staff', r[personKey])} name={recordTitle('staff', r[personKey], actor)} size={24} shape="circle" />
                        </span>
                      )}
                    </span>
                    <span className="card-title">{recordTitle(res.key, r.id, actor).split(' · ')[0]}</span>
                    {metaFields.length > 0 && (
                      <span className="card-meta">
                        {metaFields.map((k) => {
                          const f = res.fields.find((x) => x.key === k)!;
                          const icon = f.type === 'date' || f.type === 'datetime' ? 'calendar' : f.type === 'relation' ? (f.relation?.resource === 'staff' ? 'f-person' : 'f-relation') : undefined;
                          return (
                            <span key={k} className="card-field">
                              {icon && <Icon name={icon} size={14} className="card-field-icon" />}
                              <FieldValue field={f} value={r[k]} access={access[k]} actor={actor} linkRelations={false} />
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </button>
                  <IconButton
                    icon="more"
                    label={L.common.list.moveCard(r.id)}
                    aria-haspopup="menu"
                    className="board-card-menu"
                    onClick={(e) => {
                      anchor.current = e.currentTarget;
                      setMenu((m) => (m?.id === r.id ? null : r)); // click again closes
                    }}
                  />
                </li>
              ))}
              {!items.length && <li className="board-empty muted">{L.common.list.nothingHere}</li>}
            </ul>
            <footer className="board-col-foot muted">
              {items.length} {items.length === 1 ? res.label.toLowerCase() : res.labelPlural.toLowerCase()}
            </footer>
          </section>
        );
      })}
      {menu && (
        <Menu
          open
          onClose={() => setMenu(null)}
          anchor={anchor}
          label={L.common.list.moveCard(menu.id)}
          items={
            availableTransitions(actor, res, menu).length
              ? availableTransitions(actor, res, menu).map((t) => ({ id: t.to, label: t.action, icon: 'chevron-right', disabledReason: t.disabledReason, onSelect: () => move(menu, t.to) }))
              : [{ id: 'none', label: L.common.list.noFurtherSteps, onSelect: () => {}, disabledReason: L.common.list.finalState }]
          }
        />
      )}
      {!activeMasterValues(field.master!).length && <p className="muted">{L.common.list.noActiveStatuses}</p>}
    </div>
  );
}
