import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServiceQuery } from '../hooks/useServiceQuery';
import { getClockOffset, now } from '../lib/clock';
import { formatDateTime, todayKey } from '../lib/dates';
import { recordPeekPath } from '../lib/routes';
import { can } from '../services/authz';
import { exportDbJson, getDb, importDbJson } from '../services/db';
import { shiftClock, updateDemoSettings } from '../services/demo';
import { downloadText } from '../services/exporter';
import { useActor, useRevision } from '../services/hooks';
import { listOutbox } from '../services/outbox';
import { getUser } from '../services/registry';
import type { OutboxMessage } from '../services/types';
import { Button } from '../components/primitives/Button';
import { DateText, EmptyValue } from '../components/primitives/display';
import { Badge, EmptyState, ErrorState, NoAccess, Skeleton, useToast } from '../components/primitives/feedback';
import { InfoTip } from '../components/primitives/InfoTip';
import { Dialog } from '../components/primitives/overlay';
import { SelectMenu } from '../components/primitives/SelectMenu';
import { PageHeader } from '../components/shell/PageHeader';

const LATENCY = [
  { value: '0-0', label: 'Off (instant)' },
  { value: '100-300', label: 'Fast (0.1–0.3 s)' },
  { value: '300-800', label: 'Realistic (0.3–0.8 s)' },
  { value: '1000-2500', label: 'Slow 4G (1–2.5 s)' },
];
const FAILURE = [
  { value: 0, label: 'Never' },
  { value: 0.1, label: '1 in 10 calls' },
  { value: 0.3, label: '3 in 10 calls' },
];
const IDLE = [5, 15, 30, 60].map((m) => ({ value: m, label: `${m} minutes` }));

/** Admin demo controls (Settings): simulated clock, latency, failures, idle timeout. */
export function DemoControls() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const demo = getDb().demo;
  const offsetDays = Math.round(getClockOffset() / 86_400_000);
  const shift = (days: number) => {
    shiftClock(actor, days);
    toast(days === 0 ? 'Clock is back to real time' : `Clock moved to ${formatDateTime(now().toISOString())}`, 'info');
  };
  return (
    <section className="panel">
      <h2 className="panel-title dialog-title-row">
        Demo controls
        <InfoTip text="Only for demonstrations. Time-based rules (SLAs, expiry, reminders, overdue lists) read the simulated clock; screens wait the simulated network delay." label="About demo controls" />
      </h2>
      <dl className="detail-list">
        <div className="detail-row">
          <dt>Simulated now</dt>
          <dd>
            {formatDateTime(now().toISOString())}
            {offsetDays !== 0 && <Badge tone="warning">{offsetDays > 0 ? `+${offsetDays}` : offsetDays} days</Badge>}
          </dd>
        </div>
      </dl>
      <div className="row-gap">
        <Button onClick={() => shift(1)}>+1 day</Button>
        <Button onClick={() => shift(7)}>+7 days</Button>
        <Button onClick={() => shift(30)}>+30 days</Button>
        <Button onClick={() => shift(0)} disabledReason={offsetDays === 0 && getClockOffset() === 0 ? 'Already real time' : undefined}>
          Back to real time
        </Button>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label className="field-label" htmlFor="demo-latency">
            Network delay
          </label>
          <SelectMenu
            id="demo-latency"
            block
            label="Network delay"
            value={`${demo.latencyMin}-${demo.latencyMax}`}
            options={LATENCY}
            onChange={(v) => {
              const [a, b] = v.split('-').map(Number);
              updateDemoSettings(actor, { latencyMin: a, latencyMax: b });
            }}
          />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="demo-failure">
            Simulated failures
          </label>
          <SelectMenu id="demo-failure" block label="Simulated failures" value={demo.failureRate} options={FAILURE} onChange={(v) => updateDemoSettings(actor, { failureRate: v })} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="demo-idle">
            Sign out after inactivity
          </label>
          <SelectMenu id="demo-idle" block label="Sign out after inactivity" value={demo.idleTimeoutMin} options={IDLE} onChange={(v) => updateDemoSettings(actor, { idleTimeoutMin: v })} />
        </div>
      </div>
    </section>
  );
}

/** Full export / import of the local store (NFR-12, NFR-18). */
export function DataTransfer() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <>
      <Button
        icon="download"
        onClick={() => {
          downloadText(`truecolors-crm-demo-${todayKey()}.json`, exportDbJson(), 'application/json');
          toast('All demo data exported');
        }}
      >
        Export all data
      </Button>
      <Button icon="arrow-up" onClick={() => fileRef.current?.click()}>
        Import data…
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > 15 * 1024 * 1024) {
            toast('That file is larger than 15 MB', 'danger');
            return;
          }
          f.text().then((t) => {
            setError('');
            setPending(t);
          });
        }}
      />
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        size="sm"
        role="alertdialog"
        title="Replace all demo data?"
        description="Everything in this browser is replaced by the file’s contents, including the signed-in user and settings."
        footer={
          <>
            <Button onClick={() => setPending(null)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                try {
                  importDbJson(pending ?? '');
                  setPending(null);
                  toast('Demo data imported');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Import failed');
                }
              }}
            >
              Replace data
            </Button>
          </>
        }
      >
        <p className="muted">Export the current data first if you may need it again.</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}

const CHANNEL_LABEL: Record<OutboxMessage['channel'], string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'App push' };

/** Simulated outbound messages (COM-03, §6 WhatsApp / email). */
export function OutboxPage() {
  const actor = useActor();
  const [channel, setChannel] = useState('');
  const [q, setQ] = useState('');
  const query = useServiceQuery(() => listOutbox(actor), [actor.user.id]);
  if (!can(actor, 'outbox.view')) return <NoAccess what="the message outbox" />;
  const rows = (query.data ?? []).filter((m) => (!channel || m.channel === channel) && (!q || `${m.to} ${m.subject ?? ''} ${m.body}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="page">
      <PageHeader title="Message outbox" description="Every email, WhatsApp, SMS and push message the live system would send. Nothing leaves this browser." />
      <div className="toolbar">
        <input type="search" className="input input-compact" placeholder="Search recipient or text" aria-label="Search messages" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectMenu label="Filter by channel" value={channel} options={[{ value: '', label: 'All channels' }, ...Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }))]} onChange={setChannel} />
        <span className="toolbar-count muted">{rows.length} messages</span>
      </div>
      <div className="content-surface">
        {query.error ? (
          <ErrorState title="Could not load messages" onRetry={query.retry}>
            {query.error}
          </ErrorState>
        ) : !query.data ? (
          <Skeleton rows={6} />
        ) : rows.length ? (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Channel</th>
                  <th scope="col">To</th>
                  <th scope="col">Message</th>
                  <th scope="col">Record</th>
                  <th scope="col">Sent by</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">
                      <DateText value={m.createdAt} showTime />
                    </td>
                    <td>
                      <Badge tone="neutral">{CHANNEL_LABEL[m.channel]}</Badge>
                    </td>
                    <td>{m.to}</td>
                    <td>
                      {m.subject && <strong>{m.subject} · </strong>}
                      {m.body}
                    </td>
                    <td>{m.related ? <Link to={recordPeekPath(actor.workspaceId, m.related.resource, m.related.recordId)}>{m.related.recordId}</Link> : <EmptyValue />}</td>
                    <td>{getUser(m.createdBy)?.name ?? m.createdBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="send" title="No messages yet">
            Sending a quotation, dispatch update or feedback link records the message here.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
