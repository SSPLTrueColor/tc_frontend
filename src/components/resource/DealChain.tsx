/**
 * Deal Journey card — two slim lines for where a deal stands:
 *  1. the journey as a row of record pills: Lead › Opportunity › Quotation (+N older) › Sales Order › Contract.
 *     Each pill shows the record's icon (✓ once passed) and its kind; the current stop also shows its status. Hover tells
 *     the document number and status, click opens the record. A missing stop the user may create is an action pill
 *     (Create Quotation, Generate Sales Order),
 *  2. one "Next" line: the next action, who takes it, and a button to the tab where it is done.
 * The card collapses to its head line (remembered per user).
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
import { getResource } from '../../services/registry';
import { dealProgress } from '../crm/DealProgress';
import { StatusChip } from '../primitives/feedback';
import { Icon } from '../primitives/Icon';
import { Button, IconButton } from '../primitives/Button';
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

type StopState = 'done' | 'current' | 'stopped' | 'todo';

const storeKey = (userId: string) => `tc.dealJourney.collapsed.${userId}`;
const readCollapsed = (userId: string) => {
  try {
    return localStorage.getItem(storeKey(userId)) === '1';
  } catch {
    return false;
  }
};
/** The record kind's own icon (same as the sidebar). */
const iconOf = (resource: string) => {
  try {
    return getResource(resource).icon;
  } catch {
    return 'file-text';
  }
};

/** One record on the journey: icon + kind (+ status on the current stop); hover tells the number and status. */
function Pill({ actor, kind, resource, record, state, here, muted }: { actor: Actor; kind: string; resource: string; record: RecordData; state: StopState; here: boolean; muted?: boolean }) {
  const visible = canSee(actor, resource, record);
  const st = visible ? statusOf(resource, record) : undefined;
  const label = refLabel(resource, record, actor);
  const tip = !visible ? `${kind} · ${DC.restricted}` : [kind, label, st?.label, here ? DC.current : ''].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="dj-mark" aria-hidden="true">
        <Icon name={state === 'done' ? 'check' : iconOf(resource)} size={state === 'done' ? 10 : 12} />
      </span>
      <span className="dj-pill-kind">{DC.pill[resource] ?? kind}</span>
      {(state === 'current' || state === 'stopped') && st && <StatusChip label={st.label} tone={st.tone as Tone | undefined} />}
      <span className="sr-only">{`${label}${st ? ` · ${st.label}` : ''}`}</span>
    </>
  );
  const cls = cx('dj-pill', `is-${state}`, here && 'is-here', muted && 'is-muted');
  return visible && !here ? (
    <Link className={cls} to={recordPeekPath(actor.workspaceId, resource, record.id)} data-tooltip={tip}>
      {body}
    </Link>
  ) : (
    <span className={cls} data-tooltip={tip} aria-current={here ? 'page' : undefined}>
      {body}
    </span>
  );
}

const Missing = ({ kind, resource, text = DC.notCreated }: { kind: string; resource: string; text?: string }) => (
  <span className="dj-pill is-todo" data-tooltip={`${kind} · ${text}`}>
    <span className="dj-mark" aria-hidden="true">
      <Icon name={iconOf(resource)} size={12} />
    </span>
    <span className="dj-pill-kind">{DC.pill[resource] ?? kind}</span>
    <span className="sr-only">{text}</span>
  </span>
);

/** A missing stop the user may create now: an accent pill that starts it. */
const ActionPill = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link className="dj-pill is-action" to={to}>
    <span className="dj-mark" aria-hidden="true">
      <Icon name="plus" size={12} />
    </span>
    <span className="dj-pill-kind">{children}</span>
  </Link>
);

