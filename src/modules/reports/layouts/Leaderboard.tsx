import { ImageTile } from '../../../components/primitives/People';
import { L } from '../../../constants/labels';
import { cx } from '../../../lib/format';
import type { Fmt, ReportRow } from '../../../services/reports/types';
import { LeaderVisualChart, type LeaderVisual } from './LeaderVisuals';
import { cellText, fmtOf, Headline, hrefOf, KpiInline, NameLink, num, text, type LayoutProps } from './shared';

const W = L.reports.layouts;

export interface LeaderCfg {
  /** Column with the person / group name, and the column that ranks them. */
  name: string;
  value: string;
  fmt: Fmt;
  /** Target column: the bar then shows progress against it (a marker at 100 %). */
  target?: string;
  /** Small supporting figures under the name. */
  extras?: { key: string; label: string; fmt: Fmt }[];
  /** A text column shown as a status dot (value equal to `good` is green). */
  status?: { key: string; good: string };
  /** A chart drawn above the list, so each screen answers its question with the right picture. */
  visual?: LeaderVisual;
  /** Lower is better (response time, ageing). */
  asc?: boolean;
}

/** Ranked people / groups: medal, avatar, name, a bar for the ranking figure, the figure itself and a few quiet extras. */
export function Leaderboard({ out, cfg }: LayoutProps & { cfg: LeaderCfg }) {
  const rows = [...out.rows].sort((a, b) => (cfg.asc ? num(a[cfg.value]) - num(b[cfg.value]) : num(b[cfg.value]) - num(a[cfg.value])));
  const total = rows.reduce((t, r) => t + Math.max(0, num(r[cfg.value])), 0);
  const max = Math.max(...rows.map((r) => (cfg.target ? Math.max(num(r[cfg.value]), num(r[cfg.target])) : num(r[cfg.value]))), 1);
  const top = rows[0];
  const hit = cfg.target ? rows.filter((r) => num(r[cfg.target!]) > 0 && num(r[cfg.value]) >= num(r[cfg.target!])).length : 0;
  if (!rows.length || !top) return <p className="rl-empty muted">{W.noData}</p>;
  return (
    <div className="rl-board">
      <Headline>
        {cfg.target
          ? W.leaderTarget(hit, rows.filter((r) => num(r[cfg.target!]) > 0).length)
          : W.leaderTop(text(top[cfg.name]), fmtOf(num(top[cfg.value]), cfg.fmt), total > 0 && !cfg.asc ? Math.round((num(top[cfg.value]) / total) * 100) : null)}
      </Headline>
      <KpiInline kpis={out.kpis} />
      {cfg.visual && <LeaderVisualChart out={out} rows={rows} name={cfg.name} value={cfg.value} fmt={cfg.fmt} target={cfg.target} visual={cfg.visual} />}
      <ol className="rl-rank">
        {rows.map((r: ReportRow, i) => {
          const v = num(r[cfg.value]);
          const t = cfg.target ? num(r[cfg.target]) : 0;
          const width = Math.min(100, (v / max) * 100);
          const marker = t ? Math.min(100, (t / max) * 100) : null;
          const ok = t ? v >= t : null;
          return (
            <li key={r._key} className="rl-rank-row">
              <span className={cx('rl-medal', i < 3 && `is-${i + 1}`)} aria-label={W.rank(i + 1)}>
                {i + 1}
              </span>
              <ImageTile name={text(r[cfg.name])} size={32} shape="circle" />
              <div className="rl-rank-main">
                <div className="rl-rank-name">
                  <NameLink to={hrefOf(out, r)}>{text(r[cfg.name])}</NameLink>
                  {cfg.status && (
                    <span className={cx('rl-dot', text(r[cfg.status.key]) === cfg.status.good ? 'is-good' : 'is-idle')} data-tooltip={text(r[cfg.status.key])}>
                      {text(r[cfg.status.key])}
                    </span>
                  )}
                </div>
                <div className="rl-bar" aria-hidden="true">
                  <span className={cx('rl-bar-fill', ok === true && 'is-good', ok === false && 'is-short')} style={{ width: `${width}%` }} />
                  {marker !== null && <span className="rl-bar-target" style={{ left: `${marker}%` }} />}
                </div>
                {!!cfg.extras?.length && (
                  <div className="rl-extras muted">
                    {cfg.extras.map((x) => (
                      <span key={x.key}>
                        {x.label} <b>{r[x.key] === null || r[x.key] === '' || r[x.key] === undefined ? '—' : cellText(out, x.key, r[x.key])}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="rl-rank-fig">
                <strong>{fmtOf(v, cfg.fmt)}</strong>
                {t > 0 ? <span className={cx('rl-sub', ok ? 'is-good' : '')}>{W.achieved(Math.round((v / t) * 100))}</span> : total > 0 && !cfg.asc ? <span className="rl-sub muted">{W.of(Math.round((v / total) * 100))}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
