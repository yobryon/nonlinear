import type { User } from './entities.js';

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

/** Helper: build an issue identifier like "ENG-123". */
export function issueIdentifier(teamKey: string, number: number): string {
  return `${teamKey}-${number}`;
}
