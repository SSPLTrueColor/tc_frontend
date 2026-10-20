import { useRef, useState } from 'react';
import { L } from '../constants/labels';
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
import { Clip, SettingsPage, SettingsSection } from '../components/settings/kit';
import { byTime, SortPicker, type SortDir, usePaged } from '../modules/catalog/kit';

const DC = L.admin.demoControls;
const DT = L.admin.dataTransfer;
const O = L.admin.outbox;
const LATENCY = [
  { value: '0-0', label: DC.latencyOptions.off },
  { value: '100-300', label: DC.latencyOptions.fast },
  { value: '300-800', label: DC.latencyOptions.realistic },
  { value: '1000-2500', label: DC.latencyOptions.slow },
];
const FAILURE = [
  { value: 0, label: DC.failureOptions.never },
  { value: 0.1, label: DC.failureOptions.one },
  { value: 0.3, label: DC.failureOptions.three },
];
const IDLE = [5, 15, 30, 60].map((m) => ({ value: m, label: DC.minutes(m) }));

/** System Administrator demo controls (Demo Settings): simulated clock, latency, failures, idle timeout. */
export function DemoControls() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const demo = getDb().demo;
  const offsetDays = Math.round(getClockOffset() / 86_400_000);
  const shift = (days: number) => {
    shiftClock(actor, days);
    toast(days === 0 ? DC.clockReset : DC.clockMoved(formatDateTime(now().toISOString())), 'info');
  };
  return (
    <section className="panel">
      <h2 className="panel-title dialog-title-row">
        {DC.title}
        <InfoTip text={DC.tip} label={DC.tipLabel} />
      </h2>
      <dl className="detail-list">
        <div className="detail-row">
          <dt>{DC.now}</dt>
          <dd>
            {formatDateTime(now().toISOString())}
            {offsetDays !== 0 && <Badge tone="warning">{DC.days(offsetDays)}</Badge>}
          </dd>
        </div>
      </dl>
      <div className="row-gap">
        <Button onClick={() => shift(1)}>{DC.plusDays(1)}</Button>
        <Button onClick={() => shift(7)}>{DC.plusDays(7)}</Button>
        <Button onClick={() => shift(30)}>{DC.plusDays(30)}</Button>
        <Button onClick={() => shift(0)} disabledReason={offsetDays === 0 && getClockOffset() === 0 ? DC.alreadyRealTime : undefined}>
          {DC.realTime}
        </Button>
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label className="field-label" htmlFor="demo-latency">
            {DC.latency}
          </label>
          <SelectMenu
            id="demo-latency"
            block
            label={DC.latency}
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
            {DC.failures}
          </label>
          <SelectMenu id="demo-failure" block label={DC.failures} value={demo.failureRate} options={FAILURE} onChange={(v) => updateDemoSettings(actor, { failureRate: v })} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="demo-idle">
            {DC.idle}
          </label>
          <SelectMenu id="demo-idle" block label={DC.idle} value={demo.idleTimeoutMin} options={IDLE} onChange={(v) => updateDemoSettings(actor, { idleTimeoutMin: v })} />
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
          toast(DT.exported);
        }}
      >
        {DT.export}
      </Button>
      <Button icon="arrow-up" onClick={() => fileRef.current?.click()}>
        {DT.import}
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
            toast(DT.tooLarge, 'danger');
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
        title={DT.replaceTitle}
        description={DT.replaceDescription}
        footer={
          <>
            <Button onClick={() => setPending(null)} data-autofocus>
              {L.admin.common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                try {
                  importDbJson(pending ?? '');
                  setPending(null);
                  toast(DT.imported);
                } catch (e) {
                  setError(e instanceof Error ? e.message : DT.importFailed);
                }
              }}
            >
              {DT.replace}
            </Button>
          </>
        }
      >
        <p className="muted">{DT.exportFirst}</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}

const CHANNEL_LABEL: Record<OutboxMessage['channel'], string> = O.channels;

/** Sent Messages (Simulated): outbound messages (COM-03, §6 WhatsApp / email). */
export function OutboxPage() {
  const actor = useActor();
  const [channel, setChannel] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortDir>('desc');
  const query = useServiceQuery(() => listOutbox(actor), [actor.user.id]);
  const all = query.data ?? [];
  const rows = byTime(
    all.filter((m) => (!channel || m.channel === channel) && (!q || `${m.to} ${m.subject ?? ''} ${m.body}`.toLowerCase().includes(q.toLowerCase()))),
    (m) => m.createdAt,
    sort,
  );
  const paged = usePaged(rows);
  if (!can(actor, 'outbox.view')) return <NoAccess what={O.noAccessWhat} />;
  return (
    <SettingsPage title={L.nav.pages.sentMessages.title} description={O.short}>
      <SettingsSection wide title={O.sectionTitle} help={O.sectionHelp}>
      <div className="st-actions">
        <input type="search" className="input input-compact" placeholder={O.searchPlaceholder} aria-label={O.searchLabel} value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectMenu label={O.filterChannel} value={channel} options={[{ value: '', label: O.allChannels }, ...Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }))]} onChange={setChannel} />
        <SortPicker value={sort} onChange={setSort} />
      </div>
      <div className="st-surface">
        {query.error ? (
          <ErrorState title={O.loadError} onRetry={query.retry}>
            {query.error}
          </ErrorState>
        ) : !query.data ? (
          <Skeleton rows={6} />
        ) : rows.length ? (
          <>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">{O.columns.when}</th>
                    <th scope="col">{O.columns.channel}</th>
                    <th scope="col">{O.columns.to}</th>
                    <th scope="col">{O.columns.message}</th>
                    <th scope="col">{O.columns.record}</th>
                    <th scope="col">{O.columns.sentBy}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.shown.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">
                        <DateText value={m.createdAt} showTime />
                      </td>
                      <td>
                        <Badge tone="neutral">{CHANNEL_LABEL[m.channel]}</Badge>
                      </td>
                      <td className="st-cell-clip">
                        <Clip text={m.to} />
                      </td>
                      <td className="st-cell-clip">
                        <Clip text={`${m.subject ? `${m.subject} · ` : ''}${m.body}`} />
                      </td>
                      <td>{m.related ? <Link to={recordPeekPath(actor.workspaceId, m.related.resource, m.related.recordId)}>{m.related.recordId}</Link> : <EmptyValue />}</td>
                      <td>{getUser(m.createdBy)?.name ?? m.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {paged.footer(O.messages)}
          </>
        ) : all.length ? (
          <EmptyState icon="search" title={O.noMatchTitle}>
            {O.noMatchBody}
          </EmptyState>
        ) : (
          <EmptyState icon="send" title={O.emptyTitle}>
            {O.emptyBody}
          </EmptyState>
        )}
      </div>
      </SettingsSection>
    </SettingsPage>
  );
}
