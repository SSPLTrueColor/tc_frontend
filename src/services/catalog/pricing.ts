/** Price list rules (FR-039, BR-15): one active price per product per date across a division's lists. */
import { L } from '../../constants/labels';
import type { RecordData } from '../../metadata/types';
import type { Actor } from '../authz';
import { perm } from '../authz';
import { ServiceError } from '../types';

type Store = Record<string, RecordData[]>;

const overlaps = (a: RecordData, b: RecordData) => String(a.validFrom) <= String(b.validTo) && String(b.validFrom) <= String(a.validTo);

/**
 * Another ACTIVE price list (overlapping validity) already prices this product.
 * `list` is the list the product is being priced on (it may be a draft: then only activation is checked).
 */
export function conflictingPrice(store: Store, list: RecordData, productId: string, ignoreItemId?: string): { item: RecordData; list: RecordData } | null {
  const lists = new Map((store.priceLists ?? []).map((l) => [l.id, l]));
  for (const item of store.priceListItems ?? []) {
    if (item.productId !== productId || item.id === ignoreItemId || item.priceListId === list.id) continue;
    const other = lists.get(String(item.priceListId));
    if (other && other.status === 'active' && overlaps(other, list)) return { item, list: other };
  }
  return null;
}

/** Items on `list` that clash with other active lists — blocks activation. */
export function activationConflicts(store: Store, list: RecordData): string[] {
  return (store.priceListItems ?? [])
    .filter((i) => i.priceListId === list.id)
    .map((i) => {
      const c = conflictingPrice(store, list, String(i.productId), String(i.id));
      return c ? L.catalog.messages.alreadyPriced(String(i.productId), String(c.list.name), c.list.id) : '';
    })
    .filter(Boolean);
}

/** Division heads may only change prices of their own division (QUO-05); others need company-wide update. */
export function assertCanPriceDivision(actor: Actor, divisionId: unknown) {
  const scope = perm(actor, 'priceListItems').update;
  if (scope === 'all') return;
  if (scope === 'division' && actor.divisionIds.includes(String(divisionId))) return;
  throw new ServiceError('forbidden', L.catalog.messages.ownDivisionOnly);
}
