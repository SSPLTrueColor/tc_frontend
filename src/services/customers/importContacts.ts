/**
 * Contact pool intake (CUS-05, ADM-07 for contacts): CSV upload with per-row validation and
 * duplicate checks, plus SIMULATED phone-book and visiting-card (OCR) sources that return sample
 * rows — no device contacts or camera are accessed.
 */
import { normaliseMobile, validateEmail, validateMobile } from '../../lib/validators';
import { type Actor } from '../authz';
import { getDb } from '../db';
import { createRecord } from '../runtime';
import { ServiceError } from '../types';
import { L } from '../../constants/labels';
import { exactContactMatches, normaliseName } from './duplicates';

export const CONTACT_CSV_HEADERS = ['name', 'company', 'designation', 'mobile', 'email', 'city', 'source'] as const;
export const CONTACT_CSV_TEMPLATE = `${CONTACT_CSV_HEADERS.join(',')}\nAnita Sharma,Shree Ganesh Textile Mills,Purchase Manager,9876500011,anita@example.com,Surat,exhibition\nVivek Rao,,Owner,9876500012,,Pune,indiamart\n`;

export interface ImportRow {
  line: number;
  name: string;
  company: string;
  designation: string;
  mobile: string;
  email: string;
  city: string;
  source: string;
  /** Existing customer matched by company name (exact after normalisation). */
  customerId?: string;
  errors: string[];
  duplicateOf?: string;
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const SOURCES = ['website', 'exhibition', 'referral', 'dealer', 'social', 'meta_ads', 'google_ads', 'indiamart', 'cold_call', 'walk_in', 'agency'];

/** Validates rows: name required, mobile or email (BR-03), formats, duplicates in store and within the file. */
export function validateRows(raw: Omit<ImportRow, 'errors' | 'line' | 'customerId' | 'duplicateOf'>[], startLine = 2): ImportRow[] {
  const d = getDb();
  const contacts = d.records.contacts ?? [];
  const customers = d.records.customers ?? [];
  const seenMobile = new Map<string, number>();
  return raw.map((r, i) => {
    const row: ImportRow = { ...r, line: startLine + i, errors: [] };
    if (!row.name.trim()) row.errors.push(L.customers.import.errors.nameRequired);
    if (!row.mobile.trim() && !row.email.trim()) row.errors.push(L.customers.import.errors.reachRequired);
    if (row.mobile.trim() && validateMobile(row.mobile)) row.errors.push(validateMobile(row.mobile)!);
    if (row.email.trim() && validateEmail(row.email)) row.errors.push(validateEmail(row.email)!);
    if (row.source && !SOURCES.includes(row.source)) row.errors.push(L.customers.import.errors.unknownSource(row.source));
    const dup = exactContactMatches(contacts, { mobile: row.mobile, email: row.email });
    if (dup.length) row.duplicateOf = dup[0].id;
    const m = normaliseMobile(row.mobile);
    if (m) {
      if (seenMobile.has(m)) row.errors.push(L.customers.import.errors.sameMobile(seenMobile.get(m)!));
      else seenMobile.set(m, row.line);
    }
    if (row.company.trim()) {
      const hit = customers.find((c) => normaliseName(c.name) === normaliseName(row.company));
      if (hit) row.customerId = hit.id;
    }
    return row;
  });
}

export function rowsFromCsv(text: string): ImportRow[] {
  const table = parseCsv(text);
  if (!table.length) throw new ServiceError('validation', L.customers.import.errors.empty);
  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = ['name', 'mobile', 'email'].filter((h) => !header.includes(h));
  if (missing.length) throw new ServiceError('validation', L.customers.import.errors.missingColumns(missing.join(', ')));
  if (table.length > 501) throw new ServiceError('validation', L.customers.import.errors.tooMany);
  const col = (r: string[], k: string) => (header.indexOf(k) >= 0 ? (r[header.indexOf(k)] ?? '').trim() : '');
  return validateRows(table.slice(1).map((r) => ({ name: col(r, 'name'), company: col(r, 'company'), designation: col(r, 'designation'), mobile: col(r, 'mobile'), email: col(r, 'email'), city: col(r, 'city'), source: col(r, 'source') })));
}

const PHONE_BOOK = [
  { name: 'Rakesh Patel', company: '', designation: 'Owner', mobile: '9824011122', email: '', city: 'Surat', source: 'cold_call' },
  { name: 'Sunita Agarwal', company: '', designation: 'Proprietor', mobile: '9829033344', email: 'sunita.prints@example.com', city: 'Jaipur', source: 'referral' },
  { name: 'Mohammed Irfan', company: '', designation: 'Production Head', mobile: '9845055566', email: '', city: 'Bengaluru', source: 'cold_call' },
];
const CARDS = [
  { name: 'Kiran Joshi', company: 'Joshi Digital Textiles', designation: 'Managing Partner', mobile: '9825077788', email: 'kiran@joshidigital.example', city: 'Ahmedabad', source: 'exhibition' },
  { name: 'Lata Krishnan', company: 'Coimbatore Print Studio', designation: 'Technical Manager', mobile: '9842099900', email: 'lata@cbeprint.example', city: 'Coimbatore', source: 'exhibition' },
];

/** SIMULATED device sources: sample rows only (no access to the phone book or camera). */
export const samplePhoneBook = () => validateRows(PHONE_BOOK, 1);
export const sampleVisitingCard = (n: number) => validateRows([CARDS[n % CARDS.length]], 1);

/** Creates contacts for valid, non-duplicate rows. Returns created ids and skipped lines. */
export function importRows(actor: Actor, rows: ImportRow[]): { created: string[]; skipped: { line: number; reason: string }[] } {
  const created: string[] = [];
  const skipped: { line: number; reason: string }[] = [];
  for (const r of rows) {
    if (r.errors.length) {
      skipped.push({ line: r.line, reason: r.errors[0] });
      continue;
    }
    if (r.duplicateOf) {
      skipped.push({ line: r.line, reason: L.customers.import.errors.alreadyExists(r.duplicateOf) });
      continue;
    }
    try {
      const out = createRecord(actor, 'contacts', {
        name: r.name.trim(),
        customerId: r.customerId ?? null,
        designation: r.designation,
        mobile: r.mobile ? normaliseMobile(r.mobile) : null,
        email: r.email.trim().toLowerCase() || null,
        city: r.city,
        source: r.source || null,
        poolStatus: 'new',
        ownerId: actor.staffId,
        divisionIds: actor.divisionIds,
      });
      created.push(out.record.id);
    } catch (e) {
      skipped.push({ line: r.line, reason: e instanceof Error ? e.message : L.customers.import.errors.couldNotImport });
    }
  }
  return { created, skipped };
}

