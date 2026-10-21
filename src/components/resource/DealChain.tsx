/**
 * Deal Chain panel: Lead → Opportunity → Quotations (selected marked, not-selected / superseded muted) →
 * Sales Order → Contract. Every node opens its record; a missing step reads "Not created yet" and, when the
 * user may take it, offers the app's existing next action (Create Quotation, Generate Sales Order).
 */
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { cx } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import type { RecordData, Tone } from '../../metadata/types';
import { type Actor, perm } from '../../services/authz';
import { canSee, refLabel, resolveDealChain, statusOf } from '../../services/dealHistory';
import { useRevision } from '../../services/hooks';
import { StatusChip } from '../primitives/feedback';
import { Icon } from '../primitives/Icon';
import { LinkButton } from '../primitives/controls';
import './deal.css';

const DC = L.common.dealChain;
const OPEN_STAGES_CLOSED = ['won', 'lost'];
const MUTED_QUOTE = ['not_selected', 'superseded', 'rejected', 'expired'];

function Node({ actor, resource, record, current, muted, selected }: { actor: Actor; resource: string; record: RecordData; current: boolean; muted?: boolean; selected?: boolean }) {
  const visible = canSee(actor, resource, record);
  const st = visible ? statusOf(resource, record) : undefined;
  const label = refLabel(resource, record, actor);
  return (
    <span className={cx('deal-chain-node', current && 'is-current', muted && 'is-muted')}>
      {!visible ? (
        <span className="mono muted" data-tooltip={DC.restricted}>
          {label}
        </span>
      ) : current ? (
        <span className="rel-link mono" aria-current="page" data-tooltip={DC.current}>
          {label}
        </span>
      ) : (
        <Link className="rel-link mono" to={recordPeekPath(actor.workspaceId, resource, record.id)}>
          {label}
        </Link>
      )}
      {st && <StatusChip label={st.label} tone={st.tone as Tone | undefined} />}
      {selected && <span className="tag is-selected">{DC.selected}</span>}
    </span>
  );
}

const Missing = ({ text = DC.notCreated }: { text?: string }) => <span className="deal-chain-missing">{text}</span>;

export function DealChain({ resKey, recordId, actor }: { resKey: string; recordId: string; actor: Actor }) {
  useRevision();
  const chain = resolveDealChain(resKey, recordId);
  const { lead, opportunity: opp, quotations, orders, contracts, selectedQuotationId } = chain;
  const isCurrent = (res: string, r: RecordData) => res === resKey && r.id === recordId;
  const selected = quotations.find((q) => q.id === selectedQuotationId);
  const liveOrder = orders.find((o) => o.status !== 'cancelled');
  const oppOpen = !!opp && !OPEN_STAGES_CLOSED.includes(String(opp.stage));
  const canCreateQuote = oppOpen && perm(actor, 'quotations').create && canSee(actor, 'opportunities', opp);
  const canGenerateOrder = !!selected && selected.status === 'accepted' && !liveOrder && opp?.stage !== 'lost' && perm(actor, 'salesOrders').create && canSee(actor, 'quotations', selected);

  const steps: { key: keyof typeof DC.steps; body: JSX.Element }[] = [
    { key: 'leads', body: lead ? <Node actor={actor} resource="leads" record={lead} current={isCurrent('leads', lead)} /> : <Missing text={opp ? DC.notLinked : DC.notCreated} /> },
    { key: 'opportunities', body: opp ? <Node actor={actor} resource="opportunities" record={opp} current={isCurrent('opportunities', opp)} /> : <Missing /> },
    {
      key: 'quotations',
      body: quotations.length ? (
        <>
          {quotations.map((q) => (
            <Node key={q.id} actor={actor} resource="quotations" record={q} current={isCurrent('quotations', q)} selected={q.id === selectedQuotationId} muted={q.id !== selectedQuotationId && (MUTED_QUOTE.includes(String(q.status)) || q.isLatest === false || !!selectedQuotationId)} />
          ))}
        </>
      ) : (
        <>
          <Missing />
          {canCreateQuote && (
            <LinkButton icon="file-text" to={toPath(ROUTES.quotationNew, {}, { opportunity: opp!.id })}>
              {L.opportunities.actions.createQuotation}
            </LinkButton>
          )}
        </>
      ),
    },
    {
      key: 'salesOrders',
      body: orders.length ? (
        <>
          {orders.map((o) => (
            <Node key={o.id} actor={actor} resource="salesOrders" record={o} current={isCurrent('salesOrders', o)} muted={o.status === 'cancelled'} />
          ))}
        </>
      ) : (
        <>
          <Missing />
          {canGenerateOrder && (
            <LinkButton variant="primary" icon="shopping-cart" to={toPath(ROUTES.salesOrderNew, {}, { quotation: selected!.id })}>
              {L.opportunities.actions.generateSalesOrder}
            </LinkButton>
          )}
        </>
      ),
    },
    {
      key: 'salesContracts',
      body: contracts.length ? (
        <>
          {contracts.map((c) => (
            <Node key={c.id} actor={actor} resource="salesContracts" record={c} current={isCurrent('salesContracts', c)} muted={c.status === 'superseded' || c.status === 'cancelled'} />
          ))}
        </>
      ) : (
        <Missing />
      ),
    },
  ];

  return (
    <section className="deal-chain" aria-label={DC.title}>
      <h3 className="deal-chain-title">{DC.title}</h3>
      <ol className="deal-chain-steps">
        {steps.map((s, i) => (
          <Fragment key={s.key}>
            <li className="deal-chain-step">
              {i > 0 && <Icon name="chevron-right" size={14} className="deal-chain-arrow" />}
              <div className="deal-chain-body">
                <span className="deal-chain-label">{DC.steps[s.key]}</span>
                <div className="deal-chain-node-list">{s.body}</div>
              </div>
            </li>
          </Fragment>
        ))}
      </ol>
    </section>
  );
}
