/**
 * Deal History tab: one newest-first timeline for the whole deal chain (lead ↔ opportunity ↔ quotations ↔
 * sales order ↔ contract and their child records), grouped by local day, filterable by type and by record.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDateTime, formatWeekdayFull, relativeTime, todayKey, toDateKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { DEAL_FILTERS, type DealEvent, type DealFilter, dealHistory, filterDealEvents } from '../../services/dealHistory';
import { EmptyState, ErrorState } from '../primitives/feedback';
import { Icon } from '../primitives/Icon';
import { InfoTip } from '../primitives/InfoTip';
import { SelectMenu } from '../primitives/SelectMenu';
import { Skeleton } from '../primitives/Skeleton';
import type { RecordData, ResourceDefinition } from '../../metadata/types';
import './deal.css';

const D = L.common.deal;

function dayTitle(key: string): string {
  const today = todayKey();
  const label = formatWeekdayFull(key);
  if (key === today) return `${D.today} · ${label}`;
  if (key === addDays(today, -1)) return `${D.yesterday} · ${label}`;
  return label;
}

export function DealHistoryTab({ res, actor, record }: { res: ResourceDefinition; actor: Actor; record: RecordData }) {
  const [type, setType] = useState<DealFilter>('all');
  const [source, setSource] = useState('');
  const q = useServiceQuery(() => dealHistory(actor, res.key, record.id), [res.key, record.id, actor.user.id, actor.workspaceId]);

  const shown = useMemo(() => (q.data ? filterDealEvents(q.data.events, type, source) : []), [q.data, type, source]);
  const days = useMemo(() => {
    const out: { key: string; items: DealEvent[] }[] = [];
    shown.forEach((e) => {
      const key = toDateKey(new Date(e.ts));
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, items: [e] });
    });
    return out;
  }, [shown]);

  if (q.error)
    return (
      <ErrorState title={D.errorTitle} onRetry={q.retry}>
        {q.error}
      </ErrorState>
    );
  if (!q.data) return <Skeleton rows={5} />;
  if (!q.data.events.length)
    return (
      <EmptyState icon="activity" title={D.emptyTitle}>
        {D.emptyBody}
      </EmptyState>
    );

  const sourceOptions = [{ value: '', label: D.allRecords }, ...q.data.sources.map((s) => ({ value: `${s.resource}:${s.id}`, label: s.label }))];
  return (
    <div className="deal-history">
      <div className="deal-history-tools">
        <h3 className="detail-section-title dialog-title-row">
          {D.title}
          <InfoTip text={D.about} label={D.aboutLabel} />
        </h3>
        <span className="spacer" />
        <SelectMenu<DealFilter> value={type} label={D.filterLabel} onChange={setType} options={DEAL_FILTERS.map((f) => ({ value: f, label: D.filters[f] }))} />
        {sourceOptions.length > 2 && <SelectMenu<string> value={source} label={D.recordFilter} onChange={setSource} options={sourceOptions} />}
        <span className="muted small">{D.count(shown.length)}</span>
      </div>
      {!shown.length ? (
        <EmptyState icon="filter" title={D.emptyFiltered} />
      ) : (
        days.map((day) => (
          <section key={day.key} className="deal-history-day" aria-label={dayTitle(day.key)}>
            <h4 className="deal-history-day-title">{dayTitle(day.key)}</h4>
            <ol className="deal-history-list flow-list">
              {day.items.map((e) => (
                <DealHistoryItem key={e.id} e={e} actor={actor} current={e.source.resource === res.key && e.source.id === record.id} />
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

function DealHistoryItem({ e, actor, current }: { e: DealEvent; actor: Actor; current: boolean }) {
  const iso = new Date(e.ts).toISOString();
  return (
    <li className="deal-history-item">
      <span className={cx('deal-history-icon', `is-${e.type}`)} aria-hidden="true">
        <Icon name={e.icon} size={14} />
      </span>
      <div className="deal-history-main">
        <div className="deal-history-head">
          <span className="deal-history-title">{e.title}</span>
          {current ? (
            <span className="tag mono">{e.source.label}</span>
          ) : (
            <Link className="tag mono deal-history-source" to={recordPeekPath(actor.workspaceId, e.source.resource, e.source.id)} aria-label={D.openSource(e.source.label)}>
              {e.source.label}
            </Link>
          )}
        </div>
        {e.detail && <p className="deal-history-detail">{e.detail}</p>}
        {e.changes && (
          <ul className="change-list">
            {e.changes.map((c) => (
              <li key={c.field}>
                {c.label}: <span className="muted">{c.before}</span> → {c.after}
              </li>
            ))}
          </ul>
        )}
        <span className="deal-history-meta small">
          {e.actorName}
          {e.automatic && <span className="muted"> ({D.workflow})</span>}
          <span aria-hidden="true"> · </span>
          <time dateTime={iso}>{formatDateTime(iso)}</time>
          <span aria-hidden="true"> · </span>
          {relativeTime(iso)}
        </span>
      </div>
    </li>
  );
}
