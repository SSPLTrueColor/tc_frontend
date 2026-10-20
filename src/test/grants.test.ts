import { addDays, todayKey } from '../lib/dates';
import { actorFor, can, canReadResource } from '../services/authz';
import { addGrant, changeRole, extendGrant, getPerson, explainAccess, listActiveGrants, previewRoleChange, revokeGrant, validateGrant, type GrantInput } from '../services/catalog/grants';
import { __setDb, createDb, getDb } from '../services/db';

const admin = () => actorFor('u_rahul', 'tc');
const karan = () => actorFor('u_karan', 'tc'); // Sales Executive, Textile
const input = (over: Partial<GrantInput> = {}): GrantInput => ({ userId: 'u_karan', kind: 'area', module: 'spares', level: 'view', scope: 'division', expiresAt: addDays(todayKey(), 30), reason: 'Covering for the service desk', ...over });

describe('extra access for one person', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-19T10:00:00'))));

  it('adds to the role and takes nothing away', () => {
    expect(canReadResource(karan(), 'spareParts')).toBe(false);
    addGrant(admin(), input());
    expect(canReadResource(karan(), 'spareParts')).toBe(true);
    expect(canReadResource(karan(), 'leads')).toBe(true);
    expect(karan().extras?.length).toBe(1);
  });

  it('a capability grant adds the capability', () => {
    expect(can(karan(), 'approve.l2')).toBe(false);
    addGrant(admin(), input({ kind: 'capability', capability: 'approve.l2', module: undefined, level: undefined }));
    expect(can(karan(), 'approve.l2')).toBe(true);
  });

  it('stops working after its end date and after removal', () => {
    const g = addGrant(admin(), input());
    __setDbShift(g.id, addDays(todayKey(), -1));
    expect(canReadResource(karan(), 'spareParts')).toBe(false);
    const g2 = addGrant(admin(), input({ module: 'service' }));
    expect(canReadResource(karan(), 'serviceVisits')).toBe(true);
    revokeGrant(admin(), g2.id);
    expect(canReadResource(karan(), 'serviceVisits')).toBe(false);
  });

  it('needs an end date within 180 days and a real reason', () => {
    expect(validateGrant(input({ expiresAt: '' })).expiresAt).toBeTruthy();
    expect(validateGrant(input({ expiresAt: todayKey() })).expiresAt).toBeTruthy();
    expect(validateGrant(input({ expiresAt: addDays(todayKey(), 181) })).expiresAt).toBeTruthy();
    expect(validateGrant(input({ expiresAt: addDays(todayKey(), 180) })).expiresAt).toBeUndefined();
    for (const r of ['', '   ', 'abc', '!!!!!!', '😀😀😀😀😀', 'x'.repeat(201)]) expect(validateGrant(input({ reason: r })).reason, r).toBeTruthy();
  });

  it('rejects duplicates, administrators and non-administrators granting', () => {
    addGrant(admin(), input());
    expect(() => addGrant(admin(), input())).toThrow();
    expect(validateGrant(input({ userId: 'u_rahul' })).userId).toBeTruthy();
    expect(() => addGrant(actorFor('u_vikram', 'tc'), input({ module: 'service' }))).toThrow();
  });

  it('extend is capped at 180 days from today', () => {
    const g = addGrant(admin(), input({ expiresAt: addDays(todayKey(), 170) }));
    expect(extendGrant(admin(), g.id, 30)).toBe(addDays(todayKey(), 180));
    expect(() => extendGrant(admin(), g.id, 30)).toThrow();
  });

  it('writes every change to the audit trail', () => {
    const g = addGrant(admin(), input());
    extendGrant(admin(), g.id, 7);
    revokeGrant(admin(), g.id);
    const kinds = getDb().audit.map((a) => a.action);
    expect(kinds).toEqual(expect.arrayContaining(['access.grant', 'access.extend', 'access.revoke']));
    expect(listActiveGrants(admin(), 'u_karan')).toHaveLength(0);
  });

  it('shows extra access as such and explains why a screen is open or closed', () => {
    expect(explainAccess(admin(), 'u_karan', 'spareParts').allowed).toBe(false);
    addGrant(admin(), input());
    const why = explainAccess(admin(), 'u_karan', 'spareParts');
    expect(why.allowed).toBe(true);
    expect(why.fromExtra).toBe(true);
    expect(getPerson(admin(), 'u_karan').areas.find((a) => a.module === 'spares')?.extra).toBe(true);
  });

  it('changing role follows the new role, keeps extra access, never touches administrators', () => {
    addGrant(admin(), input());
    const diff = previewRoleChange(admin(), 'u_karan', 'sales_manager');
    expect(diff.gains.length + diff.changes.length).toBeGreaterThan(0);
    changeRole(admin(), 'u_karan', 'sales_manager');
    expect(karan().role.id).toBe('sales_manager');
    expect(karan().extras?.length).toBe(1);
    expect(() => changeRole(admin(), 'u_rahul', 'sales_manager')).toThrow();
    expect(() => changeRole(admin(), 'u_karan', 'admin')).toThrow();
  });
});

/** Moves a grant's end date in the stored data (the clock itself is not touched). */
function __setDbShift(id: string, expiresAt: string) {
  getDb().accessGrants = (getDb().accessGrants ?? []).map((g) => (g.id === id ? { ...g, expiresAt } : g));
}
