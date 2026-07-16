import type { Attachment } from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, type Ctx, type DeltaInput } from '../domain.js';
import type { BlobStore } from '../blob.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

const MAX_SIZE = 20 * 1024 * 1024; // 20 MiB

export class AttachmentService {
  constructor(
    private ctx: Ctx,
    private blobs: BlobStore,
  ) {}

  async create(
    uploaderId: string,
    issueId: string,
    file: { filename: string; contentType: string; data: Buffer },
  ): Promise<Attachment> {
    const { storage, bus } = this.ctx;
    if (!(await storage.issues.get(issueId))) throw notFound('Issue');
    if (file.data.length === 0) throw new DomainError('empty_file', 'File is empty');
    if (file.data.length > MAX_SIZE) {
      throw new DomainError('file_too_large', 'Attachments are limited to 20 MB');
    }
    const attachment: Attachment = {
      id: newId(),
      issueId,
      uploaderId,
      filename: file.filename.slice(0, 255) || 'file',
      contentType: file.contentType || 'application/octet-stream',
      size: file.data.length,
      createdAt: nowIso(),
    };
    await this.blobs.put(attachment.id, file.data, attachment.contentType);
    await storage.attachments.insert(attachment);
    await bus.publish([created('attachment', attachment)]);
    return attachment;
  }

  async content(attachmentId: string): Promise<{
    attachment: Attachment;
    data: Buffer;
  }> {
    const attachment = await this.ctx.storage.attachments.get(attachmentId);
    if (!attachment) throw notFound('Attachment');
    const blob = await this.blobs.get(attachmentId);
    if (!blob) throw notFound('Attachment content');
    return { attachment, data: blob.data };
  }

  async remove(attachmentId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const attachment = await storage.attachments.get(attachmentId);
    if (!attachment) throw notFound('Attachment');
    await this.blobs.delete(attachmentId);
    await storage.attachments.delete(attachmentId);
    await bus.publish([deleted('attachment', attachmentId)]);
  }

  /** Cascade for issue deletion; returns deltas for the caller to publish. */
  async removeForIssue(issueId: string): Promise<DeltaInput[]> {
    const { storage } = this.ctx;
    const deltas: DeltaInput[] = [];
    for (const attachment of await storage.attachments.all()) {
      if (attachment.issueId !== issueId) continue;
      await this.blobs.delete(attachment.id);
      await storage.attachments.delete(attachment.id);
      deltas.push(deleted('attachment', attachment.id));
    }
    return deltas;
  }
}
