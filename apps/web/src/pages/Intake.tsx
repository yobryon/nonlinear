import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/* Public intake form (route /intake/:teamKey). Unauthenticated — no store,
   no api client; plain fetch against the public intake endpoints. */

interface IntakeMeta {
  teamName: string;
  enabled: boolean;
}

type Phase = 'loading' | 'closed' | 'form' | 'sent';

export function IntakePublicPage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [teamName, setTeamName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!teamKey) {
      setPhase('closed');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/public/intake/${encodeURIComponent(teamKey)}/meta`);
        if (!res.ok) throw new Error('closed');
        const meta = (await res.json()) as IntakeMeta;
        if (cancelled) return;
        if (!meta.enabled) {
          setPhase('closed');
        } else {
          setTeamName(meta.teamName);
          setPhase('form');
        }
      } catch {
        if (!cancelled) setPhase('closed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamKey]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !teamKey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/intake/${encodeURIComponent(teamKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, email }),
      });
      if (!res.ok) {
        let message =
          res.status === 429
            ? 'Too many requests — please wait a moment and try again.'
            : `Could not send your request (${res.status})`;
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data?.error?.message) message = data.error.message;
        } catch {
          /* not json */
        }
        throw new Error(message);
      }
      setPhase('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTitle('');
    setDescription('');
    setEmail('');
    setError(null);
    setPhase('form');
  };

  if (phase === 'loading') return <div className="auth-page" />;

  if (phase === 'closed') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>This form isn&rsquo;t accepting requests.</h1>
          <p className="sub">
            The team may have turned intake off, or the link may be out of date. Check with whoever
            shared it with you.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'sent') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Request received</h1>
          <p className="sub">The team will triage it.</p>
          <button className="btn primary lg" style={{ width: '100%' }} onClick={reset}>
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Request something from {teamName}</h1>
        <p className="sub">Describe what you need and the team will triage it.</p>
        <form onSubmit={(e) => void submit(e)}>
          {error && <div className="auth-error">{error}</div>}
          <div>
            <label className="field-label">Title</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What do you need?"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="field-label">Details</label>
            <textarea
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything that helps the team understand the request"
              rows={4}
            />
          </div>
          <div>
            <label className="field-label">Your email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
            <div className="dim" style={{ marginTop: 4, fontSize: 12 }}>
              Optional — so the team can follow up.
            </div>
          </div>
          <button className="btn primary lg" type="submit" disabled={busy || !title.trim()}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </form>
      </div>
    </div>
  );
}
