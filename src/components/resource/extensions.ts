/**
 * Typed extension registry for domain-specific compound components.
 * Shared components never branch on domain names; packs register here.
 */
import type { ComponentType } from 'react';
import type { RecordData, ResourceDefinition } from '../../metadata/types';
import type { Actor } from '../../services/authz';

export interface RecordExtensionProps {
  res: ResourceDefinition;
  actor: Actor;
  record: RecordData;
}

const recordActions = new Map<string, ComponentType<RecordExtensionProps>>();
const recordBanners = new Map<string, ComponentType<RecordExtensionProps>>();

export function registerRecordActions(resource: string, c: ComponentType<RecordExtensionProps>) {
  recordActions.set(resource, c);
}
export function registerRecordBanner(resource: string, c: ComponentType<RecordExtensionProps>) {
  recordBanners.set(resource, c);
}
/** Tab a record page opens on (e.g. Customer 360° View → Overview); default is Details. */
const defaultTabs = new Map<string, string>();
export function registerDefaultRecordTab(resource: string, tabId: string) {
  defaultTabs.set(resource, tabId);
}
export const getDefaultRecordTab = (resource: string) => defaultTabs.get(resource);
export const getRecordActions = (resource: string) => recordActions.get(resource);
export const getRecordBanner = (resource: string) => recordBanners.get(resource);

/** Extra record tabs (e.g. Customer 360 → Machines, Tickets). Rendered after "Details", in registration order. */
export interface RecordTab {
  id: string;
  label: string;
  component: ComponentType<RecordExtensionProps>;
  /** Position among the extra tabs (lower first); tabs without it keep registration order after ordered ones. */
  order?: number;
  /** Optional badge count. */
  count?: (props: RecordExtensionProps) => number | undefined;
}
const recordTabs = new Map<string, RecordTab[]>();
export function registerRecordTab(resource: string, tab: RecordTab) {
  recordTabs.set(resource, [...(recordTabs.get(resource) ?? []).filter((t) => t.id !== tab.id), tab]);
}
export const getRecordTabs = (resource: string) =>
  (recordTabs.get(resource) ?? [])
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.order ?? Number.MAX_SAFE_INTEGER) - (b.t.order ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map(({ t }) => t);
