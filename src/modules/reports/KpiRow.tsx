import { SkeletonLine } from '../../components/primitives/Skeleton';
import { Link } from 'react-router-dom';
import '../dashboard/dashboard.css';
import { L } from '../../constants/labels';
import { EmptyValue } from '../../components/primitives/display';
import { Icon } from '../../components/primitives/Icon';
import { cx } from '../../lib/format';
import { formatReportDate, formatMetric } from '../../services/reports/format';
import type { KpiOut, ReportOutput } from '../../services/reports/types';

const K = L.reports.page.kpi;

function Delta({ k, range }: { k: KpiOut; range: string }) {
  if (k.prev === undefined) return null;
  const d = k.delta;
  if (d === null && k.prev === 0 && (k.value ?? 0) > 0) {
    return (
      <span className="kpi-delta is-flat" data-tooltip={K.newActivityHint}>
        {K.newActivity}
      </span>
    );
  }
  if (d === null) {
    return (
      <span className="kpi-delta is-flat" data-tooltip={K.noChangeBase}>
        <Icon name="minus" size={12} />
        <span className="sr-only">{K.noChangeBase}</span>
      </span>
    );
  }
  const flat = d === 0;
  const good = flat || k.better === 'none' ? null : (d > 0) === (k.better === 'up');
  const text = k.deltaKind === 'pp' ? K.pp(d) : K.pct(d);
  const verdict = good === null ? '' : good ? K.better : K.worse;
  return (
    <span className={cx('kpi-delta', good === null ? 'is-flat' : good ? 'is-good' : 'is-bad')} data-tooltip={`${K.vsPrevious} (${range})${k.prev === null ? '' : `: ${formatMetric(k.prev, k.fmt)}`}`}>
      <Icon name={flat ? 'minus' : d > 0 ? 'arrow-up' : 'arrow-down'} size={12} />
      {text}
      <span className="sr-only">{`${flat ? K.unchanged : d > 0 ? K.up : K.down}${verdict ? `, ${verdict}` : ''} ${K.vsPrevious}`}</span>
    </span>
  );
}

function Card({ k, range }: { k: KpiOut; range: string }) {
  const full = formatMetric(k.value, k.fmt);
  const body = (
    <>
      <div className="kpi-top">
        <span className="kpi-label" data-tooltip={k.hint ?? k.label}>
          {k.label}
        </span>
      </div>
      <div className="kpi-mid">
        <span className="kpi-value" data-tooltip={full && full !== formatMetric(k.value, k.fmt, { compact: true }) ? full : undefined}>
          {k.value === null ? <EmptyValue /> : formatMetric(k.value, k.fmt, { compact: true })}
        </span>
        <Delta k={k} range={range} />
      </div>
      <span className="kpi-sub">{k.prev === undefined ? K.snapshot : k.prev === null ? K.noPrevious : K.previous(formatMetric(k.prev, k.fmt, { compact: true }))}</span>
    </>
  );
  return k.to ? (
    <Link to={k.to} className="kpi-card">
      {body}
    </Link>
  ) : (
    <div className="kpi-card">{body}</div>
  );
}

/** 3–5 headline figures with the change against the previous period. */
export function KpiRow({ out, label }: { out: ReportOutput; label: string }) {
  const range = out.compared ? `${formatReportDate(out.compared.from)} – ${formatReportDate(out.compared.to)}` : '';
  return (
    <section className="rp-kpis" aria-label={label} style={{ ['--n' as string]: out.kpis.length }}>
      {out.kpis.map((k) => (
        <Card key={k.label} k={k} range={range} />
      ))}
    </section>
  );
}

export function KpiRowSkeleton({ n = 4 }: { n?: number }) {
  return (
    <section className="rp-kpis" aria-busy="true" aria-label={L.common.states.loading} style={{ ['--n' as string]: n }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="kpi-card">
          <SkeletonLine size="label" />
          <SkeletonLine size="value" />
          <SkeletonLine size="sub" />
        </div>
      ))}
    </section>
  );
}
