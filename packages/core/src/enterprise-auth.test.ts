import { beforeEach, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from './index.js';
import { createMemoryStorage } from './memory.js';
import { createMemoryBlobStore } from './blob.js';
import type { SsoUserInfo, User } from '@nonlinear/shared';

let domain: Domain;
let admin: User;

beforeEach(async () => {
  domain = createDomain(createMemoryStorage(), { blobs: createMemoryBlobStore() });
  admin = (
    await domain.auth.register({
      email: 'ada@acme.com',
      password: 'hunter2hunter2',
      name: 'Ada Lovelace',
      workspaceName: 'Acme',
    })
  ).user;
});

const sso = (over: Partial<SsoUserInfo> = {}): SsoUserInfo => ({
  subject: 'idp|abc123',
  email: 'grace@acme.com',
  name: 'Grace Hopper',
  ...over,
});

describe('SSO account resolution', () => {
  it('provisions a new member on first login, then matches by subject after', async () => {
    const first = await domain.auth.findOrProvisionSso(sso(), { autoProvision: true });
    expect(first.outcome).toBe('provisioned');
    expect(first.user.email).toBe('grace@acme.com');
    expect(first.user.role).toBe('member');
    expect(await domain.auth.authenticate(first.session.token)).toMatchObject({
      id: first.user.id,
    });

    const second = await domain.auth.findOrProvisionSso(sso(), { autoProvision: true });
    expect(second.outcome).toBe('matched');
    expect(second.user.id).toBe(first.user.id);
  });

  it('links an existing password account by email on first SSO login', async () => {
    const linked = await domain.auth.findOrProvisionSso(
      sso({ email: 'ada@acme.com', subject: 'idp|ada' }),
      { autoProvision: false },
    );
    expect(linked.outcome).toBe('linked');
    expect(linked.user.id).toBe(admin.id);
    // Subsequent logins match by subject, even though auto-provision is off.
    const again = await domain.auth.findOrProvisionSso(
      sso({ email: 'ada@acme.com', subject: 'idp|ada' }),
      { autoProvision: false },
    );
    expect(again.outcome).toBe('matched');
  });

  it('refuses to provision an unknown account when auto-provision is off', async () => {
    await expect(
      domain.auth.findOrProvisionSso(sso(), { autoProvision: false }),
    ).rejects.toMatchObject({ code: 'sso_no_account' });
  });

  it('refuses SSO for a deactivated account', async () => {
    const { user } = await domain.auth.findOrProvisionSso(sso(), { autoProvision: true });
    await domain.users.setActive(user.id, false);
    await expect(
      domain.auth.findOrProvisionSso(sso(), { autoProvision: true }),
    ).rejects.toMatchObject({ code: 'inactive' });
  });
});

describe('SCIM-facing provisioning', () => {
  it('provisions idempotently by email', async () => {
    const a = await domain.auth.provisionMember({ email: 'lin@acme.com', name: 'Lin' });
    const b = await domain.auth.provisionMember({ email: 'lin@acme.com', name: 'Lin Again' });
    expect(a.id).toBe(b.id);
    expect(
      (await domain.ctx.storage.users.all()).filter((u) => u.email === 'lin@acme.com'),
    ).toHaveLength(1);
  });

  it('deactivates a member and revokes their sessions, keeping the last admin safe', async () => {
    const member = await domain.auth.provisionMember({ email: 'lin@acme.com' });
    const session = await domain.auth.createSession(member.id);
    await domain.users.setActive(member.id, false);
    expect(await domain.auth.authenticate(session.token)).toBeNull();

    // The sole admin cannot be deactivated.
    await expect(domain.users.setActive(admin.id, false)).rejects.toMatchObject({
      code: 'last_admin',
    });
  });
});

describe('audit log', () => {
  it('records and pages events stably, even when they share a millisecond', async () => {
    for (let i = 0; i < 5; i++) {
      await domain.audit.record({
        action: 'user.login',
        actorId: admin.id,
        actorLabel: admin.name,
        metadata: { i },
      });
    }
    // Page through in batches of 2 and confirm every event appears exactly once.
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page = await domain.audit.list({ limit: 2, cursor });
      for (const e of page.events) seen.push((e.metadata as { i: number }).i);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
