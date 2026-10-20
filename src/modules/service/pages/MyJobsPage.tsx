import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceQuery } from '../../../hooks/useServiceQuery';
import { formatDate, nowLocal } from '../../../lib/dates';
import { loaders } from '../../../services/api/service';
import { useActor } from '../../../services/hooks';
import { setOffline } from '../../../services/offline';
import { activeMasterValues, masterValue } from '../../../services/registry';
import { byId } from '../../../services/lookups';
import { clockStates } from '../../../services/service/sla';
import { customerName } from '../../../services/service/tickets';
import { Button } from '../../../components/primitives/Button';
import type { Tone } from '../../../metadata/types';
import { InlineAlert, StatusChip, useToast } from '../../../components/primitives/feedback';
import { ListPage } from '../../../components/shell/ListPage';
import { DataTable } from '../../../components/primitives/DataTable';
import { SelectMenu } from '../../../components/primitives/SelectMenu';
import { EmptyValue } from '../../../components/primitives/display';
import { clockText } from '../components/TicketExtensions';
import { useOffline } from './useStep';
import { L } from '../../../constants/labels';
import { ROUTES, toPath } from '../../../constants/routes';

const S = L.service;
const P = S.pages.myJobs;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Offline switch + pending count shared by the field pages (NFR-15). */
export function OfflineBar() {
  const { offline, pending } = useOffline();
  const toast = useToast();
  return (
    <div className="row-gap no-print" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
      {offline ? (
        <InlineAlert tone="warning" title={P.offlineTitle}>
          {P.offlineBody(pending)}
        </InlineAlert>
      ) : null}
      <Button
        icon={offline ? 'reset' : 'eye-off'}
        onClick={() => {
          const r = setOffline(!offline);
          if (r) toast(r.conflicts.length ? S.toasts.syncConflicts(r.synced.length, r.conflicts.length, r.conflicts.map((c) => c.message).join(' ')) : S.toasts.synced(r.synced.length), r.conflicts.length ? 'danger' : 'success');
          else toast(S.toasts.offlineOn, 'info');
        }}
      >
        {offline ? S.actions.goOnline : S.actions.simulateOffline}
      </Button>
    </div>
  );
}

type JobRow = { id: string; kind: 'ticket' | 'pm'; to: string; customer: string; detail: string; machine: string; priority?: string; status: string; statusLabel: string; tone?: Tone; due: string; urgent: boolean };

/** FR-080: the engineer's jobs (tickets and PM visits), most urgent first, in the same table and filter bar as every other list. */
export function MyJobsPage() {
  const actor = useActor();
  const q = useServiceQuery(loaders.myJobs(actor), [actor.user.id]);
  const [kind, setKind] = useState('');
  const [priority, setPriority] = useState('');
  const rows = useMemo<JobRow[]>(() => {
    if (!q.data) return [];
    const tickets = q.data.tickets.map((t): JobRow => {
      const st = masterValue('ticketStatus', t.status);
      const next = clockStates(t, nowLocal()).find((c) => c.status !== 'met' && c.status !== 'breached_met' && c.status !== 'not_applicable');
      const machine = byId('machines', t.machineId);
      return {
        id: t.id,
        kind: 'ticket',
        to: toPath(ROUTES.myJob, { recordId: t.id }),
        customer: customerName(t.customerId),
        detail: s(t.description).slice(0, 120),
        machine: machine ? `${s(machine.serialNo)} · ${s(machine.model)}` : '',
        priority: s(t.priority),
        status: s(t.status),
        statusLabel: st?.label ?? s(t.status),
        tone: st?.tone,
        due: next ? `${next.clock === 'resolution' ? P.resolveBy : next.clock === 'arrival' ? P.reachSite : P.respond}: ${clockText(next)}` : P.awaitingConfirmation,
        urgent: !!next && (next.status === 'breached' || next.status === 'at_risk'),
      };
    });
    const pm = q.data.pm.map((p): JobRow => {
      const st = masterValue('pmStatus', p.status);
      return {
        id: p.id,
        kind: 'pm',
        to: toPath(ROUTES.pmSchedule, {}, { tab: 'all', q: p.id }),
        customer: customerName(p.customerId),
        detail: P.pmHeading,
        machine: s(byId('machines', p.machineId)?.serialNo),
        status: s(p.status),
        statusLabel: st?.label ?? s(p.status),
        tone: st?.tone,
        due: P.due(formatDate(s(p.dueDate))),
        urgent: false,
      };
    });
    return [...tickets, ...pm];
  }, [q.data]);
  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!priority || r.priority === priority));
  return (
    <ListPage title={L.nav.pages.myJobs.title} description={P.description}>
      <OfflineBar />
      <DataTable
        label={P.tableLabel}
        rows={shown}
        rowKey={(r) => `${r.kind}-${r.id}`}
        noun={P.noun}
        loading={!q.data && !q.error}
        error={q.error}
        onRetry={q.retry}
        search={(r) => `${r.id} ${r.customer} ${r.detail} ${r.machine}`}
        summary={P.count(shown.length)}
        activeFilters={(kind ? 1 : 0) + (priority ? 1 : 0)}
        onClearFilters={() => (setKind(''), setPriority(''))}
        empty={q.data && !rows.length ? { icon: 'check-square', title: P.empty, body: P.emptyBody } : undefined}
        filters={
          <>
            <SelectMenu label={P.typeFilter} value={kind} options={[{ value: '', label: P.allTypes }, { value: 'ticket', label: P.types.ticket }, { value: 'pm', label: P.types.pm }]} onChange={setKind} />
            <SelectMenu label={P.priorityFilter} value={priority} options={[{ value: '', label: P.allPriorities }, ...activeMasterValues('ticketPriority').map((v) => ({ value: v.key, label: v.label.replace(' (machine down)', '') }))]} onChange={setPriority} />
          </>
        }
        columns={[
          { key: 'id', label: P.cols.job, sort: (r) => r.id, render: (r) => <Link to={r.to} className="mono">{r.id}</Link> },
          { key: 'customer', label: P.cols.customer, sort: (r) => r.customer, render: (r) => (<><strong>{r.customer}</strong><div className="small muted">{r.detail}</div></>) },
          { key: 'machine', label: P.cols.machine, render: (r) => r.machine || <EmptyValue /> },
          {
            key: 'priority',
            label: P.cols.priority,
            sort: (r) => r.priority ?? '',
            render: (r) => {
              const pr = r.priority ? masterValue('ticketPriority', r.priority) : undefined;
              return pr ? <StatusChip label={pr.label.replace(' (machine down)', '')} tone={pr.tone} /> : <EmptyValue />;
            },
          },
          { key: 'status', label: P.cols.status, sort: (r) => r.statusLabel, render: (r) => <StatusChip label={r.statusLabel} tone={r.tone} /> },
          { key: 'due', label: P.cols.due, render: (r) => <span className={r.urgent ? 'text-danger small' : 'small muted'}>{r.due}</span> },
        ]}
      />
    </ListPage>
  );
}
