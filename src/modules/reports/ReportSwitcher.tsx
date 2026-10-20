import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES } from '../../constants/routes';
import { cx } from '../../lib/format';
import { Icon } from '../../components/primitives/Icon';
import { SearchInput } from '../../components/primitives/controls';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { REPORT_GROUPS, getReport } from '../../services/reports/catalog';
import { reportPath } from '../../services/reports/helpers';
import type { ReportDef } from '../../services/reports/types';
import { useReportPrefs } from './usePrefs';

const W = L.reports.catalog.switcher;
/** Filters worth keeping when moving to another report (a view or group-by id means nothing there). */
const CARRY = ['preset', 'from', 'to', 'division', 'owner'];

/** The reports the actor may open, in catalogue order (category by category). */
export function orderedReports(allowed: string[]): ReportDef[] {
  const defs = allowed.map((id) => getReport(id)).filter((d): d is ReportDef => !!d);
  return REPORT_GROUPS.flatMap((g) => defs.filter((d) => d.group === g.id));
}

/** Reports before / after the current one, to step through a category without going back. */
export function neighbours(list: ReportDef[], id: string) {
  const i = list.findIndex((d) => d.id === id);
  return { prev: i > 0 ? list[i - 1] : undefined, next: i >= 0 && i < list.length - 1 ? list[i + 1] : undefined };
}

/**
 * The report rail: every report one click away from any report page, grouped by category (collapsible),
 * with the period / division / owner filters carried over. On narrow screens it becomes one dropdown.
 */
export function ReportSwitcher({ reports, currentId }: { reports: ReportDef[]; currentId: string }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const prefs = useReportPrefs();
  const [q, setQ] = useState('');
  const current = reports.find((r) => r.id === currentId);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const carry = useMemo(() => {
    const from = new URLSearchParams(loc.search);
    const to = new URLSearchParams();
    CARRY.forEach((k) => from.get(k) && to.set(k, from.get(k)!));
    const s = to.toString();
    return s ? `?${s}` : '';
  }, [loc.search]);
  const needle = q.trim().toLowerCase();
  const link = (d: ReportDef) => `${reportPath(d.id)}${carry}`;
  const favs = reports.filter((d) => prefs.favourites.includes(d.id));
  const groups = REPORT_GROUPS.map((g) => ({ g, items: reports.filter((d) => d.group === g.id && (!needle || `${d.title} ${d.description}`.toLowerCase().includes(needle))) })).filter((x) => x.items.length);

  const item = (d: ReportDef) => (
    <li key={d.id}>
      <Link to={link(d)} className={cx('rp-nav-item', d.id === currentId && 'is-current')} aria-current={d.id === currentId ? 'page' : undefined}>
        <Icon name={d.icon} size={14} />
        <span>{d.title}</span>
      </Link>
      <Link className="rp-nav-newtab" to={link(d)} target="_blank" rel="noreferrer" aria-label={W.openNewTab(d.title)} data-tooltip={W.openNewTab(d.title)}>
        <Icon name="external-link" size={12} />
      </Link>
    </li>
  );

  return (
    <>
      <div className="rp-switch-compact">
        <SelectMenu
          label={W.label}
          searchable
          value={currentId}
          options={groups.flatMap(({ items }) => items.map((d) => ({ value: d.id, label: d.title })))}
          onChange={(id) => navigate(`${reportPath(id)}${carry}`)}
        />
      </div>
      <nav className="rp-switch" aria-label={W.heading}>
        <div className="rp-switch-top">
          <Link to={`${ROUTES.reports}?all=1`} className="rp-switch-title">
            <Icon name="bar-chart" size={14} /> {W.heading}
          </Link>
        </div>
        <SearchInput dense placeholder={W.search} aria-label={W.search} value={q} onChange={(e) => setQ(e.target.value)} />
        {!needle && favs.length > 0 && (
          <section>
            <h3 className="rp-nav-group">
              <Icon name="star" size={12} /> {W.favourites}
            </h3>
            <ul className="rp-nav-list">{favs.map(item)}</ul>
          </section>
        )}
        {groups.length === 0 && <p className="muted small">{W.noMatch}</p>}
        {groups.map(({ g, items }) => {
          const hasCurrent = items.some((d) => d.id === currentId) || current?.group === g.id;
          const expanded = needle ? true : open[g.id] ?? hasCurrent;
          return (
            <section key={g.id}>
              <button type="button" className="rp-nav-group is-button" aria-expanded={expanded} onClick={() => setOpen({ ...open, [g.id]: !expanded })}>
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
                <span>{g.label}</span>
                <span className="muted rp-count">{items.length}</span>
              </button>
              {expanded && <ul className="rp-nav-list">{items.map(item)}</ul>}
            </section>
          );
        })}
      </nav>
    </>
  );
}
