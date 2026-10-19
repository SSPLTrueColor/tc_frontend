import { useState } from 'react';
import { cx } from '../../lib/format';

/**
 * Single-series bar chart (dataviz: one series → slot-1 color, thin marks,
 * recessive hairline grid, per-bar hover tooltip, table alternative).
 */
export function BarChart({ data, label, unit, onSelect }: { data: { key: string; label: string; value: number }[]; label: string; unit: string; onSelect?: (key: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = Math.ceil(max / 5) * 5;
  const W = 560;
  const H = 180;
  const padL = 28;
  const padB = 24;
  const bw = (W - padL) / data.length;
  const ticks = [0, nice / 2, nice];
  return (
    <figure className="chart">
      <div className="chart-head">
        <figcaption className="chart-title">{label}</figcaption>
        <button type="button" className="link small" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {asTable ? (
        <table className="mini-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="num">
                {unit}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-svg-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`} className="chart-svg">
            {ticks.map((t) => {
              const y = H - padB - (t / nice) * (H - padB - 8);
              return (
                <g key={t}>
                  <line x1={padL} x2={W} y1={y} y2={y} className="chart-grid" />
                  <text x={padL - 6} y={y + 4} textAnchor="end" className="chart-axis">
                    {t}
                  </text>
                </g>
              );
            })}
            {data.map((d, i) => {
              const h = (d.value / nice) * (H - padB - 8);
              const x = padL + i * bw + bw * 0.22;
              const w = bw * 0.56;
              const y = H - padB - h;
              return (
                <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(d.key)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
                  <rect x={padL + i * bw} y={0} width={bw} height={H - padB} fill="transparent" />
                  {h > 0 && <path d={roundedTop(x, y, w, h, 4)} className={cx('chart-bar', hover === i && 'is-hover')} />}
                  <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="chart-axis">
                    {d.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${((padL + hover * bw + bw / 2) / W) * 100}%` }} role="status">
              <strong>{data[hover].value}</strong> {unit} · {data[hover].label}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
