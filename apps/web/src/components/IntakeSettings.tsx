import { useState } from 'react';
import type { Team } from '@nonlinear/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { Switch, toast, toastError } from '../ui.js';

const codeStyle = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11.5,
  background: 'var(--bg-active)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '3px 6px',
  userSelect: 'all',
  wordBreak: 'break-all',
} as const;

function copy(text: string, what: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast(`${what} copied to clipboard`, 'success'))
    .catch(toastError);
}

export function IntakeSettings({ team }: { team: Team }) {
  const [revealed, setRevealed] = useState(false);

  const setEnabled = (intakeEnabled: boolean) => {
    void api
      .updateTeam(team.id, { intakeEnabled })
      .then((t) => useStore.getState().putEntity('team', t))
      .catch(toastError);
  };

  const formUrl = `${location.origin}/intake/${team.key}`;

  return (
    <div className="settings-section">
      <h2>Intake</h2>
      <div className="setting-row">
        <div className="info">
          <div className="label">Public intake form</div>
          <div className="desc">
            Let anyone file a request without an account. Submissions land in this team's triage.
          </div>
        </div>
        <Switch on={team.intakeEnabled} onChange={setEnabled} />
      </div>

      {team.intakeEnabled && (
        <>
          <div className="setting-row">
            <div className="info">
              <div className="label">Form URL</div>
              <div className="desc">
                <code style={codeStyle}>{formUrl}</code>
              </div>
            </div>
            <button className="btn ghost" onClick={() => copy(formUrl, 'Form URL')}>
              Copy
            </button>
          </div>

          <div className="setting-row">
            <div className="info">
              <div className="label">Intake token</div>
              <div className="desc">
                <code style={codeStyle}>
                  {revealed ? (team.intakeToken ?? '—') : '••••••••••••••••'}
                </code>
              </div>
            </div>
            <button className="btn ghost" onClick={() => setRevealed((r) => !r)}>
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <button
              className="btn ghost"
              disabled={!team.intakeToken}
              onClick={() => team.intakeToken && copy(team.intakeToken, 'Intake token')}
            >
              Copy
            </button>
          </div>

          <p className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
            POST JSON {'{title, description, email}'} with the header X-Intake-Token to create
            issues programmatically, or wire a Slack slash command to the same URL.
          </p>
        </>
      )}
    </div>
  );
}
