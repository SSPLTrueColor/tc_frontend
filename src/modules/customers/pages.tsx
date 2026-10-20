/**
 * Customers & Contacts pages that are not plain resource lists:
 *  - Contact Pool (CUS-05)                     ROUTES.contactPool
 *  - Import Contacts (CUS-05)                  ROUTES.contactPoolImport
 *  - Duplicate Detection & Merge (CUS-06)      ROUTES.duplicateMerge
 *  - Bulk Ownership Transfer (CUS-10, ADM-08)  ROUTES.ownershipTransfer
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import {
  CONTACT_CSV_TEMPLATE,
  getContactPool,
  getDuplicateGroups,
  getTransferPreview,
  importContacts,
  type ImportRow,
  merge,
  parseContactCsv,
  phoneBookSample,
  type PoolContact,
  removePoolContact,
  transfer,
  visitingCardSample,
} from '../../services/api/customers';
import { can, perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { downloadText } from '../../services/exporter';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterLabel, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { Button, IconButton } from '../../components/primitives/Button';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { confirmDelete } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { QuickCreateDialog } from '../../components/resource/RecordForm';
import { PageHeader } from '../../components/shell/PageHeader';
import { SettingsPage } from '../../components/settings/kit';
import { ConvertDialog, convertBlockedReason } from './components';
import { TextField } from '../../components/primitives/controls';
import { DataTable } from '../../components/primitives/DataTable';
import { Table } from '../../components/primitives/Table';
import { FileInput, Radio } from '../../components/primitives/controls';

const A = L.customers.actions;
const PAGES = L.nav.pages;

// ---------------------------------------------------------------- Contact Pool (CUS-05)

type StatusFilter = 'open' | 'all' | 'new' | 'contacted' | 'converted';

export function ContactPoolPage() {
  const actor = useActor();
  const toast = useToast();
  const navigate = useNavigate();
  const P = L.customers.pool;
  const readable = perm(actor, 'contacts').read !== 'none';
  const q = useServiceQuery(() => (readable ? getContactPool(actor) : []), [actor.user.id]);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [source, setSource] = useState('');
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<PoolContact['contact'] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      (q.data ?? [])
        .filter(({ contact: c }) => (status === 'all' ? true : status === 'open' ? c.poolStatus !== 'converted' : c.poolStatus === status))
        .filter(({ contact: c }) => !source || c.source === source),
    [q.data, status, source],
  );

  if (!readable) return <NoAccess what={P.noAccess} />;

  const canCreate = perm(actor, 'contacts').create;
  const canDelete = perm(actor, 'contacts').delete;
  const importWith = (add?: 'phone' | 'card') => navigate(toPath(ROUTES.contactPoolImport, {}, { add }));
  const remove = (c: PoolContact['contact']) =>
    confirmDelete({
      title: P.deleteTitle(String(c.name)),
      message: P.deleteMessage,
      confirmLabel: A.delete,
      onConfirm: async () => {
        setDeleting(c.id);
        try {
          await removePoolContact(actor, c.id);
          toast(P.deleted(String(c.name)));
        } catch (e) {
          toast(errorMessage(e), 'danger');
        } finally {
          setDeleting(null);
        }
      },
    });
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'open', label: P.statusOpen },
    { value: 'new', label: L.customers.masters.poolStatus.values.new },
    { value: 'contacted', label: L.customers.masters.poolStatus.values.contacted },
    { value: 'converted', label: L.customers.masters.poolStatus.values.converted },
    { value: 'all', label: P.statusAll },
  ];

  return (
    <div className="page">
      <PageHeader title={PAGES.contactPool.title} description={P.description} />
      <div className="toolbar">
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)} disabledReason={canCreate ? undefined : P.noCreate}>
          {A.addManually}
        </Button>
        <Button icon="arrow-up" onClick={() => importWith()} disabledReason={canCreate ? undefined : P.noCreate}>
          {A.uploadExcel}
        </Button>
        <Button icon="users" onClick={() => importWith('phone')} disabledReason={canCreate ? undefined : P.noCreate} title={A.simulatedPhoneBook}>
          {A.phoneBook}
        </Button>
        <Button icon="id-card" onClick={() => importWith('card')} disabledReason={canCreate ? undefined : P.noCreate} title={A.simulatedCard}>
          {A.visitingCard}
        </Button>
        <InfoTip text={L.customers.import.demoTip} label={L.customers.import.demoTipLabel} />
      </div>
      <div className="content-surface">
        <DataTable<PoolContact>
          label={PAGES.contactPool.title}
          noun={P.noun}
          rows={rows}
          rowKey={(r) => r.contact.id}
          loading={!q.data && !q.error}
          error={q.error ? `${P.loadError}: ${q.error}` : null}
          onRetry={q.retry}
          search={({ contact: c }) => [c.name, c.mobile, c.whatsapp, c.email, c.city, c.designation].map((v) => String(v ?? '')).join(' ')}
          initialSort={{ key: 'added', dir: 'desc' }}
          activeFilters={(status !== 'open' ? 1 : 0) + (source ? 1 : 0)}
          onClearFilters={() => (setStatus('open'), setSource(''))}
          summary={q.data ? P.count(rows.length) : undefined}
          filters={
            <>
              <SelectMenu label={P.filterStatus} value={status} options={statusOptions} onChange={(v) => setStatus(v as StatusFilter)} />
              <SelectMenu label={P.filterSource} value={source} options={[{ value: '', label: P.sourceAll }, ...activeMasterValues('leadSource').map((v) => ({ value: v.key, label: v.label }))]} onChange={setSource} />
            </>
          }
          empty={
            q.data && !q.data.length
              ? { icon: 'users', title: P.empty, body: P.emptyText, action: canCreate ? <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{A.addManually}</Button> : undefined }
              : undefined
          }
          emptyText={P.noMatch}
          selectable={false}
          columns={[
            {
              key: 'name',
              label: P.cols.name,
              sort: (r) => String(r.contact.name ?? ''),
              render: ({ contact: c }) => (
                <>
                  <Link className="rel-link" to={recordPeekPath(actor.workspaceId, 'contacts', c.id)}>
                    {String(c.name)}
                  </Link>
                  {c.designation ? <div className="muted small">{String(c.designation)}</div> : null}
                </>
              ),
            },
            {
              key: 'mobile',
              label: P.cols.mobile,
              render: ({ contact: c }) =>
                c.mobile || c.email ? (
                  <>
                    <div className="nowrap">{c.mobile ? String(c.mobile) : <EmptyValue />}</div>
                    {c.email ? <div className="muted small">{String(c.email)}</div> : null}
                  </>
                ) : (
                  <EmptyValue />
                ),
            },
            { key: 'city', label: P.cols.city, sort: (r) => String(r.contact.city ?? ''), render: ({ contact: c }) => (c.city ? String(c.city) : <EmptyValue />) },
            { key: 'source', label: P.cols.source, render: ({ contact: c }) => (c.source ? masterLabel('leadSource', c.source) : <EmptyValue />) },
            { key: 'owner', label: P.cols.owner, render: ({ contact: c }) => (c.ownerId ? recordTitle('employees', c.ownerId, actor) : <EmptyValue />) },
            { key: 'added', label: P.cols.added, sort: (r) => String(r.contact.createdAt ?? ''), render: ({ contact: c }) => <DateText value={String(c.createdAt ?? '')} /> },
            {
              key: 'status',
              label: P.cols.status,
              render: ({ contact: c }) => {
                const st = masterValue('poolStatus', c.poolStatus);
                return st ? <StatusChip label={st.label} tone={st.tone} /> : null;
              },
            },
            {
              key: 'act',
              label: P.cols.actions,
              render: ({ contact: c, leadId }) =>
                leadId ? (
                  <Link className="link small" to={recordPeekPath(actor.workspaceId, 'leads', leadId)}>
                    {A.openLead(leadId)}
                  </Link>
                ) : (
                  <>
                    <IconButton icon="arrow-up" label={A.convertToLead} onClick={() => setConverting(c)} disabledReason={convertBlockedReason(actor, c)} />
                    <IconButton icon="trash" label={A.delete} disabledReason={canDelete ? (deleting === c.id ? A.delete : undefined) : P.noDelete} onClick={() => remove(c)} />
                  </>
                ),
            },
          ]}
        />
      </div>
      <QuickCreateDialog open={adding} resKey="contacts" initial={{ customerId: null, poolStatus: 'new', ownerId: actor.staffId, divisionIds: actor.divisionIds.slice(0, 1) }} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />
      {converting && <ConvertDialog actor={actor} contact={converting} onClose={() => setConverting(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Duplicate Detection & Merge (CUS-06)

export function DuplicatesPage() {
  const actor = useActor();
  const toast = useToast();
  const D = L.customers.duplicates;
  const allowed = can(actor, 'customers.merge');
  const q = useServiceQuery(() => (allowed ? getDuplicateGroups(actor) : []), [actor.user.id]);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  if (!allowed) return <NoAccess what={D.noAccess} />;
  const customers = getDb().records.customers ?? [];
  const contacts = getDb().records.contacts ?? [];
  return (
    <SettingsPage title={PAGES.duplicateMerge.title} description={D.short}>
      <div className="content-surface">
        {q.error ? (
          <ErrorState title={D.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={6} />
        ) : !q.data.length ? (
          <EmptyState icon="check" title={D.empty}>
            {D.emptyText}
          </EmptyState>
        ) : (
          
            <Table>
              <thead>
                <tr>
                  <th scope="col">{D.cols.why}</th>
                  <th scope="col">{D.cols.records}</th>
                  <th scope="col">{D.cols.action}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((g, i) => {
                  const isCustomer = g.kind !== 'contact';
                  const src = isCustomer ? customers : contacts;
                  const survivor = keep[i] ?? g.ids[0];
                  return (
                    <tr key={`${g.kind}-${g.ids.join('-')}`}>
                      <td>
                        <Badge tone={g.kind === 'gstin' ? 'danger' : 'warning'}>{D.kinds[g.kind]}</Badge>
                        <div className="muted small">{g.reason}</div>
                      </td>
                      <td>
                        <ul className="plain-list">
                          {g.ids.map((id) => {
                            const r = src.find((x) => x.id === id);
                            return (
                              <li key={id}>
                                {isCustomer ? (
                                  <label className="row-gap">
                                    <Radio name={`keep-${i}`} checked={survivor === id} onChange={() => setKeep((k) => ({ ...k, [i]: id }))} />
                                    <Link to={recordPeekPath(actor.workspaceId, 'customers', id)}>
                                      <span className="mono">{id}</span> {String(r?.name ?? '')}
                                    </Link>
                                    <span className="muted small">
                                      {r?.gstin ? String(r.gstin) : D.noGstin} · {masterLabel('territory', r?.territoryId)}
                                    </span>
                                  </label>
                                ) : (
                                  <Link to={recordPeekPath(actor.workspaceId, 'contacts', id)}>
                                    <span className="mono">{id}</span> {String(r?.name ?? '')} · {r?.customerId ? recordTitle('customers', r.customerId) : D.pool}
                                  </Link>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                      <td>
                        {isCustomer ? (
                          <Button
                            loading={busy === i}
                            icon="copy"
                            onClick={() => {
                              const drop = g.ids.find((x) => x !== survivor)!;
                              confirmDelete({
                                title: D.confirmTitle(drop, survivor),
                                message: D.confirmMessage(drop, survivor),
                                confirmLabel: A.merge,
                                onConfirm: async () => {
                                  setBusy(i);
                                  try {
                                    const r = await merge(actor, survivor, drop);
                                    toast(D.merged(drop, survivor, r.moved));
                                  } catch (e) {
                                    toast(errorMessage(e), 'danger');
                                  } finally {
                                    setBusy(null);
                                  }
                                },
                              });
                            }}
                          >
                            {A.merge}
                          </Button>
                        ) : (
                          <span className="muted small">{D.contactHint}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          
        )}
      </div>
    </SettingsPage>
  );
}

// ---------------------------------------------------------------- Bulk Ownership Transfer (CUS-10, BR-52)

export function TransferPage() {
  const actor = useActor();
  const toast = useToast();
  const X = L.customers.transfer;
  const allowed = can(actor, 'customers.transfer');
  const employees = (getDb().records.employees ?? []).filter((e) => e.workspaceId === actor.workspaceId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const preview = useServiceQuery(() => (from && allowed ? getTransferPreview(actor, from) : null), [actor.user.id, from]);
  if (!allowed) return <NoAccess what={X.noAccess} />;
  const total = preview.data?.reduce((s, x) => s + x.count, 0) ?? 0;
  const name = (id: string) => recordTitle('employees', id, actor);
  const run = () =>
    confirmDelete({
      title: X.confirmTitle(total, name(to)),
      message: X.confirmMessage(name(from), name(to)),
      confirmLabel: A.transferOwnership,
      onConfirm: async () => {
        setBusy(true);
        setErrors({});
        try {
          const r = await transfer(actor, from, to, reason);
          toast(X.done(Object.values(r.moved).reduce((a, b) => a + b, 0), name(to)));
          setReason('');
          preview.retry();
        } catch (e) {
          if (e instanceof ServiceError && e.fieldErrors) setErrors(e.fieldErrors);
          toast(errorMessage(e), 'danger');
        } finally {
          setBusy(false);
        }
      },
    });
  return (
    <SettingsPage title={PAGES.ownershipTransfer.title} description={X.short}>
      <section className="panel">
        <div className="form-grid cols-2">
          <div className="form-field">
            <label className="field-label" htmlFor="tr-from">
              {X.from} <span className="req">*</span>
            </label>
            <SelectMenu id="tr-from" block label={X.from} value={from} options={employees.map((e) => ({ value: e.id, label: `${String(e.fullName)} — ${String(e.designation)}${e.status === 'inactive' ? X.inactive : ''}` }))} onChange={setFrom} />
            {errors.from && <p className="field-error">{errors.from}</p>}
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="tr-to">
              {X.to} <span className="req">*</span>
            </label>
            <SelectMenu id="tr-to" block label={X.to} value={to} options={employees.filter((e) => e.id !== from && e.status !== 'inactive').map((e) => ({ value: e.id, label: `${String(e.fullName)} — ${String(e.designation)}` }))} onChange={setTo} />
            {errors.to && <p className="field-error">{errors.to}</p>}
          </div>
          <div className="form-field span-all">
            <span className="field-label-row">
              <label className="field-label" htmlFor="tr-reason">
                {X.reason} <span className="req">*</span>
              </label>
              <InfoTip text={X.reasonTip} label={X.reasonTipLabel} />
            </span>
            <TextField id="tr-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={X.reasonPlaceholder} />
            {errors.reason && <p className="field-error">{errors.reason}</p>}
          </div>
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-title">{X.whatMoves}</h2>
        {!from ? (
          <p className="muted">{X.chooseFrom}</p>
        ) : preview.error ? (
          <ErrorState title={X.countError} onRetry={preview.retry}>
            {preview.error}
          </ErrorState>
        ) : !preview.data ? (
          <Skeleton rows={4} />
        ) : (
          <>
            <dl className="detail-list">
              {preview.data.map((x) => (
                <div key={x.resKey} className="detail-row">
                  <dt>{x.label}</dt>
                  <dd>{x.count}</dd>
                </div>
              ))}
            </dl>
            <div className="row-gap">
              <Button variant="primary" icon="users" loading={busy} onClick={run} disabledReason={!total ? X.nothing : !to ? X.chooseTo : reason.trim().length < 5 ? X.reasonShort : undefined}>
                {A.transferOwnership}
              </Button>
              <span className="muted small">{X.buttonCount(total)}</span>
            </div>
          </>
        )}
      </section>
    </SettingsPage>
  );
}

// ---------------------------------------------------------------- Import Contacts (CUS-05)

export function ContactImportPage() {
  const actor = useActor();
  const toast = useToast();
  const I = L.customers.import;
  const [params, setParams] = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [cardN, setCardN] = useState(0);
  const allowed = perm(actor, 'contacts').create;
  const load = async (label: string, op: () => Promise<ImportRow[]>, append = false) => {
    setBusy(label);
    setError('');
    try {
      const next = await op();
      setRows((cur) => (append && cur ? [...cur, ...next.map((r, i) => ({ ...r, line: cur.length + i + 1 }))] : next));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const scanCard = () => {
    setCardN((n) => n + 1);
    load('card', () => visitingCardSample(cardN), true);
  };
  // Arriving from the Contact Pool with ?add=phone|card starts that (simulated) source once.
  const add = params.get('add');
  useEffect(() => {
    if (!allowed || (add !== 'phone' && add !== 'card')) return;
    setParams({}, { replace: true });
    if (add === 'phone') load('phone', phoneBookSample, true);
    else load('card', () => visitingCardSample(0), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, allowed]);
  if (!allowed) return <NoAccess what={I.noAccess} />;
  const valid = rows?.filter((r) => !r.errors.length && !r.duplicateOf) ?? [];
  return (
    <div className="page">
      <PageHeader title={PAGES.contactPoolImport.title} description={I.description} />
      <div className="toolbar">
        <Button icon="download" onClick={() => downloadText('contacts-template.csv', CONTACT_CSV_TEMPLATE)}>
          {A.downloadTemplate}
        </Button>
        <Button variant="primary" icon="arrow-up" loading={busy === 'csv'} onClick={() => fileRef.current?.click()}>
          {A.uploadExcel}
        </Button>
        <FileInput
          ref={fileRef}
          
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > 2 * 1024 * 1024) return setError(I.tooLarge);
            f.text().then((t) => load('csv', () => parseContactCsv(t)));
          }}
        />
        <span className="viewbar-divider" aria-hidden="true" />
        <Button icon="users" loading={busy === 'phone'} onClick={() => load('phone', phoneBookSample, true)} title={A.simulatedPhoneBook}>
          {A.phoneBook}
        </Button>
        <Button icon="id-card" loading={busy === 'card'} onClick={scanCard} title={A.simulatedCard}>
          {A.visitingCard}
        </Button>
        <InfoTip text={I.demoTip} label={I.demoTipLabel} />
        <span className="spacer" />
        <Link className="link small" to={ROUTES.contactPool}>
          {PAGES.contactPool.title}
        </Link>
      </div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div className="content-surface">
        {!rows ? (
          busy ? (
            <Skeleton rows={4} />
          ) : (
            <EmptyState icon="arrow-up" title={I.noFile}>
              {I.noFileText}
            </EmptyState>
          )
        ) : !rows.length ? (
          <EmptyState icon="search" title={I.noRows} />
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-count">
                {I.summary(
                  rows.length,
                  valid.length,
                  rows.filter((r) => r.errors.length).length,
                  rows.filter((r) => r.duplicateOf).length,
                )}
              </span>
              <span className="spacer" />
              <Button onClick={() => setRows(null)}>{A.clear}</Button>
              <Button
                variant="primary"
                loading={busy === 'import'}
                disabledReason={valid.length ? undefined : I.noValid}
                onClick={async () => {
                  if (importing.current) return; // no double submit
                  importing.current = true;
                  setBusy('import');
                  try {
                    const r = await importContacts(actor, rows);
                    toast(I.imported(r.created.length, r.skipped.length), r.created.length ? 'success' : 'info');
                    setRows(null);
                  } catch (e) {
                    toast(errorMessage(e), 'danger');
                  } finally {
                    importing.current = false;
                    setBusy(null);
                  }
                }}
              >
                {A.importN(valid.length)}
              </Button>
            </div>
            
              <Table>
                <thead>
                  <tr>
                    <th scope="col">{I.cols.line}</th>
                    <th scope="col">{I.cols.name}</th>
                    <th scope="col">{I.cols.company}</th>
                    <th scope="col">{I.cols.mobile}</th>
                    <th scope="col">{I.cols.email}</th>
                    <th scope="col">{I.cols.city}</th>
                    <th scope="col">{I.cols.check}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line}>
                      <td className="num">{r.line}</td>
                      <td>{r.name || <EmptyValue />}</td>
                      <td>{r.customerId ? <Link to={recordPeekPath(actor.workspaceId, 'customers', r.customerId)}>{r.company}</Link> : r.company || <span className="muted small">{I.pool}</span>}</td>
                      <td>{r.mobile || <EmptyValue />}</td>
                      <td>{r.email || <EmptyValue />}</td>
                      <td>{r.city || <EmptyValue />}</td>
                      <td>
                        {r.errors.length ? (
                          <StatusChip label={r.errors[0]} tone="danger" />
                        ) : r.duplicateOf ? (
                          <Link to={recordPeekPath(actor.workspaceId, 'contacts', r.duplicateOf)}>
                            <StatusChip label={I.exists(r.duplicateOf)} tone="warning" />
                          </Link>
                        ) : (
                          <StatusChip label={I.ready} tone="success" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            
          </>
        )}
      </div>
    </div>
  );
}
