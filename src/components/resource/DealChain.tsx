/**
 * Deal Journey card — one place for where a deal stands:
 *  1. phase-grouped stepper (Quotation · Order · Fulfilment) with the current step as a pending state,
 *  2. the next action, who takes it, and a button to the tab where it is done,
 *  3. the deal chain as one line of linked records: Lead › Opportunity › Quotation (+N older) › Sales Order › Contract.
 * A missing step reads "Not created yet" and, when the user may take it, offers the existing next action
 * (Create Quotation, Generate Sales Order). The card collapses to one summary line (remembered per user).
 */
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { cx } from '../../lib/format';
import { recordPeekPath } from '../../lib/routes';
import type { RecordData, Tone } from '../../metadata/types';
import { type Actor, perm } from '../../services/authz';
import { canSee, refLabel, resolveDealChain, statusOf } from '../../services/dealHistory';
import { useRevision } from '../../services/hooks';
import { dealProgress, DealStepper } from '../crm/DealProgress';
import { StatusChip } from '../primitives/feedback';
import { Icon } from '../primitives/Icon';
import { Button, IconButton } from '../primitives/Button';
import { LinkButton } from '../primitives/controls';
import { Popover } from '../primitives/overlay';
import { getRecordTabs } from './extensions';
import './deal.css';

const DC = L.common.dealChain;
const P = L.common.dealProgress;
const OPEN_STAGES_CLOSED = ['won', 'lost'];
const MUTED_QUOTE = ['not_selected', 'superseded', 'rejected', 'expired'];

/** Tab on the driving record where its next step is done. */
const NEXT_TAB: Record<string, Record<string, string>> = {
  salesOrders: { pending_approval: 'approval', confirmed: 'payments', payment_pending: 'payments', payment_received: 'processing', processing: 'processing', ready_for_dispatch: 'dispatch', dispatched: 'dispatch' },
  quotations: { pending_approval: 'approval' },
};

const storeKey = (userId: string) => `tc.dealJourney.collapsed.${userId}`;
const readCollapsed = (userId: string) => {
  try {
    return localStorage.getItem(storeKey(userId)) === '1';
  } catch {
    return false;
  }
};

function Node({ actor, kind, resource, record, current, muted, selected, children }: { actor: Actor; kind: string; resource: string; record: RecordData; current: boolean; muted?: boolean; selected?: boolean; children?: ReactNode }) {
  const visible = canSee(actor, resource, record);
  const st = visible ? statusOf(resource, record) : undefined;
  const label = refLabel(resource, record, actor);
  return (
    <span className={cx('dj-node', current && 'is-current', muted && 'is-muted')}>
      <span className="dj-node-kind">{kind}</span>
      {!visible ? (
        <span className="dj-node-id mono muted" data-tooltip={DC.restricted}>
          {label}
        </span>
      ) : current ? (
        <span className="dj-node-id mono" aria-current="page" data-tooltip={`${label} · ${DC.current}`}>
          {label}
        </span>
      ) : (
        <Link className="dj-node-id rel-link mono" to={recordPeekPath(actor.workspaceId, resource, record.id)} data-tooltip={label}>
          {label}
        </Link>
      )}
      {(st || selected || children) && (
        <span className="dj-node-chips">
          {st && <StatusChip label={st.label} tone={st.tone as Tone | undefined} />}
          {selected && <span className="tag is-selected">{DC.selected}</span>}
          {children}
        </span>
      )}
    </span>
  );
}

const Missing = ({ kind, text = DC.notCreated, children }: { kind: string; text?: string; children?: ReactNode }) => (
  <span className="dj-node is-missing">
    <span className="dj-node-kind">{kind}</span>
    <span className="dj-missing">{text}</span>
    {children}
  </span>
);

