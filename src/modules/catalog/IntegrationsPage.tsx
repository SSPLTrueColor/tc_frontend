import { useState } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { captureLead, receiveMessage, runErpSync } from '../../services/api/catalog';
import { can } from '../../services/authz';
import { integrationLog, LEAD_CHANNELS } from '../../services/catalog/integrations';
import { useActor } from '../../services/hooks';
import { recordPeekPath } from '../../lib/routes';
import { Button } from '../../components/primitives/Button';
import { DateText, EmptyValue } from '../../components/primitives/display';
import { Badge, EmptyState, ErrorState, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { SettingsField, SettingsPage, SettingsSection } from '../../components/settings/kit';
import { byTime, SortPicker, type SortDir, usePaged } from './kit';
import { Table } from '../../components/primitives/Table';

const I = L.admin.integrations;
const ACTION_LABEL: Record<string, string> = Object.fromEntries(Object.entries(I.actions).map(([k, v]) => [`integration.${k}`, v]));

/** BRD §6 integrations, simulated: lead capture webhooks, ERP sync, WhatsApp/email to ticket. */
export function IntegrationsPage() {
  const actor = useActor();
  const toast = useToast();
  const [source, setSource] = useState<string>(LEAD_CHANNELS[0].key);
  const [busy, setBusy] = useState('');
  const [logType, setLogType] = useState('');
  const [sort, setSort] = useState<SortDir>('desc');
  const log = useServiceQuery(() => integrationLog(actor), [actor.user.id]);
  const logRows = byTime((log.data ?? []).filter((a) => !logType || a.action === logType), (a) => a.at, sort);
  const paged = usePaged(logRows);
  if (!can(actor, 'integrations.manage')) return <NoAccess what={I.noAccessWhat} />;

  const run = async (key: string, op: () => Promise<{ message: string; outcome?: string }>) => {
    setBusy(key);
    try {
      const r = await op();
      toast(r.message, r.outcome === 'skipped' ? 'info' : r.outcome === 'duplicate' ? 'info' : 'success');
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy('');
    }
  };

  return (
    <SettingsPage title={L.nav.pages.integrations.title} description={I.short.page}>
      <SettingsSection title={I.leadCapture} help={I.short.lead}>
        <SettingsField label={I.leadSource} htmlFor="int-source">
          <SelectMenu id="int-source" label={I.leadSource} value={source} options={LEAD_CHANNELS.map((c) => ({ value: c.key, label: c.label }))} onChange={setSource} />
        </SettingsField>
        <div>
          <Button loading={busy === 'lead'} onClick={() => run('lead', () => captureLead(actor, source))}>
            {I.simulateLead}
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title={I.erp} help={I.short.erp}>
        <p className="st-help">{I.erpTip}</p>
        <div>
          <Button
            loading={busy === 'erp'}
            onClick={() =>
              run('erp', async () => {
                const r = await runErpSync(actor);
                return { message: I.erpDone(r.customers, r.spares) };
              })
            }
          >
            {I.erpSync}
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title={I.messageTicket} help={I.short.message}>
        <p className="st-help">{I.messageTicketTip}</p>
        <div className="st-actions">
          <Button loading={busy === 'wa'} onClick={() => run('wa', () => receiveMessage(actor, 'whatsapp'))}>
            {I.simulateWhatsapp}
          </Button>
          <Button loading={busy === 'mail'} onClick={() => run('mail', () => receiveMessage(actor, 'email'))}>
            {I.simulateEmail}
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title={I.notConnected} help={I.short.notConnected}>
        <ul className="plain-list bullets small">
          {I.notConnectedItems.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </SettingsSection>
      <SettingsSection wide title={I.log} help={I.short.log}>
        <div className="st-actions">
          <SelectMenu label={I.filterType} value={logType} options={[{ value: '', label: I.allTypes }, ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))]} onChange={setLogType} />
          <SortPicker value={sort} onChange={setSort} />
        </div>
        {log.error ? (
          <ErrorState title={I.logError} onRetry={log.retry}>
            {log.error}
          </ErrorState>
        ) : !log.data ? (
          <Skeleton rows={4} />
        ) : !logRows.length ? (
          <EmptyState icon="activity" title={I.logEmptyTitle}>
            {I.logEmptyBody}
          </EmptyState>
        ) : (
          <>
            
              <Table>
                <thead>
                  <tr>
                    <th scope="col">{I.columns.when}</th>
                    <th scope="col">{I.columns.type}</th>
                    <th scope="col">{I.columns.result}</th>
                    <th scope="col">{I.columns.record}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.shown.map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">
                        <DateText value={a.at} />
                      </td>
                      <td>
                        <Badge tone={a.action.endsWith('duplicate') ? 'warning' : 'neutral'}>{ACTION_LABEL[a.action] ?? a.action}</Badge>
                      </td>
                      <td>{a.summary}</td>
                      <td>{a.resource && a.recordId ? <Link to={recordPeekPath(actor.workspaceId, a.resource, a.recordId)}>{a.recordId}</Link> : <EmptyValue />}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            
            {paged.footer(I.runs)}
          </>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
