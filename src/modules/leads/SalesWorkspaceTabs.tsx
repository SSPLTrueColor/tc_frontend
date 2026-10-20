import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { canReadResource, type Actor } from '../../services/authz';
import { cx } from '../../lib/format';

/** Workspace switcher; `children` (e.g. New Lead) sit at the right end of the same line, so no extra header row is needed. */
export function SalesWorkspaceTabs({ actor, active, children }: { actor: Actor; active: string; children?: ReactNode }) {
  const tabs = [
    { key: 'all', label: 'All', path: '/sales', allowed: canReadResource(actor, 'leads') || canReadResource(actor, 'opportunities') },
    { key: 'leads', label: 'Leads', path: '/leads', allowed: canReadResource(actor, 'leads') },
    { key: 'opportunities', label: 'Opportunities', path: '/opportunities', allowed: canReadResource(actor, 'opportunities') },
    { key: 'pipeline', label: 'Pipeline', path: '/pipeline', allowed: canReadResource(actor, 'opportunities') },
  ];
  return <nav className="sales-workspace-tabs" aria-label="Sales workspace">
    {tabs.filter((tab) => tab.allowed).map((tab) => <Link key={tab.key} to={tab.path} className={cx('btn', active === tab.key && 'is-active')} aria-current={active === tab.key ? 'page' : undefined}>{tab.label}</Link>)}
    {children && <span className="sales-workspace-actions">{children}</span>}
  </nav>;
}
