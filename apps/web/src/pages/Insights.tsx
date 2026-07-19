import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { WorkflowState } from '@nonlinear/shared';
import { PRIORITY_LABELS, type Priority } from '@nonlinear/shared';
import { sortedStates, useStore } from '../store.js';
import { PriorityIcon, StateIcon } from '../icons.js';
import { VelocityChart } from '../components/VelocityChart.js';
import { DistributionBars, StatTile, ThroughputChart, weeklyBuckets } from '../components/tiles.js';

const WEEKS = 8;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '16px 18px',
        background: 'var(--bg-surface)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

export function InsightsPage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const teams = useStore((s) => s.teams);
  const issues = useStore((s) => s.issues);
  const states = useStore((s) => s.workflowStates);

  const team = Object.values(teams).find((t) => t.key === teamKey);

  const teamIssues = useMemo(
    () => (team ? Object.values(issues).filter((i) => i.teamId === team.id && !i.archivedAt) : []),
    [issues, team],
  );
  const buckets = useMemo(() => weeklyBuckets(teamIssues), [teamIssues]);
  const teamStates: WorkflowState[] = team ? sortedStates(Object.values(states), team.id) : [];

  if (!team) {
    return (
      <div className="empty-state">
        <h3>Team not found</h3>
      </div>
    );
  }

  const byCat = (category: WorkflowState['category']) =>
    teamIssues.filter((i) => states[i.stateId]?.category === category).length;
  const open = teamIssues.length - byCat('completed') - byCat('canceled');
  const nowIso = new Date().toISOString();
  const overdue = teamIssues.filter(
    (i) => i.dueDate && i.dueDate < nowIso && !i.completedAt && !i.canceledAt,
  ).length;
  const completed14 = teamIssues.filter(
    (i) => i.completedAt && new Date(i.completedAt).getTime() > Date.now() - 14 * 86400000,
  ).length;

  const stateRows = teamStates.map((s) => ({
    key: s.id,
    label: s.name,
    icon: <StateIcon category={s.category} color={s.color} size={13} />,
    count: teamIssues.filter((i) => i.stateId === s.id).length,
    color: s.color,
  }));
  const priorityRows = ([1, 2, 3, 4, 0] as Priority[]).map((p) => ({
    key: String(p),
    label: PRIORITY_LABELS[p],
    icon: <PriorityIcon priority={p} size={13} />,
    count: teamIssues.filter((i) => i.priority === p).length,
    color: '#5e6ad2',
  }));

  return (
    <>
      <div className="topbar">
        <div className="title">
          <span className="team-icon" style={{ background: team.color }}>
            {team.key.slice(0, 2)}
          </span>
          {team.name}
          <span className="crumb">›</span>
          <span className="crumb">Insights</span>
        </div>
        <span className="spacer" />
      </div>
      <div className="content" style={{ padding: '18px 20px 60px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <StatTile label="Open issues" value={open} />
          <StatTile label="In progress" value={byCat('started')} />
          <StatTile label="Completed" value={completed14} hint="last 14 days" />
          <StatTile label="Overdue" value={overdue} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
          <Section title={`Throughput — last ${WEEKS} weeks`}>
            <ThroughputChart buckets={buckets} />
          </Section>
          <Section title="Velocity — points completed per week">
            <VelocityChart teamId={team.id} />
          </Section>
          <Section title="Issues by status">
            <DistributionBars rows={stateRows} />
          </Section>
          <Section title="Issues by priority">
            <DistributionBars rows={priorityRows} />
          </Section>
        </div>
      </div>
    </>
  );
}
