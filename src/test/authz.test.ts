import { actorFor, canReadRecord } from '../services/authz';
import { createDb, __setDb } from '../services/db';
import { getResource } from '../services/registry';
import { queryRecords } from '../services/runtime';

describe('hierarchy row scopes', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('derives the team from reporting lines (transitively)', () => {
    const suresh = actorFor('u_suresh', 'tc'); // GM Textile → Rohan → Karan; Pooja; Nisha; Tanvi
    const ids = ['u_rohan', 'u_karan', 'u_pooja'].map((u) => actorFor(u, 'tc').staffId);
    ids.forEach((id) => expect(suresh.teamStaffIds).toContain(id));
    expect(suresh.teamStaffIds).not.toContain(actorFor('u_neha', 'tc').staffId);
  });

  it('sales executive sees only own tasks; manager sees the team; division head the division', () => {
    const res = getResource('tasks');
    const karan = actorFor('u_karan', 'tc');
    const rohan = actorFor('u_rohan', 'tc');
    const kavita = actorFor('u_kavita', 'tc'); // Paper division head
    const mine = queryRecords(karan, 'tasks').rows;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t) => t.assigneeId === karan.staffId)).toBe(true);
    const team = queryRecords(rohan, 'tasks').rows;
    expect(team.some((t) => t.assigneeId === karan.staffId)).toBe(true);
    const karanTask = mine[0];
    expect(canReadRecord(kavita, res, karanTask)).toBe(false); // Textile task, Paper head
    expect(canReadRecord(actorFor('u_suresh', 'tc'), res, karanTask)).toBe(true);
  });
});
