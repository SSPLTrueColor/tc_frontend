import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { appPack } from './domain/pack';
import { useRevision } from './services/hooks';
import { isSignedIn } from './services/session';
import { AppShell } from './components/shell/AppShell';
import { ErrorState, ToastProvider } from './components/primitives/feedback';
import { TooltipLayer } from './components/primitives/TooltipLayer';
import { ConfirmHost } from './components/primitives/overlay';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { RecordPage, ResourcePage } from './pages/ResourcePage';
import { FullPageFormPage, InboxPage } from './pages/WorkPages';
import { AccessPage, AuditPage, MastersPage, SettingsPage } from './pages/AdminPages';
import { OutboxPage } from './pages/DemoPages';
import { moduleRoutes } from './modules/routes';
import { LEGACY_REDIRECTS, ROUTES, keyOfSlug, slugOf } from './constants/routes';
import { resourceKeyFromParams } from './lib/routes';
import { L } from './constants/labels';

function NotFound({ message }: { message?: string }) {
  return (
    <div className="page">
      <ErrorState title={L.common.notFound.title}>{message ?? L.common.notFound.body}</ErrorState>
      <p className="center">
        <Link to={ROUTES.dashboard}>{L.common.notFound.back}</Link>
      </p>
    </div>
  );
}

/** Old URL → new URL (GLOSSARY D-10): copies `:params`, keeps the query string. */
function LegacyRedirect({ to }: { to: string }) {
  const params = useParams();
  const location = useLocation();
  const [path, query] = to.split('?');
  const target = path.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
  const search = [query, location.search.replace(/^\?/, '')].filter(Boolean).join('&');
  return <Navigate to={`${target}${search ? `?${search}` : ''}`} replace />;
}

/** Simulated session guard: signed-out visitors go to /login and come back afterwards. */
function RequireSession({ children }: { children: ReactNode }) {
  useRevision();
  const location = useLocation();
  if (!isSignedIn()) return <Navigate to={ROUTES.login} replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** /<resource>[/new | /:id | /:id/edit] — unknown keys never fall through to another resource. */
function ResourceRoute({ kind }: { kind: 'list' | 'new' | 'edit' | 'record' }) {
  const params = useParams();
  const location = useLocation();
  const slug = params.adminResource ? `admin/${params.adminResource}` : params.resource ?? '';
  // Old engine-key URLs (/salesOrders/SO-1) → kebab-case slug (/sales-orders/SO-1).
  if (!keyOfSlug(slug) && appPack.resources.some((r) => r.key === slug) && slugOf(slug) !== slug) {
    const rest = location.pathname.split('/').slice(2).join('/');
    return <Navigate to={`/${slugOf(slug)}${rest ? `/${rest}` : ''}${location.search}`} replace />;
  }
  const key = resourceKeyFromParams(params);
  const res = keyOfSlug(slug) ? appPack.resources.find((r) => r.key === key) : undefined;
  if (!res) return <NotFound />;
  if (kind === 'list') return <ResourcePage key={res.key} />;
  if (kind === 'record') return <RecordPage key={res.key} />;
  return <FullPageFormPage key={`${res.key}-${kind}`} />;
}

function Workspace() {
  return (
    <RequireSession>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to={ROUTES.dashboard} replace />} />
          <Route path={ROUTES.dashboard} element={<DashboardPage />} />
          <Route path={ROUTES.notifications} element={<InboxPage />} />
          <Route path={ROUTES.masters} element={<MastersPage />} />
          <Route path={ROUTES.rolesPermissions} element={<AccessPage />} />
          <Route path={ROUTES.auditTrail} element={<AuditPage />} />
          <Route path={ROUTES.sentMessages} element={<OutboxPage />} />
          <Route path={ROUTES.demoSettings} element={<SettingsPage />} />
          {moduleRoutes
            .filter((r) => !r.public)
            .map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
            <Route key={`legacy:${from}`} path={from} element={<LegacyRedirect to={to} />} />
          ))}
          <Route path="/admin/:adminResource" element={<ResourceRoute kind="list" />} />
          <Route path="/admin/:adminResource/new" element={<ResourceRoute kind="new" />} />
          <Route path="/admin/:adminResource/:recordId/edit" element={<ResourceRoute kind="edit" />} />
          <Route path="/admin/:adminResource/:recordId" element={<ResourceRoute kind="record" />} />
          <Route path="/admin/*" element={<NotFound />} />
          <Route path="/:resource" element={<ResourceRoute kind="list" />} />
          <Route path="/:resource/new" element={<ResourceRoute kind="new" />} />
          <Route path="/:resource/:recordId/edit" element={<ResourceRoute kind="edit" />} />
          <Route path="/:resource/:recordId" element={<ResourceRoute kind="record" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </RequireSession>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <TooltipLayer />
      <ConfirmHost />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path={ROUTES.login} element={<LoginPage />} />
          {Object.entries(LEGACY_REDIRECTS)
            .filter(([from]) => from === '/portal/new-ticket')
            .map(([from, to]) => (
              <Route key={`legacy:${from}`} path={from} element={<LegacyRedirect to={to} />} />
            ))}
          {moduleRoutes
            .filter((r) => r.public)
            .map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          <Route path="/*" element={<Workspace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
