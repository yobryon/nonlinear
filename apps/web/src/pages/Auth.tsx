import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { startSync } from '../sync.js';
import { useStore } from '../store.js';

function ssoErrorMessage(code: string): string {
  switch (code) {
    case 'domain_not_allowed':
      return 'Your email domain isn’t allowed to sign in here.';
    case 'sso_no_account':
      return 'No account exists for that identity. Ask an admin to invite you.';
    case 'email_unverified':
      return 'Your identity provider hasn’t verified that email address.';
    case 'provider_unavailable':
      return 'The single sign-on provider is unavailable. Try again shortly.';
    case 'access_denied':
      return 'Sign-in was cancelled.';
    default:
      return 'Single sign-on failed. Please try again.';
  }
}

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [setupRequired, setSetupRequired] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<{ enabled: boolean; label: string } | null>(null);
  const [canRegister, setCanRegister] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    setInviteToken(invite);
    void api
      .meta(invite ?? undefined)
      .then((meta) => {
        setSetupRequired(meta.setupRequired);
        setSso(meta.sso);
        // Registration is only offered during first-run setup, when open
        // signups are on, or when the visitor arrived with a valid invite.
        const allowed = meta.setupRequired || meta.allowSignups || meta.inviteValid;
        setCanRegister(allowed);
        if (meta.setupRequired || (invite && meta.inviteValid)) setMode('register');
        else setMode('login');
      })
      .catch(() => {});
    // Surface an SSO failure redirected back as ?sso_error=<code>.
    const ssoError = params.get('sso_error');
    if (ssoError) {
      setError(ssoErrorMessage(ssoError));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await api.register({
          email,
          password,
          name,
          workspaceName: setupRequired ? workspaceName : undefined,
          inviteToken: inviteToken ?? undefined,
        });
      } else {
        await api.login({ email, password });
      }
      useStore.getState().setPhase('loading');
      await startSync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>
          {setupRequired
            ? 'Welcome to nonlinear'
            : mode === 'login'
              ? 'Log in'
              : 'Create your account'}
        </h1>
        <p className="sub">
          {setupRequired
            ? 'Set up your workspace and admin account to get started.'
            : mode === 'login'
              ? 'Enter your credentials to continue.'
              : 'Join the workspace with your email.'}
        </p>
        {sso?.enabled && !setupRequired && (
          <>
            <a className="btn lg auth-sso" href="/api/auth/sso/start">
              Continue with {sso.label}
            </a>
            <div className="auth-divider">
              <span>or</span>
            </div>
          </>
        )}
        <form onSubmit={(e) => void submit(e)}>
          {error && <div className="auth-error">{error}</div>}
          {setupRequired && (
            <div>
              <label className="field-label">Workspace name</label>
              <input
                className="input"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Acme Inc"
                required
              />
            </div>
          )}
          {mode === 'register' && (
            <div>
              <label className="field-label">Your name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                required
              />
            </div>
          )}
          <div>
            <label className="field-label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : 'Password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
            />
          </div>
          <button className="btn primary lg" type="submit" disabled={busy}>
            {busy
              ? 'Working…'
              : setupRequired
                ? 'Create workspace'
                : mode === 'login'
                  ? 'Log in'
                  : 'Sign up'}
          </button>
        </form>
        {!setupRequired && canRegister && (
          <div className="auth-switch">
            {mode === 'login' ? (
              <>
                {inviteToken ? 'Have an invite? ' : 'New here? '}
                <button onClick={() => setMode('register')}>Create an account</button>
              </>
            ) : (
              <>
                Already have an account? <button onClick={() => setMode('login')}>Log in</button>
              </>
            )}
          </div>
        )}
        {!setupRequired && !canRegister && (
          <div className="auth-switch" style={{ color: 'var(--text-4)' }}>
            Registration is invite-only. Ask an admin to invite you.
          </div>
        )}
      </div>
    </div>
  );
}
