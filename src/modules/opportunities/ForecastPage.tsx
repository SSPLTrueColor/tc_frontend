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
import { moneyShort } from './format';

type Measure = 'weighted' | 'commit' | 'pipeline' | 'won';
const MEASURES: { value: Measure; label: string }[] = [
  { value: 'weighted', label: 'Weighted (value × probability)' },
  { value: 'commit', label: 'Commit (negotiation + won)' },
  { value: 'pipeline', label: 'Pipeline (all open)' },
  { value: 'won', label: 'Won' },
];

/** FR-033: monthly / quarterly weighted and commit forecast by owner, division or product category. */
export function ForecastPage() {
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

  if (perm(actor, 'opportunities').read === 'none') return <NoAccess what="the sales forecast" />;
  const horizons = period === 'month' ? [3, 6, 12] : [2, 4];
  const f = q.data;
  return (
    <div className="page">
      <PageHeader title="Forecast" description="Computed live from the opportunities you can see. Weighted = value × stage probability for open deals by expected close date; Commit = deals in Negotiation plus deals won in the period. Quarters follow the Indian financial year (Q1 = Apr–Jun)." />
      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Period">
          {(['month', 'quarter'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              className={`seg-btn${period === p ? ' is-on' : ''}`}
              onClick={() => {
                setPeriod(p);
                setHorizon(p === 'month' ? 6 : 4);
              }}
            >
              {p === 'month' ? 'Monthly' : 'Quarterly'}
            </button>
          ))}
        </div>
        <SelectMenu label="Horizon" value={horizon} options={horizons.map((n) => ({ value: n, label: `Next ${n} ${period === 'month' ? 'months' : 'quarters'}` }))} onChange={setHorizon} />
        <SelectMenu<ForecastGroup>
          label="Group by"
          value={groupBy}
          options={[
            { value: 'owner', label: 'By owner' },
            { value: 'division', label: 'By division' },
            { value: 'productType', label: 'By product category' },
          ]}
          onChange={setGroupBy}
        />
        <SelectMenu label="Division" value={division} options={[{ value: '', label: 'All divisions' }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={setDivision} />
        <SelectMenu<Measure> label="Measure" value={measure} options={MEASURES} onChange={setMeasure} />
      </div>
      {q.error ? (
        <ErrorState title="Could not compute the forecast" onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !f ? (
        <Skeleton rows={8} />
      ) : !f.count ? (
        <EmptyState icon="activity" title="Nothing to forecast in this period">
          Open opportunities with an expected close date in the next {horizon} {period === 'month' ? 'months' : 'quarters'} appear here.
        </EmptyState>
      ) : (
        <>
          <section className="stats" aria-label="Forecast totals">
            <div className="stat">
              <span className="stat-label">Weighted</span>
              <span className="stat-value">{moneyShort(f.grand.weighted)}</span>
              <span className="stat-sub">{f.count} deals in range</span>
            </div>
            <div className="stat">
              <span className="stat-label">Commit</span>
              <span className="stat-value">{moneyShort(f.grand.commit)}</span>
              <span className="stat-sub">Negotiation + won</span>
            </div>
            <Link className="stat" to={resourcePath(actor.workspaceId, 'opportunities', { view: 'v_opp_open' })}>
              <span className="stat-label">Open pipeline</span>
              <span className="stat-value">{moneyShort(f.grand.pipeline)}</span>
              <span className="stat-sub">Best case</span>
            </Link>
            <Link className="stat" to={resourcePath(actor.workspaceId, 'opportunities', { view: 'v_opp_closed' })}>
              <span className="stat-label">Won</span>
              <span className="stat-value">{moneyShort(f.grand.won)}</span>
              <span className="stat-sub">In this range</span>
            </Link>
          </section>
          <div className="dash-grid">
            <section className="panel">
              <BarChart data={f.periods.map((p) => ({ key: p.key, label: p.label, value: Math.round(f.totals[p.key][measure] / 1e4) / 10 }))} label={`${MEASURES.find((m) => m.value === measure)!.label} by ${period} (₹ lakh)`} unit="₹ lakh" />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title dialog-title-row">
                  Largest open deals in range
                  <InfoTip text="Open opportunities with the highest weighted value closing in the selected range." label="About largest deals" />
                </h2>
                <Link to={resourcePath(actor.workspaceId, 'opportunities', { view: 'v_opp_open' })} className="link small">
                  All open
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
                          {moneyShort(Number(o.value))} · closes {formatDate(String(o.expectedCloseDate))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No open deals close in this range.</p>
              )}
            </section>
          </div>
          <section className="panel">
            <h2 className="panel-title dialog-title-row">
              {MEASURES.find((m) => m.value === measure)!.label}
              <InfoTip text="Hover a cell for the exact amount. Rows are sorted by weighted value." label="About the forecast table" />
            </h2>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">{groupBy === 'owner' ? 'Owner' : groupBy === 'division' ? 'Division' : 'Product category'}</th>
                    {f.periods.map((p) => (
                      <th key={p.key} scope="col" className="num">
                        {p.label}
                      </th>
                    ))}
                    <th scope="col" className="num">
                      Total
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
                    <th scope="row">Total</th>
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
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
