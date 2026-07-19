import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Dashboard, DashboardTile, DashboardTileType, StatMetric } from '@nonlinear/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { toastError, Switch } from '../ui.js';
import { PlusIcon, TrashIcon } from '../icons.js';
import { DashboardTileView, defaultTileTitle } from '../components/tiles.js';

const TILE_TYPES: { type: DashboardTileType; label: string; needsTeam?: boolean }[] = [
  { type: 'stat', label: 'Single metric' },
  { type: 'throughput', label: 'Throughput (created vs completed)' },
  { type: 'velocity', label: 'Velocity', needsTeam: true },
  { type: 'burnup', label: 'Current cycle burn-up', needsTeam: true },
  { type: 'by-state', label: 'Issues by status', needsTeam: true },
  { type: 'by-priority', label: 'Issues by priority' },
  { type: 'by-assignee', label: 'Issues by assignee' },
  { type: 'project-health', label: 'Project health' },
];

const STAT_METRICS: { value: StatMetric; label: string }[] = [
  { value: 'open', label: 'Open issues' },
  { value: 'started', label: 'In progress' },
  { value: 'completed14', label: 'Completed (14d)' },
  { value: 'created14', label: 'Created (14d)' },
  { value: 'overdue', label: 'Overdue' },
];

function newId(): string {
  return `tile-${Math.random().toString(36).slice(2, 10)}`;
}

export function DashboardsPage() {
  const dashboards = useStore((s) => s.dashboards);
  const me = useStore((s) => s.userId);
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const rows = Object.values(dashboards).sort((a, b) =>
    a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0,
  );

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void api
      .createDashboard({ name: trimmed })
      .then((d) => {
        useStore.getState().putEntity('dashboard', d);
        setName('');
        navigate(`/dashboard/${d.id}`);
      })
      .catch(toastError);
  };

  return (
    <>
      <div className="topbar">
        <div className="title">Dashboards</div>
        <span className="spacer" />
      </div>
      <div className="content" style={{ padding: '18px 20px 60px', maxWidth: 720 }}>
        <div className="row" style={{ gap: 8, marginBottom: 18 }}>
          <input
            className="input"
            placeholder="New dashboard name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            style={{ maxWidth: 280 }}
          />
          <button className="btn primary" onClick={create} disabled={!name.trim()}>
            Create
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <h3>No dashboards yet</h3>
            <p>Build a view of the metrics your team watches — throughput, velocity, and more.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((d) => (
              <button
                key={d.id}
                className="list-row"
                onClick={() => navigate(`/dashboard/${d.id}`)}
                style={{ textAlign: 'left' }}
              >
                <span className="grow" style={{ fontWeight: 550 }}>
                  {d.name}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {d.tiles.length} tile{d.tiles.length === 1 ? '' : 's'}
                  {d.shared ? ' · shared' : d.creatorId === me ? ' · private' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function DashboardDetailPage() {
  const { dashboardId } = useParams();
  const dashboard = useStore((s) => (dashboardId ? s.dashboards[dashboardId] : undefined));
  const teams = useStore((s) => s.teams);
  const me = useStore((s) => s.userId);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  if (!dashboard) {
    return (
      <div className="empty-state">
        <h3>Dashboard not found</h3>
      </div>
    );
  }
  const owned = dashboard.creatorId === me;

  const save = (patch: Partial<Dashboard>) => {
    const next = { ...dashboard, ...patch };
    useStore.getState().putEntity('dashboard', next);
    void api.updateDashboard(dashboard.id, patch as never).catch(toastError);
  };

  const addTile = (tile: DashboardTile) => {
    save({ tiles: [...dashboard.tiles, tile] });
    setAdding(false);
  };
  const removeTile = (id: string) => save({ tiles: dashboard.tiles.filter((t) => t.id !== id) });

  const remove = () => {
    // The delete propagates back as a sync delta which drops it from the store.
    void api.deleteDashboard(dashboard.id).catch(toastError);
    navigate('/dashboards');
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span
            className="crumb"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/dashboards')}
          >
            Dashboards
          </span>
          <span className="crumb">›</span>
          {owned ? (
            <input
              className="title-input"
              value={dashboard.name}
              onChange={(e) => save({ name: e.target.value })}
            />
          ) : (
            dashboard.name
          )}
        </div>
        <span className="spacer" />
        {owned && (
          <div className="row" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 6, fontSize: 12.5, color: 'var(--text-2)' }}>
              <Switch on={dashboard.shared} onChange={(v) => save({ shared: v })} />
              Shared
            </label>
            <button className="btn ghost" onClick={() => setAdding((v) => !v)}>
              <PlusIcon size={14} /> Add tile
            </button>
            <button className="btn ghost danger" onClick={remove}>
              <TrashIcon size={14} />
            </button>
          </div>
        )}
      </div>

      {adding && owned && (
        <AddTilePanel
          teams={Object.values(teams)}
          onAdd={addTile}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="content" style={{ padding: '18px 20px 60px' }}>
        {dashboard.tiles.length === 0 ? (
          <div className="empty-state">
            <h3>Empty dashboard</h3>
            <p>{owned ? 'Add a tile to get started.' : 'The owner hasn’t added tiles yet.'}</p>
          </div>
        ) : (
          <div className="dashboard-grid">
            {dashboard.tiles.map((tile) => {
              const teamName = tile.config.teamId ? teams[tile.config.teamId]?.name : undefined;
              return (
                <div key={tile.id} className="dashboard-tile">
                  <div className="dashboard-tile-head">
                    <span className="grow truncate">
                      {tile.title || defaultTileTitle(tile, teamName)}
                    </span>
                    {owned && (
                      <button
                        className="icon-btn"
                        onClick={() => removeTile(tile.id)}
                        aria-label="Remove tile"
                      >
                        <TrashIcon size={13} />
                      </button>
                    )}
                  </div>
                  <DashboardTileView tile={tile} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function AddTilePanel({
  teams,
  onAdd,
  onCancel,
}: {
  teams: { id: string; name: string }[];
  onAdd: (tile: DashboardTile) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<DashboardTileType>('stat');
  const [teamId, setTeamId] = useState<string>('');
  const [metric, setMetric] = useState<StatMetric>('open');
  const spec = TILE_TYPES.find((t) => t.type === type)!;

  const add = () => {
    onAdd({
      id: newId(),
      type,
      title: null,
      config: {
        teamId: teamId || null,
        projectId: null,
        metric: type === 'stat' ? metric : undefined,
      },
    });
  };

  return (
    <div className="add-tile-panel">
      <label className="field-label">Tile</label>
      <select
        className="input"
        value={type}
        onChange={(e) => setType(e.target.value as DashboardTileType)}
      >
        {TILE_TYPES.map((t) => (
          <option key={t.type} value={t.type}>
            {t.label}
          </option>
        ))}
      </select>
      {type === 'stat' && (
        <select
          className="input"
          value={metric}
          onChange={(e) => setMetric(e.target.value as StatMetric)}
        >
          {STAT_METRICS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      )}
      <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        <option value="">{spec.needsTeam ? 'Select a team…' : 'All teams'}</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button className="btn primary" onClick={add} disabled={spec.needsTeam && !teamId}>
        Add
      </button>
      <button className="btn ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
