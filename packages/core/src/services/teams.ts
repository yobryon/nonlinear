import type {
  CreateTeamInput,
  CreateWorkflowStateInput,
  Team,
  TeamMembership,
  UpdateTeamInput,
  UpdateWorkflowStateInput,
  WorkflowState,
} from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, updated, type Ctx } from '../domain.js';
import { newId, newToken } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { colorFor } from '../util/colors.js';

const DEFAULT_STATES: Array<Pick<WorkflowState, 'name' | 'color' | 'category'>> = [
  { name: 'Backlog', color: '#bec2c8', category: 'backlog' },
  { name: 'Todo', color: '#e2e2e2', category: 'unstarted' },
  { name: 'In Progress', color: '#f2c94c', category: 'started' },
  { name: 'In Review', color: '#26b5ce', category: 'started' },
  { name: 'Done', color: '#5e6ad2', category: 'completed' },
  { name: 'Canceled', color: '#95a2b3', category: 'canceled' },
];

export class TeamService {
  constructor(private ctx: Ctx) {}

  async create(creatorId: string, input: CreateTeamInput): Promise<Team> {
    const { storage, bus } = this.ctx;
    const key = input.key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{0,6}$/.test(key)) {
      throw new DomainError('invalid_key', 'Team key must be 1-7 letters/digits');
    }
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Team name is required');
    for (const existing of await storage.teams.all()) {
      if (existing.key === key) {
        throw new DomainError('key_taken', `Team key ${key} is already in use`, 409);
      }
    }
    const now = nowIso();
    const team: Team = {
      id: newId(),
      name,
      key,
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? colorFor(name),
      private: false,
      timezone: 'Etc/UTC',
      cyclesEnabled: input.cyclesEnabled ?? false,
      cycleDurationWeeks: input.cycleDurationWeeks ?? 2,
      triageEnabled: false,
      slaUrgentHours: null,
      slaHighHours: null,
      estimateScale: 'exponential',
      intakeEnabled: false,
      internalIntake: input.internalIntake ?? true,
      intakeToken: null,
      issueCounter: 0,
      createdAt: now,
      updatedAt: now,
    };
    await storage.teams.insert(team);

