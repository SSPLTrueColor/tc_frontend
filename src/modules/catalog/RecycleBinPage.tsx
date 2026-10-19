import { useState } from 'react';
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

const safeLabel = (resKey: string) => {
  try {
    return getResource(resKey).label;
  } catch {
    return resKey;
  }
};

/** FR-138 / COM-10: soft-deleted records — restore or delete permanently (administrators only). */
export function RecycleBinPage() {
  const actor = useActor();
  const toast = useToast();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState('');
  const bin = useServiceQuery(() => listRecycleBin(actor), [actor.user.id]);
  if (!can(actor, 'recycle.manage')) return <NoAccess what="the recycle bin" />;
  const all = bin.data ?? [];
  const types = [...new Set(all.map((e) => e.resource))];
  const titleOf = (e: (typeof all)[number]) => {
    try {
      const res = getResource(e.resource);
      return String(e.record[res.titleField] && typeof e.record[res.titleField] === 'string' ? e.record[res.titleField] : e.record.id);
    } catch {
      return e.record.id;
    }
  };
  const rows = all.filter((e) => (!type || e.resource === type) && (!q || `${e.record.id} ${titleOf(e)}`.toLowerCase().includes(q.toLowerCase())));
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
      <PageHeader title="Recycle bin" description="Deleted records stay here until an administrator restores them or deletes them permanently. Both actions are audited." />
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder="Search ID or name" aria-label="Search the recycle bin" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectMenu label="Filter by record type" value={type} options={[{ value: '', label: 'All record types' }, ...types.map((t) => ({ value: t, label: safeLabel(t) }))]} onChange={setType} />
        <span className="toolbar-count muted">{rows.length} item(s)</span>
      </div>
      <div className="content-surface">
        {bin.error ? (
          <ErrorState title="Could not load the recycle bin" onRetry={bin.retry}>
            {bin.error}
          </ErrorState>
        ) : !bin.data ? (
          <Skeleton rows={6} />
        ) : !rows.length ? (
          <EmptyState icon="trash" title={all.length ? 'Nothing matches' : 'The recycle bin is empty'}>
            {all.length ? 'Try another search or record type.' : 'Deleted records appear here.'}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col">Type</th>
                  <th scope="col">Deleted</th>
                  <th scope="col">By</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
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
                      <Button loading={busyId === e.id} onClick={() => act(e.id, () => restoreFromBin(actor, e.id), `${e.record.id} restored`)}>
                        Restore
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() =>
                          confirmDelete({
                            title: `Delete ${e.record.id} permanently?`,
                            message: 'The record cannot be restored afterwards. Its audit history is kept.',
                            confirmLabel: 'Delete permanently',
                            onConfirm: () => act(e.id, () => purgeFromBin(actor, e.id), `${e.record.id} deleted permanently`),
                          })
                        }
                      >
                        Delete permanently
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
