import { SETTINGS_NAV, type SettingsNavItem } from '../../domain/settingsNav';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { appModules, organization, workspaces } from '../../domain/pack';
import { cx } from '../../lib/format';
import { pagePath, recordPeekPath, resourcePath, wsBase } from '../../lib/routes';
import { keyOfSlug, ROUTES } from '../../constants/routes';
import { PHONE, TABLET, useMedia } from '../../lib/useMedia';
import { can, canReadResource, currentActor } from '../../services/authz';
import { resetDemoData } from '../../services/demo';
import { listNotifications, markAllRead, markNotification, snoozeNotification } from '../../services/collab';
import { getPersistError } from '../../services/db';
import { idleExpired, signOut, touchSession } from '../../services/session';
import { isOffline, pendingWrites, setOffline, subscribeOffline } from '../../services/offline';
import { useActor, useRevision } from '../../services/hooks';
import { getResource, getRole, signInUsers } from '../../services/registry';
import { searchRecords } from '../../services/search';
import { getSettings, SIDEBAR_MAX, SIDEBAR_MIN, switchSession, toggleFavorite, togglePin, updateSettings } from '../../services/settings';
import { errorMessage } from '../../services/api/client';
import { listViews } from '../../services/views';
import { relativeTime } from '../../lib/dates';
import { applyPalette, DEFAULT_PALETTE_ID, findPalette, type Palette } from '../../lib/palette';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Avatar, useToast } from '../primitives/feedback';
import { Dialog, Drawer, Popover, useLayer } from '../primitives/overlay';
import { HelpContent } from './help';
import { GlobalRecordDrawer } from './GlobalRecordDrawer';
import { InfoTip } from '../primitives/InfoTip';
import { TOPBAR_TITLE_SLOT } from './PageHeader';
import { TYPE_ICON } from '../resource/ViewControls';
import { PaletteEditor, ThemePicker } from './ThemePicker';
import { GuidedTour, useTour, useTourHighlight } from './GuidedTour';
import { moduleTitle, RESOURCE_PAGES, workspaceForModule } from '../../domain/sidebar';
import { L } from '../../constants/labels';
import { SearchInput, TextField } from '../primitives/controls';

const C = L.common;

/** Where a module's rail icon goes: Dashboard for home, else its first readable resource list or first page. */
function moduleHome(actor: ReturnType<typeof useActor>, m: (typeof appModules)[number]) {
  if (m.id === 'home') return ROUTES.dashboard;
  if (m.id === 'leads' && (canReadResource(actor, 'leads') || canReadResource(actor, 'opportunities'))) return '/sales';
  const res = m.resources.find((r) => canReadResource(actor, r));
  if (res) return resourcePath(actor.workspaceId, res);
  const page = (m.pages ?? []).find((p) => !p.capability || can(actor, p.capability)) ?? m.pages![0];
  return pagePath(actor.workspaceId, m.id, page.path);
}

function moduleVisible(actor: ReturnType<typeof useActor>, m: (typeof appModules)[number]) {
  if (m.resources.some((r) => canReadResource(actor, r))) return true;
  return (m.pages ?? []).some((p) => !p.capability || can(actor, p.capability));
}

