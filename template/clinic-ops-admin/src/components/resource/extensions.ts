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
export const getRecordActions = (resource: string) => recordActions.get(resource);
export const getRecordBanner = (resource: string) => recordBanners.get(resource);
