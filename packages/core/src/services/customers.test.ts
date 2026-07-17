import { beforeEach, describe, expect, it } from 'vitest';
import type { Issue, Team, User } from '@nonlinear/shared';
import { SyncBus, type Ctx } from '../domain.js';
import { createMemoryStorage } from '../memory.js';
import { AuthService } from './auth.js';
import { IssueService } from './issues.js';
import { CustomerRequestService, CustomerService } from './customers.js';

let ctx: Ctx;
let customers: CustomerService;
let requests: CustomerRequestService;
let admin: User;
let team: Team;
let issue: Issue;

beforeEach(async () => {
  const storage = createMemoryStorage();
  const bus = new SyncBus(storage.syncLog);
  ctx = { storage, bus };
  customers = new CustomerService(ctx);
  requests = new CustomerRequestService(ctx);

  const auth = new AuthService(ctx);
  const result = await auth.register({
    email: 'ada@example.com',
    password: 'hunter2hunter2',
    name: 'Ada Lovelace',
    workspaceName: 'Acme',
  });
  admin = result.user;
  team = (await storage.teams.all())[0]!;
  issue = await new IssueService(ctx).create(admin.id, { teamId: team.id, title: 'Linked' });
});

describe('CustomerService', () => {
  it('creates customers and rejects duplicate names case-insensitively', async () => {
    const customer = await customers.create({ name: 'Acme Corp', tier: 'Enterprise' });
    expect(customer.name).toBe('Acme Corp');
    expect(customer.tier).toBe('Enterprise');
    expect(customer.domain).toBeNull();

    await expect(customers.create({ name: 'ACME CORP' })).rejects.toMatchObject({
      code: 'customer_exists',
      status: 409,
    });
    await expect(customers.create({ name: '  ' })).rejects.toThrow(/required/i);
  });

  it('normalizes domains and matches email domains case-insensitively', async () => {
    const customer = await customers.create({ name: 'Acme', domain: '@ACME.com' });
    expect(customer.domain).toBe('acme.com');

    expect(await customers.findByEmailDomain('Foo@ACME.com')).toMatchObject({ id: customer.id });
    expect(await customers.findByEmailDomain('foo@other.com')).toBeNull();
    expect(await customers.findByEmailDomain('not-an-email')).toBeNull();
  });

  it('updates fields and re-normalizes the domain', async () => {
    const customer = await customers.create({ name: 'Acme', domain: 'acme.com' });
    const upd = await customers.update(customer.id, { domain: '@Widgets.IO', revenue: 5000 });
    expect(upd.domain).toBe('widgets.io');
    expect(upd.revenue).toBe(5000);
    await expect(customers.update('nope', { name: 'X' })).rejects.toThrow(/not found/i);
  });

  it('cascades customer removal to its requests and publishes their deltas', async () => {
    const customer = await customers.create({ name: 'Acme' });
    const other = await customers.create({ name: 'Globex' });
    const r1 = await requests.create({ customerId: customer.id, body: 'Need SSO' });
    const r2 = await requests.create({ customerId: customer.id, body: 'Need audit logs' });
    const kept = await requests.create({ customerId: other.id, body: 'Unrelated' });

    const published: { model: string; action: string; id: string }[] = [];
    ctx.bus.subscribe((deltas) => {
      for (const d of deltas) {
        published.push({ model: d.model, action: d.action, id: (d.data as { id: string }).id });
      }
    });

    await customers.remove(customer.id);

    expect(await ctx.storage.customers.get(customer.id)).toBeNull();
    expect(await ctx.storage.customerRequests.get(r1.id)).toBeNull();
    expect(await ctx.storage.customerRequests.get(r2.id)).toBeNull();
    expect(await ctx.storage.customerRequests.get(kept.id)).not.toBeNull();

    expect(published).toContainEqual({ model: 'customerRequest', action: 'delete', id: r1.id });
    expect(published).toContainEqual({ model: 'customerRequest', action: 'delete', id: r2.id });
    expect(published).toContainEqual({ model: 'customer', action: 'delete', id: customer.id });
  });
});

describe('CustomerRequestService', () => {
  it('validates references and defaults source to manual', async () => {
    const customer = await customers.create({ name: 'Acme' });
    await expect(requests.create({ customerId: 'nope', body: 'x' })).rejects.toThrow(/not found/i);
    await expect(
      requests.create({ customerId: customer.id, body: 'x', issueId: 'nope' }),
    ).rejects.toThrow(/not found/i);
    await expect(
      requests.create({ customerId: customer.id, body: 'x', projectId: 'nope' }),
    ).rejects.toThrow(/not found/i);
    await expect(requests.create({ customerId: customer.id, body: '  ' })).rejects.toThrow(
      /required/i,
    );

    const request = await requests.create({
      customerId: customer.id,
      body: '  Need SSO  ',
      issueId: issue.id,
    });
    expect(request.body).toBe('Need SSO');
    expect(request.source).toBe('manual');
    expect(request.issueId).toBe(issue.id);
    expect(request.projectId).toBeNull();
  });

  it('updates body and links with validation, and removes requests', async () => {
    const customer = await customers.create({ name: 'Acme' });
    const request = await requests.create({ customerId: customer.id, body: 'v1' });

    const upd = await requests.update(request.id, { body: 'v2', issueId: issue.id });
    expect(upd.body).toBe('v2');
    expect(upd.issueId).toBe(issue.id);

    await expect(requests.update(request.id, { body: ' ' })).rejects.toThrow(/required/i);
    await expect(requests.update(request.id, { issueId: 'nope' })).rejects.toThrow(/not found/i);

    const cleared = await requests.update(request.id, { issueId: null });
    expect(cleared.issueId).toBeNull();

    await requests.remove(request.id);
    expect(await ctx.storage.customerRequests.get(request.id)).toBeNull();
    await expect(requests.remove(request.id)).rejects.toThrow(/not found/i);
  });

  it('detachIssue nulls issue links, returns deltas, and does not publish', async () => {
    const customer = await customers.create({ name: 'Acme' });
    const linked1 = await requests.create({
      customerId: customer.id,
      body: 'a',
      issueId: issue.id,
    });
    const linked2 = await requests.create({
      customerId: customer.id,
      body: 'b',
      issueId: issue.id,
    });
    const unlinked = await requests.create({ customerId: customer.id, body: 'c' });

    const before = await ctx.storage.syncLog.currentSyncId();
    let fanout = 0;
    ctx.bus.subscribe(() => {
      fanout += 1;
    });

    const deltas = await requests.detachIssue(issue.id);

    expect(deltas).toHaveLength(2);
    const ids = deltas.map((d) => (d.data as { id: string }).id).sort();
    expect(ids).toEqual([linked1.id, linked2.id].sort());
    for (const d of deltas) {
      expect(d.model).toBe('customerRequest');
      expect(d.action).toBe('update');
      expect((d.data as { issueId: string | null }).issueId).toBeNull();
    }

    expect((await ctx.storage.customerRequests.get(linked1.id))!.issueId).toBeNull();
    expect((await ctx.storage.customerRequests.get(linked2.id))!.issueId).toBeNull();
    expect((await ctx.storage.customerRequests.get(unlinked.id))!.issueId).toBeNull();

    // Nothing was published: sync log unchanged, no listener fanout.
    expect(await ctx.storage.syncLog.currentSyncId()).toBe(before);
    expect(fanout).toBe(0);
  });
});
