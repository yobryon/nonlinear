export * from './storage.js';
export * from './domain.js';
export * from './memory.js';
export * from './blob.js';
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
export * from './services/attachments.js';
export * from './services/initiatives.js';
export * from './services/documents.js';
export * from './services/webhooks.js';
export * from './services/duesoon.js';

import type { Storage } from './storage.js';
import { SyncBus, type Ctx } from './domain.js';
import { createMemoryBlobStore, type BlobStore } from './blob.js';
import { AttachmentService } from './services/attachments.js';
import { InitiativeService } from './services/initiatives.js';
import { DocumentService } from './services/documents.js';
import { WebhookService } from './services/webhooks.js';
import { DueSoonService } from './services/duesoon.js';
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
  attachments: AttachmentService;
  initiatives: InitiativeService;
  documents: DocumentService;
  webhooks: WebhookService;
  dueSoon: DueSoonService;
}

export interface DomainOptions {
  /** Binary storage for attachments; defaults to in-memory. */
  blobs?: BlobStore;
}

export function createDomain(storage: Storage, options: DomainOptions = {}): Domain {
  const bus = new SyncBus(storage.syncLog);
  const ctx: Ctx = { storage, bus };
  const blobs = options.blobs ?? createMemoryBlobStore();
  const attachments = new AttachmentService(ctx, blobs);
  return {
    ctx,
    bus,
    auth: new AuthService(ctx),
    teams: new TeamService(ctx),
    issues: new IssueService(ctx, attachments),
    comments: new CommentService(ctx),
    projects: new ProjectService(ctx),
    cycles: new CycleService(ctx),
    labels: new LabelService(ctx),
    relations: new RelationService(ctx),
    favorites: new FavoriteService(ctx),
    notifications: new NotificationService(ctx),
    users: new UserService(ctx),
    bootstrap: new BootstrapService(ctx),
    attachments,
    initiatives: new InitiativeService(ctx),
    documents: new DocumentService(ctx),
    webhooks: new WebhookService(ctx),
    dueSoon: new DueSoonService(ctx),
  };
}
