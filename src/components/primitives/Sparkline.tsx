import { cx } from '../../lib/format';

/** A tiny trend line under a KPI number. Decorative-plus: the accessible name states the first and last value. */
export function Sparkline({ data, label, tone = 'var(--s-accent)', className }: { data: number[]; label: string; tone?: string; className?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * 100, 26 - ((v - min) / span) * 22] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className={cx('kpi-spark', className)} viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label}>
      <polygon points={`0,28 ${line} 100,28`} fill={tone} opacity="0.12" />
      <polyline points={line} fill="none" stroke={tone} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
