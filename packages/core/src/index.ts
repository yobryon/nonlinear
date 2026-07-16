export * from './storage.js';
export * from './domain.js';
export * from './memory.js';
export * from './util/ids.js';
export * from './util/time.js';
export * from './util/fractional.js';
export * from './util/passwords.js';
export * from './util/colors.js';
export * from './services/auth.js';
export * from './services/teams.js';
export * from './services/issues.js';
export * from './services/comments.js';
export * from './services/projects.js';
export * from './services/cycles.js';
export * from './services/labels.js';
export * from './services/extras.js';
export * from './services/notify.js';

import type { Storage } from './storage.js';
import { SyncBus, type Ctx } from './domain.js';
import { AuthService } from './services/auth.js';
import { TeamService } from './services/teams.js';
import { IssueService } from './services/issues.js';
import { CommentService } from './services/comments.js';
import { ProjectService } from './services/projects.js';
import { CycleService } from './services/cycles.js';
import { LabelService } from './services/labels.js';
import {
  BootstrapService,
  FavoriteService,
  NotificationService,
  RelationService,
  UserService,
} from './services/extras.js';

/** Composition root: wire storage to every domain service. */
export interface Domain {
  ctx: Ctx;
  bus: SyncBus;
  auth: AuthService;
  teams: TeamService;
  issues: IssueService;
  comments: CommentService;
  projects: ProjectService;
  cycles: CycleService;
  labels: LabelService;
  relations: RelationService;
  favorites: FavoriteService;
  notifications: NotificationService;
  users: UserService;
  bootstrap: BootstrapService;
}

export function createDomain(storage: Storage): Domain {
  const bus = new SyncBus(storage.syncLog);
  const ctx: Ctx = { storage, bus };
  return {
    ctx,
    bus,
    auth: new AuthService(ctx),
    teams: new TeamService(ctx),
    issues: new IssueService(ctx),
    comments: new CommentService(ctx),
    projects: new ProjectService(ctx),
    cycles: new CycleService(ctx),
    labels: new LabelService(ctx),
    relations: new RelationService(ctx),
    favorites: new FavoriteService(ctx),
    notifications: new NotificationService(ctx),
    users: new UserService(ctx),
    bootstrap: new BootstrapService(ctx),
  };
}
