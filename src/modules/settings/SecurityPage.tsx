import { useState } from 'react';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { changeMfa, endOtherSessions, endSession } from '../../services/api/catalog';
import { errorMessage } from '../../services/api/client';
import { listSessions } from '../../services/account';
import { getDb } from '../../services/db';
import { useActor, useSettings } from '../../services/hooks';
import { needsOtp } from '../../services/session';
import { DangerZone, SettingsPage, SettingsSection, SettingsSkeleton, ToggleRow } from '../../components/settings/kit';
import { Button } from '../../components/primitives/Button';
import { Badge, EmptyState, ErrorState, useToast } from '../../components/primitives/feedback';

const S = L.account.security;
const title = L.nav.pages.security.title;

/** Security: two-step verification, the idle timeout (read-only) and the devices you are signed in on. */
export function SecurityPage() {
  const actor = useActor();
  const toast = useToast();
  const s = useSettings();
  const q = useServiceQuery(() => listSessions(actor.user.id), [actor.user.id]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const required = needsOtp(actor.user.id);

  if (q.error)
    return (
      <SettingsPage title={title} description={S.description}>
        <ErrorState title={S.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </SettingsPage>
    );
  if (!q.data)
    return (
      <SettingsPage title={title} description={S.description}>
        <SettingsSkeleton sections={3} />
      </SettingsPage>
    );

  const others = q.data.filter((d) => !d.current);
  const run = async (id: string, op: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try {
      await op();
      toast(ok);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPage title={title} description={S.description}>
      <SettingsSection title={S.mfa.title} help={S.mfa.help}>
        {required ? (
          <div className="st-toggle-row">
            <div className="st-toggle-text">
              <span className="field-label">{S.mfa.required}</span>
              <span className="field-help">{S.mfa.requiredHelp}</span>
            </div>
            <Badge tone="success">{S.mfa.enabled}</Badge>
          </div>
        ) : (
          <ToggleRow label={S.mfa.optional} help={S.mfa.optionalHelp} checked={s.mfaOptIn} busy={busyId === 'mfa'} onChange={(v) => run('mfa', () => changeMfa(actor, v), v ? S.mfa.on : S.mfa.off)} />
        )}
      </SettingsSection>

      <SettingsSection title={S.session.title} help={S.session.help}>
        <dl className="st-facts">
          <dt>{S.session.limit}</dt>
          <dd>{S.session.value(getDb().demo.idleTimeoutMin)}</dd>
        </dl>
      </SettingsSection>

      <SettingsSection wide title={S.sessions.title} help={S.sessions.help}>
        <ul className="st-list">
          {q.data.map((d) => (
            <li key={d.id} className="st-list-row">
              <div className="st-list-text">
                <span className="st-clip" data-tooltip={d.device}>
                  {d.device}
                </span>
                <span className="field-help">
                  {d.place} · {d.lastActive}
                </span>
              </div>
              {d.current ? (
                <Badge tone="info">{S.sessions.thisDevice}</Badge>
              ) : (
                <Button loading={busyId === d.id} onClick={() => run(d.id, () => endSession(actor, d.id), S.sessions.signedOut)}>
                  {S.sessions.signOut}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!others.length && <EmptyState icon="lock" title={S.sessions.empty} />}
      </SettingsSection>

      <DangerZone
        title={S.danger.title}
        description={S.danger.description}
        actionLabel={S.danger.action}
        confirmWord={S.danger.word}
        confirmTitle={S.danger.confirmTitle}
        confirmBody={S.danger.confirmBody}
        disabledReason={others.length ? undefined : S.sessions.empty}
        onConfirm={async () => {
          try {
            await endOtherSessions(actor);
            toast(S.danger.done);
          } catch (e) {
            toast(errorMessage(e), 'danger');
            throw e;
          }
        }}
      />
    </SettingsPage>
  );
}
