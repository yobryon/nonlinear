import type {
  AiProvider,
  AiSettings,
  AiSettingsPublic,
  UpdateAiSettingsInput,
} from '@nonlinear/shared';
import type { Ctx } from '../domain.js';

/** Sensible default model per provider for cheap, fast BYO-key features. */
export const DEFAULT_AI_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
};

/**
 * Workspace AI configuration for the optional BYO-key features. This service
 * owns the *settings* only — storing them (with the API key server-side, never
 * synced) and projecting the key-free public view. The actual LLM HTTP calls
 * live in the API layer (`apps/api/src/llm.ts`), which reads `getSettings()`.
 */
export class AiService {
  constructor(private ctx: Ctx) {}

  async getSettings(): Promise<AiSettings | null> {
    return this.ctx.storage.aiSettings.get();
  }

  async getPublic(): Promise<AiSettingsPublic> {
    const s = await this.getSettings();
    return {
      enabled: s?.enabled ?? false,
      provider: s?.provider ?? 'anthropic',
      model: s?.model ?? DEFAULT_AI_MODEL.anthropic,
      hasKey: Boolean(s?.apiKey),
    };
  }

  /** True only when configured *and* a key is present — the gate for features. */
  async isReady(): Promise<boolean> {
    const s = await this.getSettings();
    return Boolean(s?.enabled && s.apiKey);
  }

  async update(input: UpdateAiSettingsInput): Promise<AiSettingsPublic> {
    const current = await this.getSettings();
    const provider = input.provider ?? current?.provider ?? 'anthropic';
    const next: AiSettings = {
      enabled: input.enabled ?? current?.enabled ?? false,
      provider,
      // A provider switch without an explicit model resets to that provider's default.
      model:
        input.model?.trim() ||
        (input.provider && input.provider !== current?.provider
          ? DEFAULT_AI_MODEL[provider]
          : current?.model) ||
        DEFAULT_AI_MODEL[provider],
      // Omitted apiKey keeps the stored one; empty string clears it.
      apiKey: input.apiKey !== undefined ? input.apiKey.trim() : (current?.apiKey ?? ''),
    };
    await this.ctx.storage.aiSettings.set(next);
    return this.getPublic();
  }
}
