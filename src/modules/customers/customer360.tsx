/**
 * Customer 360° View tabs (CUS-07, GLOSSARY §1.2): Overview, Contacts, Sites, Leads, Opportunities,
 * Quotations, Sales Orders, Payment Status, Installed Machines, Warranty & AMC, Service Tickets,
 * Feedback, Key Account Plan, Activity History, Documents. Consumables and Training Records are
 * contributed by their modules. Registered in domain/extensions/customers.tsx.
 * Every tab loads through useServiceQuery (simulated latency) and has loading / error / empty states.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { formatMoney } from '../../lib/format';
import { formatDate, todayKey } from '../../lib/dates';
import { recordPeekPath } from '../../lib/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { countLinked, getCustomer360, getCustomer360Overview, getCustomerDocuments, getCustomerTimeline, type LinkedSet, type LinkedRow, openOpportunities } from '../../services/api/customers';
import { canUpdateRecord, perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { masterLabel, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import type { RecordExtensionProps } from '../../components/resource/extensions';
import { Button } from '../../components/primitives/Button';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { FormDrawer, QuickCreateDialog } from '../../components/resource/RecordForm';
import { LogActivityDialog } from '../../components/crm/LogActivityDialog';
import { RefreshErpButton } from './components';
import { Table } from '../../components/primitives/Table';

const C = L.customers.c360;
const T = L.customers.tabs;
const A = L.customers.actions;

// ---------------------------------------------------------------- shared bits

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h3 className="detail-section-title">
          {title} {count !== undefined && <span className="muted">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Loading / error placeholder for a tab whose query has no data yet. */
function Pending({ q }: { q: { error: string | null; retry: () => void } }) {
  return q.error ? (
    <ErrorState title={C.loadError} onRetry={q.retry}>
      {q.error}
    </ErrorState>
  ) : (
    <Skeleton rows={4} />
  );
}

