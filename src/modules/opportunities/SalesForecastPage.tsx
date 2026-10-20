import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { formatMoney } from '../../lib/format';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import { formatDate } from '../../lib/dates';
import { perm } from '../../services/authz';
import { runStagnationSweep } from '../../services/api/opportunities';
import { useActor } from '../../services/hooks';
import { computeForecast, type ForecastGroup, type ForecastPeriod } from '../../services/opportunities';
import { activeMasterValues } from '../../services/registry';
import { EmptyState, ErrorState, NoAccess, Skeleton } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { BarChart } from '../../components/resource/BarChart';
import { PageHeader } from '../../components/shell/PageHeader';
import { L } from '../../constants/labels';
import { moneyShort } from './format';
import { SegmentedControl } from '../../components/primitives/controls';
import { Table } from '../../components/primitives/Table';

const T = L.opportunities.pages.salesForecast;

type Measure = 'weighted' | 'commit' | 'pipeline' | 'won';
const MEASURES: { value: Measure; label: string }[] = (['weighted', 'commit', 'pipeline', 'won'] as const).map((value) => ({ value, label: T.measures[value] }));

/** FR-033 (OPP-07): monthly / quarterly weighted and commit forecast by owner, division or product type. */
export function SalesForecastPage() {
  const actor = useActor();
  const [period, setPeriod] = useState<ForecastPeriod>('month');
  const [horizon, setHorizon] = useState(6);
  const [groupBy, setGroupBy] = useState<ForecastGroup>('owner');
  const [measure, setMeasure] = useState<Measure>('weighted');
  const [division, setDivision] = useState('');
  const q = useServiceQuery(() => computeForecast(actor, { period, groupBy, horizon, divisionId: division || undefined }), [actor.user.id, period, groupBy, horizon, division]);

  useEffect(() => {
    void runStagnationSweep(actor).catch(() => undefined);
  }, [actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (perm(actor, 'opportunities').read === 'none') return <NoAccess what={L.opportunities.messages.noAccessForecast} />;
  const horizons = period === 'month' ? [3, 6, 12] : [2, 4];
  const f = q.data;
  return (
    <div className="page">
      <PageHeader title={L.nav.pages.salesForecast.title} description={T.description} />
      <div className="toolbar">
        <SegmentedControl
          label={T.period}
          value={period}
          onChange={(next) => {
            setPeriod(next);
            setHorizon(next === 'month' ? 6 : 4);
          }}
          options={(['month', 'quarter'] as const).map((p) => ({ value: p, label: p === 'month' ? T.monthly : T.quarterly }))}
        />
        <SelectMenu label={T.horizon} value={horizon} options={horizons.map((n) => ({ value: n, label: T.nextN(n, period) }))} onChange={setHorizon} />
        <SelectMenu<ForecastGroup>
          label={T.groupBy}
          value={groupBy}
          options={[
            { value: 'owner', label: T.byOwner },
            { value: 'division', label: T.byDivision },
            { value: 'productType', label: T.byProductType },
          ]}
          onChange={setGroupBy}
        />
        <SelectMenu label={T.division} value={division} options={[{ value: '', label: T.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={setDivision} />
        <SelectMenu<Measure> label={T.measure} value={measure} options={MEASURES} onChange={setMeasure} />
      </div>
      {q.error ? (
        <ErrorState title={T.errorTitle} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !f ? (
        <Skeleton rows={8} />
      ) : !f.count ? (
        <EmptyState icon="activity" title={T.emptyTitle}>
          {T.emptyBody(horizon, period)}
        </EmptyState>
      ) : (
        <>
          <section className="stats" aria-label={T.totals}>
            <div className="stat">
              <span className="stat-label">{T.weighted}</span>
              <span className="stat-value">{moneyShort(f.grand.weighted)}</span>
              <span className="stat-sub">{T.inRange(f.count)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{T.commit}</span>
              <span className="stat-value">{moneyShort(f.grand.commit)}</span>
              <span className="stat-sub">{T.commitSub}</span>
            </div>
            <Link className="stat" to={resourcePath(actor.workspaceId, 'opportunities', { view: 'v_opp_open' })}>
              <span className="stat-label">{T.openPipeline}</span>
              <span className="stat-value">{moneyShort(f.grand.pipeline)}</span>
              <span className="stat-sub">{T.bestCase}</span>
            </Link>
            <Link className="stat" to={resourcePath(actor.workspaceId, 'opportunities', { view: 'v_opp_closed' })}>
              <span className="stat-label">{T.won}</span>
              <span className="stat-value">{moneyShort(f.grand.won)}</span>
              <span className="stat-sub">{T.wonSub}</span>
            </Link>
          </section>
          <div className="dash-grid">
            <section className="panel">
              <BarChart data={f.periods.map((p) => ({ key: p.key, label: p.label, value: Math.round(f.totals[p.key][measure] / 1e4) / 10 }))} label={T.chartLabel(MEASURES.find((m) => m.value === measure)!.label, period)} unit={T.unitLakh} />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title dialog-title-row">
                  {T.largest}
                  <InfoTip text={T.largestTip} label={T.largestTipLabel} />
                </h2>
                <Link to={resourcePath(actor.workspaceId, 'opportunities', { view: 'v_opp_open' })} className="link small">
                  {T.allOpen}
                </Link>
              </div>
              {f.top.length ? (
                <ul className="flow-list">
                  {f.top.map((o) => (
                    <li key={o.id} className="flow-item">
                      <span className="tag tone-neutral">{Number(o.probability)}%</span>
                      <Link to={recordPeekPath(actor.workspaceId, 'opportunities', o.id)} className="flow-main">
                        <span className="flow-title">{String(o.name)}</span>
                        <span className="muted small">
                          {moneyShort(Number(o.value))} · {T.closes(formatDate(String(o.expectedCloseDate)))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{T.noneInRange}</p>
              )}
            </section>
          </div>
          <section className="panel">
            <h2 className="panel-title dialog-title-row">
              {MEASURES.find((m) => m.value === measure)!.label}
              <InfoTip text={T.tableTip} label={T.tableTipLabel} />
            </h2>
            
              <Table>
                <thead>
                  <tr>
                    <th scope="col">{groupBy === 'owner' ? T.owner : groupBy === 'division' ? T.division : T.productType}</th>
                    {f.periods.map((p) => (
                      <th key={p.key} scope="col" className="num">
                        {p.label}
                      </th>
                    ))}
                    <th scope="col" className="num">
                      {T.total}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {f.rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      {f.periods.map((p) => (
                        <td key={p.key} className="num" data-tooltip={formatMoney(r.cells[p.key][measure])}>
                          {r.cells[p.key][measure] ? moneyShort(r.cells[p.key][measure]) : '–'}
                        </td>
                      ))}
                      <td className="num">
                        <strong>{moneyShort(r.total[measure])}</strong>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">{T.total}</th>
                    {f.periods.map((p) => (
                      <td key={p.key} className="num">
                        <strong>{moneyShort(f.totals[p.key][measure])}</strong>
                      </td>
                    ))}
                    <td className="num">
                      <strong>{moneyShort(f.grand[measure])}</strong>
                    </td>
                  </tr>
                </tbody>
              </Table>
            
          </section>
        </>
      )}
    </div>
  );
}
