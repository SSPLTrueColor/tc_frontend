import { L } from '../../constants/labels';
import { SettingsField, SettingsPage, SettingsSection, SaveBar, ToggleRow, useDraft } from '../../components/settings/kit';
import { Button } from '../../components/primitives/Button';
import { useToast } from '../../components/primitives/feedback';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { ThemePicker } from '../../components/shell/ThemePicker';
import { useActor, useSettings } from '../../services/hooks';
import { masterLabel } from '../../services/registry';
import { updateSettings } from '../../services/settings';
import type { PersonalSettings } from '../../services/types';
import { SegmentedControl } from '../../components/primitives/controls';

const P = L.account.profile;

/** Profile & Appearance: who you are (read-only), language (explicit save) and look-and-feel (instant). */
export function ProfilePage() {
  const actor = useActor();
  const toast = useToast();
  const s = useSettings();
  const form = useDraft<{ language: PersonalSettings['language'] }>({ language: s.language });
  const instant = (patch: Partial<PersonalSettings>) => {
    updateSettings(actor.user.id, patch);
    toast(P.navigation.updated);
  };
  const divisions = (actor.user.divisions ?? []).map((d) => masterLabel('division', d)).join(', ');
  return (
    <SettingsPage title={L.nav.pages.profile.title} description={P.description}>
      <SettingsSection title={P.details.title} help={P.details.help}>
        <dl className="st-facts">
          <dt>{P.details.name}</dt>
          <dd>{actor.user.name}</dd>
          <dt>{P.details.role}</dt>
          <dd>{actor.role.label}</dd>
          <dt>{P.details.designation}</dt>
          <dd>{actor.user.title}</dd>
          <dt>{P.details.divisions}</dt>
          <dd>{divisions || '—'}</dd>
        </dl>
      </SettingsSection>

      <SettingsSection title={P.language.title} help={P.language.help}>
        <SettingsField label={P.language.label} htmlFor="pf-lang">
          <SelectMenu
            id="pf-lang"
            label={P.language.label}
            value={form.draft?.language ?? 'en'}
            options={[
              { value: 'en', label: P.language.en },
              { value: 'hi', label: P.language.hi },
            ]}
            onChange={(v) => form.set({ language: v as PersonalSettings['language'] })}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title={P.appearance.title} help={P.appearance.help}>
        <ThemePicker />
      </SettingsSection>

      <SettingsSection title={P.navigation.title} help={P.navigation.help}>
        <SettingsField label={P.navigation.density}>
          <SegmentedControl
            label={P.navigation.density}
            value={s.navDensity}
            onChange={(next) => instant({ navDensity: next })}
            options={(['balanced', 'compact'] as const).map((d) => ({ value: d, label: P.navigation[d] }))}
          />
        </SettingsField>
        <SettingsField label={P.navigation.form}>
          <SegmentedControl
            label={P.navigation.form}
            value={s.formLayout}
            onChange={(next) => instant({ formLayout: next })}
            options={(['simple', 'canvas'] as const).map((d) => ({ value: d, label: d === 'simple' ? P.navigation.formSimple : P.navigation.formCanvas }))}
          />
        </SettingsField>
        <ToggleRow label={P.navigation.sidebar} help={`${s.sidebarWidth}px`} checked={!s.sidebarCollapsed} onChange={(v) => instant({ sidebarCollapsed: !v })} />
        <div>
          <Button onClick={() => instant({ sidebarWidth: 240, sidebarCollapsed: false })}>{P.navigation.resetWidth}</Button>
        </div>
      </SettingsSection>

      <SettingsSection title={P.locale.title} help={P.locale.help}>
        <dl className="st-facts">
          <dt>{L.admin.settings.timeZone}</dt>
          <dd>{L.admin.settings.timeZoneValue}</dd>
          <dt>{L.admin.settings.currency}</dt>
          <dd>{L.admin.settings.currencyValue}</dd>
          <dt>{L.admin.settings.dateFormat}</dt>
          <dd>{L.admin.settings.dateFormatValue}</dd>
        </dl>
      </SettingsSection>

      <SaveBar
        dirty={form.dirty}
        onCancel={form.discard}
        onSave={() => {
          updateSettings(actor.user.id, { language: form.draft!.language });
          toast(P.language.saved);
        }}
      />
    </SettingsPage>
  );
}
