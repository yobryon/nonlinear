import { beforeEach, describe, expect, it } from 'vitest';
import { createDomain, type Domain } from './index.js';
import { createMemoryStorage } from './memory.js';
import type { User } from '@nonlinear/shared';

let domain: Domain;
let admin: User;
let plank: User; // parent agent
let plankArch: User; // plank.agent.arch
let vantage: User;
let vantageArch: User;

const root = (u: User) => u.parentAgentId ?? u.id;

beforeEach(async () => {
  domain = createDomain(createMemoryStorage());
  admin = (
    await domain.auth.register({
      email: 'ada@example.com',
      password: 'hunter2hunter2',
      name: 'Ada',
      workspaceName: 'Acme',
    })
  ).user;
  plank = await domain.auth.createAgent({ name: 'plank-agent' });
  vantage = await domain.auth.createAgent({ name: 'vantage-agent' });
  // Both families run an `arch` persona (name collides; handles differ).
  plankArch = await domain.auth.findOrProvisionAgentPersona(plank, 'arch');
  vantageArch = await domain.auth.findOrProvisionAgentPersona(vantage, 'arch');
});

describe('resolvePerson — parentage is a namespace', () => {
  it('a bare name resolves within the caller family, not another family', async () => {
    // plank's own agent addressing "arch" → plank.agent.arch.
    expect(await domain.users.resolvePerson('arch', root(plank))).toBe(plankArch.id);
    // plank's persona (a sibling) addressing "arch" → the same.
    expect(await domain.users.resolvePerson('arch', root(plankArch))).toBe(plankArch.id);
    // vantage's side resolves to vantage's arch.
    expect(await domain.users.resolvePerson('arch', root(vantage))).toBe(vantageArch.id);
  });

  it('refuses a bare name that only exists in ANOTHER family', async () => {
    // The admin (no family arch) cannot blindly reach a persona by bare name.
    await expect(domain.users.resolvePerson('arch', root(admin))).rejects.toThrow(/full handle/);
  });

  it('reaches another family only by the qualified handle', async () => {
    expect(await domain.users.resolvePerson(vantageArch.displayName, root(plank))).toBe(
      vantageArch.id,
    );
  });

  it('resolves non-namespaced users (humans / top-level agents) by short name for anyone', async () => {
    expect(await domain.users.resolvePerson('Ada', root(plank))).toBe(admin.id);
    expect(await domain.users.resolvePerson('vantage-agent', root(plank))).toBe(vantage.id);
  });

  it('resolves by email and rejects an unknown reference', async () => {
    expect(await domain.users.resolvePerson('ada@example.com', root(vantage))).toBe(admin.id);
    await expect(domain.users.resolvePerson('nobody', root(admin))).rejects.toThrow(/Unknown/);
  });
});
