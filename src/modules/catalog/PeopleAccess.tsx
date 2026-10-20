import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { formatDate } from '../../lib/dates';
import { resourcePath } from '../../lib/routes';
import { cx } from '../../lib/format';
import { type Actor, can } from '../../services/authz';
import { changePersonRole, extendExtraAccess, removeExtraAccess } from '../../services/api/catalog';
import { errorMessage } from '../../services/api/client';
import { explainAccess, getPerson, type GrantView, listPeople, previewRoleChange, type RoleDiff } from '../../services/catalog/grants';
import { useRevision } from '../../services/hooks';
import { allResources, masterLabel } from '../../services/registry';
import { appRoles } from '../../domain/pack';
import { Button } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { Avatar, Badge, EmptyState, StatusChip, useToast } from '../../components/primitives/feedback';
import { confirmDelete, Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { Clip } from '../../components/settings/kit';
import { levelOf, sentence } from './AccessSimple';
import { GrantDialog } from './GrantDialog';

const G = L.grants;
const S = L.admin.access.simple;

const plainLevel = (p: Parameters<typeof levelOf>[0]): string => {
  const l = levelOf(p);
  if (l !== 'custom') return S.levels[l];
  const words = [G.words.view, p.update !== 'none' && G.words.edit, p.create && G.words.add, p.delete && G.words.delete, p.export && G.words.export].filter(Boolean) as string[];
  return words.join(', ');
};

/** People view: pick someone, see what they can do, change their role, give extra access, find out why a screen is closed. */
export function PeopleAccess({ actor, people, initial }: { actor: Actor; people: ReturnType<typeof listPeople>; initial?: string }) {
  useRevision();
  const toast = useToast();
  const admin = can(actor, 'access.manage');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(initial ?? people.find((p) => p.roleId !== 'admin')?.userId ?? people[0]?.userId ?? '');
  const [grant, setGrant] = useState<{ module?: string } | null>(null);
  const [roleStep, setRoleStep] = useState<{ roleId: string; diff: RoleDiff } | null>(null);
  const [whyRes, setWhyRes] = useState('');
  const [showNone, setShowNone] = useState(false);
  const [busy, setBusy] = useState('');
  const list = useMemo(() => people.filter((p) => !q.trim() || `${p.name} ${p.title} ${p.roleLabel}`.toLowerCase().includes(q.trim().toLowerCase())), [people, q]);
  const person = people.find((p) => p.userId === sel) ?? people[0];
  if (!person) return <EmptyState icon="users" title={G.noPeople} />;
  const d = getPerson(actor, person.userId);
  const withAccess = d.areas.filter((a) => a.perm.read !== 'none');
  const without = d.areas.filter((a) => a.perm.read === 'none');
  const isAdminPerson = d.roleId === 'admin';
  const why = whyRes ? explainAccess(actor, person.userId, whyRes) : null;
  const whyDef = whyRes ? allResources().find((r) => r.key === whyRes) : undefined;

  const act = async (id: string, op: () => Promise<unknown>, ok: string | ((r: unknown) => string)) => {
    setBusy(id);
    try {
      const r = await op();
      toast(typeof ok === 'string' ? ok : ok(r));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy('');
    }
  };
  const removeOne = (g: GrantView) =>
    confirmDelete({ title: G.removeTitle, message: G.removeBody(d.name, g.what), confirmLabel: G.remove, onConfirm: () => act(g.id, () => removeExtraAccess(actor, g.id), G.removed) });

  const pickRole = (roleId: string) => {
    if (roleId === d.roleId) return;
    setRoleStep({ roleId, diff: previewRoleChange(actor, person.userId, roleId) });
  };
  const confirmRole = async () => {
    const r = roleStep!;
    setRoleStep(null);
    await act('role', () => changePersonRole(actor, person.userId, r.roleId), G.roleChanged(d.name, appRoles.find((x) => x.id === r.roleId)?.label ?? ''));
  };

  return (
    <div className="pa">
      <aside className="pa-list st-card" aria-label={G.search}>
        <input type="search" className="input" placeholder={G.search} aria-label={G.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="pa-people">
          {list.map((p) => (
            <li key={p.userId}>
              <button type="button" className={cx('pa-person', p.userId === person.userId && 'is-active')} aria-pressed={p.userId === person.userId} onClick={() => setSel(p.userId)}>
                <Avatar name={p.name} size={28} />
                <span className="pa-person-text">
                  <span className="st-clip">{p.name}</span>
                  <span className="muted small st-clip">{p.roleLabel}</span>
                </span>
                {p.extras > 0 && <Badge tone="accent">{G.extrasCount(p.extras)}</Badge>}
              </button>
            </li>
          ))}
          {!list.length && <li className="muted small pa-none">{G.noPeople}</li>}
        </ul>
        {admin && (
          <Link className="btn btn-secondary" to={`${resourcePath(actor.workspaceId, 'employees')}/new`}>
            {G.addPerson}
          </Link>
        )}
      </aside>

      <div className="pa-detail">
        <section className="st-card pa-head">
          <Avatar name={d.name} size={44} />
          <div className="pa-head-text">
            <h2 className="st-section-title st-clip">{d.name}</h2>
            <span className="muted st-clip">{d.title}</span>
          </div>
          <div className="pa-role">
            <label className="field-label" htmlFor="pa-role">
              {G.role}
            </label>
            {admin && !isAdminPerson ? (
              <SelectMenu id="pa-role" label={G.changeRole} value={d.roleId} options={appRoles.filter((r) => r.id !== 'admin').map((r) => ({ value: r.id, label: r.label }))} onChange={pickRole} />
            ) : (
              <Badge tone="neutral">{d.roleLabel}</Badge>
            )}
          </div>
          <dl className="st-facts pa-facts">
            <dt>{G.reportsTo}</dt>
            <dd>{d.managerName || G.topLevel}</dd>
            <dt>{G.divisions}</dt>
            <dd>{d.divisions.map((x) => masterLabel('division', x)).join(', ') || '—'}</dd>
            <dt>{G.territories}</dt>
            <dd>{d.territories.map((x) => masterLabel('territory', x)).join(', ') || '—'}</dd>
          </dl>
          {admin && !isAdminPerson && <p className="st-help pa-note">{G.roleNote}</p>}
        </section>

        <div className="pa-two">
          <section className="st-card" aria-labelledby="pa-can">
            <h2 id="pa-can" className="st-section-title">
              {G.can}
            </h2>
            <p className="st-help">{G.canHelp}</p>
            <ul className="pa-areas">
              {withAccess.map((a) => (
                <li key={a.module} className="pa-area" data-tooltip={sentence(a.perm, a.label)}>
                  <span className="st-clip">{a.label}</span>
                  <span className="pa-can-text">
                    {plainLevel(a.perm)} · <span className="muted">{G.reachShort[a.perm.read]}</span>
                  </span>
                  {a.extra && <Badge tone="accent">{G.extraTag}</Badge>}
                </li>
              ))}
            </ul>
            {without.length > 0 && (
              <>
                <button type="button" className="rel-link small" onClick={() => setShowNone(!showNone)} aria-expanded={showNone}>
                  {showNone ? G.hideNoAccess : G.showNoAccess}
                </button>
                {showNone && <p className="muted small">{without.map((a) => a.label).join(' · ')}</p>}
                {!showNone && <span className="muted small"> {G.noAccessAreas(without.length)}</span>}
              </>
            )}
          </section>

          <section className="st-card" aria-labelledby="pa-extra">
            <div className="st-section-head pa-extra-head">
              <h2 id="pa-extra" className="st-section-title">
                {G.extra}
              </h2>
              {admin && !isAdminPerson && (
                <div className="st-section-actions">
                  <Button variant="primary" icon="plus" onClick={() => setGrant({ module: without[0]?.module })}>
                    {G.giveExtra}
                  </Button>
                </div>
              )}
              <p className="st-help">{G.extraHelp}</p>
            </div>
            {d.extras.length ? (
              <ul className="pa-grants">
                {d.extras.map((g) => (
                  <li key={g.id} className="pa-grant">
                    <div className="pa-grant-main">
                      <strong className="st-clip">{g.what}</strong>
                      <span className="muted small">
                        {g.kind === 'area' ? `${G.reachShort[g.scope]} · ` : ''}
                        {G.until('')}
                        <DateText value={g.expiresAt} /> · <StatusChip label={G.daysLeft(g.daysLeft)} tone={g.daysLeft <= 7 ? 'warning' : 'neutral'} />
                      </span>
                      <Clip text={`${g.reason} — ${G.by(people.find((p) => p.userId === g.grantedBy)?.name ?? g.grantedBy)}`} />
                    </div>
                    {admin && (
                      <div className="st-row-actions">
                        <Button loading={busy === g.id} onClick={() => act(g.id, () => extendExtraAccess(actor, g.id), (r) => G.extended(formatDate(String(r))))}>
                          {G.extend}
                        </Button>
                        <Button onClick={() => removeOne(g)}>{G.remove}</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{isAdminPerson ? L.grants.errors.adminTarget : G.noExtra}</p>
            )}
          </section>
        </div>

        <section className="st-card" aria-labelledby="pa-why">
          <h2 id="pa-why" className="st-section-title">
            {G.why}
          </h2>
          <p className="st-help">{G.whyHelp}</p>
          <div className="pa-why">
            <SelectMenu searchable label={G.whyPick} value={whyRes} options={[{ value: '', label: G.whyPick }, ...allResources().map((r) => ({ value: r.key, label: r.labelPlural }))]} onChange={setWhyRes} />
            {why && whyDef && (
              <p role="status" className={cx('pa-why-text', !why.allowed && 'is-no')}>
                {why.allowed ? G.whyYes(d.name, whyDef.labelPlural, S.scopes[why.scope]) + (why.readOnly ? G.whyEdit(d.name) : '') + (why.fromExtra ? G.whyExtra : '') : G.whyNo(d.name, whyDef.labelPlural, d.roleLabel)}
              </p>
            )}
            {why && whyDef && (!why.allowed || why.readOnly) && admin && !isAdminPerson && (
              <Button onClick={() => setGrant({ module: whyDef.module })}>{G.whyFix}</Button>
            )}
          </div>
        </section>
      </div>

      <GrantDialog actor={actor} userId={person.userId} name={d.name} open={!!grant} module={grant?.module} onClose={() => setGrant(null)} />

      <Dialog
        open={!!roleStep}
        onClose={() => setRoleStep(null)}
        title={roleStep ? G.changeTitle(d.name, appRoles.find((r) => r.id === roleStep.roleId)?.label ?? '') : ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => setRoleStep(null)}>{L.common.actions.cancel}</Button>
            <Button variant="primary" onClick={confirmRole}>
              {G.confirmChange}
            </Button>
          </>
        }
      >
        {roleStep && (roleStep.diff.gains.length + roleStep.diff.loses.length + roleStep.diff.changes.length ? (
          <dl className="st-facts">
            {([['gains', G.gains], ['loses', G.loses], ['changes', G.changes]] as const).map(([k, label]) =>
              roleStep.diff[k].length ? (
                <div key={k} className="pa-diff">
                  <dt>{label}</dt>
                  <dd>{roleStep.diff[k].join(', ')}</dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : (
          <p>{G.changeNoDiff}</p>
        ))}
        <p className="st-help">{G.roleNote}</p>
      </Dialog>
    </div>
  );
}
