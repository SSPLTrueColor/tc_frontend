import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecordData } from '../../metadata/types';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { recordPeekPath } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { perm } from '../../services/authz';
import { getDb } from '../../services/db';
import { getResource, masterValue } from '../../services/registry';
import { availableTransitions, transitionRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { Button } from '../../components/primitives/Button';
import { StatusChip, useToast } from '../../components/primitives/feedback';
import { LinkButton } from '../../components/primitives/controls';
import { Dialog } from '../../components/primitives/overlay';

const W = L.opportunities.pages.markWon;

/**
 * OPP-05: what happens when a card is dropped on Won. With an accepted quotation the user confirms the move;
 * otherwise the dialog explains that Won needs an accepted quotation and links to the opportunity's quotations.
 */
export function MarkWonDialog({ actor, record, onClose }: { actor: Actor; record: RecordData; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const quotes = (getDb().records.quotations ?? []).filter((q) => q.opportunityId === record.id && q.isLatest !== false && q.status !== 'superseded');
  const accepted = quotes.find((q) => q.status === 'accepted');
  const t = availableTransitions(actor, getResource('opportunities'), record).find((x) => x.to === 'won');
  const ready = !!accepted && !!t && !t.disabledReason;
  const confirm = () => {
    setBusy(true);
    try {
      const raw = getDb().records.opportunities.find((x) => x.id === record.id);
      transitionRecord(actor, 'opportunities', record.id, 'won', raw?.version ?? record.version);
      toast(W.done(record.id));
      onClose();
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : L.common.toasts.moveFailed, 'danger');
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={ready ? W.title(record.id) : W.blockedTitle(record.id)}
      description={ready ? W.ready(String(accepted!.quoteNo ?? accepted!.id)) : (t?.disabledReason && accepted ? t.disabledReason : W.needsAccepted)}
      footer={
        ready ? (
          <>
            <Button onClick={onClose} data-autofocus>
              {L.opportunities.actions.cancel}
            </Button>
            <Button variant="primary" loading={busy} onClick={confirm}>
              {W.confirm}
            </Button>
          </>
        ) : (
          <>
            {perm(actor, 'quotations').create && (
              <LinkButton to={toPath(ROUTES.quotationNew, {}, { opportunity: record.id })}>{W.createQuotation}</LinkButton>
            )}
            <Button variant="primary" onClick={onClose} data-autofocus>
              {W.close}
            </Button>
          </>
        )
      }
    >
      {!ready && (
        <>
          <h3 className="st-subtitle">{W.quotations}</h3>
          {quotes.length ? (
            <ul className="flow-list">
              {quotes.map((q) => {
                const st = masterValue('quoteStatus', q.status);
                return (
                  <li key={q.id} className="flow-item">
                    <StatusChip label={st?.label ?? String(q.status)} tone={st?.tone} />
                    <Link to={recordPeekPath(actor.workspaceId, 'quotations', q.id)} onClick={onClose}>
                      {W.openQuotation(String(q.quoteNo ?? q.id))}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">{W.noQuotations}</p>
          )}
        </>
      )}
    </Dialog>
  );
}
