import type { FieldDefinition } from '../../metadata/types';
import { getResource } from '../../services/registry';

/** One consistent icon per field type (form rows in canvas layout, menus). */
export function fieldIcon(f?: FieldDefinition): string {
  if (!f) return 'f-id';
  if (f.type === 'relation') {
    const t = f.relation?.resource;
    if (t === 'staff' || t === 'patients' || f.display === 'person') return 'f-person';
    return getResource(t!).icon ?? 'f-relation'; // e.g. appointments → calendar
  }
  if (f.key === 'payer') return 'id-card';
  if (f.type === 'master') return ['status', 'priority', 'urgency'].includes(f.key) ? 'f-status' : 'f-tags';
  const map: Record<string, string> = { text: 'f-text', longtext: 'f-longtext', email: 'f-email', phone: 'f-phone', identifier: 'f-id', number: 'f-id', money: 'f-money', date: 'f-date', datetime: 'f-datetime', boolean: 'f-boolean', multimaster: 'f-tags', progress: 'f-progress', lineitems: 'f-items', image: 'f-image', people: 'f-people' };
  return map[f.type] ?? 'f-text';
}

