import { useState } from 'react';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { errorMessage } from '../../services/api/client';
import { saveNotifications } from '../../services/api/catalog';
import { NOTIF_CHANNELS, NOTIF_EVENTS, getNotificationPrefs, validateNotificationPrefs } from '../../services/account';
import { useActor } from '../../services/hooks';
import type { NotificationPrefs, NotifChannel, NotifEvent } from '../../services/types';
import { SaveBar, SettingsField, SettingsPage, SettingsSection, SettingsSkeleton, ToggleRow, useDraft } from '../../components/settings/kit';
import { ErrorState, useToast } from '../../components/primitives/feedback';

const N = L.account.notifications;
const title = L.nav.pages.notificationPreferences.title;

/** Notification Preferences (COM-03): channel grid saved with the bar; quiet hours and the digest save the moment they change. */
export function NotificationPreferencesPage() {
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(() => getNotificationPrefs(actor.user.id), [actor.user.id]);
  const form = useDraft<NotificationPrefs>(q.data);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  if (q.error)
    return (
      <SettingsPage title={title} description={N.description}>
        <ErrorState title={N.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </SettingsPage>
    );
  if (!q.data || !form.draft)
    return (
      <SettingsPage title={title} description={N.description}>
        <SettingsSkeleton sections={3} />
      </SettingsPage>
    );

  const p = form.draft;
  const errors = validateNotificationPrefs(p);
  const toggleChannel = (ev: NotifEvent, ch: NotifChannel, on: boolean) => form.replace({ ...p, events: { ...p.events, [ev]: on ? [...p.events[ev], ch] : p.events[ev].filter((c) => c !== ch) } });

  const save = async () => {
    setTried(true);
    if (errors.quiet) return;
    setBusy(true);
    try {
      await saveNotifications(actor, p);
      toast(N.saved);
      setTried(false);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  /** Digest is a plain switch: it saves immediately (the rest of the form is untouched). */
  const setDigest = async (on: boolean) => {
    try {
      await saveNotifications(actor, { ...q.data!, dailyDigest: on });
      toast(on ? N.digestOn : N.digestOff);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };

  return (
    <SettingsPage title={title} description={N.description}>
      <SettingsSection wide title={N.channelsTitle} help={N.channelsHelp}>
        <div className="table-scroll">
          <table className="mini-table st-grid">
            <thead>
              <tr>
                <th scope="col">{N.update}</th>
                {NOTIF_CHANNELS.map((c) => (
                  <th key={c} scope="col" className="st-check">
                    {N.channels[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIF_EVENTS.map((ev) => (
                <tr key={ev}>
                  <th scope="row">
                    <span className="st-clip">{N.events[ev]}</span>
                    <span className="field-help">{N.eventHelp[ev]}</span>
                  </th>
                  {NOTIF_CHANNELS.map((c) => (
                    <td key={c} className="st-check" data-label={N.channels[c]}>
                      <input
                        type="checkbox"
                        className="checkbox st-box"
                        checked={p.events[ev].includes(c)}
                        disabled={c === 'inApp'}
                        data-tooltip={c === 'inApp' ? N.always : undefined}
                        aria-label={N.forEvent(N.channels[c], N.events[ev])}
                        onChange={(e) => toggleChannel(ev, c, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <SettingsSection title={N.quietTitle} help={N.quietHelp}>
        <ToggleRow label={N.quietToggle} help={N.quietToggleHelp} checked={p.quietHours.enabled} onChange={(v) => form.replace({ ...p, quietHours: { ...p.quietHours, enabled: v } })} />
        {p.quietHours.enabled && (
          <div className="st-pair">
            <SettingsField label={N.from} htmlFor="np-from" error={tried ? errors.quiet : undefined}>
              <input id="np-from" className="input" type="time" value={p.quietHours.from} onChange={(e) => form.replace({ ...p, quietHours: { ...p.quietHours, from: e.target.value } })} aria-invalid={(tried && !!errors.quiet) || undefined} />
            </SettingsField>
            <SettingsField label={N.to} htmlFor="np-to">
              <input id="np-to" className="input" type="time" value={p.quietHours.to} onChange={(e) => form.replace({ ...p, quietHours: { ...p.quietHours, to: e.target.value } })} aria-invalid={(tried && !!errors.quiet) || undefined} />
            </SettingsField>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={N.digestTitle} help={N.digestHelp}>
        <ToggleRow label={N.digestToggle} help={N.digestToggleHelp} checked={q.data.dailyDigest} onChange={setDigest} />
      </SettingsSection>

      <SaveBar dirty={form.dirty} busy={busy} errorCount={tried && errors.quiet ? 1 : 0} onCancel={() => { form.discard(); setTried(false); }} onSave={save} />
    </SettingsPage>
  );
}
