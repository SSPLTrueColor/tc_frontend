/**
 * First-login walkthrough per role (COM-12, GLOSSARY G-A13): 5 short steps — welcome, the modules the
 * role uses (highlighted in the icon rail), the Dashboard, the role's key action and search.
 * Shown once per user (state in personal settings), re-openable from the Help drawer.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { appModules } from '../../domain/pack';
import { moduleTitle } from '../../domain/sidebar';
import { L } from '../../constants/labels';
import { ROUTES } from '../../constants/routes';
import { cx } from '../../lib/format';
import { resourcePath } from '../../lib/routes';
import { type Actor, can, canReadResource } from '../../services/authz';
import { useActor } from '../../services/hooks';
import { getResource } from '../../services/registry';
import { markTourSeen, tourPending } from '../../services/settings';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Dialog } from '../primitives/overlay';
import './GuidedTour.css';

const T = L.common.tour;

/** Sidebar modules each role uses most (ids from src/domain/sidebar.ts). */
const ROLE_MODULES: Record<string, string[]> = {
  admin: ['admin', 'customers', 'reports'],
  management: ['home', 'reports', 'opportunities', 'quotations'],
  division_head: ['opportunities', 'quotations', 'orders', 'reports'],
  sales_manager: ['leads', 'opportunities', 'quotations', 'targets'],
  sales_exec: ['customers', 'leads', 'opportunities', 'quotations'],
  service_head: ['service', 'installed', 'spares', 'reports'],
  engineer: ['service', 'spares', 'field'],
  coordinator: ['service', 'customers', 'installed'],
  scm: ['orders', 'dispatch', 'spares'],
  store: ['spares', 'dispatch'],
  accounts: ['orders', 'field', 'reports'],
  profiling: ['opportunities', 'customers'],
};

/** Where the role's key action lives: a static page (ROUTES key) or a resource list. */
const ROLE_ACTION: Record<string, { page?: keyof typeof ROUTES & keyof typeof L.nav.pages; resource?: string }> = {
  admin: { page: 'masters' },
  management: { page: 'dashboard' },
  division_head: { page: 'quotationPendingApprovals' },
  sales_manager: { page: 'quotationPendingApprovals' },
  sales_exec: { resource: 'leads' },
  service_head: { resource: 'tickets' },
  engineer: { page: 'myJobs' },
  coordinator: { resource: 'tickets' },
  scm: { page: 'orderProcessing' },
  store: { resource: 'requisitions' },
  accounts: { page: 'paymentSchedule' },
  profiling: { resource: 'sampleRequests' },
};

// ---------------------------------------------------------------- highlight store (read by the icon rail)

let highlighted: string[] = [];
const listeners = new Set<() => void>();
const setHighlighted = (ids: string[]) => {
  highlighted = ids;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** Module ids the tour currently highlights in the icon rail. */
export const useTourHighlight = () => useSyncExternalStore(subscribe, () => highlighted, () => highlighted);

// ---------------------------------------------------------------- open state

/** Opens the tour automatically the first time a user signs in; `start()` reopens it from Help. */
export function useTour() {
  const actor = useActor();
  const [open, setOpen] = useState(() => tourPending(actor.user.id));
  useEffect(() => {
    if (tourPending(actor.user.id)) setOpen(true);
  }, [actor.user.id]);
  return {
    open,
    start: () => setOpen(true),
    close: () => {
      markTourSeen(actor.user.id);
      setOpen(false);
    },
  };
}

function moduleUsable(actor: Actor, id: string) {
  const m = appModules.find((x) => x.id === id);
  if (!m) return false;
  return m.resources.some((r) => canReadResource(actor, r)) || (m.pages ?? []).some((p) => !p.capability || can(actor, p.capability));
}

function keyActionTarget(actor: Actor): { title: string; path: string } | null {
  const a = ROLE_ACTION[actor.role.id];
  if (!a) return null;
  if (a.resource) {
    if (!canReadResource(actor, a.resource)) return null;
    return { title: getResource(a.resource).labelPlural, path: resourcePath(actor.workspaceId, a.resource) };
  }
  if (a.page) {
    const page = appModules.flatMap((m) => m.pages ?? []).find((p) => p.id === a.page);
    if (page?.capability && !can(actor, page.capability)) return null;
    return { title: L.nav.pages[a.page].title, path: ROUTES[a.page] };
  }
  return null;
}

export function GuidedTour({ onClose }: { onClose: () => void }) {
  const actor = useActor();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const modules = (ROLE_MODULES[actor.role.id] ?? ['home']).filter((id) => moduleUsable(actor, id));
  const target = keyActionTarget(actor);
  const firstName = actor.user.name.split(' ')[0];

  const steps = [
    { title: T.welcomeTitle(firstName), body: <p>{T.welcomeBody(actor.role.label)}</p>, highlight: [] as string[] },
    {
      title: T.modulesTitle,
      body: (
        <>
          <p>{T.modulesBody(modules.map(moduleTitle).join(', '))}</p>
          <ul className="tour-modules">
            {modules.map((id) => {
              const m = appModules.find((x) => x.id === id)!;
              return (
                <li key={id}>
                  <Icon name={m.icon} size={16} />
                  <span>{moduleTitle(id)}</span>
                </li>
              );
            })}
          </ul>
        </>
      ),
      highlight: modules,
    },
    { title: T.dashboardTitle, body: <p>{T.dashboardBody}</p>, highlight: ['home'] },
    {
      title: T.keyActionTitle,
      body: (
        <>
          <p>{T.keyActions[actor.role.id] ?? T.keyActions.sales_exec}</p>
          {target && (
            <Button
              icon="arrow-right"
              onClick={() => {
                onClose();
                navigate(target.path);
              }}
            >
              {T.openPage(target.title)}
            </Button>
          )}
        </>
      ),
      highlight: [] as string[],
    },
    { title: T.searchTitle, body: <p>{T.searchBody}</p>, highlight: [] as string[] },
  ];
  const last = step === steps.length - 1;
  const cur = steps[step];

  useEffect(() => {
    setHighlighted(cur.highlight);
    return () => setHighlighted([]);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={cur.title}
      description={T.stepOf(step + 1, steps.length)}
      footer={
        <>
          {!last && (
            <Button variant="ghost" className="mr-auto" onClick={onClose}>
              {T.skip}
            </Button>
          )}
          {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>{T.back}</Button>}
          <Button variant="primary" onClick={() => (last ? onClose() : setStep((s) => s + 1))} data-autofocus>
            {last ? T.finish : T.next}
          </Button>
        </>
      }
    >
      <div className="tour">
        <p className="tour-step muted small">{T.stepOf(step + 1, steps.length)}</p>
        {cur.body}
        <ol className="tour-dots" aria-label={T.progress}>
          {steps.map((s, i) => (
            <li key={s.title} className={cx(i === step && 'is-current', i < step && 'is-done')} aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">{s.title}</span>
            </li>
          ))}
        </ol>
      </div>
    </Dialog>
  );
}
