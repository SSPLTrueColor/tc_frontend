import { useEffect } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { organization } from './domain/clinic/pack';
import { wsBase } from './lib/routes';
import { getDb } from './services/db';
import { useActor } from './services/hooks';
import { getWorkspace } from './services/registry';
import { switchSession } from './services/settings';
import { clinicPack } from './domain/clinic/pack';
import { AppShell } from './components/shell/AppShell';
import { ErrorState, ToastProvider } from './components/primitives/feedback';
import { TooltipLayer } from './components/primitives/TooltipLayer';
import { ConfirmHost } from './components/primitives/overlay';
import { DashboardPage } from './pages/DashboardPage';
import { RecordPage, ResourcePage } from './pages/ResourcePage';
import { FullPageFormPage, InboxPage, MyWorkRedirect, SchedulePage } from './pages/WorkPages';
import { AccessPage, AuditPage, EventsPage, SettingsPage, StudioPage } from './pages/AdminPages';

function NotFound({ message }: { message?: string }) {
  const actor = useActor();
  return (
    <div className="page">
      <ErrorState title="Page not found">{message ?? 'This link is invalid, was renamed, or points to something you cannot access.'}</ErrorState>
      <p className="center">
        <Link to={`${wsBase(actor.workspaceId)}/dashboard`}>Go to overview</Link>
      </p>
    </div>
  );
}

/** Resolves org/workspace slugs to known IDs; unknown slugs never fall through to another workspace. */
function WorkspaceGate() {
  const { org, ws } = useParams();
  const workspace = ws ? getWorkspace(ws) : undefined;
  const valid = org === organization.slug && !!workspace;
  const session = getDb().session;
  useEffect(() => {
    if (valid && workspace && session.workspaceId !== workspace.id) switchSession(session.userId, workspace.id);
  }, [valid, workspace, session.workspaceId, session.userId]);
  if (!valid) {
    return (
      <AppShell>
        <NotFound message="This organization or clinic workspace does not exist, or you are not a member." />
      </AppShell>
    );
  }
  if (session.workspaceId !== workspace!.id) return null;
  return (
    <AppShell>
      <Routes>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="scheduling/schedule" element={<SchedulePage />} />
        <Route path="work/inbox" element={<InboxPage />} />
        <Route path="admin/studio" element={<StudioPage />} />
        <Route path="admin/access" element={<AccessPage />} />
        <Route path="admin/audit" element={<AuditPage />} />
        <Route path="admin/events" element={<EventsPage />} />
        <Route path="admin/settings" element={<SettingsPage />} />
        <Route path=":module/:resource" element={<ResourceRoute kind="list" />} />
        <Route path=":module/:resource/new" element={<ResourceRoute kind="new" />} />
        <Route path=":module/:resource/:recordId/edit" element={<ResourceRoute kind="edit" />} />
        <Route path=":module/:resource/:recordId" element={<ResourceRoute kind="record" />} />
        <Route path="" element={<Navigate to="dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

function ResourceRoute({ kind }: { kind: 'list' | 'new' | 'edit' | 'record' }) {
  const { module, resource } = useParams();
  const res = clinicPack.resources.find((r) => r.key === resource);
  if (!res || res.module !== module) return <NotFound />;
  if (kind === 'list') return <ResourcePage key={res.key} />;
  if (kind === 'record') return <RecordPage key={res.key} />;
  return <FullPageFormPage key={`${res.key}-${kind}`} />;
}

function RootRedirect() {
  const { workspaceId } = getDb().session;
  return <Navigate to={`${wsBase(workspaceId)}/dashboard`} replace />;
}

export default function App() {
  return (
    <ToastProvider>
      <TooltipLayer />
      <ConfirmHost />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route
            path="/u/:userSlug/my-work"
            element={
              <AppShell>
                <MyWorkRedirect />
              </AppShell>
            }
          />
          <Route path="/o/:org/w/:ws/*" element={<WorkspaceGate />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
