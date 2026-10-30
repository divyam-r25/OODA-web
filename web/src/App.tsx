import { type ReactNode, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { RouterProvider, matchPath, useRouter } from './lib/router';
import { UiProvider } from './ui/ui';
import { Shell } from './ui/Shell';
import { Landing } from './pages/Landing';
import { LoginPage, RegisterPage } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { CompetitorsPage } from './pages/Competitors';
import { CompetitorNew } from './pages/CompetitorNew';
import { CompetitorDetail } from './pages/CompetitorDetail';
import { SignalsPage } from './pages/Signals';
import { ResearchPage } from './pages/Research';
import { RunDetail } from './pages/RunDetail';
import { ComparePage } from './pages/Compare';
import { ReportsPage } from './pages/Reports';
import { ReportDetail } from './pages/ReportDetail';
import { ActionsPage } from './pages/Actions';
import { SettingsPage } from './pages/Settings';
import { NotFound } from './pages/NotFound';

const APP_ROUTES: [string, (p: Record<string, string>) => ReactNode][] = [
  ['/app', () => <Dashboard />],
  ['/app/competitors', () => <CompetitorsPage />],
  ['/app/competitors/new', () => <CompetitorNew />],
  ['/app/competitors/:id', (p) => <CompetitorDetail id={p.id!} />],
  ['/app/signals', () => <SignalsPage />],
  ['/app/research', () => <ResearchPage />],
  ['/app/research/:id', (p) => <RunDetail id={p.id!} />],
  ['/app/compare', () => <ComparePage />],
  ['/app/reports', () => <ReportsPage />],
  ['/app/reports/:id', (p) => <ReportDetail id={p.id!} />],
  ['/app/actions', () => <ActionsPage />],
  ['/app/settings', () => <SettingsPage />],
];

function Routes() {
  const { path, search, navigate } = useRouter();
  const { status } = useAuth();
  const inApp = path === '/app' || path.startsWith('/app/');
  const isAuthPage = path === '/login' || path === '/register';
  useEffect(() => {
    if (status === 'anon' && inApp) navigate(`/login?next=${encodeURIComponent(path + search)}`, { replace: true });
    if (status === 'authed' && isAuthPage) navigate(new URLSearchParams(search).get('next')?.startsWith('/app') ? new URLSearchParams(search).get('next')! : '/app', { replace: true });
  }, [status, inApp, isAuthPage, path, search, navigate]);

  if (path === '/') return <Landing />;
  if (isAuthPage) return status === 'loading' || status === 'authed' ? null : path === '/login' ? <LoginPage /> : <RegisterPage />;
  if (inApp) {
    if (status !== 'authed') return <div className="empty" aria-busy="true"><p>Loading your workspace…</p></div>;
    for (const [pattern, render] of APP_ROUTES) {
      const params = matchPath(pattern, path);
      if (params) return <Shell>{render(params)}</Shell>;
    }
    return <Shell><NotFound /></Shell>;
  }
  return <NotFound standalone />;
}

export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <UiProvider>
          <Routes />
        </UiProvider>
      </AuthProvider>
    </RouterProvider>
  );
}
