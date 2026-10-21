import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { recordNewPath, recordPagePath } from '../../../lib/routes';
import { L } from '../../../constants/labels';
import { loaders } from '../../../services/api/service';
import { can, perm } from '../../../services/authz';
import { useActor } from '../../../services/hooks';
import { activeMasterValues, masterValue } from '../../../services/registry';
import type { KbRow } from '../../../services/service/kb';
import { EmptyValue } from '../../../components/primitives/display';
import { StatusChip } from '../../../components/primitives/feedback';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import { ListPage } from '../../../components/shell/ListPage';
import { DataTable, type Column } from '../../../components/primitives/DataTable';
import { LinkButton } from '../../../components/primitives/controls';

const S = L.service;
const P = S.pages.knowledgeBase;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * Knowledge Base (FR-090, SRV-16): the one place to find and manage knowledge articles —
 * search by model / error code / symptom, filter, sort, paginate. Articles open at
 * /knowledge-articles/:id (approval actions live on the record page).
 */
export function KnowledgeBasePage() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const status = params.get('status') ?? '';
  const peek = params.get('peek');
  // All visible articles load once; the table searches (title, model, error code, symptom), sorts and pages them.
  const query = useServiceQuery(loaders.knowledgeBase(actor, { category, status, size: 100000 }), [actor.user.id, category, status]);

  // Old list links (/knowledge-articles?peek=ID) arrive here; open the record page instead.
  if (peek) return <Navigate to={recordPagePath(actor.workspaceId, 'knowledgeArticles', peek)} replace />;

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  }
  const reviewer = can(actor, 'approve.service');
  const categories = activeMasterValues('complaintCategory').map((v) => ({ value: v.key, label: v.label }));
  const statuses = activeMasterValues('kbStatus').map((v) => ({ value: v.key, label: v.label }));
  const data = query.data;
  const columns: Column<KbRow>[] = [
    {
      key: 'title',
      label: P.cols.title,
      className: 'kb-title',
      sort: (a) => s(a.title),
      render: (a) => (
        <>
          <Link to={recordPagePath(actor.workspaceId, 'knowledgeArticles', a.id)}>{s(a.title)}</Link>
          <div className="muted small">
            {P.symptoms}: {s(a.symptoms).slice(0, 140)}
          </div>
        </>
      ),
    },
    { key: 'models', label: P.cols.models, sort: (a) => s(a.models), render: (a) => s(a.models) || <EmptyValue /> },
    { key: 'codes', label: P.cols.errorCodes, className: 'mono small', render: (a) => s(a.errorCodes) || <EmptyValue /> },
    { key: 'category', label: P.cols.category, sort: (a) => masterValue('complaintCategory', a.category)?.label ?? '', render: (a) => masterValue('complaintCategory', a.category)?.label ?? <EmptyValue /> },
    { key: 'author', label: P.cols.author, sort: (a) => a.authorName, render: (a) => a.authorName || <EmptyValue /> },
    {
      key: 'status',
      label: P.cols.status,
      sort: (a) => s(a.status),
      render: (a) => {
        const st = masterValue('kbStatus', a.status);
        return st ? <StatusChip label={st.label} tone={st.tone} /> : null;
      },
    },
  ];
  return (
    <ListPage
      title={L.nav.pages.knowledgeBase.title}
      description={P.description}
      actions={perm(actor, 'knowledgeArticles').create ? <LinkButton variant="primary" to={recordNewPath('knowledgeArticles')}>{S.actions.newArticle}</LinkButton> : undefined}
    >
      <DataTable exportResource="knowledgeArticles"
        label={P.tableLabel}
        rows={data?.rows ?? []}
        rowKey={(a) => a.id}
        noun={P.noun}
        loading={!data && !query.error}
        error={query.error}
        onRetry={query.retry}
        initialSort={{ key: 'title', dir: 'asc' }}
        search={(a) => [a.id, a.title, a.models, a.errorCodes, a.symptoms, a.solution, a.authorName].map(s).join(' ')}
        summary={data ? P.count(data.total) : undefined}
        activeFilters={(category ? 1 : 0) + (status ? 1 : 0)}
        onClearFilters={() => update({ category: undefined, status: undefined })}
        empty={data && !data.total && !category && !status ? { icon: 'notebook', title: P.empty, body: P.emptyBody } : undefined}
        emptyText={P.emptySearch}
        filters={
          <>
            <SelectMenu label={P.categoryFilter} value={category} options={[{ value: '', label: P.allCategories }, ...categories]} onChange={(v) => update({ category: v || undefined })} />
            {reviewer || perm(actor, 'knowledgeArticles').create ? <SelectMenu label={P.statusFilter} value={status} options={[{ value: '', label: P.allStatuses }, ...statuses]} onChange={(v) => update({ status: v || undefined })} /> : null}
          </>
        }
        columns={columns}
      />
    </ListPage>
  );
}
