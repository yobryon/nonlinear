import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Cycle } from '@nonlinear/shared';
import { formatDate, useStore } from '../store.js';
import { CycleIcon, StarIcon } from '../icons.js';
import {
  applyFilters,
  EMPTY_FILTERS,
  GroupedIssueList,
  useGroupedIssues,
  ViewControls,
  type IssueFilters,
} from '../issueViews.js';
import { toggleFavorite } from '../actions.js';
import { BurnupChart } from '../components/BurnupChart.js';

function cyclePhase(cycle: Cycle): 'past' | 'active' | 'upcoming' {
  const now = new Date().toISOString();
  if (cycle.endsAt <= now) return 'past';
  if (cycle.startsAt <= now) return 'active';
  return 'upcoming';
}

export function TeamCyclesPage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const cycles = useStore((s) => s.cycles);
  const issues = useStore((s) => s.issues);
  const states = useStore((s) => s.workflowStates);
  const navigate = useNavigate();

  const team = Object.values(teams).find((t) => t.key === teamKey);
  const rows = useMemo(() => {
    if (!team) return [];
    return Object.values(cycles)
      .filter((c) => c.teamId === team.id)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }, [cycles, team]);

  if (!team) {
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span className="team-icon" style={{ background: team.color }}>
            {team.key.slice(0, 2)}
          </span>
          {team.name}
          <span className="crumb">›</span>
          <span className="crumb">Cycles</span>
        </div>
        <span className="spacer" />
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <CycleIcon size={26} style={{ color: 'var(--text-4)' }} />
            <h3>No cycles</h3>
            <p>Cycles are created automatically while they are enabled in team settings.</p>
          </div>
        )}
        {rows.map((cycle) => {
          const phase = cyclePhase(cycle);
          const cycleIssues = Object.values(issues).filter(
            (i) => i.cycleId === cycle.id && !i.archivedAt,
          );
          const done = cycleIssues.filter((i) => {
            const c = states[i.stateId]?.category;
            return c === 'completed' || c === 'canceled';
          }).length;
          const pct = cycleIssues.length ? Math.round((done / cycleIssues.length) * 100) : 0;
          return (
            <div
              key={cycle.id}
              className="project-row"
              onClick={() => navigate(`/cycle/${cycle.id}`)}
            >
              <CycleIcon
                size={14}
                style={{ color: phase === 'active' ? 'var(--warning)' : 'var(--text-3)' }}
              />
              <span className="name">{cycle.name || `Cycle ${cycle.number}`}</span>
              {phase === 'active' && (
                <span
                  className="chip"
                  style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}
                >
                  Active
                </span>
              )}
              {phase === 'upcoming' && <span className="chip">Upcoming</span>}
              <span className="dim">
                {formatDate(cycle.startsAt)} – {formatDate(cycle.endsAt)}
              </span>
              <span className="grow" />
              <div className="progress-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
              <span className="dim" style={{ width: 70 }}>
                {done}/{cycleIssues.length} done
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function CycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const cycles = useStore((s) => s.cycles);
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const favorites = useStore((s) => s.favorites);
  const userId = useStore((s) => s.userId);
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);

  const cycle = cycleId ? cycles[cycleId] : null;
  const team = cycle ? teams[cycle.teamId] : null;

  const cycleIssues = useMemo(() => {
    if (!cycle) return [];
    return applyFilters(
      Object.values(issues).filter((i) => i.cycleId === cycle.id && !i.archivedAt),
      filters,
    );
  }, [issues, cycle, filters]);

  const grouped = useGroupedIssues(cycleIssues, 'state', team?.id);

  if (!cycle || !team) {
    return (
      <div className="empty-state">
        <h3>Cycle not found</h3>
      </div>
    );
  }

  const isFavorite = Object.values(favorites).some(
    (f) => f.userId === userId && f.type === 'cycle' && f.targetId === cycle.id,
  );
  const phase = cyclePhase(cycle);

  return (
    <>
      <div className="topbar">
        <div className="title">
          <Link to={`/team/${team.key}/cycles`} className="crumb">
            {team.name} cycles
          </Link>
          <span className="crumb">›</span>
          <CycleIcon size={15} />
          {cycle.name || `Cycle ${cycle.number}`}
          <span className="muted" style={{ fontWeight: 400 }}>
            {formatDate(cycle.startsAt)} – {formatDate(cycle.endsAt)}
            {phase === 'active' && ' · active'}
          </span>
        </div>
        <span className="spacer" />
        <button
          className={`icon-btn${isFavorite ? ' active' : ''}`}
          onClick={() => void toggleFavorite('cycle', cycle.id)}
        >
          <StarIcon size={15} filled={isFavorite} />
        </button>
      </div>
      <ViewControls filters={filters} onFilters={setFilters} teamId={team.id} />
      <div className="content">
        <div
          style={{
            margin: '14px 20px',
            padding: '14px 16px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--bg-surface)',
            maxWidth: 720,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Burn-up</div>
          <BurnupChart cycleId={cycle.id} />
        </div>
        <GroupedIssueList groups={grouped} grouping="state" />
      </div>
    </>
  );
}
