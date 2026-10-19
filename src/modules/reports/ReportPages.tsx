import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES } from '../../constants/routes';
import { addDays, todayKey } from '../../lib/dates';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { call, errorMessage } from '../../services/api/client';
import { canExportReports, exportReport, listReports, runReport } from '../../services/api/reports';
import { downloadText } from '../../services/exporter';
import { useActor } from '../../services/hooks';
import { activeMasterValues } from '../../services/registry';
import { queryRecords } from '../../services/runtime';
import { getReport, REPORT_GROUPS } from '../../services/reports/catalog';
import { reportPath } from '../../services/reports/helpers';
import type { ReportDef, ReportFilters } from '../../services/reports/types';
import { Button } from '../../components/primitives/Button';
import { DateRangePicker } from '../../components/primitives/DateRangePicker';
import { Badge, EmptyState, ErrorState, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { KpiTiles, RankBars, ReportTable } from './components';

/** /reports and /reports/<group>: data-driven catalogue of the reports this role can open. */
export function ReportsCatalogPage({ group }: { group?: string }) {
  const actor = useActor();
  const [q, setQ] = useState('');
  const query = useServiceQuery(() => listReports(actor).map((r) => ({ id: r.id, title: r.title, group: r.group, fr: r.fr, description: r.description })), [actor.user.id]);
  const groups = REPORT_GROUPS.filter((g) => !group || g.id === group);
  const title = group ? REPORT_GROUPS.find((g) => g.id === group)?.label ?? group : L.nav.pages.reports.title;
  const needle = q.trim().toLowerCase();
  return (
    <div className="page">
      <PageHeader title={title} description={L.reports.catalog.description} />
      <div className="rep-toolbar">
        <input type="search" className="input input-compact" placeholder={L.reports.catalog.search} aria-label={L.reports.catalog.search} value={q} onChange={(e) => setQ(e.target.value)} />
        {group && (
          <Link to={ROUTES.reports} className="link small">
            {L.reports.catalog.allReports}
          </Link>
        )}
      </div>
      {query.error ? (
        <ErrorState title={L.reports.catalog.loadError} onRetry={query.retry}>
          {query.error}
        </ErrorState>
      ) : !query.data ? (
        <Skeleton rows={8} />
      ) : (
        (() => {
          const visible = query.data.filter((r) => !needle || `${r.title} ${r.description} ${r.fr.join(' ')}`.toLowerCase().includes(needle));
          const shown = groups.map((g) => ({ g, items: visible.filter((r) => r.group === g.id) })).filter((x) => x.items.length);
          if (!shown.length) return <EmptyState icon="search" title={needle ? L.reports.catalog.noMatchTitle : L.reports.catalog.noReportsTitle}>{needle ? L.reports.catalog.noMatchBody : L.reports.catalog.noReportsBody}</EmptyState>;
          return (
            <div className="rep-groups">
              {shown.map(({ g, items }) => (
                <section key={g.id} className="panel">
                  <div className="panel-head">
                    <h2 className="panel-title">{g.label}</h2>
                    <span className="muted small">{items.length}</span>
                  </div>
                  {items.map((r) => (
                    <Link key={r.id} to={reportPath(r.id)} className="rep-card">
                      <span className="rep-card-title">{r.title}</span>
                      <span className="muted small">{r.description}</span>
                      <span className="rep-frs">
                        {r.fr.map((f) => (
                          <Badge key={f} tone="neutral">
                            {f}
                          </Badge>
                        ))}
                      </span>
                    </Link>
                  ))}
                </section>
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}

const defaultRange = (def: ReportDef) => {
  const today = todayKey();
  if (def.filters.date === 'future') return { from: today, to: addDays(today, 90) };
  if (def.filters.date === 'past') return { from: addDays(today, -180), to: today };
  return {};
};

/** /reports/:reportId — or a group id, which shows that group's catalogue. */
export function ReportRoute() {
  const { reportId = '' } = useParams();
  if (REPORT_GROUPS.some((g) => g.id === reportId)) return <ReportsCatalogPage group={reportId} />;
  return <ReportViewer key={reportId} reportId={reportId} />;
}

function ReportViewer({ reportId }: { reportId: string }) {
  const actor = useActor();
  const toast = useToast();
  const def = getReport(reportId);
  const [params, setParams] = useSearchParams();
  const range = def ? defaultRange(def) : {};
  const filters: ReportFilters = {
    from: params.get('from') ?? range.from,
    to: params.get('to') ?? range.to,
    division: params.get('division') ?? undefined,
    owner: params.get('owner') ?? undefined,
    group: params.get('group') ?? def?.groupOptions?.[0]?.value,
  };
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const result = useServiceQuery(() => runReport(actor, reportId, filters), [reportId, actor.user.id, filters.from, filters.to, filters.division, filters.owner, filters.group]);
  const people = useServiceQuery(() => queryRecords(actor, 'employees', { sort: [{ field: 'fullName', dir: 'asc' }] }).rows.filter((e) => e.status !== 'inactive').map((e) => ({ value: e.id, label: String(e.fullName) })), [actor.user.id]);
  useEffect(() => setSearch(''), [reportId]);

  if (!def) return <NoAccess what={L.reports.viewer.noAccess} />;
  const allowed = listReports(actor).some((r) => r.id === def.id);
  if (!allowed) return <NoAccess what={def.title} />;

  const doExport = async () => {
    if (!result.data) return;
    setExporting(true);
    try {
      const csv = await call(() => exportReport(actor, def.id, result.data!, filters));
      downloadText(`${def.id}-${todayKey()}.csv`, csv);
      toast(L.reports.viewer.exported(result.data.rows.length));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={def.title}
        description={L.reports.viewer.covers(def.description, def.fr.join(', '))}
        actions={
          <>
            <Link to={reportPath(def.group)} className="btn btn-secondary">
              <span className="btn-label">{L.reports.viewer.moreReports(REPORT_GROUPS.find((g) => g.id === def.group)?.label ?? '')}</span>
            </Link>
            <Button icon="download" loading={exporting} onClick={doExport} disabledReason={!canExportReports(actor) ? L.reports.viewer.cannotExport(actor.role.label) : !result.data?.rows.length ? L.reports.viewer.nothingToExport : undefined}>
              {L.reports.viewer.exportCsv}
            </Button>
          </>
        }
      />
      <div className="rep-toolbar" role="group" aria-label={L.reports.viewer.filters}>
        {def.filters.date && (
          <>
            <span className="muted small">{def.dateLabel ?? L.reports.viewer.date}</span>
            <span className="rep-date">
              <DateRangePicker label={def.dateLabel ?? L.reports.viewer.dateRange} value={{ from: filters.from, to: filters.to }} onChange={(v) => set({ from: v.from, to: v.to })} />
            </span>
          </>
        )}
        {def.filters.division && (
          <SelectMenu label={L.reports.viewer.division} value={filters.division ?? ''} options={[{ value: '', label: L.reports.viewer.allDivisions }, ...activeMasterValues('division').map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => set({ division: v || undefined })} />
        )}
        {def.filters.owner && (
          <SelectMenu label={L.reports.viewer.user} searchable value={filters.owner ?? ''} options={[{ value: '', label: L.reports.viewer.everyone }, ...(people.data ?? [])]} onChange={(v) => set({ owner: v || undefined })} />
        )}
        {def.groupOptions && <SelectMenu label={L.reports.viewer.groupBy} value={filters.group ?? ''} options={def.groupOptions} onChange={(v) => set({ group: v })} />}
        <input type="search" className="input input-compact" placeholder={L.reports.viewer.searchRows} aria-label={L.reports.viewer.searchRows} value={search} onChange={(e) => setSearch(e.target.value)} />
        <InfoTip text={L.reports.viewer.scopeInfo} label={L.reports.viewer.scopeInfoLabel} />
      </div>
      {result.error ? (
        <ErrorState title={L.reports.viewer.runError} onRetry={result.retry}>
          {result.error}
        </ErrorState>
      ) : !result.data ? (
        <Skeleton rows={10} />
      ) : (
        <>
          {result.data.kpis && <KpiTiles tiles={result.data.kpis} label={L.reports.viewer.headlineFigures(def.title)} />}
          {result.data.rows.length === 0 ? (
            <EmptyState icon="search" title={L.reports.viewer.emptyTitle}>
              {L.reports.viewer.emptyBody}
            </EmptyState>
          ) : (
            <div className={result.data.chart ? 'dash-grid' : undefined}>
              {result.data.chart && (
                <section className="panel">
                  <RankBars {...result.data.chart} />
                </section>
              )}
              <section className="panel" style={result.data.chart ? { gridColumn: '1 / -1' } : undefined}>
                <ReportTable columns={result.data.columns} rows={result.data.rows} search={search} caption={def.title} />
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
