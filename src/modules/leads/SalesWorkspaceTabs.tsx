import { Link } from 'react-router-dom';
import { canReadResource, type Actor } from '../../services/authz';
import { queryRecords } from '../../services/runtime';
import { useRevision } from '../../services/hooks';
import { cx } from '../../lib/format';
import { Icon } from '../../components/primitives/Icon';

/** How many records of a resource the actor can see (null when the count cannot be read). */
function countOf(actor: Actor, resKey: string): number | null {
  try {
    return queryRecords(actor, resKey).total;
  } catch {
    return null;
  }
}

/**
 * Page-level switcher for the Sales workspace — the parent navigation, so it sits directly under the page title
 * on all four pages (All · Leads · Opportunities · Pipeline). Each page's own saved views sit below it as smaller pills.
 */
export function SalesWorkspaceTabs({ actor, active }: { actor: Actor; active: string }) {
  useRevision();
  const leads = canReadResource(actor, 'leads');
  const opps = canReadResource(actor, 'opportunities');
  const tabs = [
    { key: 'all', label: 'All', icon: 'layers', path: '/sales', allowed: leads || opps, count: null as number | null },
    { key: 'leads', label: 'Leads', icon: 'target', path: '/leads', allowed: leads, count: leads ? countOf(actor, 'leads') : null },
    { key: 'opportunities', label: 'Opportunities', icon: 'trending-up', path: '/opportunities', allowed: opps, count: opps ? countOf(actor, 'opportunities') : null },
    { key: 'pipeline', label: 'Pipeline', icon: 'board', path: '/pipeline', allowed: opps, count: null },
  ];
  // Same look as the saved-view tabs on every other list page: 14px icon + name, active = semibold + 2px accent underline.
  return (
    <nav className="sales-nav" aria-label="Sales workspace">
      {tabs
        .filter((tab) => tab.allowed)
        .map((tab) => (
          <div key={tab.key} className={cx('view-tab', active === tab.key && 'is-active')}>
            <Link to={tab.path} className="view-tab-btn" aria-current={active === tab.key ? 'page' : undefined} title={tab.count !== null ? `${tab.label} · ${tab.count.toLocaleString('en-IN')}` : undefined}>
              <Icon name={tab.icon} size={14} />
              <span>{tab.label}</span>
            </Link>
          </div>
        ))}
    </nav>
  );
}