/** Module of the current URL: /admin/* → admin; /<resource> → its module; /<page> → the module owning the page. */
function activeModule(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return 'home';
  // Exact page match first, then the longest page prefix, then the resource slug.
  const pages = appModules.flatMap((m) => (m.pages ?? []).map((p) => ({ m: m.id, path: p.path })));
  const exact = pages.find((p) => p.path === pathname);
  if (exact) return exact.m;
  const slug = parts[0] === 'admin' ? `admin/${parts[1] ?? ''}` : parts[0];
  const key = keyOfSlug(slug);
  const byResource = key && appModules.find((m) => m.resources.includes(key));
  if (byResource) return byResource.id;
  if (key && RESOURCE_PAGES[key]) return workspaceForModule(RESOURCE_PAGES[key].module);
  if (parts[0] === 'admin') return 'admin';
  const prefix = pages.filter((p) => pathname.startsWith(`${p.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  return prefix?.m ?? pages.find((p) => p.path.split('/')[1] === parts[0])?.m ?? 'home';
}

export function AppShell({ children }: { children: ReactNode }) {
  useRevision();
  const actor = useActor();
  const settings = getSettings(actor.user.id);
  const location = useLocation();
  const phone = useMedia(PHONE);
  const tablet = useMedia(TABLET);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // COM-12: the account menu opens Help (with the guided tour) through this event.
  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener(OPEN_HELP_EVENT, open);
    return () => window.removeEventListener(OPEN_HELP_EVENT, open);
  }, []);
  const mod = activeModule(location.pathname);
  const drawerNav = tablet;

  useEffect(() => setNavOpen(false), [location.pathname]);

  // Simulated session timeout (NFR-08): activity keeps the session alive; idle sessions lock.
  const toast = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    let last = 0;
    const onActivity = () => {
      if (Date.now() - last > 15_000) {
        last = Date.now();
        touchSession();
      }
    };
    const timer = window.setInterval(() => {
      if (idleExpired()) {
        signOut('idle');
        toast(C.account.idleSignedOut, 'info');
        navigate(ROUTES.login);
      }
    }, 20_000);
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Theme + rail skin are personal settings.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  // Colour theme (palette): preset or the user's own; the default palette applies no overrides.
  const palette = findPalette(settings.palette, settings.customPalettes);
  useEffect(() => applyPalette(palette), [palette.id, palette.accent, palette.sidebar, palette.rail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const persistError = getPersistError();
  const tour = useTour();

  return (
    <div className={cx('app', settings.navDensity === 'compact' && 'nav-compact')} data-rail-skin={palette.id === DEFAULT_PALETTE_ID ? settings.railSkin : 'palette'}>
      <a href="#main" className="skip-link">
        {C.shell.skipToContent}
      </a>
      <div className="shell">
        {!phone && <IconRail mod={mod} onSearch={() => setPaletteOpen(true)} onHelp={() => setHelpOpen(true)} />}
        {/* Always mounted so collapse / expand can animate smoothly (width slides to 0) */}
        {!drawerNav && <ContextSidebar mod={mod} collapsed={settings.sidebarCollapsed} />}
        {drawerNav && navOpen && <MobileNav mod={mod} onClose={() => setNavOpen(false)} onSearch={() => setPaletteOpen(true)} onHelp={() => setHelpOpen(true)} showRail={phone} />}
        <div className="workspace">
          {/* The banner sits over the content column only: the rail and sidebar always start at the top. */}
          <div className="preview-banner" role="note">
            <Icon name="info" size={14} />
            <span>
              <strong>{C.shell.banner.prototype}</strong>
              {C.shell.banner.text}
            </span>
            <button type="button" className="link" onClick={() => setHelpOpen(true)}>
              {C.shell.banner.whatIsReal}
            </button>
          </div>
          {persistError && (
            <div className="preview-banner tone-danger" role="alert">
              {C.shell.banner.storageError(persistError)}
            </div>
          )}
          <TopBar onMenu={() => setNavOpen(true)} showMenu={drawerNav || settings.sidebarCollapsed} onSearch={() => setPaletteOpen(true)} />
          <main id="main" className="canvas" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <GlobalRecordDrawer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Drawer open={helpOpen} onClose={() => setHelpOpen(false)} title={C.shell.helpTitle}>
        <HelpContent
          mod={mod}
          onStartTour={() => {
            setHelpOpen(false);
            tour.start();
          }}
        />
      </Drawer>
      {tour.open && <GuidedTour onClose={tour.close} />}
    </div>
  );
}

// ---------------------------------------------------------------- Icon rail

function IconRail({ mod, onSearch, onHelp }: { mod: string; onSearch: () => void; onHelp: () => void }) {
  const actor = useActor();
  const unread = listNotifications(actor).filter((n) => !n.readAt).length;
  const navigate = useNavigate();
  const location = useLocation();
  const tourHighlight = useTourHighlight();
  return (
    <nav className="rail" aria-label={C.shell.modulesNav}>
      <Link to={ROUTES.dashboard} className="rail-brand" aria-label={C.shell.home(organization.name)} data-tooltip={organization.name}>
        <span aria-hidden="true">{organization.monogram}</span>
      </Link>
      {/* Brand stays at the top and the profile at the bottom; everything between scrolls when the window is short. */}
      <div className="rail-scroll">
        <ul className="rail-list">
          {appModules
            .filter((m) => m.id !== 'admin' && moduleVisible(actor, m))
            .map((m) => (
              <li key={m.id}>
                <Link
                  to={moduleHome(actor, m)}
                  className={cx('rail-item', mod === m.id && 'is-active', tourHighlight.includes(m.id) && 'is-tour-highlight')}
                  aria-current={mod === m.id ? 'page' : undefined}
                  aria-label={moduleTitle(m.id)}
                  data-tooltip={moduleTitle(m.id)}
                >
                  <Icon name={m.icon} />
                </Link>
              </li>
            ))}
        </ul>
        <ul className="rail-list rail-bottom">
          <li>
            <button type="button" className="rail-item" aria-label={C.shell.searchAria} data-tooltip={C.shell.searchTip} onClick={onSearch}>
              <Icon name="search" />
            </button>
          </li>
          <li>
            <button
              type="button"
              className={cx('rail-item', location.pathname === ROUTES.notifications && 'is-active')}
              aria-label={C.shell.notificationsAria(unread)}
              data-tooltip={L.nav.pages.notifications.title}
              onClick={() => navigate(ROUTES.notifications)}
            >
              <Icon name="inbox" />
              {unread > 0 && (
                <span className="rail-badge" aria-hidden="true">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </li>
          <li>
            <button type="button" className="rail-item" aria-label={C.shell.aiAria} data-tooltip={C.shell.aiTip} aria-disabled="true" onClick={onHelp}>
              <Icon name="sparkles" />
            </button>
          </li>
          <li>
            <Link
              to={moduleHome(
                actor,
                appModules.find((x) => x.id === 'admin')!,
              )}
              className={cx('rail-item', mod === 'admin' && 'is-active', tourHighlight.includes('admin') && 'is-tour-highlight')}
              aria-label={C.shell.adminAria}
              data-tooltip={moduleTitle('admin')}
            >
              <Icon name="settings" />
            </Link>
          </li>
          {/* Theme & colours and the user's profile live at the bottom of the rail (owner rule) */}
          <li>
            <ThemeButton inRail />
          </li>
        </ul>
      </div>
      <div className="rail-foot">
        <AccountMenu inRail />
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- Context sidebar

type NavEntry = {
  key: string;
  label: string;
  path: string;
  icon?: string;
  active: boolean;
  /** icon used in Favorites / Results when the row itself is text-only */ altIcon?: string;
};

/** Star beside a sidebar option: hidden until hover/focus; filled (accent) once it is a favourite. */
function FavStar({ entry }: { entry: NavEntry }) {
  const actor = useActor();
  const fav = getSettings(actor.user.id).favorites.some((f) => f.path === entry.path);
  return (
    <button
      type="button"
      className={cx('nav-star', fav && 'is-on')}
      aria-pressed={fav}
      aria-label={fav ? C.sidebar.removeFavorite(entry.label) : C.sidebar.addFavorite(entry.label)}
      data-tooltip={fav ? C.sidebar.removeFavoriteTip : C.sidebar.addFavoriteTip}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(actor, {
          label: entry.label,
          path: entry.path,
          icon: entry.icon ?? entry.altIcon,
        });
      }}
    >
      <Icon name="star" size={14} />
    </button>
  );
}

function NavItem({ entry, star = true }: { entry: NavEntry; star?: boolean }) {
  return (
    <li className="nav-item">
      <Link to={entry.path} className={cx('nav-row', !entry.icon && 'nav-child', entry.active && 'is-active')} aria-current={entry.active ? 'page' : undefined}>
        {entry.icon && <Icon name={entry.icon} />}
        <span className="nav-label">{entry.label}</span>
      </Link>
      {star && <FavStar entry={entry} />}
    </li>
  );
}


/** Settings left nav: grouped, sticky (the sidebar does not scroll with the page), filtered by what the role may open. */
function SettingsNav({ headerAction }: { headerAction?: ReactNode }) {
  const actor = useActor();
  const location = useLocation();
  const K = L.settingsKit.nav;
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const allowed = (i: SettingsNavItem) => (i.resource ? canReadResource(actor, i.resource) : !i.capability || can(actor, i.capability));
  const groups = SETTINGS_NAV.map((g) => ({
    id: g.id,
    items: g.items.filter(allowed).filter((i) => !needle || (K.items[i.id] ?? i.id).toLowerCase().includes(needle)),
  })).filter((g) => g.items.length);
  const active = (i: SettingsNavItem) => location.pathname === i.path || (i.resource !== undefined && location.pathname.startsWith(`${i.path}/`));
  return (
    <>
      <div className="sidebar-head">
        <span className="sidebar-title">{K.title}</span>
        {headerAction}
      </div>
      <div className="sidebar-search">
        <Icon name="search" size={14} />
        <SearchInput placeholder={K.find} aria-label={K.findAria} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      </div>
      <div className="sidebar-scroll">
        {groups.length ? (
          groups.map((g) => (
            <div key={g.id} className="nav-group">
              <span className="nav-section is-static">{(K.groups as Record<string, string>)[g.id]}</span>
              <ul className="nav-list">
                {g.items.map((i) => (
                  <NavItem key={i.id} star={false} entry={{ key: i.id, label: K.items[i.id] ?? i.id, path: i.path, icon: i.icon, active: active(i) }} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="nav-empty muted">{K.noMatch(q)}</p>
        )}
      </div>
    </>
  );
}

function SidebarContent({ mod, headerAction }: { mod: string; headerAction?: ReactNode }) {
  const actor = useActor();
  const settings = getSettings(actor.user.id);
  const location = useLocation();
  const m = appModules.find((x) => x.id === mod) ?? appModules[0];
  const here = location.pathname + location.search;
  const [q, setQ] = useState('');
  const [collapsedGroups, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => {
    const n = new Set(collapsedGroups);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setCollapsed(n);
  };

  // Everything the sidebar can open, built once — the search and the favourites use the same entries.
  const pages: NavEntry[] = (m.pages ?? [])
    .filter((p) => !p.capability || can(actor, p.capability))
    .map((p) => {
      const path = pagePath(actor.workspaceId, m.id, p.path);
      return {
        key: `page:${p.id}`,
        label: p.label,
        path,
        icon: p.icon,
        active: location.pathname === path,
      };
    });
  const groups = m.resources
    .filter((r) => canReadResource(actor, r))
    .map((rk) => {
      const res = getResource(rk);
      const views = listViews(actor, rk);
      const base = resourcePath(actor.workspaceId, rk);
      const current = location.pathname === base ? (new URLSearchParams(location.search).get('view') ?? (settings.defaultViews[rk] || settings.lastViews[rk] || views[0]?.id)) : undefined;
      const withIcons = m.navChildIcons?.includes(rk);
      const items: NavEntry[] = views.map((v) => {
        const typeIcon = TYPE_ICON[v.type];
        return {
          key: `view:${v.id}`,
          label: v.name,
          path: `${base}?view=${v.id}`,
          icon: withIcons ? typeIcon : undefined,
          altIcon: typeIcon,
          active: current === v.id,
        };
      });
      return { rk, label: res.labelPlural, items };
    });
  // Compact (sectioned) sidebar: each section = its record lists (one row each) + its pages; only the section
  // you are in opens by default. Saved views are not rows here — they are tabs on the list and stay searchable.
  const resourceRows: NavEntry[] = groups.map((g) => {
    const base = resourcePath(actor.workspaceId, g.rk);
    return { key: `res:${g.rk}`, label: g.label, path: base, icon: getResource(g.rk).icon, active: location.pathname === base || location.pathname.startsWith(`${base}/`) };
  });
  const sections = (m.sections ?? [])
    .map((s) => ({
      ...s,
      items: [...resourceRows.filter((e) => s.resources.includes(e.key.slice(4))), ...pages.filter((e) => s.pages.includes(e.key.slice(5)))],
    }))
    .filter((s) => s.items.length > 0);
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});
  const all = [...pages, ...(m.sections ? resourceRows : []), ...groups.flatMap((g) => g.items)];
  const needle = q.trim().toLowerCase();
  const results = needle ? all.filter((e) => e.label.toLowerCase().includes(needle)) : [];

  if (mod === 'admin') return <SettingsNav headerAction={headerAction} />;

  return (
    <>
      <div className="sidebar-head">
        {/* Short sidebar name on one line; the full BRD module name is the tooltip. */}
        <span className="sidebar-title" title={moduleTitle(m.id)}>
          {m.label}
        </span>
        {headerAction}
      </div>
      <div className="sidebar-search">
        <Icon name="search" size={14} />
        <SearchInput placeholder={C.sidebar.findPage(all.length)} aria-label={C.sidebar.findPageAria} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      </div>
      <div className="sidebar-scroll">
        {/* Section separators are plain muted text. Rows WITH an icon: icon + text. Rows WITHOUT an icon
            (children of a group): text only, indented under the group label. ☆ on hover → Favorites (top). */}
        {needle ? (
          <>
            <span className="nav-section is-static">{C.sidebar.results}</span>
            {results.length ? (
              <ul className="nav-list">
                {results.map((e) => (
                  <NavItem key={e.key} entry={{ ...e, icon: e.icon ?? e.altIcon }} />
                ))}
              </ul>
            ) : (
              <p className="nav-empty muted">{C.sidebar.noPagesMatch(q)}</p>
            )}
          </>
        ) : (
          <>
            {settings.favorites.length > 0 && (
              <>
                <span className="nav-section is-static">{C.sidebar.favorites}</span>
                <ul className="nav-list">
                  {settings.favorites.map((f) => (
                    <NavItem
                      key={f.path}
                      entry={{
                        key: f.path,
                        label: f.label,
                        path: f.path,
                        icon: f.icon ?? 'table',
                        active: here === f.path || location.pathname === f.path,
                      }}
                    />
                  ))}
                </ul>
              </>
            )}
            {sections.length > 0 &&
              sections.map((s) => {
                const open = sectionOpen[s.id] ?? s.items.some((e) => e.active);
                return (
                  <div key={s.id} className="nav-tree nav-section-group">
                    <button type="button" className={cx('nav-row nav-toggle', !open && s.items.some((e) => e.active) && 'is-active')} aria-expanded={open} onClick={() => setSectionOpen((o) => ({ ...o, [s.id]: !open }))}>
                      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                      <span className="nav-label">{s.label}</span>
                      <span className="nav-count">{s.items.length}</span>
                    </button>
                    {open && (
                      <ul className="nav-list nav-children has-icons">
                        {s.items.map((e) => (
                          <NavItem key={e.key} entry={e} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            {!sections.length && pages.length > 0 && <span className="nav-section is-static">{C.sidebar.pages}</span>}
            {!sections.length && <ul className="nav-list">
              {pages.map((e) => (
                <NavItem key={e.key} entry={e} />
              ))}
              {m.id === 'admin' &&
                (m.pages ?? [])
                  .filter((p) => p.capability && !can(actor, p.capability))
                  .map((p) => (
                    <li key={p.id}>
                      <span className="nav-row is-disabled" data-tooltip={C.states.notAvailableFor(actor.role.label)}>
                        <Icon name="lock" />
                        <span className="nav-label">{p.label}</span>
                      </span>
                    </li>
                  ))}
            </ul>}
            {!sections.length && groups.length > 0 && <span className="nav-section is-static">{C.sidebar.menu}</span>}
            {!sections.length && groups.map((g) => {
              const open = !collapsedGroups.has(g.rk);
              return (
                <div key={g.rk} className="nav-tree">
                  <button type="button" className="nav-row nav-toggle" aria-expanded={open} onClick={() => toggleGroup(g.rk)}>
                    <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                    <span className="nav-label">{g.label}</span>
                    <span className="nav-count">{g.items.length}</span>
                  </button>
                  {open && (
                    <ul className={cx('nav-list nav-children', g.items.some((e) => e.icon) && 'has-icons')}>
                      {g.items.map((e) => (
                        <NavItem key={e.key} entry={e} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {settings.pins.length > 0 && (
              <div className="nav-group">
                <span className="nav-section is-static">{C.sidebar.pinned}</span>
                <ul className="nav-list">
                  {settings.pins.map((p) => (
                    <li key={p.path} className="nav-pin">
                      <Link to={p.path} className={cx('nav-row', here === p.path && 'is-active')}>
                        <Icon name="pin" />
                        <span className="nav-label">{p.label}</span>
                      </Link>
                      <button type="button" className="nav-unpin" aria-label={C.sidebar.unpin(p.label)} onClick={() => togglePin(actor, p.label, p.path)}>
                        <Icon name="x" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {settings.recents.length > 0 && (
              <div className="nav-group">
                <span className="nav-section is-static">{C.sidebar.recent}</span>
                <ul className="nav-list">
                  {settings.recents.slice(0, 5).map((r) => (
                    <li key={r.path}>
                      <Link to={r.path} className="nav-row">
                        <Icon name="reset" />
                        <span className="nav-label">{r.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ContextSidebar({ mod, collapsed = false }: { mod: string; collapsed?: boolean }) {
  const actor = useActor();
  const settings = getSettings(actor.user.id);
  const [width, setWidth] = useState(settings.sidebarWidth);
  const [dragging, setDragging] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  // Collapsed sidebar stays mounted for the animation but is not focusable or clickable.
  useEffect(() => {
    if (collapsed) navRef.current?.setAttribute('inert', '');
    else navRef.current?.removeAttribute('inert');
  }, [collapsed]);
  useEffect(() => setWidth(settings.sidebarWidth), [settings.sidebarWidth]);
  const startDrag = (x0: number) => {
    let w = width;
    setDragging(true);
    const move = (e: PointerEvent) => {
      w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width + e.clientX - x0));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      updateSettings(actor.user.id, { sidebarWidth: w });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <nav className={cx('sidebar', collapsed && 'is-collapsed', dragging && 'is-dragging')} style={{ width: collapsed ? 0 : width }} aria-label={C.shell.moduleNavigation} aria-hidden={collapsed || undefined} ref={navRef}>
      <div className="sidebar-inner" style={{ width }}>
        <SidebarContent mod={mod} headerAction={<IconButton icon="panel-left" label={C.shell.collapseSidebar} onClick={() => updateSettings(actor.user.id, { sidebarCollapsed: true })} className="sidebar-toggle" />} />
      </div>
      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={C.shell.resizeSidebar}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          startDrag(e.clientX);
        }}
        onDoubleClick={() => updateSettings(actor.user.id, { sidebarWidth: 240 })}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            updateSettings(actor.user.id, {
              sidebarWidth: width + (e.key === 'ArrowRight' ? 16 : -16),
            });
          }
        }}
      />
    </nav>
  );
}

function MobileNav({ mod, onClose, onSearch, onHelp, showRail }: { mod: string; onClose: () => void; onSearch: () => void; onHelp: () => void; showRail: boolean }) {
  const actor = useActor();
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, onClose);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a,button')?.focus();
  }, []);
  return (
    <div className="overlay-scrim overlay-scrim-left" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="mobile-nav" role="dialog" aria-modal="true" aria-label={C.shell.navigation}>
        {showRail && (
          <div className="mobile-modules">
            {appModules
              .filter((m) => moduleVisible(actor, m))
              .map((m) => (
                <Link key={m.id} to={moduleHome(actor, m)} className={cx('mobile-module', mod === m.id && 'is-active')} aria-current={mod === m.id ? 'page' : undefined}>
                  <Icon name={m.icon} />
                  <span>{m.label}</span>
                </Link>
              ))}
            <button type="button" className="mobile-module" onClick={onSearch}>
              <Icon name="search" />
              <span>{C.shell.search}</span>
            </button>
            <button type="button" className="mobile-module" onClick={onHelp}>
              <Icon name="help" />
              <span>{C.shell.help}</span>
            </button>
          </div>
        )}
        <div className="sidebar mobile-sidebar">
          <SidebarContent mod={mod} />
        </div>
        <IconButton icon="x" label={C.shell.closeNavigation} onClick={onClose} className="mobile-nav-close" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Top bar: workspace, notifications, account

function TopBar({ onMenu, showMenu, onSearch }: { onMenu: () => void; showMenu: boolean; onSearch: () => void }) {
  const actor = useActor();
  const phone = useMedia(PHONE); // on phones the rail is hidden, so theme + profile stay in the top bar
  const settings = getSettings(actor.user.id);
  return (
    <div className="topbar">
      <div className="topbar-left">
        {showMenu &&
          (settings.sidebarCollapsed && !window.matchMedia(TABLET).matches ? (
            <IconButton icon="panel-left" label={C.shell.expandSidebar} onClick={() => updateSettings(actor.user.id, { sidebarCollapsed: false })} />
          ) : (
            <IconButton icon="menu" label={C.shell.openNavigation} onClick={onMenu} />
          ))}
        {/* Page title + ⓘ description are portalled here by <PageHeader>. */}
        <div id={TOPBAR_TITLE_SLOT} className="topbar-title" />
      </div>
      <button type="button" className="topbar-search" onClick={onSearch} aria-label={C.shell.searchTopbarAria}>
        <Icon name="search" size={14} />
        <span>{C.shell.searchTopbar}</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="topbar-right">
        {workspaces.length > 1 && <WorkspaceSwitcher />}
        <OfflineToggle />
        {phone && <ThemeButton />}
        <NotificationBell />
        {phone && <AccountMenu />}
      </div>
    </div>
  );
}

/** NFR-15 simulated offline mode: queues field writes; going online syncs them and reports conflicts. */
function OfflineToggle() {
  const off = useSyncExternalStore(subscribeOffline, isOffline, isOffline);
  const pending = useSyncExternalStore(
    subscribeOffline,
    () => pendingWrites().length,
    () => 0,
  );
  const toast = useToast();
  return (
    <IconButton
      icon={off ? 'eye-off' : 'activity'}
      label={off ? C.shell.offline.offlineLabel(pending) : C.shell.offline.onlineLabel}
      badge={off ? pending : undefined}
      aria-pressed={off}
      className={off ? 'is-offline' : undefined}
      onClick={() => {
        const r = setOffline(!off);
        if (!r) toast(C.shell.offline.wentOffline, 'info');
        else if (r.conflicts.length) toast(C.shell.offline.backOnlineConflicts(r.synced.length, r.conflicts.length, r.conflicts.map((c) => `${c.label}: ${c.message}`).join('; ')), 'danger');
        else toast(r.synced.length ? C.shell.offline.backOnlineSynced(r.synced.length) : C.shell.offline.backOnline, 'success');
      }}
    />
  );
}

function WorkspaceSwitcher() {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const ws = workspaces.find((w) => w.id === actor.workspaceId)!;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="ws-switch"
        data-tooltip={`${organization.name} / ${ws.name}`}
        aria-label={C.shell.workspace.aria(ws.name)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="building" size={14} />
        <span className="ws-name">{ws.name}</span>
        <Icon name="chevrons-up-down" size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={C.shell.workspace.switch} width={260}>
        <p className="pop-label dialog-title-row">
          {C.shell.workspace.heading(organization.name)}
          <InfoTip text={C.shell.workspace.about} label={C.shell.workspace.aboutLabel} />
        </p>
        <ul className="menu">
          {workspaces.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                className={cx('menu-item', w.id === actor.workspaceId && 'is-current')}
                onClick={() => {
                  setOpen(false);
                  if (w.id === actor.workspaceId) return;
                  switchSession(actor.user.id, w.id);
                  const rest = location.pathname.split('/').slice(5).join('/') || 'dashboard';
                  navigate(`${wsBase(w.id)}/${rest}`);
                }}
              >
                <Icon name={w.id === actor.workspaceId ? 'check' : 'circle'} />
                <span className="menu-label">{w.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

function NotificationBell() {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const items = listNotifications(actor);
  const unread = items.filter((n) => !n.readAt).length;
  const go = (n: (typeof items)[number]) => {
    markNotification(actor, n.id, true);
    setOpen(false);
    if (!n.link) return;
    if ('page' in n.link) navigate(n.link.page === 'inbox' ? `${ROUTES.notifications}?tab=approvals` : `/${n.link.page}`);
    else navigate(recordPeekPath(actor.workspaceId, n.link.resource, n.link.recordId));
  };
  return (
    <>
      <IconButton ref={ref} icon="bell" label={C.shell.notificationsAria(unread)} badge={unread} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={C.notifications.title} width={360} align="end">
        <div className="pop-head">
          <span className="dialog-title-row">
            <strong>{C.notifications.title}</strong>
            <InfoTip text={C.notifications.about} label={C.notifications.aboutLabel} />
          </span>
          <Button variant="ghost" onClick={() => markAllRead(actor)} disabledReason={unread ? undefined : C.notifications.nothingUnread}>
            {C.notifications.markAllRead}
          </Button>
        </div>
        {items.length ? (
          <ul className="notif-list">
            {items.slice(0, 12).map((n) => (
              <li key={n.id} className={cx('notif', !n.readAt && 'is-unread')}>
                <button type="button" className="notif-main" onClick={() => go(n)}>
                  {!n.readAt && <span className="unread-dot" aria-label={C.notifications.unread} />}
                  <span>
                    <span className="notif-title">{n.title}</span>
                    <span className="muted small">
                      {C.notifications.kinds[n.kind] ?? n.kind.replace(/_/g, ' ')} · {relativeTime(n.createdAt)}
                    </span>
                  </span>
                </button>
                <IconButton icon="calendar-clock" label={C.notifications.snoozeAria} onClick={() => snoozeNotification(actor, n.id, 4)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted pop-empty">{C.notifications.allCaughtUp}</p>
        )}
        <Link className="pop-foot link" to={ROUTES.notifications} onClick={() => setOpen(false)}>
          {C.notifications.openAll}
        </Link>
      </Popover>
    </>
  );
}

/** Theme changer in the top bar: mode + colour palettes (presets and the user's own). */
function ThemeButton({ inRail = false }: { inRail?: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Palette | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      {inRail ? (
        <button
          ref={ref}
          type="button"
          className={cx('rail-item', open && 'is-active')}
          aria-label={C.shell.themeAria}
          data-tooltip={C.shell.themeTip}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="palette" />
        </button>
      ) : (
        <IconButton ref={ref} icon="palette" label={C.shell.themeAria} aria-haspopup="dialog" aria-expanded={open} pressed={open} onClick={() => setOpen((o) => !o)} />
      )}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref}
        label={C.shell.themeAria}
        width={360}
        align={inRail ? 'start' : 'end'}
        side={inRail ? 'right' : 'bottom'}
        className={cx('theme-pop', inRail && 'from-rail')}
      >
        <div className="pop-head">
          <strong>{C.shell.theme}</strong>
        </div>
        <ThemePicker
          onEditPalette={(p) => {
            setOpen(false);
            setEditing(p);
          }}
        />
      </Popover>
      {editing && <PaletteEditor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const OPEN_HELP_EVENT = 'tc:open-help';

function AccountMenu({ inRail = false }: { inRail?: boolean }) {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const navigate = useNavigate();
  return (
    <>
      {inRail ? (
        <button
          ref={ref}
          type="button"
          className={cx('rail-item rail-profile', open && 'is-active')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          aria-label={C.account.aria(actor.user.name, actor.role.label)}
          data-tooltip={C.account.tip(actor.user.name, actor.role.label)}
        >
          <Avatar name={actor.user.name} size={30} />
        </button>
      ) : (
        <button ref={ref} type="button" className="account-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={C.account.aria(actor.user.name, actor.role.label)}>
          <Avatar name={actor.user.name} size={26} />
          <span className="account-text hide-phone">
            <span className="account-name">{actor.user.name}</span>
            <span className="account-role">{actor.role.label}</span>
          </span>
        </button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={C.account.menu} width={320} align={inRail ? 'start' : 'end'} side={inRail ? 'right' : 'bottom'} className={cx(inRail && 'from-rail')}>
        <p className="pop-label">{C.account.switchUser}</p>
        <ul className="menu" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {signInUsers(actor.workspaceId).map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className={cx('menu-item', u.id === actor.user.id && 'is-current')}
                onClick={() => {
                  setOpen(false);
                  if (u.id === actor.user.id) return;
                  try {
                    switchSession(u.id, actor.workspaceId);
                  } catch (e) {
                    toast(errorMessage(e), 'danger');
                    return;
                  }
                  toast(C.account.nowViewingAs(u.name, C.account.rolePosition(getRole(u.roleId).label, u.title)), 'info');
                }}
              >
                <Avatar name={u.name} size={22} />
                <span className="menu-label">
                  {u.name}
                  <span className="menu-reason">{C.account.rolePosition(getRole(u.roleId).label, u.title)}</span>
                </span>
                {u.id === actor.user.id && <Icon name="check" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="menu-sep" />
        <ul className="menu">
          <li>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                navigate(ROUTES.notifications);
              }}
            >
              <Icon name="inbox" />
              <span className="menu-label">{C.account.myWork}</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                navigate(ROUTES.demoSettings);
              }}
            >
              <Icon name="sliders" />
              <span className="menu-label">{C.account.personalSettings}</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new Event(OPEN_HELP_EVENT));
              }}
            >
              <Icon name="info" />
              <span className="menu-label">{C.account.help}</span>
            </button>
          </li>
          {can(actor, 'demo.settings') && (
            <li>
              <button
                type="button"
                className="menu-item is-danger"
                onClick={() => {
                  setOpen(false);
                  setConfirmReset(true);
                }}
              >
                <Icon name="reset" />
                <span className="menu-label">{C.account.resetDemo}</span>
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                signOut();
                navigate(ROUTES.login);
              }}
            >
              <Icon name="door-open" />
              <span className="menu-label">{C.account.signOut}</span>
            </button>
          </li>
        </ul>
      </Popover>
      <ResetDialog open={confirmReset} onClose={() => setConfirmReset(false)} />
    </>
  );
}

export function ResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      role="alertdialog"
      title={C.confirm.resetTitle}
      description={C.confirm.resetDescription}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            {C.actions.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              try {
                resetDemoData(currentActor());
              } catch (e) {
                onClose();
                toast(errorMessage(e), 'danger');
                return;
              }
              onClose();
              toast(C.toasts.demoReset, 'info');
            }}
          >
            {C.confirm.resetAction}
          </Button>
        </>
      }
    >
      <p className="muted">{C.confirm.resetBody}</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Command palette

interface Cmd {
  id: string;
  label: string;
  hint: string;
  icon: string;
  run: () => void;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actor = useActor();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    const go = (to: string) => () => {
      onClose();
      navigate(to);
    };
    appModules.forEach((m) => {
      (m.pages ?? [])
        .filter((p) => !p.capability || can(actor, p.capability))
        .forEach((p) =>
          out.push({
            id: `p-${p.id}`,
            label: p.label,
            hint: m.label,
            icon: p.icon,
            run: go(pagePath(actor.workspaceId, m.id, p.path)),
          }),
        );
      m.resources
        .filter((r) => canReadResource(actor, r))
        .forEach((r) => {
          const res = getResource(r);
          out.push({
            id: `r-${r}`,
            label: res.labelPlural,
            hint: m.label,
            icon: res.icon === 'calendar' ? 'calendar' : res.icon,
            run: go(resourcePath(actor.workspaceId, r)),
          });
          listViews(actor, r).forEach((v) =>
            out.push({
              id: `v-${v.id}`,
              label: C.palette.viewLabel(res.labelPlural, v.name),
              hint: C.palette.savedView,
              icon: TYPE_ICON[v.type],
              run: go(resourcePath(actor.workspaceId, r, { view: v.id })),
            }),
          );
        });
    });
    getSettings(actor.user.id).recents.forEach((r) =>
      out.push({
        id: `rec-${r.path}`,
        label: r.label,
        hint: C.palette.recent,
        icon: 'reset',
        run: go(r.path),
      }),
    );
    return out;
  }, [actor.user.id, actor.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const records = useMemo(() => (open ? searchRecords(actor, q) : []), [q, open, actor.user.id, actor.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase();
  const list: Cmd[] = [
    ...records.map((h) => ({
      id: `rec-${h.resource}-${h.id}`,
      label: `${h.id} · ${h.title}`,
      hint: h.exact ? C.palette.exactId(h.resourceLabel) : h.resourceLabel,
      icon: 'search',
      run: () => {
        onClose();
        navigate(recordPeekPath(actor.workspaceId, h.resource, h.id));
      },
    })),
    ...commands.filter((c) => !needle || c.label.toLowerCase().includes(needle)).slice(0, needle ? 12 : 10),
  ];

  return (
    <Dialog open={open} onClose={onClose} title={C.palette.title} description={C.palette.description} size="md">
      <div className="palette">
        <TextField
          
          placeholder={C.palette.placeholder}
          aria-label={C.palette.title}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={list[active] ? `pal-${list[active].id}` : undefined}
          value={q}
          data-autofocus
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && list[active]) {
              e.preventDefault();
              list[active].run();
            }
          }}
        />
        <ul id="palette-list" role="listbox" className="palette-list" aria-label={C.palette.results}>
          {list.map((c, i) => (
            <li key={c.id} id={`pal-${c.id}`} role="option" aria-selected={i === active} className={cx('palette-item', i === active && 'is-active')} onMouseEnter={() => setActive(i)} onClick={c.run}>
              <Icon name={c.icon} />
              <span className="palette-label">{c.label}</span>
              <span className="muted small">{c.hint}</span>
            </li>
          ))}
          {!list.length && <li className="muted palette-empty">{C.palette.noResults}</li>}
        </ul>
      </div>
    </Dialog>
  );
}
