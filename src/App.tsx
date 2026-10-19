import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { ErrorState, ToastProvider } from './components/primitives/feedback';
import { TooltipLayer } from './components/primitives/TooltipLayer';
import { ConfirmHost } from './components/primitives/overlay';
import { DashboardPage } from './modules/home/DashboardPage';

function NotFound() {
  return (
    <div className="page">
      <ErrorState title="Page not found">This link is invalid, was renamed, or points to something you cannot access.</ErrorState>
      <p className="center">
        <Link to="/dashboard">Go to overview</Link>
      </p>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <TooltipLayer />
      <ConfirmHost />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppShell>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </ToastProvider>
  );
}
