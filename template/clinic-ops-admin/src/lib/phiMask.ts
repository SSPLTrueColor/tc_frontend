/**
 * PHI masking helpers (phi-masking skill contract, SPEC v1.0 §3):
 * keep first 2 + last 2 chars, one "*" per hidden char; email masks local part only.
 */
const maskMiddle = (value: string, lead = 2, trail = 2): string => {
  if (value.length <= lead + trail) return '*'.repeat(value.length);
  return `${value.slice(0, lead)}${'*'.repeat(value.length - lead - trail)}${value.slice(value.length - trail)}`;
};

export const maskPhone = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str) return '';
  if (str.startsWith('+')) return `+${maskMiddle(str.slice(1))}`;
  return maskMiddle(str);
};

export const maskEmail = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str) return '';
  const at = str.indexOf('@');
  if (at === -1) return maskMiddle(str);
  return `${maskMiddle(str.slice(0, at))}${str.slice(at)}`;
};

export const maskIdentifier = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  return maskMiddle(String(value));
};

export type SensitiveFieldType = 'phone' | 'email' | 'identifier';

export const maskSensitive = (value: unknown, type: SensitiveFieldType): string =>
  type === 'email' ? maskEmail(value) : type === 'phone' ? maskPhone(value) : maskIdentifier(value);

/** True when a value already looks masked (contains an asterisk). Gate call/copy actions with this. */
export const isMasked = (value: unknown): boolean => typeof value === 'string' && value.includes('*');

/** Placeholder returned by the service for restricted non-contact values. */
export const RESTRICTED = '••••• restricted';
