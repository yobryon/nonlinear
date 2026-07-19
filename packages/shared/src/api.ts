import type { User } from './entities.js';
import type { AiProvider, ProjectHealth, PulseItemType } from './enums.js';

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface SessionResponse {
  user: User;
  workspaceId: string;
}

/** What the login page needs to know before anyone signs in. */
export interface MetaResponse {
  setupRequired: boolean;
  workspaceName: string | null;
  /** SSO sign-in availability + button label (null when OIDC isn't configured). */
  sso: { enabled: boolean; label: string } | null;
}

/** Normalized identity claims from an OIDC provider, consumed by the domain. */
export interface SsoUserInfo {
  /** Stable IdP subject identifier (the `sub` claim). */
  subject: string;
  email: string;
  name: string | null;
}

/** What the client is allowed to know about AI config — never the API key. */
export interface AiSettingsPublic {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  /** Whether an API key is stored (the key itself never leaves the server). */
  hasKey: boolean;
}

/** One entry in the Pulse activity feed. */
export interface PulseItem {
  id: string;
  type: PulseItemType;
  /** ISO timestamp the event happened. */
  at: string;
  title: string;
  /** Short human-readable detail (e.g. update body excerpt, count). */
  detail: string;
  actorId: string | null;
  targetType: 'project' | 'cycle' | 'team' | null;
  targetId: string | null;
  health: ProjectHealth | null;
}

export interface PulseFeed {
  items: PulseItem[];
  /** Window covered, in days. */
  sinceDays: number;
}

/** AI label suggestion for an issue. */
export interface LabelSuggestion {
  labelId: string;
  name: string;
}

/** Helper: build an issue identifier like "ENG-123". */
export function issueIdentifier(teamKey: string, number: number): string {
  return `${teamKey}-${number}`;
}
