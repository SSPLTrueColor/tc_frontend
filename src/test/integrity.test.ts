/** Cross-module integrity of the merged domain pack and the full demo seed. */
import { appModules, appPack, appRoles } from '../domain/pack';
import { createDb } from '../services/db';

const db = createDb(new Date('2026-10-19T10:00:00'));
const resKeys = new Set(appPack.resources.map((r) => r.key));
const masterKeys = new Set(appPack.masters.map((m) => m.key));

describe('domain pack integrity', () => {
  it('has unique resource and master keys', () => {
    const dupR = appPack.resources.map((r) => r.key).filter((k, i, a) => a.indexOf(k) !== i);
    const dupM = appPack.masters.map((m) => m.key).filter((k, i, a) => a.indexOf(k) !== i);
    expect(dupR).toEqual([]);
    expect(dupM).toEqual([]);
  });

  it('references only existing resources and masters', () => {
    const bad: string[] = [];
    appPack.resources.forEach((r) =>
      r.fields.forEach((f) => {
        if (f.relation && !resKeys.has(f.relation.resource)) bad.push(`${r.key}.${f.key} → ${f.relation.resource}`);
        if (f.master && !masterKeys.has(f.master)) bad.push(`${r.key}.${f.key} master ${f.master}`);
      }),
    );
    appModules.forEach((m) => m.resources.forEach((k) => !resKeys.has(k) && bad.push(`nav ${m.id} → ${k}`)));
    appRoles.forEach((role) => Object.keys(role.resources).forEach((k) => !resKeys.has(k) && bad.push(`role ${role.id} → ${k}`)));
    expect(bad).toEqual([]);
  });

  it('every resource is reachable from navigation', () => {
    // A module page with the same path as a resource (e.g. /attendance "My day") replaces its list by design.
    const navRes = new Set([...appModules.flatMap((m) => m.resources), ...appModules.flatMap((m) => (m.pages ?? []).map((p) => p.path))]);
    expect(appPack.resources.map((r) => r.key).filter((k) => !navRes.has(k))).toEqual([]);
  });
});

describe('seed integrity', () => {
  it('relations point at existing records', () => {
    const ids = new Map(Object.entries(db.records).map(([k, rows]) => [k, new Set(rows.map((r) => r.id))]));
    const bad: string[] = [];
    appPack.resources.forEach((r) =>
      r.fields
        .filter((f) => f.type === 'relation' && f.relation)
        .forEach((f) =>
          (db.records[r.key] ?? []).forEach((row) => {
            const v = row[f.key];
            if (v && !ids.get(f.relation!.resource)?.has(String(v))) bad.push(`${r.key}/${row.id}.${f.key}=${v}`);
          }),
        ),
    );
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('master values in seed exist', () => {
    const masters = new Map(appPack.masters.map((m) => [m.key, new Set(m.values.map((v) => v.key))]));
    const bad: string[] = [];
    appPack.resources.forEach((r) =>
      r.fields
        .filter((f) => f.master)
        .forEach((f) =>
          (db.records[r.key] ?? []).forEach((row) => {
            const v = row[f.key];
            const vals = Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v];
            vals.forEach((x) => !masters.get(f.master!)?.has(String(x)) && bad.push(`${r.key}/${row.id}.${f.key}=${x}`));
          }),
        ),
    );
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('qualified leads link to an opportunity', () => {
    const q = (db.records.leads ?? []).filter((l) => l.status === 'qualified');
    expect(q.filter((l) => !l.opportunityId).map((l) => l.id)).toEqual([]);
  });

  it('fits comfortably in localStorage', () => {
    const mb = JSON.stringify(db).length / 1024 / 1024;
    console.log(`seed size ${mb.toFixed(2)} MB; records`, Object.fromEntries(Object.entries(db.records).map(([k, v]) => [k, v.length])));
    expect(mb).toBeLessThan(4);
  });
});

describe('seed plausibility', () => {
  it('machine lines are never sold in bulk', () => {
    const machines = new Set((db.records.products ?? []).filter((p) => p.productType === 'machine').map((p) => p.id));
    const bad = [...(db.records.quotations ?? []), ...(db.records.salesOrders ?? [])].flatMap((q) =>
      ((q.lines as { productId: string; qty: number }[] | undefined) ?? []).filter((l) => machines.has(l.productId) && l.qty > 3).map((l) => `${q.id}:${l.qty}`),
    );
    expect(bad).toEqual([]);
  });
});
