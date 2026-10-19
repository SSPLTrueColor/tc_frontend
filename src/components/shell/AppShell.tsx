import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { activeModule, appModules, appMonogram, appName, demoUsers, getRole } from '../../app/nav';
import { cx } from '../../lib/format';
import { PHONE, TABLET, useMedia } from '../../lib/useMedia';
import { getPersistError, getSettings, resetDemoData, SIDEBAR_MAX, SIDEBAR_MIN, switchUser, toggleFavorite, togglePin, updateSettings, useActor, useRevision } from '../../store/session';
import { applyPalette, DEFAULT_PALETTE_ID, findPalette } from '../../lib/palette';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Avatar, useToast } from '../primitives/feedback';
import { Dialog, Drawer, Popover, useLayer } from '../primitives/overlay';
import { HelpContent } from './help';
import { InfoTip } from '../primitives/InfoTip';
import { TOPBAR_TITLE_SLOT } from './PageHeader';

const moduleHome = (m: (typeof appModules)[number]) => m.pages[0]?.path ?? '/dashboard';


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
  const mod = activeModule(location.pathname);
  const drawerNav = tablet;

  useEffect(() => setNavOpen(false), [location.pathname]);

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

  return (
    <div className={cx('app', settings.navDensity === 'compact' && 'nav-compact')} data-rail-skin={palette.id === DEFAULT_PALETTE_ID ? settings.railSkin : 'palette'}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="preview-banner" role="note">
        <Icon name="info" size={14} />
        <span>
          <strong>Prototype</strong> · Synthetic data stored only in this browser · Roles are simulated (no real sign-in) · Nothing is sent, charged or shared.
        </span>
        <button type="button" className="link" onClick={() => setHelpOpen(true)}>
          What is real?
        </button>
      </div>
      {persistError && (
        <div className="preview-banner tone-danger" role="alert">
          Local storage is unavailable ({persistError}). Changes will be lost on reload.
        </div>
      )}
      <div className="shell">
        {!phone && <IconRail mod={mod} onSearch={() => setPaletteOpen(true)} onHelp={() => setHelpOpen(true)} />}
        {!drawerNav && !settings.sidebarCollapsed && <ContextSidebar mod={mod} />}
        {drawerNav && navOpen && <MobileNav mod={mod} onClose={() => setNavOpen(false)} onSearch={() => setPaletteOpen(true)} onHelp={() => setHelpOpen(true)} showRail={phone} />}
        <div className="workspace">
          <TopBar onMenu={() => setNavOpen(true)} showMenu={drawerNav || settings.sidebarCollapsed} onSearch={() => setPaletteOpen(true)} />
          <main id="main" className="canvas" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Drawer open={helpOpen} onClose={() => setHelpOpen(false)} title="Help & prototype boundaries">
        <HelpContent mod={mod} />
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------- Icon rail

function IconRail({ mod, onSearch, onHelp }: { mod: string; onSearch: () => void; onHelp: () => void }) {
  return (
    <nav className="rail" aria-label="Modules">
      <Link to="/dashboard" className="rail-brand" aria-label={`${appName} home`} data-tooltip={appName}>
        <span aria-hidden="true">{appMonogram}</span>
      </Link>
      <ul className="rail-list">
        {appModules
          .filter((m) => m.id !== 'admin')
          .map((m) => (
            <li key={m.id}>
              <Link to={moduleHome(m)} className={cx('rail-item', mod === m.id && 'is-active')} aria-current={mod === m.id ? 'page' : undefined} aria-label={m.label} data-tooltip={m.label}>
                <Icon name={m.icon} />
              </Link>
            </li>
          ))}
      </ul>
      <ul className="rail-list rail-bottom">
        <li>
          <button type="button" className="rail-item" aria-label="Search and commands (Ctrl+K)" data-tooltip="Search · Ctrl K" onClick={onSearch}>
            <Icon name="search" />
          </button>
        </li>
        <li>
          <button type="button" className="rail-item" aria-label="AI assistant (not available)" data-tooltip="AI assistant — not enabled in this prototype" aria-disabled="true" onClick={onHelp}>
            <Icon name="sparkles" />
          </button>
        </li>
      </ul>
    </nav>
  );
}


// ---------------------------------------------------------------- Context sidebar

type NavEntry = { key: string; label: string; path: string; icon?: string; active: boolean; /** icon used in Favorites / Results when the row itself is text-only */ altIcon?: string };

/** Star beside a sidebar option: hidden until hover/focus; filled (accent) once it is a favourite. */
function FavStar({ entry }: { entry: NavEntry }) {
  const actor = useActor();
  const fav = getSettings(actor.user.id).favorites.some((f) => f.path === entry.path);
  return (
    <button
      type="button"
      className={cx('nav-star', fav && 'is-on')}
      aria-pressed={fav}
      aria-label={fav ? `Remove ${entry.label} from favorites` : `Add ${entry.label} to favorites`}
      data-tooltip={fav ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(actor, { label: entry.label, path: entry.path, icon: entry.icon ?? entry.altIcon });
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
  const pages: NavEntry[] = m.pages.map((p) => ({ key: `page:${p.id}`, label: p.label, path: p.path, icon: p.icon, active: location.pathname === p.path }));
  const groups: { rk: string; label: string; items: NavEntry[] }[] = [];
  const all = [...pages, ...groups.flatMap((g) => g.items)];
  const needle = q.trim().toLowerCase();
  const results = needle ? all.filter((e) => e.label.toLowerCase().includes(needle)) : [];

  return (
    <>
      <div className="sidebar-head">
        <span className="sidebar-title">{m.label}</span>
        {headerAction}
      </div>
      <div className="sidebar-search">
        <Icon name="search" size={14} />
        <input type="search" placeholder={`Find a page (${all.length})`} aria-label="Find a page in this module" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      </div>
      <div className="sidebar-scroll">
        {/* Section separators are plain muted text. Rows WITH an icon: icon + text. Rows WITHOUT an icon
            (children of a group): text only, indented under the group label. ☆ on hover → Favorites (top). */}
        {needle ? (
          <>
            <span className="nav-section is-static">Results</span>
            {results.length ? (
              <ul className="nav-list">
                {results.map((e) => (
                  <NavItem key={e.key} entry={{ ...e, icon: e.icon ?? e.altIcon }} />
                ))}
              </ul>
            ) : (
              <p className="nav-empty muted">No pages match “{q}”.</p>
            )}
          </>
        ) : (
          <>
            {settings.favorites.length > 0 && (
              <>
                <span className="nav-section is-static">Favorites</span>
                <ul className="nav-list">
                  {settings.favorites.map((f) => (
                    <NavItem key={f.path} entry={{ key: f.path, label: f.label, path: f.path, icon: f.icon ?? 'list', active: here === f.path || location.pathname === f.path }} />
                  ))}
                </ul>
              </>
            )}
            {pages.length > 0 && <span className="nav-section is-static">Pages</span>}
            <ul className="nav-list">
              {pages.map((e) => (
                <NavItem key={e.key} entry={e} />
              ))}
            </ul>
            {groups.length > 0 && <span className="nav-section is-static">Menu</span>}
            {groups.map((g) => {
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
                <span className="nav-section is-static">Pinned</span>
                <ul className="nav-list">
                  {settings.pins.map((p) => (
                    <li key={p.path} className="nav-pin">
                      <Link to={p.path} className={cx('nav-row', here === p.path && 'is-active')}>
                        <Icon name="pin" />
                        <span className="nav-label">{p.label}</span>
                      </Link>
                      <button type="button" className="nav-unpin" aria-label={`Unpin ${p.label}`} onClick={() => togglePin(actor, p.label, p.path)}>
                        <Icon name="x" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {settings.recents.length > 0 && (
              <div className="nav-group">
                <span className="nav-section is-static">Recent</span>
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

function ContextSidebar({ mod }: { mod: string }) {
  const actor = useActor();
  const settings = getSettings(actor.user.id);
  const [width, setWidth] = useState(settings.sidebarWidth);
  useEffect(() => setWidth(settings.sidebarWidth), [settings.sidebarWidth]);
  const startDrag = (x0: number) => {
    let w = width;
    const move = (e: PointerEvent) => {
      w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width + e.clientX - x0));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      updateSettings(actor.user.id, { sidebarWidth: w });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <nav className="sidebar" style={{ width }} aria-label="Module navigation">
      <SidebarContent mod={mod} headerAction={<IconButton icon="panel-left" label="Collapse sidebar" onClick={() => updateSettings(actor.user.id, { sidebarCollapsed: true })} className="sidebar-toggle" />} />
      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
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
            updateSettings(actor.user.id, { sidebarWidth: width + (e.key === 'ArrowRight' ? 16 : -16) });
          }
        }}
      />
    </nav>
  );
}

function MobileNav({ mod, onClose, onSearch, onHelp, showRail }: { mod: string; onClose: () => void; onSearch: () => void; onHelp: () => void; showRail: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, onClose);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a,button')?.focus();
  }, []);
  return (
    <div className="overlay-scrim overlay-scrim-left" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
        {showRail && (
          <div className="mobile-modules">
            {appModules.map((m) => (
                <Link
                  key={m.id}
                  to={moduleHome(m)}
                  className={cx('mobile-module', mod === m.id && 'is-active')}
                  aria-current={mod === m.id ? 'page' : undefined}
                >
                  <Icon name={m.icon} />
                  <span>{m.label}</span>
                </Link>
              ))}
            <button type="button" className="mobile-module" onClick={onSearch}>
              <Icon name="search" />
              <span>Search</span>
            </button>
            <button type="button" className="mobile-module" onClick={onHelp}>
              <Icon name="help" />
              <span>Help</span>
            </button>
          </div>
        )}
        <div className="sidebar mobile-sidebar">
          <SidebarContent mod={mod} />
        </div>
        <IconButton icon="x" label="Close navigation" onClick={onClose} className="mobile-nav-close" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Top bar: notifications, account

function TopBar({ onMenu, showMenu, onSearch }: { onMenu: () => void; showMenu: boolean; onSearch: () => void }) {
  const actor = useActor();
  const settings = getSettings(actor.user.id);
  return (
    <div className="topbar">
      <div className="topbar-left">
        {showMenu &&
          (settings.sidebarCollapsed && !window.matchMedia(TABLET).matches ? (
            <IconButton icon="panel-left" label="Expand sidebar" onClick={() => updateSettings(actor.user.id, { sidebarCollapsed: false })} />
          ) : (
            <IconButton icon="menu" label="Open navigation" onClick={onMenu} />
          ))}
        {/* Page title + ⓘ description are portalled here by <PageHeader>. */}
        <div id={TOPBAR_TITLE_SLOT} className="topbar-title" />
      </div>
      <button type="button" className="topbar-search" onClick={onSearch} aria-label="Search records, pages and actions (Ctrl+K)">
        <Icon name="search" size={14} />
        <span>Search…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="topbar-right">
        <NotificationBell />
        <AccountMenu />
      </div>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={ref} icon="bell" label="Notifications" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Notifications" width={360} align="end">
        <div className="pop-head">
          <span className="dialog-title-row">
            <strong>Notifications</strong>
            <InfoTip text="Reading a notification never approves or completes the linked work." label="About notifications" />
          </span>
        </div>
        <p className="muted pop-empty">You’re all caught up.</p>
      </Popover>
    </>
  );
}


function AccountMenu() {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  return (
    <>
      <button ref={ref} type="button" className="account-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Account: ${actor.user.name}, ${actor.role.label}`}>
        <Avatar name={actor.user.name} size={26} />
        <span className="account-text hide-phone">
          <span className="account-name">{actor.user.name}</span>
          <span className="account-role">{actor.role.label}</span>
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Account and role" width={300} align="end">
        <p className="pop-label">Simulated sign-in (demo users)</p>
        <ul className="menu">
          {demoUsers.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className={cx('menu-item', u.id === actor.user.id && 'is-current')}
                onClick={() => {
                  setOpen(false);
                  if (u.id === actor.user.id) return;
                  switchUser(u.id);
                  toast(`Now viewing as ${u.name} (${getRole(u.roleId).label})`, 'info');
                }}
              >
                <Avatar name={u.name} size={22} />
                <span className="menu-label">
                  {u.name}
                  <span className="menu-reason">{getRole(u.roleId).label}</span>
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
              className="menu-item is-danger"
              onClick={() => {
                setOpen(false);
                setConfirmReset(true);
              }}
            >
              <Icon name="reset" />
              <span className="menu-label">Reset demo data…</span>
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
      title="Reset demo data?"
      description="Restores the original demo dataset in this browser. Your personal settings are kept."
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              resetDemoData();
              onClose();
              toast('Demo data reset', 'info');
            }}
          >
            Reset data
          </Button>
        </>
      }
    >
      <p className="muted">All records and changes you made will be discarded.</p>
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
    appModules.forEach((m) => m.pages.forEach((p) => out.push({ id: `p-${p.id}`, label: p.label, hint: m.label, icon: p.icon, run: go(p.path) })));
    getSettings(actor.user.id).recents.forEach((r) => out.push({ id: `rec-${r.path}`, label: r.label, hint: 'Recent', icon: 'reset', run: go(r.path) }));
    return out;
  }, [actor.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = q.trim().toLowerCase();
  const list: Cmd[] = [
    ...commands.filter((c) => !needle || c.label.toLowerCase().includes(needle)).slice(0, needle ? 12 : 10),
  ];

  return (
    <Dialog open={open} onClose={onClose} title="Search" description="Pages you can access." size="md">
      <div className="palette">
        <input
          className="input"
          placeholder="Type a page name…"
          aria-label="Search"
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
        <ul id="palette-list" role="listbox" className="palette-list" aria-label="Results">
          {list.map((c, i) => (
            <li key={c.id} id={`pal-${c.id}`} role="option" aria-selected={i === active} className={cx('palette-item', i === active && 'is-active')} onMouseEnter={() => setActive(i)} onClick={c.run}>
              <Icon name={c.icon} />
              <span className="palette-label">{c.label}</span>
              <span className="muted small">{c.hint}</span>
            </li>
          ))}
          {!list.length && <li className="muted palette-empty">No results you can access.</li>}
        </ul>
      </div>
    </Dialog>
  );
}
