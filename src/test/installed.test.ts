import type { RecordData } from '../metadata/types';
import '../domain/extensions/index';
import { actorFor } from '../services/authz';
import { createDb, getDb, __setDb } from '../services/db';
import { addDays, todayKey } from '../lib/dates';
import { createRecord, transitionRecord } from '../services/runtime';
import { moveMachine, planRenewalSweep, prepareRenewalQuotation, renewContract, runRenewalSweep, signOffInstallation, startSignOffOtp } from '../services/installed/logic';
import { getResource, masterLabel } from '../services/registry';
import { recordPagePath, resourcePath } from '../lib/routes';
import { routes as installedRoutes } from '../modules/installed/routes';
import { ROUTES } from '../constants/routes';
import { coverageFor } from '../services/lookups';
import { ServiceError } from '../services/types';

const svc = () => actorFor('u_manoj', 'tc'); // Service Head: installed base, all scopes

function baseInstallation(over: Partial<RecordData> = {}): RecordData {
  const d = getDb();
  const product = d.records.products.find((p) => p.productType === 'machine' && p.status === 'active')!;
  const customer = d.records.customers.find((c) => ((c.divisionIds as string[]) ?? []).includes(String(product.divisionId))) ?? d.records.customers[0];
  const now = new Date().toISOString();
  const r: RecordData = {
    id: `INS-T-${Math.random().toString(36).slice(2, 7)}`,
    workspaceId: 'tc',
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: 'test',
    customerId: customer.id,
    salesOrderId: null,
    productId: product.id,
    divisionId: product.divisionId,
    engineerId: actorFor('u_ravi', 'tc').staffId,
    scheduledAt: `${todayKey()}T10:00`,
    status: 'trial_training',
    rdPower: true, rdEarthing: true, rdUps: true, rdClimate: true, rdSpace: true, rdAir: true, rdNetwork: true,
    hoExpectations: 'x', hoCommitments: 'y', hoKeyContacts: 'z',
    jcSteps: ['unpack', 'position', 'power_on', 'heads', 'ink_fill', 'rip', 'profile', 'test_print'],
    trialResults: 'OK',
    trainingTopics: ['operation'],
    trainees: 'Ramesh',
    serialNo: 'TEST-2026-0001',
    ...over,
  };
  d.records.installations = [r, ...(d.records.installations ?? [])];
  return r;
}

