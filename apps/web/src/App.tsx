import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useStore } from './store.js';
import { startSync } from './sync.js';
import { Sidebar } from './Sidebar.js';
import { CommandPalette, openPalette, usePalette } from './CommandPalette.js';
import { NewIssueDialog, openNewIssue, useNewIssue } from './NewIssueDialog.js';
import { ShortcutsDialog, useHelp } from './ShortcutsDialog.js';
import { Toasts } from './ui.js';
import { MenuIcon, PencilIcon, SearchIcon, SpinnerIcon } from './icons.js';
import { applyPreferences, applyStoredPreferences } from './preferences.js';
import { BulkBar } from './issueViews.js';
import { AuthPage } from './pages/Auth.js';
import { TeamIssuesPage } from './pages/TeamIssues.js';
import { IssueDetailPage } from './pages/IssueDetail.js';
import { MyIssuesPage } from './pages/MyIssues.js';
import { AwaitingPage } from './pages/Awaiting.js';
import { InboxPage } from './pages/Inbox.js';
import { ProjectDetailPage, ProjectsPage } from './pages/Projects.js';
import { CycleDetailPage, TeamCyclesPage } from './pages/Cycles.js';
import { DecisionDetailPage, DecisionsPage } from './pages/Decisions.js';
import { SettingsPage } from './pages/Settings.js';
import { TriagePage } from './pages/Triage.js';
import { ReconcilePage } from './pages/Reconcile.js';
import { InitiativeDetailPage, InitiativesPage } from './pages/Initiatives.js';
import { DocumentDetailPage, DocumentsPage } from './pages/Documents.js';
import { DocsPage } from './pages/Docs.js';
import { DashboardDetailPage, DashboardsPage } from './pages/Dashboards.js';
import { PulsePage } from './pages/Pulse.js';
import { InsightsPage } from './pages/Insights.js';
import { SearchPage } from './pages/Search.js';
import { TimelinePage } from './pages/Timeline.js';
import { ArchivePage } from './pages/Archive.js';
import { CustomViewPage } from './pages/CustomView.js';
import { CustomerDetailPage, CustomersPage } from './pages/Customers.js';
import { IntakePublicPage } from './pages/Intake.js';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function Shortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        usePalette.getState().show();
        return;
      }
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // '?' toggles the shortcut sheet from anywhere; it's the one shortcut we
      // still honor while the sheet itself is open (so it can dismiss it). Some
      // keyboards/automation report shift+/ as '/', so match either shape.
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        useHelp.getState().toggle();
        return;
      }
      if (usePalette.getState().open || useNewIssue.getState().open || useHelp.getState().open)
        return;

      const key = e.key.toLowerCase();
      if (pendingG) {
        pendingG = false;
        if (timer) clearTimeout(timer);
        if (key === 'i') navigate('/inbox');
        else if (key === 'm') navigate('/my-issues');
        else if (key === 'p') navigate('/projects');
        else if (key === 's') navigate('/settings/preferences');
        return;
      }
      if (key === 'c') {
        e.preventDefault();
        openNewIssue();
      } else if (key === '/') {
        e.preventDefault();
        navigate('/search');
      } else if (key === 'g') {
        pendingG = true;
        timer = setTimeout(() => {
          pendingG = false;
        }, 800);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return null;
}

function DefaultRedirect() {
  const teams = useStore((s) => s.teams);
  const home = useStore((s) => (s.userId ? s.users[s.userId]?.preferences.home : undefined));
  const first = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (home === 'inbox') return <Navigate to="/inbox" replace />;
  if (home === 'my-issues') return <Navigate to="/my-issues" replace />;
  if (first) return <Navigate to={`/team/${first.key}/issues`} replace />;
  return <Navigate to="/settings/teams" replace />;
}