function LinkedTable({ rows, ws }: { rows: LinkedRow[]; ws: string }) {
  const showAmount = rows.some((r) => r.amount !== undefined);
  return (
    
      <Table>
        <thead>
          <tr>
            <th scope="col">{C.columns.id}</th>
            <th scope="col">{C.columns.title}</th>
            <th scope="col">{C.columns.status}</th>
            {showAmount && (
              <th scope="col" className="th-num">
                {C.columns.amount}
              </th>
            )}
            <th scope="col">{C.columns.date}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.resKey}:${r.id}`}>
              <td className="nowrap">
                <Link to={recordPeekPath(ws, r.resKey, r.id)} className="rel-link mono">
                  {r.id}
                </Link>
              </td>
              <td>{r.title !== r.id ? r.title : <EmptyValue />}</td>
              <td>{r.status ? <StatusChip label={r.status.label} tone={r.status.tone} /> : <EmptyValue />}</td>
              {showAmount && <td className="td-num">{r.amount !== undefined ? formatMoney(r.amount) : <EmptyValue />}</td>}
              <td className="nowrap">{r.date ? <DateText value={r.date} /> : <EmptyValue />}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    
  );
}

function LinkedSection({ title, set, ws, icon }: { title: string; set: LinkedSet; ws: string; icon: string }) {
  return (
    <Section title={title} count={set.available ? set.rows.length : undefined}>
      {!set.available ? (
        <p className="muted">{C.notAvailable}</p>
      ) : set.rows.length ? (
        <LinkedTable rows={set.rows} ws={ws} />
      ) : (
        <EmptyState icon={icon} title={C.linked.emptyTitle(title)}>
          {C.linked.emptyText(title)}
        </EmptyState>
      )}
    </Section>
  );
}

function use360(actor: RecordExtensionProps['actor'], id: string) {
  return useServiceQuery(() => getCustomer360(actor, id), [actor.user.id, id]);
}

type SetKey = 'leads' | 'opportunities' | 'quotations' | 'salesOrders' | 'machines' | 'tickets';

/** One tab = one linked resource list. */
function linkedTab(key: SetKey, title: string, icon: string) {
  return function LinkedTab({ actor, record }: RecordExtensionProps) {
    const q = use360(actor, record.id);
    if (!q.data) return <Pending q={q} />;
    return (
      <div className="related">
        <LinkedSection title={title} set={q.data[key]} ws={actor.workspaceId} icon={icon} />
      </div>
    );
  };
}

export const LeadsTab = linkedTab('leads', T.leads, 'target');
export const OpportunitiesTab = linkedTab('opportunities', T.opportunities, 'handshake');
export const QuotationsTab = linkedTab('quotations', T.quotations, 'file-text');
export const SalesOrdersTab = linkedTab('salesOrders', T.salesOrders, 'shopping-cart');
export const MachinesTab = linkedTab('machines', T.installedMachines, 'printer');

/** Contacts / Sites tab badge counts (sync, from the local store). */
/** Contacts / Sites tab badge counts — scoped like the tab content, so the badge never shows records the user cannot open. */
export const contactCount = ({ actor, record }: RecordExtensionProps) => countLinked(actor, 'contacts', record.id);
export const siteCount = ({ actor, record }: RecordExtensionProps) => countLinked(actor, 'addresses', record.id);

// ---------------------------------------------------------------- ERP figures

export function ErpFigures({ record }: { record: RecordData }) {
  const F = L.customers.fields.customers;
  const fig = (v: unknown) => (typeof v === 'number' ? formatMoney(v) : <EmptyValue />);
  return (
    <dl className="detail-list">
      <div className="detail-row">
        <dt>{F.creditLimit}</dt>
        <dd>{fig(record.creditLimit)}</dd>
      </div>
      <div className="detail-row">
        <dt>{F.outstanding}</dt>
        <dd>{fig(record.outstanding)}</dd>
      </div>
      <div className="detail-row">
        <dt>{F.overdue}</dt>
        <dd>{typeof record.overdue === 'number' && record.overdue > 0 ? <strong className="text-danger">{formatMoney(record.overdue)}</strong> : fig(record.overdue)}</dd>
      </div>
      <div className="detail-row">
        <dt>{C.payment.lastSynced}</dt>
        <dd>{record.erpSyncedAt ? <DateText value={String(record.erpSyncedAt)} showTime /> : <EmptyValue />}</dd>
      </div>
    </dl>
  );
}

const erpTip = (
  <span className="dialog-title-row">
    <InfoTip text={C.payment.erpTip} label={C.payment.erpTipLabel} />
  </span>
);

// ---------------------------------------------------------------- Overview

export function OverviewTab({ actor, record }: RecordExtensionProps) {
  const q = useServiceQuery(() => getCustomer360Overview(actor, record.id), [actor.user.id, record.id]);
  const F = L.customers.fields.customers;
  const O = C.overview;
  if (!q.data) return <Pending q={q} />;
  const { counts, children, endCustomers, recent } = q.data;
  const facts: [string, ReactNode][] = [
    [F.category, masterLabel('customerCategory', record.category) || <EmptyValue />],
    [F.segmentTags, ((record.segmentTags as string[]) ?? []).map((s) => masterLabel('segment', s)).join(', ') || <EmptyValue />],
    [F.territoryId, masterLabel('territory', record.territoryId) || <EmptyValue />],
    [F.ownerId, record.ownerId ? recordTitle('employees', record.ownerId, actor) : <EmptyValue />],
    [F.gstin, record.gstin ? <span className="mono">{String(record.gstin)}</span> : <EmptyValue />],
    [F.keyAccount, record.keyAccount ? <StatusChip label={F.keyAccount} tone="accent" /> : <EmptyValue />],
    [F.parentId, record.parentId ? <Link to={recordPeekPath(actor.workspaceId, 'customers', String(record.parentId))}>{recordTitle('customers', record.parentId, actor)}</Link> : <EmptyValue />],
    [F.dealerId, record.dealerId ? <Link to={recordPeekPath(actor.workspaceId, 'customers', String(record.dealerId))}>{recordTitle('customers', record.dealerId, actor)}</Link> : <EmptyValue />],
  ];
  const glance: [string, number | undefined][] = [
    [O.counts.contacts, counts.contacts],
    [O.counts.sites, counts.sites],
    [O.counts.openLeads, counts.openLeads],
    [O.counts.openOpportunities, counts.openOpportunities],
    [O.counts.machines, counts.machines],
    [O.counts.openTickets, counts.openTickets],
  ];
  const list = (rows: { id: string; name: string }[]) =>
    rows.length ? (
      rows.map((c, i) => (
        <span key={c.id}>
          {i > 0 && ', '}
          <Link to={recordPeekPath(actor.workspaceId, 'customers', c.id)}>{c.name}</Link>
        </span>
      ))
    ) : (
      <span className="muted">{O.noGroup}</span>
    );
  return (
    <div className="related">
      <Section title={O.atAGlance}>
        <dl className="detail-list">
          {glance
            .filter(([, n]) => n !== undefined)
            .map(([label, n]) => (
              <div key={label} className="detail-row">
                <dt>{label}</dt>
                <dd>{n}</dd>
              </div>
            ))}
        </dl>
      </Section>
      <Section title={O.facts}>
        <dl className="detail-list">
          {facts.map(([label, value]) => (
            <div key={label} className="detail-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div className="detail-row">
            <dt>{O.group}</dt>
            <dd>{list(children)}</dd>
          </div>
          {(record.category === 'dealer' || record.category === 'distributor') && (
            <div className="detail-row">
              <dt>{O.endCustomers}</dt>
              <dd>{list(endCustomers)}</dd>
            </div>
          )}
        </dl>
      </Section>
      <Section title={O.erp} action={erpTip}>
        <ErpFigures record={record} />
      </Section>
      <Section title={O.recent}>
        {recent.length ? (
          <ul className="related-list">
            {recent.map((a) => (
              <li key={a.id}>
                <span className="muted small nowrap">
                  <DateText value={String(a.at)} />
                </span>
                <Link to={recordPeekPath(actor.workspaceId, 'activities', a.id)} className="rel-link">
                  {String(a.subject)}
                </Link>
                <span className="muted small">{masterLabel('activityType', a.activityType)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{O.noRecent}</p>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- Contacts

export function ContactsTab({ actor, record }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  const [adding, setAdding] = useState(false);
  if (!q.data) return <Pending q={q} />;
  const { contacts } = q.data;
  return (
    <div className="related">
      <Section
        title={T.contacts}
        count={contacts.length}
        action={
          perm(actor, 'contacts').create && (
            <Button variant="ghost" icon="plus" onClick={() => setAdding(true)}>
              {A.addContact}
            </Button>
          )
        }
      >
        {contacts.length ? (
          <ul className="related-list">
            {contacts.map((c) => (
              <li key={c.id}>
                <Link to={recordPeekPath(actor.workspaceId, 'contacts', c.id)} className="rel-link">
                  {String(c.name)}
                </Link>
                <span className="muted small">{[c.designation, masterLabel('buyingRole', c.buyingRole)].filter(Boolean).join(' · ') || <EmptyValue />}</span>
                {c.buyingRole === 'decision_maker' && <StatusChip label={C.contacts.decisionMaker} tone="accent" />}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="users" title={C.contacts.empty}>
            {C.contacts.emptyText}
          </EmptyState>
        )}
      </Section>
      <QuickCreateDialog open={adding} resKey="contacts" initial={{ customerId: record.id, divisionIds: record.divisionIds, ownerId: record.ownerId }} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- Sites

const siteLine = (a: RecordData) => [a.line1, a.city, masterLabel('state', a.state), a.pincode].filter(Boolean).join(', ');

export function SitesTab({ actor, record }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  const [adding, setAdding] = useState(false);
  if (!q.data) return <Pending q={q} />;
  const { sites } = q.data;
  return (
    <div className="related">
      <Section
        title={T.sites}
        count={sites.length}
        action={
          perm(actor, 'addresses').create && (
            <Button variant="ghost" icon="plus" onClick={() => setAdding(true)}>
              {A.addSite}
            </Button>
          )
        }
      >
        {sites.length ? (
          <ul className="related-list">
            {sites.map((a) => (
              <li key={a.id}>
                <Link to={recordPeekPath(actor.workspaceId, 'addresses', a.id)} className="rel-link">
                  {String(a.label)}
                </Link>
                <span className="muted small">{siteLine(a)}</span>
                <StatusChip label={masterLabel('addressType', a.addressType)} tone={masterValue('addressType', a.addressType)?.tone} />
                {a.addressType === 'installation' && (a.lat === null || a.lat === undefined) && <StatusChip label={C.sites.noGeo} tone="warning" />}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="building" title={C.sites.empty}>
            {C.sites.emptyText}
          </EmptyState>
        )}
      </Section>
      <QuickCreateDialog open={adding} resKey="addresses" initial={{ customerId: record.id, state: record.billingState }} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- Payment Status (ERP + payment schedule)

export function PaymentStatusTab({ actor, record, res }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  const P = C.payment;
  if (!q.data) return <Pending q={q} />;
  const { payments } = q.data;
  const open = payments.rows.filter((r) => r.received < r.amount);
  const openTotal = open.reduce((s, r) => s + (r.amount - r.received), 0);
  const pastDueTotal = open.filter((r) => r.pastDue).reduce((s, r) => s + (r.amount - r.received), 0);
  return (
    <div className="related">
      <Section
        title={P.erp}
        action={
          <span className="row-gap">
            {erpTip}
            <RefreshErpButton actor={actor} record={record} res={res} compact />
          </span>
        }
      >
        <ErpFigures record={record} />
      </Section>
      <Section title={P.schedule} count={payments.available ? payments.rows.length : undefined}>
        {!payments.available ? (
          <p className="muted">{C.notAvailable}</p>
        ) : !payments.rows.length ? (
          <EmptyState icon="receipt" title={P.scheduleEmpty}>
            {P.scheduleEmptyText}
          </EmptyState>
        ) : (
          <>
            <p className="small">{P.totals(formatMoney(openTotal), formatMoney(pastDueTotal))}</p>
            
              <Table>
                <thead>
                  <tr>
                    <th scope="col">{P.cols.milestone}</th>
                    <th scope="col">{P.cols.order}</th>
                    <th scope="col">{P.cols.due}</th>
                    <th scope="col" className="th-num">
                      {P.cols.amount}
                    </th>
                    <th scope="col" className="th-num">
                      {P.cols.received}
                    </th>
                    <th scope="col">{P.cols.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={recordPeekPath(actor.workspaceId, 'paymentMilestones', r.id)} className="rel-link">
                          {r.label}
                        </Link>
                      </td>
                      <td>{r.salesOrderId ? <Link to={recordPeekPath(actor.workspaceId, 'salesOrders', r.salesOrderId)}>{r.salesOrderTitle}</Link> : <EmptyValue />}</td>
                      <td className={r.pastDue ? 'nowrap text-danger' : 'nowrap'}>{r.dueDate ? <DateText value={r.dueDate} /> : <EmptyValue />}</td>
                      <td className="td-num">{formatMoney(r.amount)}</td>
                      <td className="td-num">{formatMoney(r.received)}</td>
                      <td>{r.status ? <StatusChip label={r.status.label} tone={r.status.tone} /> : <EmptyValue />}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            
          </>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- Warranty & AMC

export function WarrantyAmcTab({ actor, record }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  if (!q.data) return <Pending q={q} />;
  return (
    <div className="related">
      <LinkedSection title={C.warranty.warranties} set={q.data.warranties} ws={actor.workspaceId} icon="shield" />
      <LinkedSection title={C.warranty.amc} set={q.data.amcContracts} ws={actor.workspaceId} icon="file-text" />
    </div>
  );
}

// ---------------------------------------------------------------- Service Tickets

export function TicketsTab({ actor, record }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  if (!q.data) return <Pending q={q} />;
  const rated = q.data.feedback.rows.filter((f) => f.rating !== undefined);
  const avg = rated.length ? rated.reduce((s, f) => s + Number(f.rating), 0) / rated.length : null;
  return (
    <div className="related">
      {avg !== null && <p className="small">{C.tickets.csat(avg.toFixed(1), rated.length)}</p>}
      <LinkedSection title={T.serviceTickets} set={q.data.tickets} ws={actor.workspaceId} icon="wrench" />
    </div>
  );
}

// ---------------------------------------------------------------- Feedback

export function FeedbackTab({ actor, record }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  const Fb = C.feedback;
  if (!q.data) return <Pending q={q} />;
  const { feedback } = q.data;
  const rated = feedback.rows.filter((f) => f.rating !== undefined);
  const avg = rated.length ? rated.reduce((s, f) => s + Number(f.rating), 0) / rated.length : null;
  return (
    <div className="related">
      <Section title={T.feedback} count={feedback.available ? feedback.rows.length : undefined} action={avg !== null && <StatusChip label={Fb.average(avg.toFixed(1), rated.length)} tone={avg >= 4 ? 'success' : avg >= 3 ? 'warning' : 'danger'} />}>
        {!feedback.available ? (
          <p className="muted">{C.notAvailable}</p>
        ) : !feedback.rows.length ? (
          <EmptyState icon="star" title={Fb.empty}>
            {Fb.emptyText}
          </EmptyState>
        ) : (
          
            <Table>
              <thead>
                <tr>
                  <th scope="col">{Fb.cols.ticket}</th>
                  <th scope="col">{Fb.cols.rating}</th>
                  <th scope="col">{Fb.cols.comment}</th>
                  <th scope="col">{Fb.cols.closed}</th>
                </tr>
              </thead>
              <tbody>
                {feedback.rows.map((f) => (
                  <tr key={f.ticketId}>
                    <td className="nowrap">
                      <Link to={recordPeekPath(actor.workspaceId, 'tickets', f.ticketId)} className="rel-link mono">
                        {f.ticketId}
                      </Link>
                    </td>
                    <td className="nowrap">{f.rating !== undefined ? <span aria-label={`${f.rating} / 5`}>{'★'.repeat(f.rating)}{'☆'.repeat(Math.max(0, 5 - f.rating))}</span> : <EmptyValue />}</td>
                    <td>{f.comment.trim() ? f.comment : <span className="muted small">{Fb.noComment}</span>}</td>
                    <td className="nowrap">{f.closedAt ? <DateText value={f.closedAt} /> : <EmptyValue />}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- Key Account Plan (CUS-11)

export function KeyAccountPlanTab({ actor, record, res }: RecordExtensionProps) {
  const q = use360(actor, record.id);
  const [editing, setEditing] = useState(false);
  const P = C.plan;
  const raw = getDb().records.customers?.find((c) => c.id === record.id);
  const canEdit = !!raw && canUpdateRecord(actor, res, raw);
  if (!q.data) return <Pending q={q} />;
  const openOpps = openOpportunities(q.data);
  const decisionMakers = q.data.contacts.filter((c) => c.buyingRole === 'decision_maker' || c.buyingRole === 'finance');
  const review = record.planNextReview ? String(record.planNextReview) : '';
  return (
    <div className="related">
      <Section
        title={T.keyAccountPlan}
        action={
          canEdit && (
            <Button variant="ghost" icon="pencil" onClick={() => setEditing(true)}>
              {record.keyAccount ? A.editPlan : A.makeKeyAccount}
            </Button>
          )
        }
      >
        {!record.keyAccount ? (
          <EmptyState icon="star" title={P.notKey} />
        ) : (
          <>
            {review && review < todayKey() && (
              <InlineAlert tone="warning" title={P.overdueTitle}>
                {P.overdueText(formatDate(review))}
              </InlineAlert>
            )}
            <dl className="detail-list">
              <div className="detail-row">
                <dt>{P.objectives}</dt>
                <dd>{record.planObjectives ? String(record.planObjectives) : <EmptyValue />}</dd>
              </div>
              <div className="detail-row">
                <dt>{P.keyContacts}</dt>
                <dd>
                  {record.planKeyContacts ? String(record.planKeyContacts) : null}
                  {decisionMakers.length > 0 && <div className="muted small">{P.onRecord(decisionMakers.map((c) => `${String(c.name)} (${masterLabel('buyingRole', c.buyingRole)})`).join(', '))}</div>}
                  {!record.planKeyContacts && !decisionMakers.length && <EmptyValue />}
                </dd>
              </div>
              <div className="detail-row">
                <dt>{P.risks}</dt>
                <dd>{record.planRisks ? String(record.planRisks) : <EmptyValue />}</dd>
              </div>
              <div className="detail-row">
                <dt>{P.nextReview}</dt>
                <dd>{review ? formatDate(review) : <EmptyValue />}</dd>
              </div>
            </dl>
            <h4 className="detail-section-title">{P.openOpps}</h4>
            {openOpps.length ? <LinkedTable rows={openOpps} ws={actor.workspaceId} /> : <p className="muted">{P.noOpenOpps}</p>}
          </>
        )}
      </Section>
      <FormDrawer open={editing} resKey="customers" recordId={record.id} onClose={() => setEditing(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- Activity History (COM-05)

export function ActivityHistoryTab({ actor, record }: RecordExtensionProps) {
  const q = useServiceQuery(() => getCustomerTimeline(actor, record.id), [actor.user.id, record.id]);
  const [logging, setLogging] = useState(false);
  return (
    <div className="related">
      <Section
        title={T.activityHistory}
        count={q.data?.length}
        action={
          perm(actor, 'activities').create && (
            <Button variant="ghost" icon="plus" onClick={() => setLogging(true)}>
              {A.logActivity}
            </Button>
          )
        }
      >
        {!q.data ? (
          <Pending q={q} />
        ) : q.data.length ? (
          <ul className="related-list">
            {q.data.slice(0, 40).map((a) => (
              <li key={a.id}>
                <span className="muted small nowrap">
                  <DateText value={String(a.at)} />
                </span>
                <Link to={recordPeekPath(actor.workspaceId, 'activities', a.id)} className="rel-link">
                  {String(a.subject)}
                </Link>
                <span className="muted small">
                  {masterLabel('activityType', a.activityType)} · {recordTitle('employees', a.byId, actor)}
                  {a.parentLabel ? ` · ${String(a.parentLabel)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="message" title={C.activity.empty}>
            {C.activity.emptyText}
          </EmptyState>
        )}
      </Section>
      <LogActivityDialog open={logging} onClose={() => setLogging(false)} parent={{ parentResource: 'customers', parentId: record.id, parentLabel: `${record.id} · ${String(record.name)}`, customerId: record.id }} />
    </div>
  );
}

