import { useRef, useState } from 'react';
import type { Team } from '@nonlinear/shared';
import { api } from '../api.js';
import { toast, toastError } from '../ui.js';

const MAX_ERRORS_SHOWN = 5;

export function ImportExport({ team }: { team: Team }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const onFile = async (file: File) => {
    setImporting(true);
    setErrors([]);
    try {
      const result = await api.importCsv(team.id, file);
      toast(
        `${result.created} issue${result.created === 1 ? '' : 's'} imported, ${result.skipped} skipped`,
        result.errors.length > 0 ? 'info' : 'success',
      );
      setErrors(result.errors);
    } catch (err) {
      toastError(err);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="settings-section">
      <h2>Import / export</h2>
      <div className="setting-row">
        <div className="info">
          <div className="label">Import issues from CSV</div>
          <div className="desc">
            Supported columns: Title, Description, Status, Priority, Assignee, Labels, Estimate —
            Jira CSV exports work too.
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <button className="btn ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? 'Importing…' : 'Choose CSV'}
        </button>
      </div>
      {errors.length > 0 && (
        <div className="auth-error" style={{ marginBottom: 10 }}>
          {errors.slice(0, MAX_ERRORS_SHOWN).map((err, i) => (
            <div key={i}>{err}</div>
          ))}
          {errors.length > MAX_ERRORS_SHOWN && (
            <div>…and {errors.length - MAX_ERRORS_SHOWN} more</div>
          )}
        </div>
      )}

      <div className="setting-row">
        <div className="info">
          <div className="label">Export issues</div>
          <div className="desc">Download every issue in {team.name} as a CSV file.</div>
        </div>
        <button
          className="btn ghost"
          onClick={() => window.open(`/api/teams/${team.id}/export.csv`)}
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}
