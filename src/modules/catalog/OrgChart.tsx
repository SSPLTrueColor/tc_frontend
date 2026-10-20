import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { recordPeekPath } from '../../lib/routes';
import type { OrgNode } from '../../services/catalog/admin';
import { masterLabel } from '../../services/registry';
import { Avatar, Badge } from '../../components/primitives/feedback';
import { IconButton } from '../../components/primitives/Button';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { cx } from '../../lib/format';

const O = L.admin.organisation;

const NODE_W = 208;
const NODE_H = 76;
const GAP_X = 24;
const GAP_Y = 52;
const MIN_K = 0.25;
const MAX_K = 1.6;
/** Division colour bands cycle through these tokens. */
const BANDS = ['--s-accent', '--s-info', '--s-success', '--s-warning', '--s-danger'];

interface Laid {
  node: OrgNode;
  id: string;
  x: number;
  y: number;
  parent: string | null;
  depth: number;
  hidden: number;
  team: number;
}

const idOf = (n: OrgNode) => String(n.employee.id);
const countAll = (n: OrgNode): number => n.reports.reduce((s, r) => s + 1 + countAll(r), 0);
const depthOf = (nodes: OrgNode[]): number => (nodes.length ? 1 + Math.max(...nodes.map((n) => depthOf(n.reports))) : 0);

/** Tidy top-down layout: every parent is centred over its visible children; roots sit side by side. */
function layout(roots: OrgNode[], collapsed: Set<string>): Laid[] {
  const out: Laid[] = [];
  const kids = (n: OrgNode) => (collapsed.has(idOf(n)) ? [] : n.reports);
  const width = (n: OrgNode): number => {
    const k = kids(n);
    return k.length ? Math.max(NODE_W, k.reduce((s, c) => s + width(c), 0) + GAP_X * (k.length - 1)) : NODE_W;
  };
  const place = (n: OrgNode, left: number, depth: number, parent: string | null) => {
    const w = width(n);
    const k = kids(n);
    out.push({ node: n, id: idOf(n), x: left + w / 2 - NODE_W / 2, y: depth * (NODE_H + GAP_Y), parent, depth, hidden: n.reports.length - k.length, team: countAll(n) });
    let cx0 = left + (w - (k.reduce((s, c) => s + width(c), 0) + GAP_X * Math.max(0, k.length - 1))) / 2;
    for (const c of k) {
      place(c, cx0, depth + 1, idOf(n));
      cx0 += width(c) + GAP_X;
    }
  };
  let left = 0;
  for (const r of roots) {
    place(r, left, 0, null);
    left += width(r) + GAP_X * 2;
  }
  return out;
}

const ancestorsOf = (roots: OrgNode[], target: Set<string>): Set<string> => {
  const found = new Set<string>();
  const walk = (n: OrgNode): boolean => {
    let hit = target.has(idOf(n));
    for (const r of n.reports) if (walk(r)) hit = true;
    if (hit && !target.has(idOf(n))) found.add(idOf(n));
    return hit;
  };
  roots.forEach(walk);
  return found;
};

interface View {
  x: number;
  y: number;
  k: number;
}

