import { beforeEach, describe, expect, it } from 'vitest';
import type { Document, User } from '@nonlinear/shared';
import { createMemoryStorage } from '../memory.js';
import { SyncBus, type Ctx } from '../domain.js';
import { AuthService } from './auth.js';
import { DocumentService } from './documents.js';
import { DocumentCommentService } from './docComments.js';

let ctx: Ctx;
let service: DocumentCommentService;
let admin: User;
let member: User;
let doc: Document;

beforeEach(async () => {
  const storage = createMemoryStorage();
  const bus = new SyncBus(storage.syncLog);
  ctx = { storage, bus };
  service = new DocumentCommentService(ctx);

  const auth = new AuthService(ctx);
  admin = (
    await auth.register({
      email: 'ada@example.com',
      password: 'hunter2hunter2',
      name: 'Ada Lovelace',
      workspaceName: 'Acme',
    })
  ).user;
  member = (
    await auth.register({
      email: 'grace@example.com',
      password: 'hunter2hunter2',
      name: 'Grace Hopper',
    })
  ).user;

  const documents = new DocumentService(ctx);
  doc = await documents.create(admin.id, { title: 'Spec', content: 'Hello world' });
});

describe('DocumentCommentService.create', () => {
  it('creates a comment and truncates long anchor text to 500 chars', async () => {
    const longAnchor = `  ${'x'.repeat(600)}  `;
    const comment = await service.create(admin.id, {
      documentId: doc.id,
      body: '  Looks good  ',
      anchorText: longAnchor,
    });
    expect(comment.body).toBe('Looks good');
    expect(comment.authorId).toBe(admin.id);
    expect(comment.anchorText).toHaveLength(500);
    expect(comment.anchorText).toBe('x'.repeat(500));
    expect(comment.resolvedAt).toBeNull();
    expect(await ctx.storage.documentComments.get(comment.id)).toEqual(comment);
  });

  it('normalizes missing or blank anchor text to null', async () => {
    const noAnchor = await service.create(admin.id, { documentId: doc.id, body: 'Hi' });
    expect(noAnchor.anchorText).toBeNull();
    const blankAnchor = await service.create(admin.id, {
      documentId: doc.id,
      body: 'Hi again',
      anchorText: '   ',
    });
    expect(blankAnchor.anchorText).toBeNull();
  });

  it('rejects a missing document and an empty body', async () => {
    await expect(service.create(admin.id, { documentId: 'nope', body: 'Hi' })).rejects.toThrow(
      /not found/i,
    );
    await expect(service.create(admin.id, { documentId: doc.id, body: '   ' })).rejects.toThrow(
      /required/i,
    );
  });
});

describe('DocumentCommentService.update', () => {
  it('lets any user toggle resolved, setting and clearing resolvedAt', async () => {
    const comment = await service.create(admin.id, { documentId: doc.id, body: 'Fix this' });
    const resolved = await service.update(member.id, comment.id, { resolved: true });
    expect(resolved.resolvedAt).not.toBeNull();
    const reopened = await service.update(member.id, comment.id, { resolved: false });
    expect(reopened.resolvedAt).toBeNull();
  });

  it('rejects body edits by anyone but the author', async () => {
    const comment = await service.create(admin.id, { documentId: doc.id, body: 'Original' });
    await expect(service.update(member.id, comment.id, { body: 'Hijacked' })).rejects.toThrow(
      /own comments/i,
    );
    const edited = await service.update(admin.id, comment.id, { body: 'Revised' });
    expect(edited.body).toBe('Revised');
  });
});

describe('DocumentCommentService.remove', () => {
  it('allows the author and admins, rejects other users', async () => {
    const adminComment = await service.create(admin.id, { documentId: doc.id, body: 'Mine' });
    await expect(service.remove(member.id, adminComment.id)).rejects.toThrow(/own comments/i);

    const memberComment = await service.create(member.id, { documentId: doc.id, body: 'Theirs' });
    await service.remove(admin.id, memberComment.id);
    expect(await ctx.storage.documentComments.get(memberComment.id)).toBeNull();

    await service.remove(admin.id, adminComment.id);
    expect(await ctx.storage.documentComments.get(adminComment.id)).toBeNull();
  });
});

describe('DocumentCommentService.removeForDocument', () => {
  it("deletes only that document's comments and returns unpublished deltas", async () => {
    const documents = new DocumentService(ctx);
    const other = await documents.create(admin.id, { title: 'Other' });
    const a = await service.create(admin.id, { documentId: doc.id, body: 'A' });
    const b = await service.create(member.id, { documentId: doc.id, body: 'B' });
    const keep = await service.create(admin.id, { documentId: other.id, body: 'Keep' });

    const before = await ctx.storage.syncLog.currentSyncId();
    const deltas = await service.removeForDocument(doc.id);

    expect(deltas).toHaveLength(2);
    expect(deltas.map((d) => d.action)).toEqual(['delete', 'delete']);
    expect(deltas.map((d) => d.model)).toEqual(['documentComment', 'documentComment']);
    expect(new Set(deltas.map((d) => (d.data as { id: string }).id))).toEqual(
      new Set([a.id, b.id]),
    );

    expect(await ctx.storage.documentComments.get(a.id)).toBeNull();
    expect(await ctx.storage.documentComments.get(b.id)).toBeNull();
    expect(await ctx.storage.documentComments.get(keep.id)).toEqual(keep);

    // Nothing was published — the integrator does that.
    expect(await ctx.storage.syncLog.currentSyncId()).toBe(before);
  });
});
