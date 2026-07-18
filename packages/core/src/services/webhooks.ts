import type { SyncDelta, Webhook } from '@nonlinear/shared';
import { DomainError, created, deleted, notFound, updated, type Ctx } from '../domain.js';
import { newId, newToken } from '../util/ids.js';
import { nowIso } from '../util/time.js';

/** Models whose deltas are forwarded to outbound webhooks. */
const FORWARDED_MODELS = new Set(['issue', 'comment', 'project']);

export class WebhookService {
  constructor(private ctx: Ctx) {}

  async create(
    creatorId: string,
    url: string,
    format: 'json' | 'slack' = 'json',
    agentUserId: string | null = null,
  ): Promise<Webhook> {
    const { storage, bus } = this.ctx;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new DomainError('invalid_url', 'Webhook URL is not valid');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new DomainError('invalid_url', 'Webhook URL must be http(s)');
    }
    if (agentUserId) {
      const agent = await storage.users.get(agentUserId);
      if (!agent) throw notFound('Agent');
    }
    const webhook: Webhook = {
      id: newId(),
      url: parsed.toString(),
      secret: newToken(),
      format,
      agentUserId,
      enabled: true,
      creatorId,
      createdAt: nowIso(),
    };
    await storage.webhooks.insert(webhook);
    await bus.publish([created('webhook', webhook)]);
    return webhook;
  }

  async setEnabled(webhookId: string, enabled: boolean): Promise<Webhook> {
    const { storage, bus } = this.ctx;
    const webhook = await storage.webhooks.get(webhookId);
    if (!webhook) throw notFound('Webhook');
    webhook.enabled = enabled;
    await storage.webhooks.update(webhook);
    await bus.publish([updated('webhook', webhook)]);
    return webhook;
  }

  async remove(webhookId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    if (!(await storage.webhooks.get(webhookId))) throw notFound('Webhook');
    await storage.webhooks.delete(webhookId);
    await bus.publish([deleted('webhook', webhookId)]);
  }

  /**
   * Subscribe to the sync bus and forward issue/comment/project events to
   * every enabled webhook. Fire-and-forget with a timeout; failures are
   * logged via the provided logger and never block mutations.
   */
  startDispatcher(log: (message: string) => void = () => {}): () => void {
    return this.ctx.bus.subscribe((deltas) => {
      const forwarded = deltas.filter((d) => FORWARDED_MODELS.has(d.model));
      if (forwarded.length === 0) return;
      void this.dispatch(forwarded, log);
    });
  }

  /**
   * True when a delta is "about" the agent: the issue is assigned to them, an
   * issue's subscribers include them, or a comment @mentions their handle.
   * This is the trigger half of the assign/mention → agent loop.
   */
  private async involvesAgent(delta: SyncDelta, agentId: string): Promise<boolean> {
    if (delta.action === 'delete') return false;
    if (delta.model === 'issue') {
      const issue = delta.data as { assigneeId?: string | null; subscriberIds?: string[] };
      return issue.assigneeId === agentId || (issue.subscriberIds ?? []).includes(agentId);
    }
    if (delta.model === 'comment') {
      const comment = delta.data as { body?: string };
      const agent = await this.ctx.storage.users.get(agentId);
      if (!agent) return false;
      const handle = agent.displayName.toLowerCase();
      const body = (comment.body ?? '').toLowerCase();
      return new RegExp(`(^|[^\\w])@${handle}(?![\\w.-])`).test(body);
    }
    return false;
  }

  private async scopeDeltas(
    webhook: { agentUserId: string | null },
    deltas: SyncDelta[],
  ): Promise<SyncDelta[]> {
    if (!webhook.agentUserId) return deltas;
    const kept: SyncDelta[] = [];
    for (const d of deltas) {
      if (await this.involvesAgent(d, webhook.agentUserId)) kept.push(d);
    }
    return kept;
  }

  private async dispatch(deltas: SyncDelta[], log: (message: string) => void): Promise<void> {
    const webhooks = (await this.ctx.storage.webhooks.all()).filter((w) => w.enabled);
    await Promise.all(
      webhooks.map(async (webhook) => {
        const scoped = await this.scopeDeltas(webhook, deltas);
        if (scoped.length === 0) return;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-nonlinear-secret': webhook.secret,
            },
            body: JSON.stringify({ type: 'sync.deltas', deltas: scoped }),
            signal: controller.signal,
          });
          clearTimeout(timer);
        } catch (err) {
          log(`webhook ${webhook.url} failed: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
  }
}
