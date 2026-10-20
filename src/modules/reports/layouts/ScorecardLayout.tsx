import { Link } from 'react-router-dom';
import { L } from '../../../constants/labels';
import { KpiRow } from '../KpiRow';
import { Headline, kpiText, text, type LayoutProps } from './shared';

const W = L.reports.layouts;
const GROUPS: { id: keyof typeof W.groups; keys: string[] }[] = [
  { id: 'sales', keys: ['booked', 'lead-response', 'lead-conversion', 'win-rate', 'pipeline', 'weighted', 'cycle', 'q2o'] },
  { id: 'service', keys: ['sla', 'mttr', 'ftfr', 'repeat', 'pm', 'csat'] },
  { id: 'money', keys: ['backlog', 'collections', 'overdue'] },
  { id: 'growth', keys: ['amc', 'attach', 'scorecard', 'adoption'] },
];

/** Business scorecard: the five headline figures, the lead-to-order flow, then every KPI in its own business group. */
export function ScorecardLayout({ out, def }: LayoutProps) {
  const pts = out.chart?.points ?? [];
  const first = pts[0]?.value ?? 0;
  const last = pts[pts.length - 1];
  let drop: { label: string; pct: number } | null = null;
  pts.forEach((p, i) => {
    if (!i || !pts[i - 1].value) return;
    const lost = 1 - p.value / pts[i - 1].value;
    if (!drop || lost > drop.pct) drop = { label: p.label, pct: lost };
  });
  const byKey = new Map(out.rows.map((r) => [r._key, r]));
  return (
    <div className="rl-board">
      {first > 0 && last && (
        <Headline>
          {W.funnelHead(Math.round((last.value / first) * 100), last.label.toLowerCase())}
          {drop && (drop as { pct: number }).pct > 0 ? ` ${W.funnelDrop((drop as { label: string }).label, Math.round((drop as { pct: number }).pct * 100))}` : ''}
        </Headline>
      )}
      <KpiRow out={out} label={def.title} />
      {pts.length > 0 && (
        <ol className="rl-flow" aria-label={out.chart?.spec.title}>
          {pts.map((p, i) => (
            <li key={p.key} className="rl-flow-step" style={{ ['--w' as string]: first ? Math.max(0.35, p.value / first) : 1 }}>
              <span className="rl-flow-label">{p.label}</span>
              <strong>{p.value}</strong>
              {i > 0 && pts[i - 1].value > 0 && p.value <= pts[i - 1].value && <span className="rl-flow-carry muted">{W.carried(Math.round((p.value / pts[i - 1].value) * 100))}</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="rl-groups">
        {GROUPS.map((g) => (
          <section key={g.id} className="rl-group">
            <h3>{W.groups[g.id]}</h3>
            <ul>
              {g.keys.map((k) => {
                const r = byKey.get(k);
                if (!r) return null;
                const href = text(r._href);
                const v = kpiText(text(r.value));
                return (
                  <li key={k}>
                    {href ? (
                      <Link to={href} className="rl-metric">
                        <span>{text(r.kpi)}</span>
                        <strong>{v}</strong>
                      </Link>
                    ) : (
                      <div className="rl-metric">
                        <span>{text(r.kpi)}</span>
                        <strong>{v}</strong>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
