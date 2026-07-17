import type {
  CreateDocumentCommentInput,
  DocumentComment,
  UpdateDocumentCommentInput,
} from '@nonlinear/shared';
import {
  DomainError,
  created,
  deleted,
  notFound,
  updated,
  type Ctx,
  type DeltaInput,
} from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

const MAX_ANCHOR_LENGTH = 500;

export class DocumentCommentService {
  constructor(private ctx: Ctx) {}

  async create(authorId: string, input: CreateDocumentCommentInput): Promise<DocumentComment> {
    const { storage, bus } = this.ctx;
    const document = await storage.documents.get(input.documentId);
    if (!document) throw notFound('Document');
    const body = input.body.trim();
    if (!body) throw new DomainError('empty_comment', 'Comment body is required');
    const trimmedAnchor = input.anchorText?.trim() ?? '';
    const anchorText = trimmedAnchor ? trimmedAnchor.slice(0, MAX_ANCHOR_LENGTH) : null;

    const now = nowIso();
    const comment: DocumentComment = {
      id: newId(),
      documentId: document.id,
      authorId,
      body,
      anchorText,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await storage.documentComments.insert(comment);
    await bus.publish([created('documentComment', comment)]);
    return comment;
  }

  async update(
    actorId: string,
    commentId: string,
    input: UpdateDocumentCommentInput,
  ): Promise<DocumentComment> {
    const { storage, bus } = this.ctx;
    const comment = await storage.documentComments.get(commentId);
    if (!comment) throw notFound('Document comment');
    if (input.body !== undefined) {
      if (comment.authorId !== actorId) {
        throw new DomainError('forbidden', 'You can only edit your own comments', 403);
      }
      const body = input.body.trim();
      if (!body) throw new DomainError('empty_comment', 'Comment body is required');
      comment.body = body;
    }
    if (input.resolved !== undefined) {
      comment.resolvedAt = input.resolved ? nowIso() : null;
    }
    comment.updatedAt = nowIso();
    await storage.documentComments.update(comment);
    await bus.publish([updated('documentComment', comment)]);
    return comment;
  }

  async remove(actorId: string, commentId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const comment = await storage.documentComments.get(commentId);
    if (!comment) throw notFound('Document comment');
    const actor = await storage.users.get(actorId);
    if (comment.authorId !== actorId && actor?.role !== 'admin') {
      throw new DomainError('forbidden', 'You can only delete your own comments', 403);
    }
    await storage.documentComments.delete(commentId);
    await bus.publish([deleted('documentComment', commentId)]);
  }

  /**
   * Delete every comment on a document and return the deltas WITHOUT
   * publishing them; the caller folds these into its own publish (used by
   * the document-delete cascade).
   */
  async removeForDocument(documentId: string): Promise<DeltaInput[]> {
    const { storage } = this.ctx;
    const deltas: DeltaInput[] = [];
    for (const comment of await storage.documentComments.all()) {
      if (comment.documentId !== documentId) continue;
      await storage.documentComments.delete(comment.id);
      deltas.push(deleted('documentComment', comment.id));
    }
    return deltas;
  }
}
