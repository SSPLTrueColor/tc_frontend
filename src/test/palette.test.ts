import { beforeEach, describe, expect, it } from 'vitest';
import { applyPalette, contrast, derivePalette, findPalette, PRESET_PALETTES } from '../lib/palette';
import { actorFor } from '../services/authz';
import { __setDb, createDb } from '../services/db';
import { deleteCustomPalette, getSettings, saveCustomPalette } from '../services/settings';

describe('theme changer', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-16T09:00:00'))));

  it('every preset keeps text readable (AA 4.5:1) on buttons, links and the rail', () => {
    for (const p of PRESET_PALETTES) {
      const d = derivePalette(p);
      expect(contrast(d.onAccent, d.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(d.accentTextLight, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(d.railIcon, d.rail)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('a very light custom accent switches the button text to dark', () => {
    const d = derivePalette({ id: 'x', name: 'Lemon', accent: '#ffe066', sidebar: '#ffffff', rail: '#222222' });
    expect(d.onAccent).not.toBe('#ffffff');
    expect(contrast(d.accentTextLight, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('custom palettes are saved, applied, edited and deleted per user', () => {
    const actor = actorFor('u_rahul', 'tc');
    const id = saveCustomPalette(actor, { name: 'Clinic teal', accent: '#0f766e', sidebar: '#f3faf9', rail: '#13201f' });
    expect(getSettings('u_rahul').palette).toBe(id);
    saveCustomPalette(actor, { id, name: 'Teal 2', accent: '#0f766e', sidebar: '#f3faf9', rail: '#13201f' });
    expect(getSettings('u_rahul').customPalettes.map((p) => p.name)).toEqual(['Teal 2']);
    deleteCustomPalette(actor, id);
    expect(getSettings('u_rahul').customPalettes).toEqual([]);
    expect(getSettings('u_rahul').palette).toBe('violet');
  });

  it('the default palette applies no overrides; others set CSS variables', () => {
    applyPalette(findPalette('ocean', []));
    expect(document.documentElement.getAttribute('data-palette')).toBe('ocean');
    expect(document.documentElement.style.getPropertyValue('--pal-accent')).toBe('#1f5fd6');
    applyPalette(findPalette('violet', []));
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false);
  });
});
