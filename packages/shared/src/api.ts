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

/** Helper: build an issue identifier like "ENG-123". */
export function issueIdentifier(teamKey: string, number: number): string {
  return `${teamKey}-${number}`;
}
