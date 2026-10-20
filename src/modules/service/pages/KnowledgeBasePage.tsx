import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { recordNewPath, recordPagePath } from '../../../lib/routes';
import { L } from '../../../constants/labels';
import { loaders } from '../../../services/api/service';
import { can, perm } from '../../../services/authz';
import { useActor } from '../../../services/hooks';
import { activeMasterValues, masterValue } from '../../../services/registry';
import { KB_PAGE_SIZE, type KbSort } from '../../../services/service/kb';
import { Button, IconButton } from '../../../components/primitives/Button';
import { EmptyValue } from '../../../components/primitives/display';
import { EmptyState, ErrorState, Skeleton, StatusChip } from '../../../components/primitives/feedback';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import { PageHeader } from '../../../components/shell/PageHeader';
import { LinkButton, SearchInput } from '../../../components/primitives/controls';
import { Table } from '../../../components/primitives/Table';

const S = L.service;
const P = S.pages.knowledgeBase;
const SORTS: KbSort[] = ['title', 'updated', 'category'];
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * Knowledge Base (FR-090, SRV-16): the one place to find and manage knowledge articles —
 * search by model / error code / symptom, filter, sort, paginate. Articles open at
 * /knowledge-articles/:id (approval actions live on the record page).
 */
export function KnowledgeBasePage() {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const status = params.get('status') ?? '';
  const sort = (SORTS.includes(params.get('sort') as KbSort) ? params.get('sort') : 'title') as KbSort;
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const peek = params.get('peek');
  // Debounced search box (URL holds the applied query, so links and Back keep the search).
  const [text, setText] = useState(q);
  useEffect(() => {
    if (text === q) return;
    const t = window.setTimeout(() => update({ q: text.trim() || undefined }), 250);
    return () => window.clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = useServiceQuery(loaders.knowledgeBase(actor, { q, category, status, sort, page, size: KB_PAGE_SIZE }), [actor.user.id, q, category, status, sort, page]);

  // Old list links (/knowledge-articles?peek=ID) arrive here; open the record page instead.
  if (peek) return <Navigate to={recordPagePath(actor.workspaceId, 'knowledgeArticles', peek)} replace />;

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    Object.entries({ page: undefined, ...patch }).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  }
  const reviewer = can(actor, 'approve.service');
  const categories = activeMasterValues('complaintCategory').map((v) => ({ value: v.key, label: v.label }));
  const statuses = activeMasterValues('kbStatus').map((v) => ({ value: v.key, label: v.label }));
  const filtered = !!(q || category || status);
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  return (
    <div className="page">
      <PageHeader
        title={L.nav.pages.knowledgeBase.title}
        description={P.description}
        actions={
          perm(actor, 'knowledgeArticles').create ? (
            <LinkButton variant="primary" to={recordNewPath('knowledgeArticles')}>{S.actions.newArticle}</LinkButton>
          ) : undefined
        }
      />
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <SearchInput dense placeholder={P.searchPlaceholder} aria-label={P.searchLabel} value={text} onChange={(e) => setText(e.target.value)} />
        <SelectMenu label={P.categoryFilter} value={category} options={[{ value: '', label: P.allCategories }, ...categories]} onChange={(v) => update({ category: v || undefined })} />
        {reviewer || perm(actor, 'knowledgeArticles').create ? (
          <SelectMenu label={P.statusFilter} value={status} options={[{ value: '', label: P.allStatuses }, ...statuses]} onChange={(v) => update({ status: v || undefined })} />
        ) : null}
        <SelectMenu<KbSort> label={P.sortLabel} value={sort} options={SORTS.map((k) => ({ value: k, label: P.sorts[k] }))} onChange={(v) => update({ sort: v })} />
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setText('');
              update({ q: undefined, category: undefined, status: undefined });
            }}
          >
            {S.actions.clearFilters}
          </Button>
        )}
        <span className="spacer" />
        {data && <span className="toolbar-count muted">{P.count(data.total)}</span>}
      </div>
      <div className="content-surface">
        {query.error ? (
          <ErrorState title={P.loadError} onRetry={query.retry}>
            {query.error}
          </ErrorState>
        ) : !data ? (
          <Skeleton rows={8} />
        ) : !data.rows.length ? (
          <EmptyState icon="notebook" title={filtered ? P.emptySearch : P.empty}>
            {filtered ? P.emptySearchBody : P.emptyBody}
          </EmptyState>
        ) : (
          <>
            
              <Table>
                <thead>
                  <tr>
                    <th scope="col">{P.cols.title}</th>
                    <th scope="col">{P.cols.models}</th>
                    <th scope="col">{P.cols.errorCodes}</th>
                    <th scope="col">{P.cols.category}</th>
                    <th scope="col">{P.cols.author}</th>
                    <th scope="col">{P.cols.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((a) => {
                    const st = masterValue('kbStatus', a.status);
                    return (
                      <tr key={a.id}>
                        <td style={{ minWidth: 240 }}>
                          <Link to={recordPagePath(actor.workspaceId, 'knowledgeArticles', a.id)}>{s(a.title)}</Link>
                          <div className="muted small">
                            {P.symptoms}: {s(a.symptoms).slice(0, 140)}
                          </div>
                        </td>
                        <td>{s(a.models) || <EmptyValue />}</td>
                        <td className="mono small">{s(a.errorCodes) || <EmptyValue />}</td>
                        <td>{masterValue('complaintCategory', a.category)?.label ?? <EmptyValue />}</td>
                        <td>{a.authorName || <EmptyValue />}</td>
                        <td>{st && <StatusChip label={st.label} tone={st.tone} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            
            <div className="grid-footer">
              <span className="grid-footer-range">{S.pager.range(data.page * data.size + 1, Math.min(data.total, (data.page + 1) * data.size), data.total)}</span>
              <nav className="grid-pages" aria-label={S.pager.label}>
                <IconButton icon="chevron-left" label={S.pager.prev} disabledReason={data.page === 0 ? S.pager.first : undefined} onClick={() => update({ page: String(data.page - 1) })} />
                <IconButton icon="chevron-right" label={S.pager.next} disabledReason={data.page + 1 >= pages ? S.pager.last : undefined} onClick={() => update({ page: String(data.page + 1) })} />
              </nav>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
