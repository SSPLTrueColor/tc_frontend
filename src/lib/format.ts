const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const num = new Intl.NumberFormat('en-IN');
export const formatMoney = (n: number) => money.format(n);
export const formatNumber = (n: number) => num.format(n);
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
