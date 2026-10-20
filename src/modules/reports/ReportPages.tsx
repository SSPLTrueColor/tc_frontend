import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES } from '../../constants/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { todayKey, relativeTime } from '../../lib/dates';
import { XLSX_MIME } from '../../lib/xlsx';
import { call, errorMessage } from '../../services/api/client';
import { canExportReports, exportReport, listReports, runReport } from '../../services/api/reports';
import { downloadBytes } from '../../services/exporter';
import { useActor } from '../../services/hooks';
import { getReport, LEGACY_REPORTS, REPORT_GROUPS } from '../../services/reports/catalog';
import { formatReportDate } from '../../services/reports/format';
import { reportPath } from '../../services/reports/helpers';
import { presetsFor } from '../../services/reports/periods';
import type { ReportDef, ReportOutput } from '../../services/reports/types';
import { Button, IconButton } from '../../components/primitives/Button';
import { Icon } from '../../components/primitives/Icon';
import { EmptyState, ErrorState, NoAccess, Skeleton, Tabs, useToast } from '../../components/primitives/feedback';
import { PageHeader } from '../../components/shell/PageHeader';
import { cx } from '../../lib/format';
import { FilterBar } from './FilterBar';
import { KpiRow, KpiRowSkeleton } from './KpiRow';
import { ChartSkeleton, ReportChart } from './ReportChart';
import { ReportTable, TableSkeleton, useTableModel } from './ReportTable';
import { useReportPrefs } from './usePrefs';
import { useReportState } from './useReportState';

const P = L.reports.page;

// ---------------------------------------------------------------- landing

function ReportCard({ def, viewedAt, favourite, onToggle, compact }: { def: ReportDef; viewedAt?: number; favourite: boolean; onToggle: () => void; compact?: boolean }) {
  return (
    <li className={cx('rp-card', compact && 'is-compact')}>
      <span className="rp-card-icon" aria-hidden="true">
        <Icon name={def.icon} size={18} />
      </span>
      <div className="rp-card-body">
        <Link to={reportPath(def.id)} className="rp-card-title">
          {def.title}
        </Link>
        <span className="rp-card-desc">{def.description}</span>
        <span className="rp-card-meta muted">{viewedAt ? P.viewed(relativeTime(new Date(viewedAt).toISOString())) : P.notOpened}</span>
      </div>
      <IconButton className={cx('rp-fav', favourite && 'is-on')} icon="star" label={favourite ? P.unfavourite(def.title) : P.favourite(def.title)} pressed={favourite} onClick={onToggle} />
    </li>
  );
}

