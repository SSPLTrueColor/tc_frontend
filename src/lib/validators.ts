/**
 * Indian business-format validators (REQUIREMENTS §5.1). Pure functions: each returns an
 * error message, or undefined when the value is valid. Empty values are the caller's
 * concern (required checks live in the validation service).
 */
import type { FormatKey } from '../metadata/types';

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const VALID_STATE_CODES = new Set([...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')), '97', '99']);

/** GSTIN check digit (mod-36 weighted sum used by the GST network). */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHARS.indexOf(first14[i]);
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function validateGstin(raw: string, opts: { stateCode?: string; pan?: string } = {}): string | undefined {
  const v = raw.trim().toUpperCase();
  if (!GSTIN_RE.test(v)) return 'Enter a valid 15-character GSTIN (e.g. 27AAACT1234A1Z5)';
  if (!VALID_STATE_CODES.has(v.slice(0, 2))) return 'The first two digits of the GSTIN are not a valid state code';
  if (gstinCheckDigit(v.slice(0, 14)) !== v[14]) return 'GSTIN check digit is incorrect — please re-check the number';
  if (opts.stateCode && v.slice(0, 2) !== opts.stateCode) return 'GSTIN state code does not match the billing state';
  if (opts.pan && v.slice(2, 12) !== opts.pan.trim().toUpperCase()) return 'GSTIN does not contain this company’s PAN';
  return undefined;
}

export const validatePan = (raw: string) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(raw.trim().toUpperCase()) ? undefined : 'Enter a valid PAN (e.g. ABCDE1234F)');

/** Stores as 10 digits; accepts +91 / 0 prefixes and spaces. */
export const normaliseMobile = (raw: string) => raw.replace(/[\s-]/g, '').replace(/^(\+91|91(?=\d{10}$)|0(?=\d{10}$))/, '');
export const validateMobile = (raw: string) => (/^[6-9][0-9]{9}$/.test(normaliseMobile(raw)) ? undefined : 'Enter a 10-digit Indian mobile number');

export const validateEmail = (raw: string) => (/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(raw.trim()) ? undefined : 'Enter a valid email address');
export const validatePincode = (raw: string) => (/^[1-9][0-9]{5}$/.test(raw.trim()) ? undefined : 'Enter a 6-digit pincode');
export const validateHsn = (raw: string) => (/^([0-9]{4}|[0-9]{6}|[0-9]{8})$/.test(raw.trim()) ? undefined : 'HSN must be 4, 6 or 8 digits');
export const validateSac = (raw: string) => (/^99[0-9]{4}$/.test(raw.trim()) ? undefined : 'SAC must be 6 digits starting with 99');
export const validateHsnSac = (raw: string) => (!validateHsn(raw) || !validateSac(raw) ? undefined : 'Enter a valid HSN (4/6/8 digits) or SAC (6 digits starting 99)');
export const validateUrl = (raw: string) => (/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(raw.trim()) ? undefined : 'Enter a full web address starting with http:// or https://');

const BY_KEY: Record<FormatKey, (v: string) => string | undefined> = {
  gstin: (v) => validateGstin(v),
  pan: validatePan,
  mobile: validateMobile,
  email: validateEmail,
  pincode: validatePincode,
  hsn: validateHsn,
  sac: validateSac,
  hsnSac: validateHsnSac,
  url: validateUrl,
};

export const validateFormat = (key: FormatKey, value: string) => BY_KEY[key](value);
