import { beforeEach, describe, expect, it } from 'vitest';
import { actorFor } from '../services/authz';
import { __setDb, createDb } from '../services/db';
import { getSettings, toggleFavorite } from '../services/settings';

describe('sidebar favourites', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-16T09:00:00'))));
  it('starring an option adds it to Favorites; starring again removes it', () => {
    const actor = actorFor('u_morgan', 'riverside');
    const entry = { label: 'Front desk flow', path: '/x?view=v1', icon: 'board' };
    toggleFavorite(actor, entry);
    expect(getSettings('u_morgan').favorites).toEqual([entry]);
    toggleFavorite(actor, entry);
    expect(getSettings('u_morgan').favorites).toEqual([]);
  });
});
