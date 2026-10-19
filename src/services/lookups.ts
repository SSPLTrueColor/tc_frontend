/**
 * Cross-module read helpers over the shared record store, keyed by the field names in
 * docs/CONTRACTS.md. Modules use these instead of importing each other's code.
 * Pure reads; pass `records` from a HookContext (`ctx.d.records`) or omit to read the live store.
 */
import type { RecordData } from '../metadata/types';
import { demoUsers } from '../domain/pack';
import { todayKey } from '../lib/dates';
import { getDb } from './db';
import { getPolicies } from './policies';

type Store = Record<string, RecordData[]>;
const live = (): Store => getDb().records;
const rows = (key: string, s: Store = live()) => s[key] ?? [];

export const byId = (resKey: string, id: unknown, s?: Store) => (id ? rows(resKey, s).find((r) => r.id === id) : undefined);

// ---------------------------------------------------------------- people & hierarchy

/** Demo user (sign-in identity) behind an employee id. */
export const userOfStaff = (staffId: unknown) => demoUsers.find((u) => u.staffIds.tc === staffId);
export const staffOfUser = (userId: string) => demoUsers.find((u) => u.id === userId)?.staffIds.tc;
/** Reporting manager's employee id. */
export const managerOf = (staffId: unknown, s?: Store) => (byId('employees', staffId, s)?.managerId as string | undefined) ?? undefined;
/** Active employees with a role, optionally limited to a division. */
export function employeesWithRole(roleId: string, divisionId?: string, s?: Store): RecordData[] {
  return rows('employees', s).filter((e) => e.roleId === roleId && e.status !== 'inactive' && (!divisionId || ((e.divisionIds as string[]) ?? []).includes(divisionId)));
}
export const divisionHeadsOf = (divisionId: string, s?: Store) => employeesWithRole('division_head', divisionId, s);

// ---------------------------------------------------------------- catalog & pricing

/** BR-15: list price valid on a date from active price lists of the product's division. */
export function listPriceFor(productId: string, dateKey = todayKey(), s?: Store): { listPrice: number; landedCost?: number; priceListId: string } | null {
  const lists = new Map(rows('priceLists', s).filter((l) => l.status !== 'draft' && String(l.validFrom) <= dateKey && String(l.validTo) >= dateKey).map((l) => [l.id, l]));
  const item = rows('priceListItems', s).find((i) => i.productId === productId && lists.has(String(i.priceListId)));
  return item ? { listPrice: Number(item.listPrice), landedCost: item.landedCost === undefined ? undefined : Number(item.landedCost), priceListId: String(item.priceListId) } : null;
}

/** CON-02 / BR-41: a valid customer rate contract overrides the price list. */
export function contractRateFor(customerId: string, productId: string, dateKey = todayKey(), s?: Store): number | null {
  const rc = rows('rateContracts', s).find((r) => r.customerId === customerId && r.productId === productId && String(r.validFrom) <= dateKey && String(r.validTo) >= dateKey && r.status !== 'inactive');
  return rc ? Number(rc.rate) : null;
}

// ---------------------------------------------------------------- tax & money

/** BR-16: CGST+SGST inside the company's GST state, otherwise IGST. Amounts rounded to paise. */
export function gstSplit(placeOfSupplyState: string, taxable: number, ratePct: number) {
  const tax = Math.round(taxable * ratePct) / 100;
  if (placeOfSupplyState === getPolicies().companyGstState) {
    const half = Math.round(tax * 50) / 100;
    return { cgst: half, sgst: Math.round((tax - half) * 100) / 100, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: Math.round(tax * 100) / 100 };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const three = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ''}` : two(n));

/** Indian-system amount in words: "Rupees Twelve Lakh Thirty Four Thousand … and Fifty Paise Only". */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${crore >= 1000 ? amountInWords(crore).replace(/^Rupees | Only$/g, '') : three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  const words = parts.join(' ') || 'Zero';
  return `Rupees ${words}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}

// ---------------------------------------------------------------- installed base

/** BR-29: coverage of a machine on a date — CMC > AMC > warranty > none. */
export function coverageFor(machineId: string, dateKey = todayKey(), s?: Store): 'cmc' | 'amc' | 'warranty' | 'none' {
  const contracts = rows('amcContracts', s).filter((c) => c.machineId === machineId && ['active', 'due_for_renewal'].includes(String(c.status)) && String(c.startDate) <= dateKey && String(c.endDate) >= dateKey);
  if (contracts.some((c) => c.contractType === 'cmc')) return 'cmc';
  if (contracts.some((c) => c.contractType === 'amc')) return 'amc';
  const w = rows('warranties', s).find((x) => x.machineId === machineId && String(x.startDate) <= dateKey && String(x.endDate) >= dateKey);
  return w ? 'warranty' : 'none';
}

/** Customer of a record that carries `customerId` (directly) — convenience for 360 views. */
export const recordsOfCustomer = (resKey: string, customerId: string, s?: Store) => rows(resKey, s).filter((r) => r.customerId === customerId);