export function OrgChart({ tree, ws, divisions }: { tree: OrgNode[]; ws: string; divisions: { key: string; label: string }[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const walk = (n: OrgNode, d: number) => {
      if (d >= 1 && n.reports.length) s.add(idOf(n));
      n.reports.forEach((r) => walk(r, d + 1));
    };
    tree.forEach((n) => walk(n, 0));
    return s;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [division, setDivision] = useState('');
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const laid = useMemo(() => layout(tree, collapsed), [tree, collapsed]);
  const byId = useMemo(() => new Map(laid.map((l) => [l.id, l])), [laid]);
  const bounds = useMemo(() => {
    const maxX = Math.max(...laid.map((l) => l.x + NODE_W), NODE_W);
    const maxY = Math.max(...laid.map((l) => l.y + NODE_H), NODE_H);
    return { w: maxX, h: maxY };
  }, [laid]);

  const q = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return new Set<string>();
    const s = new Set<string>();
    const walk = (n: OrgNode) => {
      if (`${String(n.employee.fullName)} ${String(n.employee.designation ?? '')} ${masterLabel('role', n.employee.roleId)}`.toLowerCase().includes(q)) s.add(idOf(n));
      n.reports.forEach(walk);
    };
    tree.forEach(walk);
    return s;
  }, [tree, q]);

  const fit = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const pad = 32;
    const k = Math.min(1, Math.max(MIN_K, Math.min((el.clientWidth - pad * 2) / bounds.w, (el.clientHeight - pad * 2) / bounds.h)));
    setView({ k, x: (el.clientWidth - bounds.w * k) / 2, y: pad });
  }, [bounds]);

  /** Opening view: readable size, centred on the largest team (the whole chart is one click away with "Fit"). */
  const home = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const roots = laid.filter((l) => l.depth === 0);
    const focal = roots.reduce((a, b) => (b.team > a.team ? b : a), roots[0]);
    const fitK = Math.min((el.clientWidth - 64) / bounds.w, (el.clientHeight - 64) / bounds.h);
    const k = Math.min(1, Math.max(0.7, fitK));
    const cxw = bounds.w * k <= el.clientWidth ? bounds.w / 2 : focal ? focal.x + NODE_W / 2 : bounds.w / 2;
    setView({ k, x: el.clientWidth / 2 - cxw * k, y: 32 });
  }, [bounds, laid]);

  const focusOn = useCallback((id: string) => {
    const el = boxRef.current;
    const l = byId.get(id);
    if (!el || !l) return;
    setView((v) => ({ ...v, x: el.clientWidth / 2 - (l.x + NODE_W / 2) * v.k, y: el.clientHeight / 3 - l.y * v.k }));
  }, [byId]);

  // Fit once the box has a size (and again when the tree itself changes).
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && boxRef.current?.clientWidth) {
      home();
      fitted.current = true;
    }
  }, [home]);

  // Searching opens the branches that lead to matches and jumps to the first one.
  const firstMatch = [...matches][0];
  useEffect(() => {
    if (!matches.size) return;
    const open = ancestorsOf(tree, matches);
    setCollapsed((c) => (open.size && [...open].some((i) => c.has(i)) ? new Set([...c].filter((i) => !open.has(i))) : c));
  }, [matches, tree]);
  useEffect(() => {
    if (firstMatch) focusOn(firstMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMatch, q]);

  // Wheel zoom around the pointer (non-passive so the page does not scroll).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoom = (f: number) => {
    const el = boxRef.current;
    if (!el) return;
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f));
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    });
  };

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const s = new Set(c);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const s = new Set<string>();
    const walk = (n: OrgNode) => {
      if (n.reports.length) s.add(idOf(n));
      n.reports.forEach(walk);
    };
    tree.forEach(walk);
    setCollapsed(s);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,a')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const sel = selected ? laid.find((l) => l.id === selected)?.node ?? findNode(tree, selected) : null;
  const managerOf = (id: string) => {
    const walk = (nodes: OrgNode[], p: OrgNode | null): OrgNode | null | undefined => {
      for (const n of nodes) {
        if (idOf(n) === id) return p;
        const r = walk(n.reports, n);
        if (r !== undefined) return r;
      }
      return undefined;
    };
    return walk(tree, null);
  };

  const inDivision = (n: OrgNode) => !division || ((n.employee.divisionIds as string[]) ?? []).includes(division);
  const divIndex = (n: OrgNode) => Math.max(0, divisions.findIndex((d) => d.key === ((n.employee.divisionIds as string[]) ?? [])[0]));
  const total = tree.reduce((s, n) => s + 1 + countAll(n), 0);

  // Overview map
  const MM_W = 150;
  const mmK = MM_W / bounds.w;
  const mmH = Math.min(100, bounds.h * mmK);
  const box = boxRef.current;

  return (
    <div className="org">
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder={O.searchPlaceholder} aria-label={O.searchLabel} value={search} onChange={(e) => setSearch(e.target.value)} />
        <SelectMenu label={O.divisionFilter} value={division} options={[{ value: '', label: O.allDivisions }, ...divisions.map((d) => ({ value: d.key, label: d.label }))]} onChange={setDivision} />
        {q && <Badge tone={matches.size ? 'info' : 'neutral'}>{O.matches(matches.size)}</Badge>}
        <span className="spacer" />
        <span className="muted small">{O.summary(total, depthOf(tree))}</span>
        <IconButton icon="plus" label={O.expandAll} onClick={expandAll} />
        <IconButton icon="minimize" label={O.collapseAll} onClick={collapseAll} />
      </div>
      <p className="muted small org-howto">{O.howTo}</p>
      <div className="org-stage">
        <div
          ref={boxRef}
          className="org-canvas"
          role="application"
          aria-label={O.chartLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('org-world')) setSelected(null);
          }}
        >
          <div className="org-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: bounds.w, height: bounds.h }}>
            <svg className="org-lines" width={bounds.w} height={bounds.h} aria-hidden="true">
              {laid
                .filter((l) => l.parent)
                .map((l) => {
                  const p = byId.get(l.parent!)!;
                  const x1 = p.x + NODE_W / 2;
                  const y1 = p.y + NODE_H;
                  const x2 = l.x + NODE_W / 2;
                  const y2 = l.y;
                  const my = y1 + GAP_Y / 2;
                  return <path key={l.id} d={`M${x1},${y1} V${my} H${x2} V${y2}`} />;
                })}
            </svg>
            {laid.map((l) => {
              const e = l.node.employee;
              const dim = (!!division && !inDivision(l.node)) || (!!q && !matches.has(l.id));
              return (
                <div
                  key={l.id}
                  className={cx('org-card', selected === l.id && 'is-selected', q && matches.has(l.id) && 'is-match', dim && 'is-dim')}
                  style={{ left: l.x, top: l.y, width: NODE_W, height: NODE_H, ['--band' as string]: `var(${BANDS[divIndex(l.node) % BANDS.length]})` }}
                >
                  <button type="button" className="org-card-body" aria-pressed={selected === l.id} onClick={() => !drag.current?.moved && setSelected(l.id)}>
                    <Avatar name={String(e.fullName)} size={30} />
                    <span className="org-card-text">
                      <strong>{String(e.fullName)}</strong>
                      <span className="muted small">{String(e.designation ?? masterLabel('role', e.roleId))}</span>
                    </span>
                  </button>
                  {l.node.reports.length > 0 && (
                    <button type="button" className="org-toggle" aria-expanded={l.hidden === 0} aria-label={l.hidden ? O.showTeam(l.node.reports.length) : O.hideTeam(l.node.reports.length)} data-tooltip={l.hidden ? O.showTeam(l.node.reports.length) : O.hideTeam(l.node.reports.length)} onClick={() => toggle(l.id)}>
                      {l.hidden ? `+${l.team}` : '−'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="org-controls">
            <IconButton icon="plus" label={O.zoomIn} variant="secondary" onClick={() => zoom(1.2)} />
            <IconButton icon="minimize" label={O.zoomOut} variant="secondary" onClick={() => zoom(1 / 1.2)} />
            <IconButton icon="maximize" label={O.fit} variant="secondary" onClick={fit} />
          </div>
          {box && bounds.w > 0 && (
            <svg className="org-minimap" width={MM_W} height={mmH} role="img" aria-label={O.miniMap}>
              {laid.map((l) => (
                <rect key={l.id} x={l.x * mmK} y={l.y * mmK} width={Math.max(2, NODE_W * mmK)} height={Math.max(2, NODE_H * mmK)} className={selected === l.id ? 'is-selected' : undefined} />
              ))}
              <rect className="org-minimap-view" x={(-view.x / view.k) * mmK} y={(-view.y / view.k) * mmK} width={(box.clientWidth / view.k) * mmK} height={(box.clientHeight / view.k) * mmK} />
            </svg>
          )}
        </div>
        {sel && (
          <aside className="org-detail panel" aria-label={O.details}>
            <div className="dialog-title-row">
              <Avatar name={String(sel.employee.fullName)} size={40} />
              <div>
                <h2 className="panel-title">{String(sel.employee.fullName)}</h2>
                <span className="muted small">{String(sel.employee.designation ?? '')}</span>
              </div>
              <span className="spacer" />
              <IconButton icon="x" label={O.closeDetails} onClick={() => setSelected(null)} />
            </div>
            <dl className="org-facts">
              <dt>{O.role}</dt>
              <dd>{masterLabel('role', sel.employee.roleId)}</dd>
              <dt>{O.divisionsLabel}</dt>
              <dd>{((sel.employee.divisionIds as string[]) ?? []).map((d) => masterLabel('division', d)).join(', ') || '—'}</dd>
              <dt>{O.territoriesLabel}</dt>
              <dd>{((sel.employee.territoryIds as string[]) ?? []).map((t) => masterLabel('territory', t)).join(', ') || '—'}</dd>
              <dt>{O.reportsTo}</dt>
              <dd>
                {managerOf(idOf(sel)) ? (
                  <button type="button" className="rel-link" onClick={() => { const m = managerOf(idOf(sel))!; setSelected(idOf(m)); focusOn(idOf(m)); }}>
                    {String(managerOf(idOf(sel))!.employee.fullName)}
                  </button>
                ) : (
                  O.topLevel
                )}
              </dd>
              <dt>{O.directReports}</dt>
              <dd>{sel.reports.length ? `${O.direct(sel.reports.length)} · ${O.team(countAll(sel))}` : '—'}</dd>
            </dl>
            <Link className="btn btn-secondary" to={recordPeekPath(ws, 'employees', idOf(sel))}>
              {O.openEmployee}
            </Link>
          </aside>
        )}
      </div>
    </div>
  );
}

function findNode(nodes: OrgNode[], id: string): OrgNode | null {
  for (const n of nodes) {
    if (idOf(n) === id) return n;
    const r = findNode(n.reports, id);
    if (r) return r;
  }
  return null;
}
