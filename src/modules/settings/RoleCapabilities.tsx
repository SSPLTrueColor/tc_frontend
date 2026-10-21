/**
 * Roles & Permissions › Roles: approvals and special actions per role (ADM-02). Approve levels, finance
 * approval, data export and the other capabilities are edited here and saved as a diff of the shipped role.
 */
import { useState } from 'react';
import { L } from '../../constants/labels';
import type { RoleDefinition } from '../../metadata/types';
import type { Actor } from '../../services/authz';
import { call, errorMessage } from '../../services/api/client';
import { EDITABLE_CAPABILITIES, saveRoleCapabilities } from '../../services/catalog/access';
import { Button } from '../../components/primitives/Button';
import { Checkbox } from '../../components/primitives/controls';
import { useToast } from '../../components/primitives/feedback';
import { Table } from '../../components/primitives/Table';
import { SettingsSection } from '../../components/settings/kit';

const X = L.admin.access;

export function RoleCapabilities({ actor, role, shipped, disabled }: { actor: Actor; role: RoleDefinition; shipped: RoleDefinition; disabled: boolean }) {
  const toast = useToast();
  const current = EDITABLE_CAPABILITIES.filter((c) => role.capabilities.includes(c));
  const [draft, setDraft] = useState<{ roleId: string; held: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const held = draft && draft.roleId === role.id ? draft.held : current;
  const dirty = [...held].sort().join() !== [...current].sort().join();
  const toggle = (c: string, on: boolean) => setDraft({ roleId: role.id, held: on ? [...held, c] : held.filter((x) => x !== c) });

  const save = async () => {
    setBusy(true);
    try {
      const n = await call(() => saveRoleCapabilities(actor, role.id, held));
      toast(n ? X.capabilitiesSaved(role.label) : X.capabilitiesNoChange, n ? 'success' : 'info');
      setDraft(null);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      wide
      title={X.capabilitiesTitle}
      help={X.capabilitiesHelp}
      actions={
        !disabled && (
          <Button variant="primary" loading={busy} disabledReason={!dirty ? X.capabilitiesNoChange : undefined} onClick={save}>
            {X.capabilitiesSave}
          </Button>
        )
      }
    >
      <Table>
        <tbody>
          {EDITABLE_CAPABILITIES.map((c) => (
            <tr key={c}>
              <th scope="row">
                <span className="st-clip">{X.capabilities[c] ?? c}</span>
                {shipped.capabilities.includes(c) && <span className="field-help">{X.capabilityFrom(shipped.label)}</span>}
              </th>
              <td className="st-check">
                <Checkbox className="st-box" checked={held.includes(c)} disabled={disabled} aria-label={X.capabilities[c] ?? c} onChange={(e) => toggle(c, e.target.checked)} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SettingsSection>
  );
}
