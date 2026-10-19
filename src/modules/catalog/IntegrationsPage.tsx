import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { InfoTip } from '../../components/primitives/InfoTip';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';

const ACTION_LABEL: Record<string, string> = {
  'integration.lead_captured': 'Lead captured',
  'integration.lead_duplicate': 'Duplicate enquiry',
  'integration.erp_sync': 'ERP sync',
  'integration.message_ticket': 'Message → ticket',
};

/** BRD §6 integrations, simulated: lead capture webhooks, ERP sync, WhatsApp/email to ticket. */
export function IntegrationsPage() {
  const actor = useActor();
  const toast = useToast();
  const [source, setSource] = useState<string>(LEAD_CHANNELS[0].key);
  const [busy, setBusy] = useState('');
  const log = useServiceQuery(() => integrationLog(actor), [actor.user.id]);
  if (!can(actor, 'integrations.manage')) return <NoAccess what="integrations" />;

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
    <div className="page">
      <PageHeader title="Integrations" description="Simulated connections from BRD §6. Each button fabricates what the external system would send and runs it through the real CRM rules. Nothing leaves this browser." />
      <div className="cat-cards">
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            Lead capture
            <InfoTip text="Website forms, Meta lead ads, Google Ads and IndiaMART post enquiries to the CRM. Each is checked for duplicates on mobile and email, then auto-assigned to the least-loaded sales owner in the division." label="About lead capture" />
          </h2>
          <p className="muted small">LEAD-03, LEAD-04 · webhook / API</p>
          <div className="row-gap">
            <SelectMenu label="Lead source" value={source} options={LEAD_CHANNELS.map((c) => ({ value: c.key, label: c.label }))} onChange={setSource} />
            <Button variant="primary" loading={busy === 'lead'} onClick={() => run('lead', () => captureLead(actor, source))}>
              Simulate incoming lead
            </Button>
          </div>
        </section>
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            ERP
            <InfoTip text="Pulls credit limit, outstanding and overdue amounts per customer and main-store spares stock. The live system would also push approved sales orders and receive invoices." label="About ERP sync" />
          </h2>
          <p className="muted small">CUS-09, SPR-02, SO-09 · scheduled sync</p>
          <Button variant="primary" loading={busy === 'erp'} onClick={() => run('erp', async () => {
            const r = await runErpSync(actor);
            return { message: `ERP sync done: ${r.customers} customer balance(s), ${r.spares} spare-part stock level(s).` };
          })}>
            Sync from ERP now
          </Button>
        </section>
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            WhatsApp & email to ticket
            <InfoTip text="A customer contact messages the service number or mailbox; the CRM identifies them and logs a service ticket (SRV-01)." label="About message to ticket" />
          </h2>
          <p className="muted small">SRV-01 · WhatsApp Business API / email-to-ticket</p>
          <div className="row-gap">
            <Button loading={busy === 'wa'} onClick={() => run('wa', () => receiveMessage(actor, 'whatsapp'))}>
              Simulate WhatsApp
            </Button>
            <Button loading={busy === 'mail'} onClick={() => run('mail', () => receiveMessage(actor, 'email'))}>
              Simulate email
            </Button>
          </div>
        </section>
        <section className="panel">
          <h2 className="panel-title">Not connected in this prototype</h2>
          <ul className="plain-list bullets small">
            <li>Zoho CRM migration — one-time data load (not applicable to a frontend prototype).</li>
            <li>Google / Outlook calendar sync — needs OAuth and a server.</li>
            <li>Maps — locations are stored as coordinates; no map tiles are loaded.</li>
            <li>E-signature — sign-offs use an on-screen one-time code.</li>
          </ul>
        </section>
      </div>
      <section className="panel">
        <h2 className="panel-title">Integration log</h2>
        {log.error ? (
          <ErrorState title="Could not load the log" onRetry={log.retry}>
            {log.error}
          </ErrorState>
        ) : !log.data ? (
          <Skeleton rows={4} />
        ) : !log.data.length ? (
          <EmptyState icon="activity" title="No integration runs yet">
            Use the buttons above to simulate inbound data.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Type</th>
                  <th scope="col">Result</th>
                  <th scope="col">Record</th>
                </tr>
              </thead>
              <tbody>
                {log.data.slice(0, 100).map((a) => (
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
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