describe('installed base', () => {
  beforeEach(() => __setDb(createDb(new Date())));

  it('seeds an installed base with warranties and contracts in every renewal state', () => {
    const d = getDb();
    if (!d.records.customers?.length || !d.records.products?.length) return; // upstream modules absent
    expect(d.records.machines.length).toBeGreaterThanOrEqual(100);
    expect(d.records.warranties.length).toBe(d.records.machines.length);
    const statuses = new Set(d.records.amcContracts.map((c) => c.status));
    ['active', 'due_for_renewal', 'renewed'].forEach((s) => expect(statuses.has(s)).toBe(true));
    expect(new Set(d.records.machines.map((m) => m.serialNo)).size).toBe(d.records.machines.length);
    // A seeded sweep has nothing left to do on the seed day.
    expect(planRenewalSweep().due.length).toBe(0);
  });

  it('signs off with OTP: creates machine, warranty and training; coverage becomes warranty', () => {
    if (!getDb().records.products?.length) return;
    const ins = baseInstallation();
    const code = startSignOffOtp(svc(), ins.id);
    expect(() => signOffInstallation(svc(), ins.id, { method: 'otp', otp: '000000', signedOffBy: 'Mr Shah' }, 1)).toThrow(ServiceError);
    const out = signOffInstallation(svc(), ins.id, { method: 'otp', otp: code, signedOffBy: 'Mr Shah' }, 1);
    expect(out.status).toBe('signed_off');
    const m = getDb().records.machines.find((x) => x.id === out.machineId)!;
    expect(m.serialNo).toBe('TEST-2026-0001');
    expect(getDb().records.warranties.some((w) => w.machineId === m.id && w.startDate === todayKey())).toBe(true);
    expect(getDb().records.trainingRecords.some((t) => t.machineId === m.id)).toBe(true);
    expect(coverageFor(m.id)).toBe('warranty');
    expect(getDb().outbox.some((x) => x.related?.recordId === m.id)).toBe(true);
  });

  it('blocks sign-off for a duplicate serial and incomplete job cards', () => {
    if (!getDb().records.machines?.length) return;
    const dup = baseInstallation({ serialNo: getDb().records.machines[0].serialNo, jcSteps: ['unpack'] });
    const code = startSignOffOtp(svc(), dup.id);
    expect(() => signOffInstallation(svc(), dup.id, { method: 'otp', otp: code, signedOffBy: 'X' }, 1)).toThrow(/already exists|job-card steps/);
  });

  it('requires every readiness item before Site ready (BR-27)', () => {
    if (!getDb().records.products?.length) return;
    const ins = baseInstallation({ status: 'scheduled', rdAir: false });
    expect(() => transitionRecord(svc(), 'installations', ins.id, 'site_ready', 1)).toThrow(/Compressed air/);
  });

  it('rejects a second machine with the same serial', () => {
    const d = getDb();
    if (!d.records.machines?.length) return;
    const m = d.records.machines[0];
    expect(() => createRecord(actorFor('u_rahul', 'tc'), 'machines', { serialNo: String(m.serialNo).toLowerCase(), productId: m.productId, customerId: m.customerId, installDate: todayKey(), divisionId: m.divisionId })).toThrow(/already exists/);
  });

  it('renewal sweep: due inside the window, one reminder per threshold, idempotent; renew links contracts', () => {
    const d = getDb();
    const c = d.records.amcContracts?.find((x) => x.status === 'active' && d.records.machines.find((m) => m.id === x.machineId)?.customerId === x.customerId);
    if (!c) return;
    c.endDate = addDays(todayKey(), 25);
    c.remindersSent = '';
    const before = d.outbox.length;
    expect(runRenewalSweep(svc())).toBeGreaterThan(0);
    const after = getDb().records.amcContracts.find((x) => x.id === c.id)!;
    expect(after.status).toBe('due_for_renewal');
    expect(after.remindersSent).toBe('90,60,30');
    expect(getDb().outbox.length).toBe(before + 1);
    expect(runRenewalSweep(svc())).toBe(0);
    const fresh = renewContract(svc(), c.id, { contractType: 'cmc', startDate: addDays(todayKey(), 26), endDate: addDays(todayKey(), 390), value: 250000, pmVisitsPerYear: 4 });
    expect(getDb().records.amcContracts.find((x) => x.id === c.id)!.status).toBe('renewed');
    expect(fresh.renewalOfId).toBe(c.id);
    expect(String(fresh.contractNo)).toMatch(/^AMC\/\d{2}-\d{2}\/\d{4}$/);
  });

  it('seed keeps open contracts on the current machine owner', () => {
    const d = getDb();
    const open = (d.records.amcContracts ?? []).filter((c) => ['active', 'due_for_renewal'].includes(String(c.status)));
    open.forEach((c) => expect(c.customerId).toBe(d.records.machines.find((m) => m.id === c.machineId)?.customerId));
  });

  it('resale moves ownership and records history', () => {
    const d = getDb();
    const m = d.records.machines?.find((x) => x.status === 'active');
    if (!m) return;
    const to = d.records.customers.find((c) => c.id !== m.customerId)!;
    moveMachine(svc(), m.id, { moveType: 'resale', toCustomerId: to.id, toSiteAddressId: null, moveDate: todayKey(), reason: 'Sold' });
    expect(getDb().records.machines.find((x) => x.id === m.id)!.customerId).toBe(to.id);
    expect(getDb().records.machineMoves.some((x) => x.machineId === m.id && x.moveType === 'resale')).toBe(true);
  });

  it('uses the glossary terms for record names, field labels and statuses', () => {
    expect(getResource('machines').labelPlural).toBe('Installed Base');
    expect(getResource('machineComponents').labelPlural).toBe('Component Serial Numbers');
    expect(getResource('machineReadings').labelPlural).toBe('Machine Usage Readings');
    expect(getResource('machineMoves').labelPlural).toBe('Resale / Relocation History');
    expect(getResource('amcContracts').label).toBe('AMC / CMC Contract');
    const label = (res: string, key: string) => getResource(res).fields.find((f) => f.key === key)?.label;
    expect(label('installations', 'engineerId')).toBe('Service engineer');
    expect(label('machines', 'siteAddressId')).toBe('Installation site');
    expect(label('machines', 'installDate')).toBe('Installation date');
    expect(label('amcContracts', 'contractNo')).toBe('Contract number');
    expect(label('amcContracts', 'pmVisitsPerYear')).toBe('Number of preventive visits');
    expect(label('amcContracts', 'billingFrequency')).toBe('Billing schedule');
    expect(masterLabel('installationStatus', 'site_ready')).toBe('Site Ready');
    expect(masterLabel('amcStatus', 'due_for_renewal')).toBe('Due for Renewal');
    expect(masterLabel('amcType', 'amc')).toBe('AMC – Labour Only');
    expect(getResource('installations').lifecycle?.transitions[0].action).toBe('Verify Site Readiness');
  });

  it('routes: Renewals at /renewal-pipeline, resources on their glossary slugs', () => {
    expect(installedRoutes.map((r) => r.path)).toEqual([ROUTES.renewalPipeline]);
    expect(resourcePath('tc', 'installations')).toBe('/installation-jobs');
    expect(resourcePath('tc', 'machines')).toBe('/installed-base');
    expect(recordPagePath('tc', 'amcContracts', 'AMC-1')).toBe('/amc-cmc-contracts/AMC-1');
  });

  it('Create Renewal Quotation: ensures one renewal opportunity and reuses it', () => {
    const d = getDb();
    if (!Array.isArray(d.records.opportunities) || !Array.isArray(d.records.quotations)) return;
    const c = d.records.amcContracts?.find((x) => x.status === 'active' && !x.renewalOpportunityId);
    if (!c) return;
    const opp = prepareRenewalQuotation(svc(), c.id);
    expect(getDb().records.opportunities.some((o) => o.id === opp && o.amcContractId === c.id)).toBe(true);
    expect(prepareRenewalQuotation(svc(), c.id)).toBe(opp);
    const renewed = d.records.amcContracts.find((x) => x.status === 'renewed');
    if (renewed) expect(() => prepareRenewalQuotation(svc(), renewed.id)).toThrow(ServiceError);
  });
});
