/**
 * Typed cell renderer registry. One renderer per field type, used by grid,
 * board cards, inspector details and related lists — permission-aware.
 */
import { Link } from 'react-router-dom';
import type { FieldAccess, FieldDefinition, MasterValue } from '../../metadata/types';
import { todayKey } from '../../lib/dates';
import { cx, formatMoney, pct } from '../../lib/format';
import { RESTRICTED } from '../../lib/phiMask';
import { recordPeekPath } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { canReadResource } from '../../services/authz';
import { getDb } from '../../services/db';
import { getResource, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { isEmpty } from '../../services/validation';
import { Icon } from '../primitives/Icon';
import { MaskedField, StatusChip } from '../primitives/feedback';
import { DateText, EmptyValue } from '../primitives/display';
import { OverflowChips } from '../primitives/OverflowChips';
import { AvatarStack, ImageTile, PersonChip } from '../primitives/People';

/** Subtitle of a related person (e.g. their role), from `personSubtitle`. */
export function personSubtitle(field: FieldDefinition, resource: string, id: unknown): string | undefined {
  if (!field.personSubtitle) return undefined;
  const row = getDb().records[resource]?.find((r) => r.id === id);
  const f = getResource(resource).fields.find((x) => x.key === field.personSubtitle);
  if (!row || !f) return undefined;
  return f.master ? masterValue(f.master, row[f.key])?.label : String(row[f.key] ?? '');
}

/** Photo of a related record (e.g. a staff member) when the target resource has an image field. */
export function photoOf(resource: string, id: unknown): string | null {
  const row = getDb().records[resource]?.find((r) => r.id === id);
  return (row?.photo as string | undefined) ?? null;
}

const STATUS_LIKE = new Set(['status', 'urgency', 'priority']);

export function MasterChip({ master, value, plain }: { master: string; value: unknown; plain?: boolean }) {
  const mv: MasterValue | undefined = masterValue(master, value);
  if (!mv) return isEmpty(value) ? <EmptyValue /> : <span>{String(value)}</span>;
  const label = mv.active ? mv.label : `${mv.label} (inactive)`;
  if (plain) return <span>{label}</span>;
  return <StatusChip label={label} tone={mv.tone ?? 'neutral'} />;
}

export function FieldValue({
  field,
  value,
  access,
  actor,
  linkRelations = true,
  rich = false,
}: {
  field: FieldDefinition;
  value: unknown;
  access: FieldAccess;
  actor: Actor;
  linkRelations?: boolean;
  /** Multi-line (rich) views: people show as avatar + name (+ subtitle). */
  rich?: boolean;
}) {
  if (access === 'hide') return null;
  // Contact data follows the phi-masking contract: masked by default; Eye reveal only when granted.
  if (field.type === 'phone' || field.type === 'email') {
    return <MaskedField value={value} type={field.type} canReveal={access === 'edit' || access === 'view'} />;
  }
  if (access === 'mask') {
    if (isEmpty(value)) return <EmptyValue />;
    return (
      <span className="restricted" data-tooltip="Restricted for your role">
        <Icon name="lock" size={12} />
        {value === RESTRICTED ? 'Restricted' : String(value)}
      </span>
    );
  }
  if (isEmpty(value) && field.type !== 'progress' && field.type !== 'boolean') return <EmptyValue />;

  switch (field.type) {
    case 'master':
      return <MasterChip master={field.master!} value={value} plain={!STATUS_LIKE.has(field.key) && masterValue(field.master!, value)?.tone === 'neutral'} />;
    case 'multimaster':
      return <OverflowChips items={(value as string[]).map((k) => masterValue(field.master!, k)?.label ?? k)} label={field.label} />;
    case 'relation': {
      const target = field.relation!.resource;
      const title = recordTitle(target, value, actor);
      const exists = getDb().records[target]?.some((r) => r.id === value);
      const body = rich && field.display === 'person' ? <PersonChip name={title} src={photoOf(target, value)} subtitle={personSubtitle(field, target, value)} /> : title;
      if (!linkRelations || !exists || !canReadResource(actor, target)) return <span>{body}</span>;
      return (
        <Link className="rel-link" to={recordPeekPath(actor.workspaceId, target, String(value))} onClick={(e) => e.stopPropagation()}>
          {body}
        </Link>
      );
    }
    case 'people': {
      const target = field.relation!.resource;
      const ids = value as string[];
      return <AvatarStack people={ids.map((id) => ({ name: recordTitle(target, id, actor), src: photoOf(target, id), subtitle: personSubtitle(field, target, id) }))} label={field.label} />;
    }
    case 'image':
      return <ImageTile src={String(value)} name={field.label} size={32} />;
    case 'date': {
      const overdue = /due|bookBy/i.test(field.key + field.label) && String(value) < todayKey();
      return (
        <span className={cx('date-cell', overdue && 'text-danger')}>
          <DateText value={String(value)} />
          {overdue && <span className="sr-only"> (overdue)</span>}
          {overdue && <Icon name="alert" size={12} className="inline-icon" />}
        </span>
      );
    }
    case 'datetime':
      return <DateText value={String(value)} showTime />;
    case 'money':
      return <span className="num">{formatMoney(Number(value))}</span>;
    case 'number':
      return (
        <span className="num">
          {String(value)}
          {field.unit && <span className="muted"> {field.unit}</span>}
        </span>
      );
    case 'progress': {
      const n = Math.max(0, Math.min(1, Number(value) || 0));
      return (
        <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(n * 100)} aria-label={field.label}>
          <span className="meter-track">
            <span className="meter-fill" style={{ width: `${n * 100}%` }} />
          </span>
          <span className="meter-text">{pct(n)}</span>
        </span>
      );
    }
    case 'boolean':
      return (
        <span className="bool">
          <Icon name={value ? 'check' : 'x'} size={14} />
          {value ? 'Yes' : 'No'}
        </span>
      );
    case 'identifier':
      return <span className="mono">{String(value)}</span>;
    case 'lineitems':
      return <span>{(value as unknown[]).length} item(s)</span>;
    case 'longtext':
      return <span className="clamp-2">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}
