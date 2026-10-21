import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { formatDate } from '../../lib/dates';
import { recordPagePath } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { masterValue } from '../../services/registry';
import { safeTitle } from '../../services/leads/rules';
import { Button } from '../../components/primitives/Button';
import { EmptyValue } from '../../components/primitives/display';
import { StatusChip } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { Table } from '../../components/primitives/Table';
import { Textarea } from '../../components/primitives/controls';

const D = L.leads.dialogs.duplicate;

/**
 * LEAD-03 / CUS-06: shown when the lead being created matches open leads. The user opens an existing lead
 * or creates the new one with a reason (kept in the audit trail).
 */
export function DuplicateLeadDialog({ actor, matches, hidden, busy, onOpen, onProceed, onClose }: { actor: Actor; matches: RecordData[]; hidden: number; busy?: boolean; onOpen: (id: string) => void; onProceed: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const short = reason.trim().length < 5;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      role="alertdialog"
      title={D.title}
      description={D.description}
      footer={
        <>
          <Button onClick={onClose}>{L.leads.actions.cancel}</Button>
          {matches.length > 0 && (
            <Button onClick={() => onOpen(matches[0].id)} data-autofocus>
              {D.openExisting}
            </Button>
          )}
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              setTried(true);
              if (!short) onProceed(reason.trim());
            }}
          >
            {D.createAnyway}
          </Button>
        </>
      }
    >
      {matches.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">{D.columns.lead}</th>
              <th scope="col">{D.columns.customer}</th>
              <th scope="col">{D.columns.status}</th>
              <th scope="col">{D.columns.owner}</th>
              <th scope="col">{D.columns.followUp}</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((l) => {
              const st = masterValue('leadStatus', l.status);
              return (
                <tr key={l.id}>
                  <td>
                    <Link to={recordPagePath(actor.workspaceId, 'leads', l.id)} onClick={() => onOpen(l.id)} className="mono">
                      {l.id}
                    </Link>
                  </td>
                  <td>{safeTitle('customers', l.customerId, actor) || <EmptyValue />}</td>
                  <td>
                    <StatusChip label={st?.label ?? String(l.status)} tone={st?.tone} />
                  </td>
                  <td>{safeTitle('employees', l.ownerId, actor) || <EmptyValue />}</td>
                  <td>{l.nextFollowUpAt ? formatDate(String(l.nextFollowUpAt)) : <EmptyValue />}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {hidden > 0 && <p className="muted small">{D.hidden(hidden)}</p>}
      <div className="form-field">
        <label className="field-label" htmlFor="dup-reason">
          {D.reason} <span className="req">*</span>
        </label>
        <Textarea id="dup-reason" className="textarea" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={(tried && short) || undefined} />
        {tried && short ? <p className="field-error">{L.leads.errors.duplicateReason}</p> : <p className="muted small">{D.reasonHelp}</p>}
      </div>
    </Dialog>
  );
}
