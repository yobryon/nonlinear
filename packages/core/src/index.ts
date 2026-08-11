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
export * from './services/views.js';
export * from './services/templates.js';
export * from './services/projectUpdates.js';
export * from './services/reminders.js';
export * from './services/customers.js';
export * from './services/docComments.js';
export * from './services/triageRules.js';
export * from './services/importer.js';
export * from './services/tokens.js';
export * from './services/visibility.js';
export * from './services/audit.js';
export * from './services/dashboards.js';
export * from './services/ai.js';
export * from './services/pulse.js';
export * from './services/invites.js';
export * from './services/decisions.js';

import type { Storage } from './storage.js';
import { SyncBus, type Ctx } from './domain.js';
import { createMemoryBlobStore, type BlobStore } from './blob.js';
import { AttachmentService } from './services/attachments.js';
import { InitiativeService } from './services/initiatives.js';
import { DocumentService } from './services/documents.js';
import { WebhookService } from './services/webhooks.js';
import { DueSoonService } from './services/duesoon.js';
import { CustomViewService } from './services/views.js';
import { IssueTemplateService } from './services/templates.js';
import { ProjectUpdateService } from './services/projectUpdates.js';
import { ReminderService } from './services/reminders.js';
import { CustomerRequestService, CustomerService } from './services/customers.js';
import { DocumentCommentService } from './services/docComments.js';
import { TriageRuleService } from './services/triageRules.js';
import { CsvService } from './services/importer.js';
import { TokenService } from './services/tokens.js';
import { AuditService } from './services/audit.js';
import { DashboardService } from './services/dashboards.js';
import { AiService } from './services/ai.js';
import { PulseService } from './services/pulse.js';
import { InviteService } from './services/invites.js';
import { DecisionService } from './services/decisions.js';
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
  views: CustomViewService;
  templates: IssueTemplateService;
  projectUpdates: ProjectUpdateService;
  reminders: ReminderService;
  customers: CustomerService;
  customerRequests: CustomerRequestService;
  docComments: DocumentCommentService;
  triageRules: TriageRuleService;
  csv: CsvService;
  tokens: TokenService;
  audit: AuditService;
  dashboards: DashboardService;
  ai: AiService;
  pulse: PulseService;
  invites: InviteService;
  decisions: DecisionService;
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
  const projectUpdates = new ProjectUpdateService(ctx);
  const reminders = new ReminderService(ctx);
  const customerRequests = new CustomerRequestService(ctx);
  const docComments = new DocumentCommentService(ctx);
  const issues = new IssueService(ctx, attachments, { reminders, customerRequests });
  return {
    ctx,
    bus,
    auth: new AuthService(ctx),
    teams: new TeamService(ctx),
    issues,
    comments: new CommentService(ctx),
    projects: new ProjectService(ctx, { projectUpdates }),
    cycles: new CycleService(ctx),
    labels: new LabelService(ctx),
    relations: new RelationService(ctx),
    favorites: new FavoriteService(ctx),
    notifications: new NotificationService(ctx),
    users: new UserService(ctx),
    bootstrap: new BootstrapService(ctx),
    attachments,
    initiatives: new InitiativeService(ctx),
    documents: new DocumentService(ctx, { docComments }),
    webhooks: new WebhookService(ctx),
    dueSoon: new DueSoonService(ctx),
    views: new CustomViewService(ctx),
    templates: new IssueTemplateService(ctx),
    projectUpdates,
    reminders,
    customers: new CustomerService(ctx),
    customerRequests,
    docComments,
    triageRules: new TriageRuleService(ctx),
    csv: new CsvService(ctx, issues),
    tokens: new TokenService(ctx),
    audit: new AuditService(ctx),
    dashboards: new DashboardService(ctx),
    ai: new AiService(ctx),
    pulse: new PulseService(ctx),
    invites: new InviteService(ctx),
    decisions: new DecisionService(ctx),
  };
}
