import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useStore } from './store.js';
import { startSync } from './sync.js';
import { Sidebar } from './Sidebar.js';
import { CommandPalette, usePalette } from './CommandPalette.js';
import { NewIssueDialog, openNewIssue, useNewIssue } from './NewIssueDialog.js';
import { Toasts } from './ui.js';
import { SpinnerIcon } from './icons.js';
import { BulkBar } from './issueViews.js';
import { AuthPage } from './pages/Auth.js';
import { TeamIssuesPage } from './pages/TeamIssues.js';
import { IssueDetailPage } from './pages/IssueDetail.js';
import { MyIssuesPage } from './pages/MyIssues.js';
import { InboxPage } from './pages/Inbox.js';
import { ProjectDetailPage, ProjectsPage } from './pages/Projects.js';
import { CycleDetailPage, TeamCyclesPage } from './pages/Cycles.js';
import { SettingsPage } from './pages/Settings.js';
import { TriagePage } from './pages/Triage.js';
import { InitiativeDetailPage, InitiativesPage } from './pages/Initiatives.js';
import { DocumentDetailPage, DocumentsPage } from './pages/Documents.js';
import { InsightsPage } from './pages/Insights.js';

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
      if (usePalette.getState().open || useNewIssue.getState().open) return;

      const key = e.key.toLowerCase();
      if (pendingG) {
        pendingG = false;
        if (timer) clearTimeout(timer);
        if (key === 'i') navigate('/inbox');
        else if (key === 'm') navigate('/my-issues');
        else if (key === 'p') navigate('/projects');
        return;
      }
      if (key === 'c') {
        e.preventDefault();
        openNewIssue();
      } else if (key === '/') {
        e.preventDefault();
        usePalette.getState().show();
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
  const first = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (first) return <Navigate to={`/team/${first.key}/issues`} replace />;
  return <Navigate to="/settings/teams" replace />;
}

function AppShell() {
  const connection = useStore((s) => s.connection);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {connection === 'offline' && (
        <div className="offline-banner">Connection lost — reconnecting…</div>
      )}
      <div className="app" style={{ flex: 1, minHeight: 0 }}>
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<DefaultRedirect />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/my-issues" element={<MyIssuesPage />} />
            <Route path="/team/:teamKey/issues" element={<TeamIssuesPage />} />
            <Route path="/team/:teamKey/triage" element={<TriagePage />} />
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
            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const phase = useStore((s) => s.phase);

  useEffect(() => {
    void startSync().catch(() => {
      useStore.getState().setPhase('anonymous');
    });
  }, []);

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
          <BulkBar />
        </>
      )}
      <Toasts />
    </BrowserRouter>
  );
}
