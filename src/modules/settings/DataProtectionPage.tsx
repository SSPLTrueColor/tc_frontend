import { REQUEST_TONE } from '../../domain/statusTones';
import { useState } from 'react';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { changeConsent, changeRetention, closeDpRequest, fileDpRequest } from '../../services/api/catalog';
import { errorMessage } from '../../services/api/client';
import { getDataProtection, type DpRequestInput, validateDpRequest, validateRetention } from '../../services/account';
import { can } from '../../services/authz';
import { useActor } from '../../services/hooks';
import type { DataProtection, DpRequest } from '../../services/types';
import { Clip, ReadOnlyNote, SaveBar, SettingsField, SettingsPage, SettingsSection, SettingsSkeleton, ToggleRow, useDraft } from '../../components/settings/kit';
import { Button } from '../../components/primitives/Button';
import { DateText } from '../../components/primitives/display';
import { EmptyState, ErrorState, StatusChip, useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { usePaged } from '../catalog/kit';
import { TextField, Textarea } from '../../components/primitives/controls';
import { NumberInput } from '../../components/primitives/NumberInput';
import { Table } from '../../components/primitives/Table';

const D = L.account.dataProtection;
const title = L.nav.pages.dataProtection.title;
const TONE = REQUEST_TONE;
const EMPTY: DpRequestInput = { type: 'correction', subject: '', details: '' };

/** Data Protection (DPDP Act 2023): consent switches (instant), retention (saved with the bar) and data-subject requests. */
export function DataProtectionPage() {
  const actor = useActor();
  const toast = useToast();
  const admin = can(actor, 'config.publish');
  const q = useServiceQuery(() => getDataProtection(), [actor.user.id]);
  const retention = useDraft<DataProtection['retention']>(q.data?.retention);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [req, setReq] = useState<DpRequestInput>(EMPTY);
  const [reqTried, setReqTried] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);
  const paged = usePaged(q.data?.requests ?? [], 10);

  if (q.error)
    return (
      <SettingsPage title={title} description={D.description}>
        <ErrorState title={D.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </SettingsPage>
    );
  if (!q.data || !retention.draft)
    return (
      <SettingsPage title={title} description={D.description}>
        <SettingsSkeleton sections={3} />
      </SettingsPage>
    );

  const r = retention.draft;
  const rErr = validateRetention(r);
  const reqErr = validateDpRequest(req);

  const run = async (op: () => Promise<unknown>, ok: string) => {
    try {
      await op();
      toast(ok);
      return true;
    } catch (e) {
      toast(errorMessage(e), 'danger');
      return false;
    }
  };
  const saveRetention = async () => {
    setTried(true);
    if (Object.keys(rErr).length) return;
    setBusy(true);
    if (await run(() => changeRetention(actor, r), D.retentionSaved)) setTried(false);
    setBusy(false);
  };
  const submit = async () => {
    setReqTried(true);
    if (Object.keys(reqErr).length || reqBusy) return;
    setReqBusy(true);
    try {
      const created = await fileDpRequest(actor, req);
      toast(D.logged(created.id));
      setReq(EMPTY);
      setReqTried(false);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setReqBusy(false);
    }
  };

  const retentionField = (key: keyof DataProtection['retention'], label: string, unit: string) => (
    <SettingsField label={`${label} (${unit})`} htmlFor={`dp-${key}`} error={tried ? rErr[key] : undefined}>
      <NumberInput id={`dp-${key}`} disabled={!admin} rule={{ integer: true }} value={r[key]} onValueChange={(n) => retention.set({ [key]: n ?? NaN })} invalid={tried && !!rErr[key]} />
    </SettingsField>
  );

  return (
    <SettingsPage title={title} description={D.description}>
      {!admin && <ReadOnlyNote>{D.readOnly}</ReadOnlyNote>}

      <SettingsSection title={D.consentTitle} help={D.consentHelp}>
        {(Object.keys(q.data.consents) as (keyof DataProtection['consents'])[]).map((k) => (
          <ToggleRow key={k} label={D.consents[k].title} help={D.consents[k].help} checked={q.data!.consents[k]} disabled={!admin} onChange={(v) => run(() => changeConsent(actor, k, v), D.consentChanged(D.consents[k].title, v))} />
        ))}
      </SettingsSection>

      <SettingsSection title={D.retentionTitle} help={D.retentionHelp}>
        {retentionField('auditMonths', D.audit, D.auditUnit)}
        {retentionField('recycleDays', D.recycle, D.recycleUnit)}
        {retentionField('inactiveContactMonths', D.inactive, D.inactiveUnit)}
      </SettingsSection>

      <SettingsSection wide title={D.requestsTitle} help={D.requestsHelp}>
        <div className="st-request-form">
          <SettingsField label={D.type} htmlFor="dp-type">
            <SelectMenu id="dp-type" label={D.type} value={req.type} options={Object.entries(D.types).map(([value, label]) => ({ value, label }))} onChange={(v) => setReq({ ...req, type: v as DpRequestInput['type'] })} />
          </SettingsField>
          <SettingsField label={D.subject} htmlFor="dp-subject" help={D.subjectHelp} error={reqTried ? reqErr.subject : undefined} required>
            <TextField id="dp-subject" value={req.subject} maxLength={120} onChange={(e) => setReq({ ...req, subject: e.target.value })} onBlur={() => req.subject && setReqTried(true)} aria-invalid={(reqTried && !!reqErr.subject) || undefined} />
          </SettingsField>
          <SettingsField label={D.details} htmlFor="dp-details" help={D.detailsHelp} error={reqTried ? reqErr.details : undefined}>
            <Textarea id="dp-details" rows={3} value={req.details} onChange={(e) => setReq({ ...req, details: e.target.value })} aria-invalid={(reqTried && !!reqErr.details) || undefined} />
          </SettingsField>
          <div>
            <Button variant="primary" loading={reqBusy} onClick={submit}>
              {D.submit}
            </Button>
          </div>
        </div>

        {q.data.requests.length ? (
          <>
            
              <Table>
                <thead>
                  <tr>
                    <th scope="col">{D.columns.id}</th>
                    <th scope="col">{D.columns.type}</th>
                    <th scope="col">{D.columns.subject}</th>
                    <th scope="col">{D.columns.status}</th>
                    <th scope="col">{D.columns.opened}</th>
                    {admin && <th scope="col" />}
                  </tr>
                </thead>
                <tbody>
                  {paged.shown.map((x: DpRequest) => (
                    <tr key={x.id}>
                      <td>{x.id}</td>
                      <td>{D.types[x.type]}</td>
                      <td className="st-cell-clip">
                        <Clip text={x.subject} />
                      </td>
                      <td>
                        <StatusChip label={D.statuses[x.status]} tone={TONE[x.status]} />
                      </td>
                      <td>
                        <DateText value={x.createdAt} />
                      </td>
                      {admin && (
                        <td className="st-row-actions">
                          {x.status === 'open' && (
                            <>
                              <Button onClick={() => run(() => closeDpRequest(actor, x.id, 'done'), D.resolved(D.statuses.done))}>{D.markDone}</Button>
                              <Button onClick={() => run(() => closeDpRequest(actor, x.id, 'rejected'), D.resolved(D.statuses.rejected))}>{D.reject}</Button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            
            {paged.footer('requests')}
          </>
        ) : (
          <EmptyState icon="inbox" title={D.noRequests}>
            {D.noRequestsBody}
          </EmptyState>
        )}
      </SettingsSection>

      <SaveBar dirty={admin && retention.dirty} busy={busy} errorCount={tried ? Object.keys(rErr).length : 0} onCancel={() => { retention.discard(); setTried(false); }} onSave={saveRetention} />
    </SettingsPage>
  );
}
