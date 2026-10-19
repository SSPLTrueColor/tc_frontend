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
import { AccessPage, AuditPage, EventsPage, SettingsPage, StudioPage } from './pages/AdminPages';
import { OutboxPage } from './pages/DemoPages';
import { moduleRoutes } from './modules/routes';

function NotFound({ message }: { message?: string }) {
  return (
    <div className="page">
      <ErrorState title="Page not found">{message ?? 'This link is invalid, was renamed, or points to something you cannot access.'}</ErrorState>
      <p className="center">
        <Link to="/dashboard">Go to overview</Link>
      </p>
    </div>
  );
}

/** Simulated session guard: signed-out visitors go to /login and come back afterwards. */
function RequireSession({ children }: { children: ReactNode }) {
  useRevision();
  const location = useLocation();
  if (!isSignedIn()) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** /<resource>[/new | /:id | /:id/edit] — unknown keys never fall through to another resource. */
function ResourceRoute({ kind }: { kind: 'list' | 'new' | 'edit' | 'record' }) {
  const { resource } = useParams();
  const res = appPack.resources.find((r) => r.key === resource);
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
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/admin/studio" element={<StudioPage />} />
          <Route path="/admin/access" element={<AccessPage />} />
          <Route path="/admin/audit" element={<AuditPage />} />
          <Route path="/admin/events" element={<EventsPage />} />
          <Route path="/admin/outbox" element={<OutboxPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />
          {moduleRoutes
            .filter((r) => !r.public)
            .map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
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
          <Route path="/login" element={<LoginPage />} />
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
