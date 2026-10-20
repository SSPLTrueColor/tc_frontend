import { useState } from 'react';
import { L } from '../../constants/labels';
import { type Actor, can } from '../../services/authz';
import { extendExtraAccess, removeExtraAccess } from '../../services/api/catalog';
import { errorMessage } from '../../services/api/client';
import { type GrantView, listActiveGrants } from '../../services/catalog/grants';
import { useRevision } from '../../services/hooks';
import { getUser } from '../../services/registry';
import { Button } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { EmptyState, StatusChip, useToast } from '../../components/primitives/feedback';
import { confirmDelete } from '../../components/primitives/overlay';
import { Clip } from '../../components/settings/kit';
import { usePaged } from './kit';
import { formatDate } from '../../lib/dates';

const G = L.grants;
const S = L.admin.access.simple;

/** Everything given on top of roles, soonest to end first: the monthly "who has more than their role" check. */
export function ExpiringAccess({ actor }: { actor: Actor }) {
  useRevision();
  const toast = useToast();
  const admin = can(actor, 'access.manage');
  const rows = listActiveGrants(actor);
  const paged = usePaged(rows, 10);
  const [busy, setBusy] = useState('');
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
  const remove = (g: GrantView) =>
    confirmDelete({ title: G.removeTitle, message: G.removeBody(getUser(g.userId)?.name ?? g.userId, g.what), confirmLabel: G.remove, onConfirm: () => act(g.id, () => removeExtraAccess(actor, g.id), G.removed) });
  return (
    <section className="st-card">
      <div className="st-section-head">
        <h2 className="st-section-title">{G.expiringTitle}</h2>
        <p className="st-help">{G.expiringHelp}</p>
      </div>
      {rows.length ? (
        <>
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">{G.columns.person}</th>
                  <th scope="col">{G.columns.access}</th>
                  <th scope="col">{G.columns.reach}</th>
                  <th scope="col">{G.columns.ends}</th>
                  <th scope="col">{G.columns.reason}</th>
                  {admin && <th scope="col" />}
                </tr>
              </thead>
              <tbody>
                {paged.shown.map((g) => (
                  <tr key={g.id}>
                    <td>{getUser(g.userId)?.name ?? g.userId}</td>
                    <td>{g.what}</td>
                    <td>{g.kind === 'area' ? S.scopes[g.scope] : '—'}</td>
                    <td className="nowrap">
                      <DateText value={g.expiresAt} /> <StatusChip label={G.daysLeft(g.daysLeft)} tone={g.daysLeft <= 7 ? 'warning' : 'neutral'} />
                    </td>
                    <td className="st-cell-clip">
                      <Clip text={g.reason} />
                    </td>
                    {admin && (
                      <td className="st-row-actions">
                        <Button loading={busy === g.id} onClick={() => act(g.id, () => extendExtraAccess(actor, g.id), (r) => G.extended(formatDate(String(r))))}>
                          {G.extend}
                        </Button>
                        <Button onClick={() => remove(g)}>{G.remove}</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paged.footer('extra access')}
        </>
      ) : (
        <EmptyState icon="shield" title={G.noGrants}>
          {G.noGrantsBody}
        </EmptyState>
      )}
    </section>
  );
}