/** "+N older" quotations: a small button that lists the other quotations of the deal. */
function OlderQuotes({ actor, quotes, isCurrent }: { actor: Actor; quotes: RecordData[]; isCurrent: (r: RecordData) => boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className="dj-older" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {DC.older(quotes.length)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={DC.olderTitle} width={340}>
        <div className="dj-older-list">
          <p className="dj-older-title">{DC.olderTitle}</p>
          {quotes.map((q) => (
            <Node key={q.id} actor={actor} kind="" resource="quotations" record={q} current={isCurrent(q)} muted={MUTED_QUOTE.includes(String(q.status)) || q.isLatest === false} />
          ))}
        </div>
      </Popover>
    </>
  );
}

export function DealChain({ resKey, recordId, actor, onTab }: { resKey: string; recordId: string; actor: Actor; onTab?: (tab: string) => void }) {
  useRevision();
  const [collapsed, setCollapsed] = useState(() => readCollapsed(actor.user.id));
  const chain = resolveDealChain(resKey, recordId);
  const { lead, opportunity: opp, quotations, orders, contracts, selectedQuotationId } = chain;
  const isCurrent = (res: string, r: RecordData) => res === resKey && r.id === recordId;
  const selected = quotations.find((q) => q.id === selectedQuotationId);
  const liveOrder = orders.find((o) => o.status !== 'cancelled');
  const oppOpen = !!opp && !OPEN_STAGES_CLOSED.includes(String(opp.stage));
  const canCreateQuote = oppOpen && perm(actor, 'quotations').create && canSee(actor, 'opportunities', opp);
  const canGenerateOrder = !!selected && selected.status === 'accepted' && !liveOrder && opp?.stage !== 'lost' && perm(actor, 'salesOrders').create && canSee(actor, 'quotations', selected);

  // Progress: an older quotation version shows only the chain; otherwise the deal's own quotation and live order drive it.
  const self = resKey === 'quotations' ? quotations.find((q) => q.id === recordId) : undefined;
  const latestQuote = [...quotations].reverse().find((q) => q.isLatest !== false);
  const quote = resKey === 'quotations' ? (self?.isLatest === false ? undefined : self) : (selected ?? latestQuote);
  const order = resKey === 'salesOrders' ? orders.find((o) => o.id === recordId) : liveOrder;
  const model = resKey === 'quotations' && self?.isLatest === false ? null : dealProgress(quote, order);

  const tabId = model && model.driver.resource === resKey ? NEXT_TAB[resKey]?.[model.driver.status] : undefined;
  const tab = tabId && onTab ? getRecordTabs(resKey).find((t) => t.id === tabId) : undefined;

  const toggle = () => {
    const c = !collapsed;
    setCollapsed(c);
    try {
      localStorage.setItem(storeKey(actor.user.id), c ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  };

  // Quotation shown in the line: this one, else the selected one, else the latest; the rest fold into "+N older".
  const shownQuote = self ?? selected ?? latestQuote ?? quotations[quotations.length - 1];
  const otherQuotes = quotations.filter((q) => q.id !== shownQuote?.id);
  const shownOrders = orders.filter((o) => o.status !== 'cancelled' || isCurrent('salesOrders', o));
  const liveContracts = contracts.filter((c) => !['superseded', 'cancelled'].includes(String(c.status)));
  const shownContracts = liveContracts.length ? liveContracts : contracts.slice(-1);

  const chainLine = (
    <ol className="dj-chain" aria-label={DC.title}>
      <li>{lead ? <Node actor={actor} kind={DC.steps.leads} resource="leads" record={lead} current={isCurrent('leads', lead)} /> : <Missing kind={DC.steps.leads} text={opp ? DC.notLinked : DC.notCreated} />}</li>
      <li>{opp ? <Node actor={actor} kind={DC.steps.opportunities} resource="opportunities" record={opp} current={isCurrent('opportunities', opp)} /> : <Missing kind={DC.steps.opportunities} />}</li>
      <li>
        {shownQuote ? (
          <Node actor={actor} kind={DC.quotation} resource="quotations" record={shownQuote} current={isCurrent('quotations', shownQuote)} selected={shownQuote.id === selectedQuotationId && quotations.length > 1}>
            {otherQuotes.length > 0 && <OlderQuotes actor={actor} quotes={otherQuotes} isCurrent={(q) => isCurrent('quotations', q)} />}
          </Node>
        ) : (
          <Missing kind={DC.steps.quotations}>
            {canCreateQuote && (
              <LinkButton icon="file-text" to={toPath(ROUTES.quotationNew, {}, { opportunity: opp!.id })}>
                {L.opportunities.actions.createQuotation}
              </LinkButton>
            )}
          </Missing>
        )}
      </li>
      <li>
        {shownOrders.length ? (
          <span className="dj-node-stack">{shownOrders.map((o) => <Node key={o.id} actor={actor} kind={DC.steps.salesOrders} resource="salesOrders" record={o} current={isCurrent('salesOrders', o)} muted={o.status === 'cancelled'} />)}</span>
        ) : (
          <Missing kind={DC.steps.salesOrders}>
            {canGenerateOrder && (
              <LinkButton variant="primary" icon="shopping-cart" to={toPath(ROUTES.salesOrderNew, {}, { quotation: selected!.id })}>
                {L.opportunities.actions.generateSalesOrder}
              </LinkButton>
            )}
          </Missing>
        )}
      </li>
      <li>
        {shownContracts.length ? (
          <span className="dj-node-stack">{shownContracts.map((c) => <Node key={c.id} actor={actor} kind={DC.steps.salesContracts} resource="salesContracts" record={c} current={isCurrent('salesContracts', c)} muted={c.status === 'superseded' || c.status === 'cancelled'} />)}</span>
        ) : (
          <Missing kind={DC.steps.salesContracts} />
        )}
      </li>
    </ol>
  );

  const nextBox =
    model && (model.stopped || model.next) ? (
      <div className={cx('dj-next', model.stopped && 'is-stopped', model.complete && 'is-complete')}>
        <Icon name={model.stopped ? 'alert' : model.complete ? 'check-circle' : 'arrow-right'} size={16} className="dj-next-icon" />
        <div className="dj-next-body">
          <span className="dj-next-head">
            <strong>{model.stopped ? P.stoppedLabel : model.complete ? P.done : P.nextLabel}</strong>
            {!model.stopped && model.next?.who && <span className="dj-next-who">{model.next.who}</span>}
          </span>
          <span className="dj-next-text">{model.stopped ?? model.next?.text}</span>
        </div>
        {tab && !model.stopped && (
          <Button size="compact" icon="arrow-right" onClick={() => onTab!(tab.id)}>
            {P.openTab(tab.label)}
          </Button>
        )}
      </div>
    ) : null;

  const summary = model ? (model.stopped ? `${P.stoppedLabel}: ${model.stopped}` : model.current ? `${P.pending[model.current]}${model.next?.who ? ` — ${P.nextLabel}: ${model.next.who}` : ''}` : P.done) : null;

  return (
    <section className={cx('deal-journey', collapsed && 'is-collapsed')} aria-label={P.title}>
      <div className="dj-head">
        <h3 className="dj-title">{P.title}</h3>
        {collapsed && summary && <span className={cx('dj-summary', model?.stopped && 'is-stopped')}>{summary}</span>}
        <IconButton icon={collapsed ? 'chevron-down' : 'chevron-up'} label={collapsed ? P.expand : P.collapse} aria-expanded={!collapsed} onClick={toggle} className="dj-toggle" />
      </div>
      {!collapsed && (
        <>
          {model && <DealStepper model={model} />}
          {nextBox}
          {chainLine}
        </>
      )}
    </section>
  );
}
