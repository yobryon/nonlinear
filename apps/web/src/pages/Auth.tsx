import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { startSync } from '../sync.js';
import { useStore } from '../store.js';

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [setupRequired, setSetupRequired] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .meta()
      .then((meta) => {
        setSetupRequired(meta.setupRequired);
        if (meta.setupRequired) setMode('register');
      })
      .catch(() => {});
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
        {!setupRequired && (
          <div className="auth-switch">
            {mode === 'login' ? (
              <>
                New here? <button onClick={() => setMode('register')}>Create an account</button>
              </>
            ) : (
              <>
                Already have an account? <button onClick={() => setMode('login')}>Log in</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