/** Old /design/:slug bookmarks land in the unified docs hub. */
function DesignDocsRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/docs/design/${slug ?? 'README'}`} replace />;
}

function AppShell() {
  const connection = useStore((s) => s.connection);
  const workspace = useStore((s) => s.workspace);
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();

  // Close the drawer on navigation.
  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {connection === 'offline' && (
        <div className="offline-banner">Connection lost — reconnecting…</div>
      )}
      <div className="mobile-header">
        <button className="icon-btn" onClick={() => setMobileNav(true)} aria-label="Open menu">
          <MenuIcon size={18} />
        </button>
        <span className="ws-logo">{(workspace?.name ?? 'N')[0]?.toUpperCase()}</span>
        <span className="truncate" style={{ fontWeight: 600 }}>
          {workspace?.name ?? 'nonlinear'}
        </span>
        <span className="grow" />
        <button className="icon-btn" onClick={openPalette} aria-label="Search">
          <SearchIcon size={17} />
        </button>
        <button className="icon-btn" onClick={() => openNewIssue()} aria-label="New issue">
          <PencilIcon size={17} />
        </button>
      </div>
      <div className={`app${mobileNav ? ' nav-open' : ''}`} style={{ flex: 1, minHeight: 0 }}>
        {mobileNav && <div className="nav-backdrop" onClick={() => setMobileNav(false)} />}
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<DefaultRedirect />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/my-issues" element={<MyIssuesPage />} />
            <Route path="/awaiting" element={<AwaitingPage />} />
            <Route path="/team/:teamKey/issues" element={<TeamIssuesPage />} />
            <Route path="/team/:teamKey/projects" element={<ProjectsPage />} />
            <Route path="/team/:teamKey/triage" element={<TriagePage />} />
            <Route path="/team/:teamKey/reconcile" element={<ReconcilePage />} />
            <Route path="/team/:teamKey/decisions" element={<DecisionsPage />} />
            <Route path="/decision/:decisionId" element={<DecisionDetailPage />} />
            <Route path="/team/:teamKey/archive" element={<ArchivePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/view/:viewId" element={<CustomViewPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customer/:customerId" element={<CustomerDetailPage />} />
            <Route path="/team/:teamKey/cycles" element={<TeamCyclesPage />} />
            <Route path="/team/:teamKey/insights" element={<InsightsPage />} />
            <Route path="/issue/:key" element={<IssueDetailPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/project/:projectId" element={<ProjectDetailPage />} />
            <Route path="/cycle/:cycleId" element={<CycleDetailPage />} />
            <Route path="/initiatives" element={<InitiativesPage />} />
            <Route path="/initiative/:initiativeId" element={<InitiativeDetailPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/document/:documentId" element={<DocumentDetailPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/docs/:group/:slug" element={<DocsPage />} />
            {/* Back-compat: the old standalone Design-docs routes now live in the hub. */}
            <Route path="/design" element={<Navigate to="/docs/design/README" replace />} />
            <Route path="/design/:slug" element={<DesignDocsRedirect />} />
            <Route path="/dashboards" element={<DashboardsPage />} />
            <Route path="/dashboard/:dashboardId" element={<DashboardDetailPage />} />
            <Route path="/pulse" element={<PulsePage />} />
            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const phase = useStore((s) => s.phase);
  const myPrefs = useStore((s) => (s.userId ? s.users[s.userId]?.preferences : undefined));

  useEffect(() => {
    applyStoredPreferences();
    void startSync().catch(() => {
      useStore.getState().setPhase('anonymous');
    });
  }, []);

  // Apply live preferences whenever they change (also across-device via sync).
  useEffect(() => {
    if (myPrefs) applyPreferences(myPrefs);
  }, [myPrefs]);

  const isPublicIntake = location.pathname.startsWith('/intake/');
  if (isPublicIntake) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/intake/:teamKey" element={<IntakePublicPage />} />
        </Routes>
        <Toasts />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      {phase === 'loading' && (
        <div className="loading-screen">
          <SpinnerIcon size={18} />
          Loading workspace…
        </div>
      )}
      {phase === 'anonymous' && <AuthPage />}
      {phase === 'ready' && (
        <>
          <Routes>
            <Route path="/settings/*" element={<SettingsPage />} />
            <Route path="*" element={<AppShell />} />
          </Routes>
          <Shortcuts />
          <CommandPalette />
          <NewIssueDialog />
          <ShortcutsDialog />
          <BulkBar />
        </>
      )}
      <Toasts />
    </BrowserRouter>
  );
}
