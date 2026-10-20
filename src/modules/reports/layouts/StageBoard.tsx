import { Link } from 'react-router-dom';
import { L } from '../../../constants/labels';
import { cx } from '../../../lib/format';
import type { Fmt } from '../../../services/reports/types';
import { fmtOf, Headline, KpiInline, type LayoutProps } from './shared';

const W = L.reports.layouts;

export interface BoardItem {
  id: string;
  title: string;
  sub?: string;
  amount?: string;
  href?: string;
}
export interface BoardColumn {
  key: string;
  label: string;
  count: number;
  /** Figure the share bar and the headline use (money, or the count again). */
  value: number;
  sub?: string;
  tone?: 'good' | 'warn' | 'bad';
  items?: BoardItem[];
}

/** Stages side by side: a share bar on top, then one card per stage with its count, figure and the first few records. */
export function StageBoard({ out, columns, fmt, head }: LayoutProps & { columns: BoardColumn[]; fmt: Fmt; head: string }) {
  const total = columns.reduce((t, c) => t + c.value, 0);
  if (!columns.length || total === 0) return <p className="rl-empty muted">{W.noData}</p>;
  return (
    <div className="rl-board">
      <Headline>{head}</Headline>
      <KpiInline kpis={out.kpis} />
      <div className="rl-share" role="img" aria-label={columns.map((c) => `${c.label} ${fmtOf(c.value, fmt)}`).join(', ')}>
        {columns.map((c, i) => (
          <span key={c.key} className={`rl-share-seg s${i % 6}`} style={{ flexGrow: Math.max(c.value, total * 0.02) }} data-tooltip={`${c.label}: ${fmtOf(c.value, fmt)}`} />
        ))}
      </div>
      <div className="rl-stages">
        {columns.map((c, i) => (
          <section key={c.key} className={cx('rl-stage', c.tone && `is-${c.tone}`)} aria-label={c.label}>
            <header>
              <span className={`rl-swatch s${i % 6}`} aria-hidden="true" />
              <h3>{c.label}</h3>
              <span className="rl-count">{c.count}</span>
            </header>
            <div className="rl-stage-fig">{fmtOf(c.value, fmt)}</div>
            {c.sub && <div className="rl-stage-sub muted">{c.sub}</div>}
            {c.items && (
              <ul className="rl-items">
                {c.items.slice(0, 4).map((it) => {
                  const body = (
                    <>
                      <span className="rl-item-title">{it.title}</span>
                      {it.sub && <span className="rl-item-sub muted">{it.sub}</span>}
                      {it.amount && <span className="rl-item-amt">{it.amount}</span>}
                    </>
                  );
                  return <li key={it.id}>{it.href ? <Link to={it.href}>{body}</Link> : <div>{body}</div>}</li>;
                })}
                {c.items.length > 4 && <li className="rl-more muted">{W.more(c.items.length - 4)}</li>}
                {!c.items.length && <li className="rl-more muted">{W.boardEmpty}</li>}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
