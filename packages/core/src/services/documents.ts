import type { CreateDocumentInput, Document, UpdateDocumentInput } from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, updated, type Ctx } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

import type { DocumentCommentService } from './docComments.js';

export class DocumentService {
  constructor(
    private ctx: Ctx,
    private cascades?: { docComments?: DocumentCommentService },
  ) {}

  async create(creatorId: string, input: CreateDocumentInput): Promise<Document> {
    const { storage, bus } = this.ctx;
    const title = input.title.trim();
    if (!title) throw new DomainError('invalid_title', 'Document title is required');
    if (input.projectId && !(await storage.projects.get(input.projectId))) {
      throw notFound('Project');
    }
    const now = nowIso();
    const document: Document = {
      id: newId(),
      title,
      content: input.content ?? '',
      projectId: input.projectId ?? null,
      creatorId,
      createdAt: now,
      updatedAt: now,
    };
    await storage.documents.insert(document);
    await bus.publish([created('document', document)]);
    return document;
  }

  async update(documentId: string, input: UpdateDocumentInput): Promise<Document> {
    const { storage, bus } = this.ctx;
    const document = await storage.documents.get(documentId);
    if (!document) throw notFound('Document');
    if (input.title !== undefined) document.title = input.title.trim() || document.title;
    if (input.content !== undefined) document.content = input.content;
    if (input.projectId !== undefined) {
      if (input.projectId && !(await storage.projects.get(input.projectId))) {
        throw notFound('Project');
      }
      document.projectId = input.projectId;
    }
    document.updatedAt = nowIso();
    await storage.documents.update(document);
    await bus.publish([updated('document', document)]);
    return document;
  }

  async remove(documentId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    if (!(await storage.documents.get(documentId))) throw notFound('Document');
    const deltas = this.cascades?.docComments
      ? await this.cascades.docComments.removeForDocument(documentId)
      : [];
    await storage.documents.delete(documentId);
    await bus.publish([...deltas, deleted('document', documentId)]);
  }
}