// ---------------------------------------------------------------- Documents (COM-04, simulated)

export function DocumentsTab({ actor, record }: RecordExtensionProps) {
  const q = useServiceQuery(() => getCustomerDocuments(actor, record.id), [actor.user.id, record.id]);
  const D = C.documents;
  return (
    <div className="related">
      <Section title={T.documents} count={q.data?.length} action={<InfoTip text={D.simulated} label={D.simulated} />}>
        {!q.data ? (
          <Pending q={q} />
        ) : !q.data.length ? (
          <EmptyState icon="file-text" title={D.empty}>
            {D.emptyText}
          </EmptyState>
        ) : (
          
            <Table>
              <thead>
                <tr>
                  <th scope="col">{D.cols.file}</th>
                  <th scope="col">{D.cols.type}</th>
                  <th scope="col">{D.cols.record}</th>
                  <th scope="col">{D.cols.updated}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((d) => (
                  <tr key={d.key}>
                    <td>{d.fileName}</td>
                    <td>{d.fieldLabel}</td>
                    <td className="nowrap">
                      <Link to={recordPeekPath(actor.workspaceId, d.resKey, d.recordId)} className="rel-link">
                        {d.resLabel} <span className="mono">{d.recordId}</span>
                      </Link>
                    </td>
                    <td className="nowrap">{d.updatedAt ? <DateText value={d.updatedAt} /> : <EmptyValue />}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          
        )}
      </Section>
    </div>
  );
}
