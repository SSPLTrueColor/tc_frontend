import { useState } from 'react';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { purgeFromBin, restoreFromBin } from '../../services/api/catalog';
import { can } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getResource, getUser } from '../../services/registry';
import { listRecycleBin, recordTitle } from '../../services/runtime';
import { Button } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { EmptyState, ErrorState, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { confirmDelete } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';
import { byTime, SortPicker, type SortDir, usePaged } from './kit';

const B = L.admin.recycleBin;

const safeLabel = (resKey: string) => {
  try {
    return getResource(resKey).label;
  } catch {
    return resKey;
  }
};

/** COM-10 / FR-138: soft-deleted records — restore or delete permanently (System Administrator only). */
export function RecycleBinPage() {
  const actor = useActor();
  const toast = useToast();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortDir>('desc');
  const [busyId, setBusyId] = useState('');
  const bin = useServiceQuery(() => listRecycleBin(actor), [actor.user.id]);
  const all = bin.data ?? [];
  const titleOf = (e: (typeof all)[number]) => {
    try {
      const res = getResource(e.resource);
      return String(e.record[res.titleField] && typeof e.record[res.titleField] === 'string' ? e.record[res.titleField] : e.record.id);
    } catch {
      return e.record.id;
    }
  };
  const rows = byTime(
    all.filter((e) => (!type || e.resource === type) && (!q || `${e.record.id} ${titleOf(e)}`.toLowerCase().includes(q.toLowerCase()))),
    (e) => e.deletedAt,
    sort,
  );
  const paged = usePaged(rows);
  if (!can(actor, 'recycle.manage')) return <NoAccess what={B.noAccessWhat} />;
  const types = [...new Set(all.map((e) => e.resource))];
  const act = async (id: string, op: () => Promise<void>, ok: string) => {
    setBusyId(id);
    try {
      await op();
      toast(ok);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusyId('');
    }
  };
  return (
    <div className="page">
      <PageHeader title={L.nav.pages.recycleBin.title} description={B.description} />
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder={B.searchPlaceholder} aria-label={B.searchLabel} value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectMenu label={B.filterType} value={type} options={[{ value: '', label: L.admin.common.allRecordTypes }, ...types.map((t) => ({ value: t, label: safeLabel(t) }))]} onChange={setType} />
        <SortPicker value={sort} onChange={setSort} />
      </div>
      <div className="content-surface">
        {bin.error ? (
          <ErrorState title={B.loadError} onRetry={bin.retry}>
            {bin.error}
          </ErrorState>
        ) : !bin.data ? (
          <Skeleton rows={6} />
        ) : !rows.length ? (
          <EmptyState icon="trash" title={all.length ? B.noMatchTitle : B.emptyTitle}>
            {all.length ? B.noMatchBody : B.emptyBody}
          </EmptyState>
        ) : (
          <>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">{B.columns.record}</th>
                    <th scope="col">{B.columns.type}</th>
                    <th scope="col">{B.columns.deleted}</th>
                    <th scope="col">{B.columns.by}</th>
                    <th scope="col">
                      <span className="sr-only">{B.columns.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.shown.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <span className="mono">{e.record.id}</span> · {titleOf(e) === e.record.id ? recordTitle(e.resource, e.record.id, actor) : titleOf(e)}
                      </td>
                      <td>{safeLabel(e.resource)}</td>
                      <td className="nowrap">
                        <DateText value={e.deletedAt} />
                      </td>
                      <td>{getUser(e.deletedBy)?.name ?? e.deletedBy}</td>
                      <td className="row-gap">
                        <Button loading={busyId === e.id} onClick={() => act(e.id, () => restoreFromBin(actor, e.id), B.restored(e.record.id))}>
                          {B.restore}
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() =>
                            confirmDelete({
                              title: B.purgeTitle(e.record.id),
                              message: B.purgeMessage,
                              confirmLabel: B.purge,
                              onConfirm: () => act(e.id, () => purgeFromBin(actor, e.id), B.purged(e.record.id)),
                            })
                          }
                        >
                          {B.purge}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {paged.footer(B.items)}
          </>
        )}
      </div>
    </div>
  );
}
