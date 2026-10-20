import { useEffect, useState } from 'react';
import { L } from '../../constants/labels';
import { addDays, todayKey } from '../../lib/dates';
import { can } from '../../services/authz';
import { giveExtraAccess } from '../../services/api/catalog';
import { errorMessage } from '../../services/api/client';
import { GRANT_CAPABILITIES, GRANT_LEVELS, GRANT_SCOPES, type GrantInput, grantableAreas, isRedundant, validateGrant } from '../../services/catalog/grants';
import type { Actor } from '../../services/authz';
import { Button } from '../../components/primitives/Button';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { DatePicker } from '../../components/primitives/DatePicker';
import { Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { SettingsField } from '../../components/settings/kit';
import { formatDate } from '../../lib/dates';
import { SegmentedControl, Textarea } from '../../components/primitives/controls';

const G = L.grants;
const PRESETS = [7, 30, 90, 180];

const blank = (userId: string, module?: string): GrantInput => ({ userId, kind: 'area', module: module ?? grantableAreas()[0]?.module, level: 'view', scope: 'own', expiresAt: addDays(todayKey(), 30), reason: '' });

/** Give one person extra access: what, how much, whose records, until when, and why. */
export function GrantDialog({ actor, userId, name, open, onClose, module }: { actor: Actor; userId: string; name: string; open: boolean; onClose: () => void; module?: string }) {
  const toast = useToast();
  const [v, setV] = useState<GrantInput>(() => blank(userId, module));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setV(blank(userId, module));
      setTried(false);
    }
  }, [open, userId, module]);
  if (!can(actor, 'access.manage')) return null;
  const errors = validateGrant(v);
  const show = (k: keyof typeof errors) => (tried ? errors[k] : undefined);
  const what = v.kind === 'capability' ? `cap:${v.capability}` : `area:${v.module}`;
  const options = [...grantableAreas().map((a) => ({ value: `area:${a.module}`, label: a.label })), ...GRANT_CAPABILITIES.map((c) => ({ value: `cap:${c}`, label: G.capabilities[c] }))];
  const risky = (v.kind === 'capability' && ['approve.l3', 'approve.finance'].includes(String(v.capability))) || (v.kind === 'area' && (v.level === 'full' || v.level === 'export'));
  const until = v.expiresAt ? formatDate(v.expiresAt) : '…';
  const summary =
    v.kind === 'capability' ? G.summaryCap(name, G.capabilities[String(v.capability)] ?? '', until) : G.summaryArea(name, G.levelVerbs[String(v.level)], options.find((o) => o.value === what)?.label ?? '', G.whoWords[v.scope], until);
  const redundant = !errors.userId && !errors.what && isRedundant(v);

  const submit = async () => {
    setTried(true);
    if (Object.keys(errors).length || busy) return;
    setBusy(true);
    try {
      await giveExtraAccess(actor, v);
      toast(G.granted(name));
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={G.dialogTitle(name)}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{L.common.actions.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {G.give}
          </Button>
        </>
      }
    >
      <div className="st-section-body">
        <SettingsField label={G.what} htmlFor="gr-what" error={show('what')}>
          <SelectMenu
            id="gr-what"
            searchable
            label={G.what}
            value={what}
            options={options}
            onChange={(o) => setV(o.startsWith('cap:') ? { ...v, kind: 'capability', capability: o.slice(4), module: undefined } : { ...v, kind: 'area', module: o.slice(5), capability: undefined })}
          />
        </SettingsField>
        {v.kind === 'area' && (
          <div className="st-pair">
            <SettingsField label={G.level} htmlFor="gr-level" error={show('level')}>
              <SelectMenu id="gr-level" label={G.level} value={String(v.level)} options={GRANT_LEVELS.map((l) => ({ value: l, label: G.levels[l] }))} onChange={(l) => setV({ ...v, level: l as GrantInput['level'] })} />
            </SettingsField>
            <SettingsField label={G.whose} htmlFor="gr-scope" error={show('scope')}>
              <SelectMenu id="gr-scope" label={G.whose} value={v.scope} options={GRANT_SCOPES.map((s) => ({ value: s, label: G.scopes[s] }))} onChange={(s) => setV({ ...v, scope: s as GrantInput['scope'] })} />
            </SettingsField>
          </div>
        )}
        <SettingsField label={G.endDate} htmlFor="gr-end" help={G.endHelp} error={show('expiresAt')}>
          <div className="st-actions">
            <SegmentedControl label={G.endDate} value={PRESETS.map((d) => addDays(todayKey(), d)).find((d) => d === v.expiresAt) ?? ''} onChange={(d) => setV({ ...v, expiresAt: d })} options={PRESETS.map((d) => ({ value: addDays(todayKey(), d), label: G.presets[d] }))} />
            <DatePicker id="gr-end" label={G.endDate} value={v.expiresAt} clearable={false} onChange={(d) => setV({ ...v, expiresAt: d ?? '' })} invalid={!!show('expiresAt')} />
          </div>
        </SettingsField>
        <SettingsField label={G.reasonLabel} htmlFor="gr-reason" help={G.reasonHelp} error={show('reason')} required>
          <Textarea id="gr-reason" rows={2} maxLength={220} value={v.reason} placeholder={G.reasonPlaceholder} onChange={(e) => setV({ ...v, reason: e.target.value })} onBlur={() => v.reason && setTried(true)} aria-invalid={!!show('reason') || undefined} />
        </SettingsField>
        <InlineAlert tone={risky ? 'warning' : 'info'}>
          {summary}
          {risky ? ` ${G.risky}` : ''}
          {redundant ? ` ${G.redundant}.` : ''}
        </InlineAlert>
      </div>
    </Dialog>
  );
}
