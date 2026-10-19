import { gstinCheckDigit, normaliseMobile, validateGstin, validateHsnSac, validateMobile, validatePan, validatePincode } from '../lib/validators';
import { formatDate, formatDateTime } from '../lib/dates';
import { formatMoney } from '../lib/format';

describe('Indian format validators', () => {
  it('accepts a GSTIN with a correct check digit and rejects a wrong one', () => {
    expect(gstinCheckDigit('27AAPFU0939F1Z')).toBe('V');
    expect(validateGstin('27AAPFU0939F1ZV')).toBeUndefined();
    expect(validateGstin('27AAPFU0939F1ZA')).toMatch(/check digit/);
    expect(validateGstin('27AAPFU0939F1Z')).toMatch(/15-character/);
    expect(validateGstin('99AAPFU0939F1ZV')).toBeTruthy();
  });

  it('cross-checks GSTIN against state and PAN', () => {
    expect(validateGstin('27AAPFU0939F1ZV', { stateCode: '24' })).toMatch(/state/);
    expect(validateGstin('27AAPFU0939F1ZV', { pan: 'AAPFU0939F' })).toBeUndefined();
    expect(validateGstin('27AAPFU0939F1ZV', { pan: 'ABCDE1234F' })).toMatch(/PAN/);
  });

  it('validates PAN, mobile, pincode and HSN/SAC', () => {
    expect(validatePan('abcde1234f')).toBeUndefined();
    expect(validatePan('ABCD1234F')).toBeTruthy();
    expect(normaliseMobile('+91 98200 12345')).toBe('9820012345');
    expect(validateMobile('09820012345')).toBeUndefined();
    expect(validateMobile('5820012345')).toBeTruthy();
    expect(validatePincode('400001')).toBeUndefined();
    expect(validatePincode('040001')).toBeTruthy();
    expect(validateHsnSac('8443')).toBeUndefined();
    expect(validateHsnSac('998719')).toBeUndefined();
    expect(validateHsnSac('12345')).toBeTruthy();
  });

  it('formats dates as DD-MM-YYYY and money as INR with lakh grouping', () => {
    expect(formatDate('2026-10-16')).toBe('16-10-2026');
    expect(formatDateTime('2026-10-16T20:30')).toBe('16-10-2026 08:30 PM');
    expect(formatMoney(1234567)).toBe('₹12,34,567.00');
  });
});
