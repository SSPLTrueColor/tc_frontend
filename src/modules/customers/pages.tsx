import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { recordPeekPath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { importContacts, merge, parseContactCsv, phoneBookSample, transfer, visitingCardSample } from '../../services/api/customers';
import { can, perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { downloadText } from '../../services/exporter';
import { useActor } from '../../services/hooks';
import { masterLabel } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { listDuplicateGroups, previewTransfer } from '../../services/customers/operations';
import { CONTACT_CSV_TEMPLATE, type ImportRow } from '../../services/customers/importContacts';
import { Button } from '../../components/primitives/Button';
import { EmptyValue } from '../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, StatusChip, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { confirmDelete } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';

// ---------------------------------------------------------------- Duplicates & merge (CUS-06)

export function DuplicatesPage() {
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(() => (can(actor, 'customers.merge') ? listDuplicateGroups(actor) : []), [actor.user.id]);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  if (!can(actor, 'customers.merge')) return <NoAccess what="duplicate review" />;
  const customers = getDb().records.customers ?? [];
  const contacts = getDb().records.contacts ?? [];
  return (
    <div className="page">
      <PageHeader title="Duplicates & merge" description="Customers with the same GSTIN or very similar names (≥ 85%), and contacts sharing a mobile number. Merging re-points every linked record to the survivor and moves the duplicate to the recycle bin; the merge is audited." />
      <div className="content-surface">
        {q.error ? (
          <ErrorState title="Could not check for duplicates" onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={6} />
        ) : !q.data.length ? (
          <EmptyState icon="check" title="No likely duplicates">
            New customers are checked on entry; anything that slips through appears here.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">Why</th>
                  <th scope="col">Records (choose the one to keep)</th>
                  <th scope="col">Action</th>
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
                        <Badge tone={g.kind === 'gstin' ? 'danger' : 'warning'}>{g.kind === 'gstin' ? 'Same GSTIN' : g.kind === 'name' ? 'Similar name' : 'Same mobile'}</Badge>
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
                                    <input type="radio" name={`keep-${i}`} checked={survivor === id} onChange={() => setKeep((k) => ({ ...k, [i]: id }))} />
                                    <Link to={recordPeekPath(actor.workspaceId, 'customers', id)}>
                                      <span className="mono">{id}</span> {String(r?.name ?? '')}
                                    </Link>
                                    <span className="muted small">{r?.gstin ? String(r.gstin) : 'No GSTIN'} · {masterLabel('territory', r?.territoryId)}</span>
                                  </label>
                                ) : (
                                  <Link to={recordPeekPath(actor.workspaceId, 'contacts', id)}>
                                    <span className="mono">{id}</span> {String(r?.name ?? '')} {r?.customerId ? `· ${recordTitle('customers', r.customerId)}` : '· pool'}
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
                            onClick={() => {
                              const drop = g.ids.find((x) => x !== survivor)!;
                              confirmDelete({
                                title: `Merge ${drop} into ${survivor}?`,
                                message: `Contacts, addresses, leads, orders, machines, tickets and activities of ${drop} move to ${survivor}. ${drop} goes to the recycle bin. This cannot be undone automatically.`,
                                confirmLabel: 'Merge',
                                onConfirm: async () => {
                                  setBusy(i);
                                  try {
                                    const r = await merge(actor, survivor, drop);
                                    toast(`Merged ${drop} into ${survivor} (${r.moved} linked records moved)`);
                                  } catch (e) {
                                    toast(errorMessage(e), 'danger');
                                  } finally {
                                    setBusy(null);
                                  }
                                },
                              });
                            }}
                          >
                            Merge into selected
                          </Button>
                        ) : (
                          <span className="muted small">Open the contacts and edit or delete the wrong one.</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Ownership transfer (CUS-10, BR-52)

export function TransferPage() {
  const actor = useActor();
  const toast = useToast();
  const employees = (getDb().records.employees ?? []).filter((e) => e.workspaceId === actor.workspaceId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const preview = useServiceQuery(() => (from && can(actor, 'customers.transfer') ? previewTransfer(actor, from) : null), [actor.user.id, from]);
  if (!can(actor, 'customers.transfer')) return <NoAccess what="ownership transfer" />;
  const total = preview.data?.reduce((s, x) => s + x.count, 0) ?? 0;
  const name = (id: string) => recordTitle('employees', id, actor);
  const run = () =>
    confirmDelete({
      title: `Transfer ${total} records to ${name(to)}?`,
      message: `Accounts, contacts, open leads, open opportunities and open tasks of ${name(from)} move to ${name(to)}. Closed records keep their original owner. Every change is kept in the record history.`,
      confirmLabel: 'Transfer',
      onConfirm: async () => {
        setBusy(true);
        setErrors({});
        try {
          const r = await transfer(actor, from, to, reason);
          toast(`Transferred ${Object.values(r.moved).reduce((a, b) => a + b, 0)} records to ${name(to)}`);
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
    <div className="page">
      <PageHeader title="Ownership transfer" description="Move a person’s accounts and open work to someone else — when they leave or territories change. Closed records keep their original owner." />
      <section className="panel">
        <div className="form-grid cols-2">
          <div className="form-field">
            <label className="field-label" htmlFor="tr-from">
              Current owner <span className="req">*</span>
            </label>
            <SelectMenu id="tr-from" block label="Current owner" value={from} options={employees.map((e) => ({ value: e.id, label: `${String(e.fullName)} — ${String(e.designation)}${e.status === 'inactive' ? ' (inactive)' : ''}` }))} onChange={setFrom} />
            {errors.from && <p className="field-error">{errors.from}</p>}
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="tr-to">
              New owner <span className="req">*</span>
            </label>
            <SelectMenu id="tr-to" block label="New owner" value={to} options={employees.filter((e) => e.id !== from && e.status !== 'inactive').map((e) => ({ value: e.id, label: `${String(e.fullName)} — ${String(e.designation)}` }))} onChange={setTo} />
            {errors.to && <p className="field-error">{errors.to}</p>}
          </div>
          <div className="form-field span-all">
            <span className="field-label-row">
              <label className="field-label" htmlFor="tr-reason">
                Reason <span className="req">*</span>
              </label>
              <InfoTip text="Recorded in the history of every transferred record and in the audit log." label="About the reason" />
            </span>
            <input id="tr-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Territory realignment – Surat moved to Karan" />
            {errors.reason && <p className="field-error">{errors.reason}</p>}
          </div>
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-title">What will move</h2>
        {!from ? (
          <p className="muted">Choose the current owner to see their records.</p>
        ) : preview.error ? (
          <ErrorState title="Could not count records" onRetry={preview.retry}>
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
              <Button variant="primary" loading={busy} onClick={run} disabledReason={!total ? 'Nothing to transfer' : !to ? 'Choose the new owner' : reason.trim().length < 5 ? 'Give a reason (at least 5 characters)' : undefined}>
                Transfer {total} records
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Contact import (CUS-05)

export function ContactImportPage() {
  const actor = useActor();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [cardN, setCardN] = useState(0);
  if (!perm(actor, 'contacts').create) return <NoAccess what="importing contacts" />;
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
  const valid = rows?.filter((r) => !r.errors.length && !r.duplicateOf) ?? [];
  return (
    <div className="page">
      <PageHeader title="Import contacts" description="Add prospects to the contact pool from a CSV file. Every row is validated (name, mobile or email, formats) and checked for duplicates before anything is saved." />
      <div className="toolbar">
        <Button icon="download" onClick={() => downloadText('contacts-template.csv', CONTACT_CSV_TEMPLATE)}>
          Download template
        </Button>
        <Button variant="primary" icon="arrow-up" loading={busy === 'csv'} onClick={() => fileRef.current?.click()}>
          Upload CSV…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > 2 * 1024 * 1024) return setError('That file is larger than 2 MB.');
            f.text().then((t) => load('csv', () => parseContactCsv(t)));
          }}
        />
        <span className="viewbar-divider" aria-hidden="true" />
        <Button loading={busy === 'phone'} onClick={() => load('phone', phoneBookSample, true)} title="Simulated: adds sample entries, the phone book is not read">
          Add from phone book (demo)
        </Button>
        <Button
          loading={busy === 'card'}
          onClick={() => {
            setCardN((n) => n + 1);
            load('card', () => visitingCardSample(cardN), true);
          }}
          title="Simulated OCR: adds a sample card, the camera is not used"
        >
          Scan visiting card (demo)
        </Button>
        <InfoTip text="Phone-book import and visiting-card scanning run in the mobile app. Here they add sample rows so the review step can be shown." label="About demo sources" />
      </div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div className="content-surface">
        {!rows ? (
          <EmptyState icon="arrow-up" title="No file yet">
            Upload a CSV with columns name, company, designation, mobile, email, city, source.
          </EmptyState>
        ) : !rows.length ? (
          <EmptyState icon="search" title="The file has no rows" />
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-count">
                {rows.length} rows · <strong>{valid.length}</strong> ready · {rows.filter((r) => r.errors.length).length} with errors · {rows.filter((r) => r.duplicateOf).length} already exist
              </span>
              <span className="spacer" />
              <Button onClick={() => setRows(null)}>Clear</Button>
              <Button
                variant="primary"
                loading={busy === 'import'}
                disabledReason={valid.length ? undefined : 'No valid new rows to import'}
                onClick={async () => {
                  setBusy('import');
                  try {
                    const r = await importContacts(actor, rows);
                    toast(`Imported ${r.created.length} contact(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}`, r.created.length ? 'success' : 'info');
                    setRows(null);
                  } catch (e) {
                    toast(errorMessage(e), 'danger');
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Import {valid.length} contact(s)
              </Button>
            </div>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Name</th>
                    <th scope="col">Company</th>
                    <th scope="col">Mobile</th>
                    <th scope="col">Email</th>
                    <th scope="col">City</th>
                    <th scope="col">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line}>
                      <td className="num">{r.line}</td>
                      <td>{r.name || <EmptyValue />}</td>
                      <td>{r.customerId ? <Link to={recordPeekPath(actor.workspaceId, 'customers', r.customerId)}>{r.company}</Link> : r.company || <span className="muted small">Pool</span>}</td>
                      <td>{r.mobile || <EmptyValue />}</td>
                      <td>{r.email || <EmptyValue />}</td>
                      <td>{r.city || <EmptyValue />}</td>
                      <td>
                        {r.errors.length ? (
                          <StatusChip label={r.errors[0]} tone="danger" />
                        ) : r.duplicateOf ? (
                          <Link to={recordPeekPath(actor.workspaceId, 'contacts', r.duplicateOf)}>
                            <StatusChip label={`Exists as ${r.duplicateOf}`} tone="warning" />
                          </Link>
                        ) : (
                          <StatusChip label="Ready" tone="success" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