/** "+N" older quotations: a small badge that lists the other quotations of the deal. */
function OlderQuotes({ actor, quotes, isCurrent }: { actor: Actor; quotes: RecordData[]; isCurrent: (r: RecordData) => boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className="dj-older" aria-haspopup="dialog" aria-expanded={open} aria-label={DC.older(quotes.length)} data-tooltip={DC.olderTitle} onClick={() => setOpen((o) => !o)}>
        +{quotes.length}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label={DC.olderTitle} width={340}>
        <div className="dj-older-list">
          <p className="dj-older-title">{DC.olderTitle}</p>
          {quotes.map((q) => {
            const st = canSee(actor, 'quotations', q) ? statusOf('quotations', q) : undefined;
            const label = refLabel('quotations', q, actor);
            return (
              <span key={q.id} className={cx('dj-older-row', (MUTED_QUOTE.includes(String(q.status)) || q.isLatest === false) && 'is-muted')}>
                {isCurrent(q) || !st ? (
                  <span className="mono">{label}</span>
                ) : (
                  <Link className="rel-link mono" to={recordPeekPath(actor.workspaceId, 'quotations', q.id)}>
                    {label}
                  </Link>
                )}
                {st && <StatusChip label={st.label} tone={st.tone as Tone | undefined} />}
              </span>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

export function DealChain({ resKey, recordId, actor, onTab }: { resKey: string; recordId: string; actor: Actor; onTab?: (tab: string) => void }) {
  useRevision();
  const [collapsed, setCollapsed] = useState(() => readCollapsed(actor.user.id));
  const [showAll, setShowAll] = useState(false);
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
  // A Not Selected quotation is closed: it never shows the selected deal's progress or next step (neutral note instead).
  const notSelected = resKey === 'quotations' && self?.status === 'not_selected';
  const model = notSelected || (resKey === 'quotations' && self?.isLatest === false) ? null : dealProgress(quote, order);
  const notSelectedText = notSelected ? (selected && selected.id !== self?.id ? P.notSelectedFor(String(selected.quoteNo ?? selected.id)) : P.notSelectedLost) : null;

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

  // Quotation shown on the journey: this one, else the selected one, else the latest; the rest fold into "+N".
  const shownQuote = self ?? selected ?? latestQuote ?? quotations[quotations.length - 1];
  const otherQuotes = quotations.filter((q) => q.id !== shownQuote?.id);
  const shownOrders = orders.filter((o) => o.status !== 'cancelled' || isCurrent('salesOrders', o));
  const liveContracts = contracts.filter((c) => !['superseded', 'cancelled'].includes(String(c.status)));
  const shownContracts = liveContracts.length ? liveContracts : contracts.slice(-1);

  // The furthest record is where the deal stands (every stop done once the deal is complete).
  const has = [!!lead, !!opp, !!shownQuote, shownOrders.length > 0, shownContracts.length > 0];
  const reached = has.lastIndexOf(true);
  const stateAt = (i: number): StopState => (!has[i] ? 'todo' : i === reached && !model?.complete ? (model?.stopped ? 'stopped' : 'current') : 'done');

  const stops: ReactNode[] = [
    lead ? <Pill actor={actor} kind={DC.steps.leads} resource="leads" record={lead} state={stateAt(0)} here={isCurrent('leads', lead)} /> : <Missing kind={DC.steps.leads} resource="leads" text={opp ? DC.notLinked : DC.notCreated} />,
    opp ? <Pill actor={actor} kind={DC.steps.opportunities} resource="opportunities" record={opp} state={stateAt(1)} here={isCurrent('opportunities', opp)} /> : <Missing kind={DC.steps.opportunities} resource="opportunities" />,
    shownQuote ? (
      <>
        <Pill actor={actor} kind={DC.quotation} resource="quotations" record={shownQuote} state={stateAt(2)} here={isCurrent('quotations', shownQuote)} />
        {otherQuotes.length > 0 && <OlderQuotes actor={actor} quotes={otherQuotes} isCurrent={(q) => isCurrent('quotations', q)} />}
      </>
    ) : canCreateQuote ? (
      <ActionPill to={toPath(ROUTES.quotationNew, {}, { opportunity: opp!.id })}>{L.opportunities.actions.createQuotation}</ActionPill>
    ) : (
      <Missing kind={DC.quotation} resource="quotations" />
    ),
    shownOrders.length ? (
      shownOrders.map((o) => <Pill key={o.id} actor={actor} kind={DC.steps.salesOrders} resource="salesOrders" record={o} state={o.status === 'cancelled' ? 'stopped' : stateAt(3)} here={isCurrent('salesOrders', o)} muted={o.status === 'cancelled'} />)
    ) : canGenerateOrder ? (
      <ActionPill to={toPath(ROUTES.salesOrderNew, {}, { quotation: selected!.id })}>{L.opportunities.actions.generateSalesOrder}</ActionPill>
    ) : (
      <Missing kind={DC.steps.salesOrders} resource="salesOrders" />
    ),
    shownContracts.length ? (
      shownContracts.map((c) => <Pill key={c.id} actor={actor} kind={DC.steps.salesContracts} resource="salesContracts" record={c} state={stateAt(4)} here={isCurrent('salesContracts', c)} muted={c.status === 'superseded' || c.status === 'cancelled'} />)
    ) : (
      <Missing kind={DC.steps.salesContracts} resource="salesContracts" />
    ),
  ];

  // By default only the last passed stage, the current one and the next; earlier stages fold into "+N".
  const focus = Math.max(reached, 0);
  const from = showAll ? 0 : Math.max(0, focus - 1);
  const to = showAll ? stops.length - 1 : Math.min(stops.length - 1, focus + 1);
  const hidden = from;

  const summary = notSelected ? P.notSelected : model ? (model.stopped ? `${P.stoppedLabel}: ${model.stopped}` : model.current ? P.pending[model.current] : P.done) : null;
  const toggleBtn = <IconButton icon={collapsed ? 'chevron-down' : 'chevron-up'} label={collapsed ? P.expand : P.collapse} aria-expanded={!collapsed} onClick={toggle} className="dj-toggle" />;

  if (collapsed)
    return (
      <section className="deal-journey is-collapsed" aria-label={P.title}>
        <div className="dj-head">
          <h3 className="dj-title">{P.title}</h3>
          {summary && <span className={cx('dj-summary', model?.stopped && 'is-stopped', model?.complete && 'is-complete')}>{summary}</span>}
          {toggleBtn}
        </div>
      </section>
    );

  return (
    <section className="deal-journey" aria-label={P.title}>
      <div className="dj-head">
        <ol className="dj-track" aria-label={DC.title}>
          {hidden > 0 && (
            <li className="dj-stop is-done">
              <button type="button" className="dj-older dj-earlier" aria-label={DC.showEarlier(hidden)} data-tooltip={DC.showEarlier(hidden)} onClick={() => setShowAll(true)}>
                +{hidden}
              </button>
            </li>
          )}
          {stops.map((stop, i) =>
            i < from || i > to ? null : (
              <li key={i} className={cx('dj-stop', `is-${stateAt(i)}`)}>
                {stop}
              </li>
            ),
          )}
          {showAll && (
            <li className="dj-stop">
              <button type="button" className="dj-older" aria-label={DC.showLess} data-tooltip={DC.showLess} onClick={() => setShowAll(false)}>
                <Icon name="chevron-left" size={12} />
              </button>
            </li>
          )}
        </ol>
        {toggleBtn}
      </div>
      {notSelectedText && (
        <div className="dj-next">
          <Icon name="info" size={14} className="dj-next-icon" />
          <strong className="dj-next-label">{P.notSelected}</strong>
          <span className="dj-next-text" data-tooltip={notSelectedText}>
            {notSelectedText}
          </span>
        </div>
      )}
      {model && (model.stopped || model.next) && (
        <div className={cx('dj-next', model.stopped && 'is-stopped', model.complete && 'is-complete')}>
          <Icon name={model.stopped ? 'alert' : model.complete ? 'check-circle' : 'arrow-right'} size={14} className="dj-next-icon" />
          <strong className="dj-next-label">{model.stopped ? P.stoppedLabel : model.complete ? P.done : P.nextLabel}</strong>
          {!model.stopped && model.next?.who && <span className="dj-next-who">{model.next.who}</span>}
          <span className="dj-next-text" data-tooltip={model.stopped ?? model.next?.text}>
            {model.stopped ?? model.next?.text}
          </span>
          {tab && !model.stopped && (
            <Button size="compact" icon="arrow-right" onClick={() => onTab!(tab.id)}>
              {P.openTab(tab.label)}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
