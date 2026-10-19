import '../domain/extensions/index';
import { L } from '../constants/labels';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { masterValue } from '../services/registry';
import { filterArticles, searchArticles, type KbRow } from '../services/service/kb';
import { filterPm, pmSchedule, type PmRow } from '../services/service/pm';
import { escalationRole } from '../services/service/tickets';

const kb = (id: string, x: Partial<KbRow>): KbRow => ({ id, workspaceId: 'tc', version: 1, createdAt: '', updatedAt: '', title: '', models: '', errorCodes: '', symptoms: '', solution: '', category: 'other', status: 'published', authorName: '', ...x }) as KbRow;
const pm = (id: string, x: Partial<PmRow>): PmRow => ({ id, workspaceId: 'tc', version: 1, createdAt: '', updatedAt: '', status: 'due', dueDate: '2026-11-01', machineLabel: '', model: '', customerLabel: '', ...x }) as PmRow;

describe('Knowledge Base list (SRV-16)', () => {
  const rows = [
    kb('KB-1', { title: 'Missing nozzles', models: 'TX-1800, TX-3200', errorCodes: 'E-201', category: 'print_head', updatedAt: '2026-10-01' }),
    kb('KB-2', { title: 'Banding on prints', models: 'TX-1800', errorCodes: 'B-01', category: 'print_quality', updatedAt: '2026-10-10' }),
    kb('KB-3', { title: 'Cutter blade', models: 'POD-640', errorCodes: 'P-120', category: 'mechanical', status: 'draft', updatedAt: '2026-09-01' }),
  ];

  it('searches every word across model, error code and text', () => {
    expect(filterArticles(rows, { q: 'tx-1800' }).total).toBe(2);
    expect(filterArticles(rows, { q: 'tx-3200 E-201' }).rows.map((r) => r.id)).toEqual(['KB-1']);
    expect(filterArticles(rows, { q: 'nothing-like-this' }).total).toBe(0);
  });

  it('filters by category and status, sorts and pages', () => {
    expect(filterArticles(rows, { category: 'mechanical' }).rows.map((r) => r.id)).toEqual(['KB-3']);
    expect(filterArticles(rows, { status: 'published' }).total).toBe(2);
    expect(filterArticles(rows, { sort: 'updated' }).rows[0].id).toBe('KB-2');
    expect(filterArticles(rows, { sort: 'title' }).rows[0].id).toBe('KB-2');
    const p = filterArticles(rows, { size: 2, page: 5 });
    expect(p.page).toBe(1);
    expect(p.rows).toHaveLength(1);
  });

  it('hides drafts from other service engineers but shows them to Service Leadership', () => {
    __setDb(createDb(new Date('2026-10-19T10:00:00')));
    const head = actorFor('u_manoj', 'tc');
    const all = searchArticles(head, { size: 500 });
    expect(all.rows.some((a) => a.status !== 'published')).toBe(true);
    const eng = actorFor('u_ravi', 'tc');
    const seen = searchArticles(eng, { size: 500 }).rows;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((a) => a.status === 'published' || a.authorId === eng.staffId)).toBe(true);
    expect(getDb().records.knowledgeArticles.length).toBeGreaterThanOrEqual(seen.length);
  });
});

describe('PM Schedule list (SRV-11)', () => {
  const rows = [
    pm('PMV-1', { status: 'due', dueDate: '2026-11-05', customerLabel: 'Zeta Prints', engineerId: 'E1', divisionId: 'TX', machineLabel: 'TX18-001' }),
    pm('PMV-2', { status: 'overdue', dueDate: '2026-10-01', customerLabel: 'Alpha Textiles', divisionId: 'POD' }),
    pm('PMV-3', { status: 'done', dueDate: '2026-09-01', customerLabel: 'Beta Labels', engineerId: 'E2', divisionId: 'LBL' }),
  ];

  it('filters by tab, service engineer (incl. unassigned), division and search', () => {
    expect(filterPm(rows, { tab: 'all' })).toHaveLength(3);
    expect(filterPm(rows, { tab: 'due' }).map((p) => p.id)).toEqual(['PMV-1']);
    expect(filterPm(rows, { tab: 'all', engineerId: '__none' }).map((p) => p.id)).toEqual(['PMV-2']);
    expect(filterPm(rows, { tab: 'all', divisionId: 'LBL' }).map((p) => p.id)).toEqual(['PMV-3']);
    expect(filterPm(rows, { tab: 'all', q: 'tx18' }).map((p) => p.id)).toEqual(['PMV-1']);
  });

  it('sorts by due date or customer', () => {
    expect(filterPm(rows, { tab: 'all' }).map((p) => p.id)).toEqual(['PMV-3', 'PMV-2', 'PMV-1']);
    expect(filterPm(rows, { tab: 'all', sort: 'due_desc' })[0].id).toBe('PMV-1');
    expect(filterPm(rows, { tab: 'all', sort: 'customer' })[0].id).toBe('PMV-2');
  });

  it('loads the seeded schedule with labelled rows', () => {
    __setDb(createDb(new Date('2026-10-19T10:00:00')));
    const rowsSeeded = pmSchedule(actorFor('u_manoj', 'tc'));
    expect(rowsSeeded.every((r) => typeof r.customerLabel === 'string')).toBe(true);
  });
});

describe('Service labels (GLOSSARY)', () => {
  it('uses BRD values and role names', () => {
    __setDb(createDb(new Date('2026-10-19T10:00:00')));
    expect(masterValue('pmStatus', 'done')?.label).toBe('Completed');
    expect(masterValue('ticketStatus', 'waiting_parts')?.label).toBe('Waiting for Parts');
    expect(masterValue('ticketChannel', 'email')?.label).toBe('Email-to-Ticket');
    expect(masterValue('visitType', 'site')?.label).toBe('Site Visit');
    expect(escalationRole(1)).toBe(L.roles.escalationLevels[1]);
    expect(escalationRole(4)).toBe('MD');
  });
});