/** /reports and /reports/<category>: reports as calm cards grouped by category, with favourites and recently viewed on top. */
export function ReportsCatalogPage({ group }: { group?: string }) {
  const actor = useActor();
  const prefs = useReportPrefs();
  const [q, setQ] = useState('');
  const query = useServiceQuery(() => listReports(actor).map((r) => r.id), [actor.user.id]);
  const allowed = new Set(query.data ?? []);
  const groups = REPORT_GROUPS.filter((g) => !group || g.id === group);
  const title = group ? groups[0]?.label ?? group : L.nav.pages.reports.title;
  const needle = q.trim().toLowerCase();
  const viewedAt = new Map(prefs.recent.map((r) => [r.id, r.at]));
  const defs = (query.data ?? []).map((id) => getReport(id)).filter((d): d is ReportDef => !!d);
  const matches = (d: ReportDef) => !needle || `${d.title} ${d.description}`.toLowerCase().includes(needle);
  const shown = groups.map((g) => ({ g, items: defs.filter((d) => d.group === g.id && matches(d)) })).filter((x) => x.items.length);
  const favs = defs.filter((d) => prefs.favourites.includes(d.id));
  const recents = prefs.recent.map((r) => getReport(r.id)).filter((d): d is ReportDef => !!d && allowed.has(d.id)).slice(0, 4);
  const card = (d: ReportDef, compact?: boolean) => <ReportCard key={d.id} def={d} compact={compact} viewedAt={viewedAt.get(d.id)} favourite={prefs.favourites.includes(d.id)} onToggle={() => prefs.toggle(d.id)} />;

  return (
    <div className="page rp-page">
      <PageHeader title={title} description={L.reports.catalog.description} />
      <div className="rp-landbar">
        <input type="search" className="input input-compact rp-search" placeholder={L.reports.catalog.search} aria-label={L.reports.catalog.search} value={q} onChange={(e) => setQ(e.target.value)} />
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
      ) : !defs.length ? (
        <EmptyState icon="bar-chart" title={L.reports.catalog.noReportsTitle}>
          {L.reports.catalog.noReportsBody}
        </EmptyState>
      ) : (
        <>
          {!needle && !group && (favs.length > 0 || recents.length > 0) && (
            <div className="rp-quick">
              {favs.length > 0 && (
                <section aria-label={P.favourites}>
                  <h2 className="rp-section-title">
                    <Icon name="star" size={14} /> {P.favourites}
                  </h2>
                  <ul className="rp-cards is-quick">{favs.map((d) => card(d, true))}</ul>
                </section>
              )}
              {recents.length > 0 && (
                <section aria-label={P.recent}>
                  <h2 className="rp-section-title">
                    <Icon name="clock" size={14} /> {P.recent}
                  </h2>
                  <ul className="rp-cards is-quick">{recents.map((d) => card(d, true))}</ul>
                </section>
              )}
            </div>
          )}
          {!shown.length ? (
            <EmptyState icon="search" title={L.reports.catalog.noMatchTitle} action={<Button onClick={() => setQ('')}>{P.clearSearch}</Button>}>
              {L.reports.catalog.noMatchBody}
            </EmptyState>
          ) : (
            shown.map(({ g, items }) => (
              <section key={g.id} className="rp-category" aria-label={g.label}>
                <h2 className="rp-section-title">
                  <Icon name={g.icon} size={14} />
                  {group ? g.label : <Link to={reportPath(g.id)}>{g.label}</Link>}
                  <span className="muted rp-count">{items.length}</span>
                </h2>
                <ul className="rp-cards">{items.map((d) => card(d))}</ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- report page

/** /reports/:reportId — or a category id (that category's cards), or an older report id (redirected). */
export function ReportRoute() {
  const { reportId = '' } = useParams();
  const loc = useLocation();
  if (REPORT_GROUPS.some((g) => g.id === reportId)) return <ReportsCatalogPage group={reportId} />;
  const moved = LEGACY_REPORTS[reportId];
  if (moved) {
    const sp = new URLSearchParams(loc.search);
    if (moved.view) sp.set('view', moved.view);
    return <Navigate to={`${reportPath(moved.id)}${[...sp].length ? `?${sp}` : ''}`} replace />;
  }
  return <OpenReport key={reportId} reportId={reportId} />;
}

/** A report that does not exist, or that this role cannot read, is "no access" — never an empty page. */
function OpenReport({ reportId }: { reportId: string }) {
  const actor = useActor();
  const def = getReport(reportId);
  if (!def || !listReports(actor).some((r) => r.id === def.id)) return <NoAccess what={def?.title ?? L.reports.viewer.noAccess} />;
  return <ReportPage def={def} />;
}

function ReportPage({ def }: { def: ReportDef }) {
  const actor = useActor();
  const toast = useToast();
  const prefs = useReportPrefs();
  const reportId = def.id;
  const today = todayKey();
  const state = useReportState(def, actor.user.id, today);
  const { view, filters } = state;

  const result = useServiceQuery(() => runReport(actor, reportId, view.id, filters), [reportId, view.id, actor.user.id, filters.from, filters.to, filters.division, filters.owner, filters.group]);

  // Keep showing the previous figures (dimmed) while a changed filter reloads, so the page does not jump.
  const last = useRef<{ key: string; data: ReportOutput } | null>(null);
  if (result.data) last.current = { key: `${reportId}|${view.id}`, data: result.data };
  const stale = !result.data && last.current?.key === `${reportId}|${view.id}` ? last.current.data : undefined;
  const out = result.data ?? stale;
  const refreshing = !result.data && !!stale && !result.error;

  const model = useTableModel(out?.columns ?? [], out?.rows ?? [], `${reportId}|${view.id}`);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    prefs.touch(reportId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const fav = prefs.favourites.includes(def.id);
  const kind = view.filters.date;
  const presetLabel = kind ? presetsFor(kind, today).find((p) => p.id === state.preset)?.label : undefined;
  const filterLines = [
    ...(kind ? [P.excel.period(view.dateLabel ?? P.filters.period, state.preset === 'custom' || !presetLabel ? '' : presetLabel, filters.from ? formatReportDate(filters.from) : '…', filters.to ? formatReportDate(filters.to) : '…')] : []),
    ...(filters.division ? [P.excel.line(P.filters.division, filters.division)] : []),
    ...(filters.owner ? [P.excel.line(P.filters.user, filters.owner)] : []),
    ...(model.search.trim() ? [P.excel.line(P.table.search, model.search.trim())] : []),
  ];

  const doExport = async () => {
    if (!out) return;
    setExporting(true);
    try {
      const bytes = await call(() => exportReport(actor, def.id, { viewLabel: def.views.length > 1 ? view.label : def.title, columns: model.visible, rows: model.rows, filterLines, generatedAt: formatReportDate(today) }));
      downloadBytes(`${def.id}${def.views.length > 1 ? `-${view.id}` : ''}-${today}.xlsx`, bytes, XLSX_MIME);
      toast(L.reports.viewer.exported(model.rows.length));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setExporting(false);
    }
  };

  const loading = !out && !result.error;
  const focusFilters = () => {
    const first = document.querySelector<HTMLElement>('.rp-filters button, .rp-filters input');
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first?.focus();
  };

  return (
    <div className="page rp-page">
      <PageHeader title={def.title} description={def.description} />
      <div className="rp-head">
        <p className="rp-desc">{def.description}</p>
        <div className="rp-actions">
          <Link to={reportPath(def.group)} className="btn btn-ghost" data-tooltip={P.moreInCategory}>
            <Icon name="chevron-left" />
            <span className="btn-label">{REPORT_GROUPS.find((g) => g.id === def.group)?.label}</span>
          </Link>
          <IconButton className={cx('rp-fav', fav && 'is-on')} icon="star" label={fav ? P.unfavourite(def.title) : P.favourite(def.title)} pressed={fav} variant="secondary" onClick={() => prefs.toggle(def.id)} />
          <Button
            icon="file-spreadsheet"
            loading={exporting}
            onClick={doExport}
            disabledReason={!canExportReports(actor) ? L.reports.viewer.cannotExport(actor.role.label) : !out || !model.rows.length ? L.reports.viewer.nothingToExport : undefined}
          >
            {P.exportExcel}
          </Button>
        </div>
      </div>

      {def.views.length > 1 && <Tabs label={P.views(def.title)} value={view.id} onChange={(id) => state.set({ view: id })} tabs={def.views.map((v) => ({ id: v.id, label: v.label }))} />}
      <FilterBar state={state} />

      {result.error && !out ? (
        <ErrorState title={L.reports.viewer.runError} onRetry={result.retry}>
          {result.error}
        </ErrorState>
      ) : loading ? (
        <div className="rp-body" aria-busy="true">
          <KpiRowSkeleton n={view.kpis.length} />
          {view.chart && <ChartSkeleton />}
          <TableSkeleton />
        </div>
      ) : (
        out && (
          <div className="rp-body" role="region" aria-label={def.title} id={`panel-${view.id}`} aria-labelledby={def.views.length > 1 ? `tab-${view.id}` : undefined}>
            {result.error && (
              <ErrorState title={L.reports.viewer.runError} onRetry={result.retry}>
                {result.error}
              </ErrorState>
            )}
            <div className={cx('rp-stack', refreshing && 'is-busy')}>
              <KpiRow out={out} label={L.reports.viewer.headlineFigures(def.title)} />
              {out.chart && <ReportChart chart={out.chart} busy={refreshing} />}
              <ReportTable model={model} title={P.table.details} busy={refreshing} onChangeFilters={focusFilters} />
            </div>
          </div>
        )
      )}
    </div>
  );
}
