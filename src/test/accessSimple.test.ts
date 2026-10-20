import { describe, expect, it } from 'vitest';
import { appRoles, NO_ACCESS } from '../domain/pack';
import { validateRolePermissions } from '../services/catalog/access';
import { applyLevel, applyScope, levelOf, type Level } from '../modules/catalog/AccessSimple';

const LEVELS: Exclude<Level, 'custom'>[] = ['none', 'view', 'edit', 'full'];
const SCOPES = ['own', 'team', 'division', 'all'] as const;

describe('simple roles view', () => {
  it('every preset at every scope is valid and reads back as the same level', () => {
    for (const l of LEVELS)
      for (const s of SCOPES) {
        const p = applyLevel({ ...NO_ACCESS }, l, s);
        expect(validateRolePermissions({ x: p })).toEqual({});
        expect(levelOf(p)).toBe(l);
      }
  });

  it('changing whose records keeps update within read', () => {
    for (const l of LEVELS)
      for (const from of SCOPES)
        for (const to of SCOPES) {
          const p = applyScope(applyLevel({ ...NO_ACCESS }, l, from), to);
          expect(validateRolePermissions({ x: p })).toEqual({});
        }
  });

  it('classifies every shipped permission without throwing', () => {
    for (const r of appRoles) for (const p of Object.values(r.resources)) expect(['none', 'view', 'edit', 'full', 'custom']).toContain(levelOf(p));
  });
});
