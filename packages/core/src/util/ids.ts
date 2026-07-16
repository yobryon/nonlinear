import { randomUUID, randomBytes } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
