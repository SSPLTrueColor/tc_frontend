import type { ResourceDefinition } from '../../metadata/types';
import { activities, employees, tasks } from './core';

/** Every published resource. Modules add their definitions here as they are built (REQUIREMENTS §8). */
export const appResources: ResourceDefinition[] = [tasks, activities, employees];