    const deltas = [created('team', team)];
    let position = 0;
    for (const spec of DEFAULT_STATES) {
      const state: WorkflowState = {
        id: newId(),
        teamId: team.id,
        ...spec,
        position: position++,
        createdAt: now,
        updatedAt: now,
      };
      await storage.workflowStates.insert(state);
      deltas.push(created('workflowState', state));
    }
    await bus.publish(deltas);
    await this.addMember(team.id, creatorId);
    return team;
  }

  async update(teamId: string, input: UpdateTeamInput): Promise<Team> {
    const { storage, bus } = this.ctx;
    const team = await storage.teams.get(teamId);
    if (!team) throw notFound('Team');
    if (input.key !== undefined) {
      const key = input.key.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]{0,6}$/.test(key)) {
        throw new DomainError('invalid_key', 'Team key must be 1-7 letters/digits');
      }
      for (const other of await storage.teams.all()) {
        if (other.id !== teamId && other.key === key) {
          throw new DomainError('key_taken', `Team key ${key} is already in use`, 409);
        }
      }
      team.key = key;
    }
    if (input.name !== undefined) team.name = input.name.trim() || team.name;
    if (input.description !== undefined) team.description = input.description;
    if (input.icon !== undefined) team.icon = input.icon;
    if (input.color !== undefined) team.color = input.color;
    if (input.private !== undefined) team.private = input.private;
    if (input.internalIntake !== undefined) team.internalIntake = input.internalIntake;
    if (input.timezone !== undefined) team.timezone = input.timezone;
    if (input.cyclesEnabled !== undefined) team.cyclesEnabled = input.cyclesEnabled;
    if (input.cycleDurationWeeks !== undefined) {
      team.cycleDurationWeeks = Math.max(1, Math.min(8, input.cycleDurationWeeks));
    }
    const extraDeltas = [];
    if (input.triageEnabled !== undefined) {
      team.triageEnabled = input.triageEnabled;
      if (input.triageEnabled) {
        const hasTriage = (await storage.workflowStates.all()).some(
          (s) => s.teamId === teamId && s.category === 'triage',
        );
        if (!hasTriage) {
          const now = nowIso();
          const state: WorkflowState = {
            id: newId(),
            teamId,
            name: 'Triage',
            color: '#f2994a',
            category: 'triage',
            position: -1,
            createdAt: now,
            updatedAt: now,
          };
          await storage.workflowStates.insert(state);
          extraDeltas.push(created('workflowState', state));
        }
      }
    }
    const clampSla = (hours: number | null): number | null =>
      hours === null ? null : Math.max(1, Math.min(24 * 30, Math.round(hours)));
    if (input.slaUrgentHours !== undefined) team.slaUrgentHours = clampSla(input.slaUrgentHours);
    if (input.slaHighHours !== undefined) team.slaHighHours = clampSla(input.slaHighHours);
    if (input.estimateScale !== undefined) team.estimateScale = input.estimateScale;
    if (input.intakeEnabled !== undefined) {
      team.intakeEnabled = input.intakeEnabled;
      if (input.intakeEnabled && !team.intakeToken) team.intakeToken = newToken();
    }
    team.updatedAt = nowIso();
    await storage.teams.update(team);
    await bus.publish([updated('team', team), ...extraDeltas]);
    return team;
  }

  async remove(teamId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const team = await storage.teams.get(teamId);
    if (!team) throw notFound('Team');
    const issues = await storage.issues.byTeam(teamId);
    if (issues.length > 0) {
      throw new DomainError('team_not_empty', 'Delete or move this team’s issues first', 409);
    }
    const deltas = [];
    for (const state of await storage.workflowStates.all()) {
      if (state.teamId === teamId) {
        await storage.workflowStates.delete(state.id);
        deltas.push(deleted('workflowState', state.id));
      }
    }
    for (const membership of await storage.teamMemberships.all()) {
      if (membership.teamId === teamId) {
        await storage.teamMemberships.delete(membership.id);
        deltas.push(deleted('teamMembership', membership.id));
      }
    }
    for (const cycle of await storage.cycles.all()) {
      if (cycle.teamId === teamId) {
        await storage.cycles.delete(cycle.id);
        deltas.push(deleted('cycle', cycle.id));
      }
    }
    for (const label of await storage.labels.all()) {
      if (label.teamId === teamId) {
        await storage.labels.delete(label.id);
        deltas.push(deleted('label', label.id));
      }
    }
    await storage.teams.delete(teamId);
    deltas.push(deleted('team', teamId));
    await bus.publish(deltas);
  }

  async addMember(teamId: string, userId: string): Promise<TeamMembership> {
    const { storage, bus } = this.ctx;
    if (!(await storage.teams.get(teamId))) throw notFound('Team');
    if (!(await storage.users.get(userId))) throw notFound('User');
    for (const m of await storage.teamMemberships.all()) {
      if (m.teamId === teamId && m.userId === userId) return m;
    }
    const membership: TeamMembership = {
      id: newId(),
      teamId,
      userId,
      createdAt: nowIso(),
    };
    await storage.teamMemberships.insert(membership);
    await bus.publish([created('teamMembership', membership)]);
    return membership;
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    for (const m of await storage.teamMemberships.all()) {
      if (m.teamId === teamId && m.userId === userId) {
        await storage.teamMemberships.delete(m.id);
        await bus.publish([deleted('teamMembership', m.id)]);
        return;
      }
    }
  }

  async createState(input: CreateWorkflowStateInput): Promise<WorkflowState> {
    const { storage, bus } = this.ctx;
    if (!(await storage.teams.get(input.teamId))) throw notFound('Team');
    const siblings = (await storage.workflowStates.all()).filter((s) => s.teamId === input.teamId);
    const now = nowIso();
    const state: WorkflowState = {
      id: newId(),
      teamId: input.teamId,
      name: input.name.trim(),
      color: input.color,
      category: input.category,
      position: input.position ?? Math.max(0, ...siblings.map((s) => s.position + 1)),
      createdAt: now,
      updatedAt: now,
    };
    if (!state.name) throw new DomainError('invalid_name', 'State name is required');
    await storage.workflowStates.insert(state);
    await bus.publish([created('workflowState', state)]);
    return state;
  }

  async updateState(stateId: string, input: UpdateWorkflowStateInput): Promise<WorkflowState> {
    const { storage, bus } = this.ctx;
    const state = await storage.workflowStates.get(stateId);
    if (!state) throw notFound('Workflow state');
    if (input.name !== undefined) state.name = input.name.trim() || state.name;
    if (input.color !== undefined) state.color = input.color;
    if (input.position !== undefined) state.position = input.position;
    state.updatedAt = nowIso();
    await storage.workflowStates.update(state);
    await bus.publish([updated('workflowState', state)]);
    return state;
  }

  async removeState(stateId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const state = await storage.workflowStates.get(stateId);
    if (!state) throw notFound('Workflow state');
    const inUse = (await storage.issues.byTeam(state.teamId)).some((i) => i.stateId === stateId);
    if (inUse) {
      throw new DomainError('state_in_use', 'Move issues out of this state first', 409);
    }
    const remaining = (await storage.workflowStates.all()).filter(
      (s) => s.teamId === state.teamId && s.id !== stateId,
    );
    if (remaining.length === 0) {
      throw new DomainError('last_state', 'A team needs at least one workflow state', 409);
    }
    await storage.workflowStates.delete(stateId);
    await bus.publish([deleted('workflowState', stateId)]);
  }
}
