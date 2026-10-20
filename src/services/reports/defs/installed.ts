/** IB-07 installed base reports: base by model/region, warranty & AMC expiry, machines without a contract. */
import { L } from '../../../constants/labels';
import { coverageFor } from '../../lookups';
import { dayOf, ms } from '../kpis';
import { applyFilters, empName, groupBy, label, list, n, peek, row, s } from '../helpers';
import { monthName } from '../format';
import { count, countIf, maxOf, mean, sum as sumOf, sumIf } from '../metrics';
import type { Metric, ReportDef } from '../types';

const D = L.reports.defs;
const C = L.reports.cols;
const G = L.reports.groupBy;
const R = L.reports.rep;
const monthOf = (v: unknown) => dayOf(v).slice(0, 7);

/** Contracts renewed ÷ (renewed + lost + expired), read off the status rows of the AMC status view. */
const renewalRate: Metric = (rows) => {
  const of = (st: string) => Number(rows.find((r) => r._key === st)?.contracts ?? 0);
  const closed = of('renewed') + of('lost') + of('expired');
  return closed ? of('renewed') / closed : null;
};

export const installedReports: ReportDef[] = [
  {
    id: 'installed-base-by-model',
    title: D.installedBase.title,
    group: 'installed-base',
    icon: 'printer',
    fr: ['FR-074'],
    description: R.installedBase.description,
    needs: ['machines'],
    views: [
      {
        id: 'base',
        label: D.installedBase.title,
        filters: { division: true },
        groupOptions: [
          { value: 'model', label: G.model },
          { value: 'region', label: G.region },
          { value: 'coverage', label: G.coverage },
        ],
        compute: (ds, f, ctx) => {
          const ms_ = applyFilters(ds.get('machines').filter((m) => m.status !== 'scrapped'), f);
          const custState = new Map(ds.get('customers').map((c) => [c.id, label('state', c.billingState)]));
          const g = f.group ?? 'model';
          const keyOf = (m: Record<string, unknown>) => (g === 'region' ? custState.get(s(m.customerId)) ?? L.reports.common.unknown : g === 'coverage' ? label('coverage', coverageFor(s(m.id), ctx.today)) : s(m.model) || ds.name('products', m.productId));
          return {
            columns: [
              { key: 'group', label: g === 'region' ? D.installedBase.cols.region : g === 'coverage' ? D.installedBase.cols.coverage : C.model, link: () => list('machines') },
              { key: 'machines', label: C.machines, type: 'number', total: 'sum' },
              { key: 'customers', label: D.installedBase.cols.customers, type: 'number' },
              { key: 'newThisYear', label: D.installedBase.cols.newThisYear, type: 'number', total: 'sum' },
            ],
            rows: [...groupBy(ms_, keyOf).entries()]
              .map(([k, v]) => row(k, { group: k, machines: v.length, customers: new Set(v.map((m) => s(m.customerId))).size, newThisYear: v.filter((m) => dayOf(m.installDate) >= `${ctx.today.slice(0, 4)}-01-01`).length }))
              .sort((a, b) => n(b.machines) - n(a.machines)),
          };
        },
        kpis: [
          { label: D.installedBase.tile, fmt: 'number', value: sumOf('machines'), better: 'none' },
          { label: D.installedBase.cols.newThisYear, fmt: 'number', value: sumOf('newThisYear') },
          { label: R.installedBase.kpis.groups, fmt: 'number', value: count, better: 'none' },
        ],
        chart: (f) => ({ type: f.group === 'coverage' ? 'donut' : 'hbar', title: D.installedBase.chart, x: 'group', y: 'machines', fmt: 'number', unit: D.installedBase.unit }),
      },
    ],
  },
  {
    id: 'warranty-amc',
    title: R.warrantyAmc.title,
    group: 'installed-base',
    icon: 'shield-check',
    fr: ['FR-012', 'FR-074', 'FR-072'],
    description: R.warrantyAmc.description,
    needs: ['amcContracts'],
    views: [
      {
        id: 'warranty',
        label: R.warrantyAmc.views.warranty,
        filters: { date: 'future', division: true },
        dateLabel: D.warrantyExpiry.dateLabel,
        compute: (ds, f, ctx) => {
          const ws = applyFilters(ds.get('warranties'), f, { date: 'endDate' });
          const amc = ds.get('amcContracts');
          const machines = ds.get('machines');
          const rows = ws
            .map((w) => {
              const m = machines.find((x) => x.id === w.machineId);
              return row(w.id, {
                id: w.id,
                serial: m ? s(m.serialNo) : s(w.machineId),
                customer: ds.name('customers', w.customerId ?? m?.customerId),
                endDate: w.endDate,
                daysLeft: Math.round((ms(dayOf(w.endDate)) - ms(ctx.today)) / 86_400_000),
                hasContract: amc.some((c) => c.machineId === w.machineId && ['active', 'due_for_renewal', 'draft'].includes(s(c.status)) && dayOf(c.endDate) > dayOf(w.endDate)) ? L.reports.common.yes : L.reports.common.no,
              });
            })
            .sort((a, b) => n(a.daysLeft) - n(b.daysLeft));
          return {
            columns: [
              { key: 'serial', label: C.machine, link: peek('warranties') },
              { key: 'customer', label: C.customer },
              { key: 'endDate', label: D.warrantyExpiry.cols.endDate, type: 'date' },
              { key: 'daysLeft', label: C.daysLeft, type: 'number' },
              { key: 'hasContract', label: D.warrantyExpiry.cols.hasContract },
            ],
            rows,
            points: [...groupBy(rows, (r) => monthOf(r.endDate)).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ key: k, label: monthName(k), value: v.length })),
          };
        },
        kpis: [
          { label: R.warrantyAmc.kpis.expiring, fmt: 'number', value: count, better: 'none' },
          { label: R.warrantyAmc.kpis.noContract, fmt: 'number', value: countIf((r) => r.hasContract === L.reports.common.no), better: 'down', hint: R.warrantyAmc.noContractHint },
          { label: R.warrantyAmc.kpis.within30, fmt: 'number', value: countIf((r) => n(r.daysLeft) <= 30), better: 'down' },
        ],
        chart: { type: 'bar', title: D.warrantyExpiry.chart, x: 'endDate', y: 'daysLeft', fmt: 'number', unit: D.installedBase.unit, keepOrder: true },
      },
      {
        id: 'renewals',
        label: R.warrantyAmc.views.renewals,
        filters: { date: 'future', division: true, owner: true },
        dateLabel: D.amcRenewalsDue.dateLabel,
        compute: (ds, f, ctx) => {
          const cs = applyFilters(ds.get('amcContracts').filter((c) => ['active', 'due_for_renewal'].includes(s(c.status))), f, { date: 'endDate', owner: 'ownerId' });
          const rows = cs
            .map((c) => row(c.id, { id: c.id, contract: s(c.contractNo) || c.id, customer: ds.name('customers', c.customerId), type: c.contractType, endDate: c.endDate, daysLeft: Math.round((ms(dayOf(c.endDate)) - ms(ctx.today)) / 86_400_000), value: n(c.value), status: c.status, owner: empName(ds, c.ownerId) }))
            .sort((a, b) => n(a.daysLeft) - n(b.daysLeft));
          return {
            columns: [
              { key: 'contract', label: D.amcRenewalsDue.cols.contract, link: peek('amcContracts') },
              { key: 'customer', label: C.customer },
              { key: 'type', label: D.amcRenewalsDue.cols.type, type: 'status', master: 'amcType' },
              { key: 'endDate', label: D.amcRenewalsDue.cols.endDate, type: 'date' },
              { key: 'daysLeft', label: C.daysLeft, type: 'number' },
              { key: 'value', label: C.value, type: 'money', total: 'sum' },
              { key: 'status', label: C.status, type: 'status', master: 'amcStatus' },
              { key: 'owner', label: C.salesExecutive, optional: true },
            ],
            rows,
            points: [...groupBy(rows, (r) => monthOf(r.endDate)).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ key: k, label: monthName(k), value: v.reduce((t, r) => t + n(r.value), 0) })),
          };
        },
        kpis: [
          { label: R.warrantyAmc.kpis.due, fmt: 'number', value: count, better: 'none' },
          { label: D.amcRenewalsDue.tile, fmt: 'money', value: sumOf('value'), better: 'none', hint: R.warrantyAmc.atStakeHint },
          { label: R.warrantyAmc.kpis.within30, fmt: 'number', value: countIf((r) => n(r.daysLeft) <= 30), better: 'down' },
          { label: R.warrantyAmc.kpis.valueWithin30, fmt: 'money', value: sumIf('value', (r) => n(r.daysLeft) <= 30), better: 'none' },
        ],
        chart: { type: 'bar', title: D.amcRenewalsDue.chart, x: 'endDate', y: 'value', fmt: 'money', keepOrder: true },
      },
      {
        id: 'status',
        label: R.warrantyAmc.views.status,
        filters: { date: 'past', division: true, owner: true },
        dateLabel: D.amcStatus.dateLabel,
        compute: (ds, f) => {
          const cs = applyFilters(ds.get('amcContracts'), f, { date: 'endDate', owner: 'ownerId' });
          return {
            columns: [
              { key: 'status', label: C.status, type: 'status', master: 'amcStatus', link: () => list('amcContracts') },
              { key: 'contracts', label: D.amcStatus.cols.contracts, type: 'number', total: 'sum' },
              { key: 'amc', label: D.amcStatus.cols.amc, type: 'number', total: 'sum' },
              { key: 'cmc', label: D.amcStatus.cols.cmc, type: 'number', total: 'sum' },
              { key: 'value', label: C.value, type: 'money', total: 'sum' },
            ],
            rows: [...groupBy(cs, (c) => s(c.status)).entries()]
              .map(([st, v]) => row(st, { status: st, contracts: v.length, value: v.reduce((t, c) => t + n(c.value), 0), amc: v.filter((c) => c.contractType === 'amc').length, cmc: v.filter((c) => c.contractType === 'cmc').length }))
              .sort((a, b) => n(b.contracts) - n(a.contracts)),
          };
        },
        kpis: [
          { label: D.amcStatus.cols.contracts, fmt: 'number', value: sumOf('contracts'), better: 'none' },
          { label: R.warrantyAmc.kpis.contractValue, fmt: 'money', value: sumOf('value') },
          { label: D.amcStatus.tile, fmt: 'pct', value: renewalRate, hint: D.amcStatus.hint },
        ],
        chart: { type: 'donut', title: D.amcStatus.chart, x: 'status', y: 'contracts', fmt: 'number', unit: D.amcStatus.unit },
      },
    ],
  },
  {
    id: 'machines-without-contract',
    title: D.machinesWithoutContract.title,
    group: 'installed-base',
    icon: 'layers',
    fr: ['FR-074', 'FR-072'],
    description: R.noContract.description,
    needs: ['machines'],
    views: [
      {
        id: 'uncovered',
        label: D.machinesWithoutContract.title,
        filters: { division: true },
        compute: (ds, f, ctx) => {
          const ms_ = applyFilters(ds.get('machines').filter((m) => m.status !== 'scrapped'), f).filter((m) => coverageFor(m.id, ctx.today) === 'none');
          const rows = ms_
            .map((m) => row(m.id, { id: m.id, serial: s(m.serialNo), model: s(m.model) || ds.name('products', m.productId), customer: ds.name('customers', m.customerId), installDate: m.installDate, ageYears: Math.round(((ms(ctx.today) - ms(dayOf(m.installDate))) / (365 * 86_400_000)) * 10) / 10 }))
            .sort((a, b) => n(a.ageYears) - n(b.ageYears));
          return {
            columns: [
              { key: 'serial', label: C.serialNumber, link: peek('machines') },
              { key: 'model', label: C.model },
              { key: 'customer', label: C.customer },
              { key: 'installDate', label: C.installationDate, type: 'date' },
              { key: 'ageYears', label: D.machinesWithoutContract.cols.ageYears, type: 'number' },
            ],
            rows,
            points: [...groupBy(rows, (r) => s(r.model)).entries()].map(([k, v]) => ({ key: k, label: k, value: v.length })),
          };
        },
        kpis: [
          { label: R.noContract.kpis.uncovered, fmt: 'number', value: count, better: 'down', hint: R.noContract.hint },
          { label: R.noContract.kpis.avgAge, fmt: 'number', value: mean('ageYears'), better: 'none' },
          { label: R.noContract.kpis.oldest, fmt: 'number', value: maxOf('ageYears'), better: 'none' },
        ],
        chart: { type: 'hbar', title: D.machinesWithoutContract.chart, x: 'model', y: 'ageYears', fmt: 'number', unit: D.machinesWithoutContract.unit },
      },
    ],
  },
];
