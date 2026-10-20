import { useState } from 'react';
import type { RecordData, ResourceDefinition } from '../../metadata/types';
import { cx } from '../../lib/format';
import { type Actor, fieldAccessMap } from '../../services/authz';
import { activeMasterValues, getMaster } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { Button } from '../primitives/Button';
import { StatusChip } from '../primitives/feedback';
import { useStageMove } from './MoveStageButton';
import { FieldValue, photoOf } from './FieldValue';
import { ImageTile } from '../primitives/People';
import { getCardActions } from './extensions';
import { L } from '../../constants/labels';

/** Board: columns are lifecycle states; moves go through the same guarded transition API. */
/** Cards drawn per column before "Show more": a board with thousands of records stays fast. */
const CARDS_PER_COLUMN = 40;

export function BoardView({ res, actor, rows, boardField, cardFields, onOpen, activeId }: { res: ResourceDefinition; actor: Actor; rows: RecordData[]; boardField: string; cardFields: string[]; onOpen: (id: string) => void; activeId?: string }) {
  const CardActions = getCardActions(res.key);
  const field = res.fields.find((f) => f.key === boardField)!;
  const values = getMaster(field.master!).values.filter((v) => v.active).sort((a, b) => a.order - b.order);
  const access = fieldAccessMap(actor, res);
  const [dragId, setDragId] = useState<string | null>(null);
  const [cap, setCap] = useState<Record<string, number>>({});
  const [over, setOver] = useState<string | null>(null);

  // Drag a card to another column = change status; statuses that need details open their dialog (useStageMove).
  const { move, dialog } = useStageMove(res, actor);

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
              {items.slice(0, cap[col.key] ?? CARDS_PER_COLUMN).map((r) => (
                <li
                  key={r.id}
                  className={cx('board-card', `tone-${col.tone ?? 'neutral'}`, activeId === r.id && 'is-active')}
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
                          // FieldValue already draws the field's icon; the card only adds a label tooltip and truncation.
                          return (
                            <span key={k} className={cx('card-field', `is-${f.type}`)} data-tooltip={f.label}>
                              <FieldValue field={f} value={r[k]} access={access[k]} actor={actor} linkRelations={false} />
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </button>
                  {CardActions && (
                    <div className="board-card-actions">
                      <CardActions res={res} actor={actor} record={r} surface="board" />
                    </div>
                  )}
                </li>
              ))}
              {!items.length && <li className="board-empty muted">{L.common.list.nothingHere}</li>}
              {items.length > (cap[col.key] ?? CARDS_PER_COLUMN) && (
                <li className="board-more">
                  <Button onClick={() => setCap((c) => ({ ...c, [col.key]: (c[col.key] ?? CARDS_PER_COLUMN) + CARDS_PER_COLUMN }))}>{L.common.list.showMore(Math.min(CARDS_PER_COLUMN, items.length - (cap[col.key] ?? CARDS_PER_COLUMN)))}</Button>
                </li>
              )}
            </ul>
            <footer className="board-col-foot muted">
              {items.length} {items.length === 1 ? res.label.toLowerCase() : res.labelPlural.toLowerCase()}
            </footer>
          </section>
        );
      })}
      {!activeMasterValues(field.master!).length && <p className="muted">{L.common.list.noActiveStatuses}</p>}
      {dialog}
    </div>
  );
}
