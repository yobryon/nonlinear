import type { AiSettings } from '@nonlinear/shared';

/**
 * Minimal BYO-key LLM client. A protocol adapter (like sso/scim/digest): the
 * domain owns AI *settings*, this owns the HTTP call to whichever provider the
 * workspace configured. Supports the Anthropic Messages API and the OpenAI
 * Chat Completions API (and OpenAI-compatible gateways).
 */

const ENDPOINTS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
} as const;

export class LlmError extends Error {
  readonly code = 'ai_error';
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
  }
}

export async function complete(
  settings: AiSettings,
  system: string,
  user: string,
  opts: { maxTokens?: number } = {},
): Promise<string> {
  if (!settings.apiKey) throw new LlmError('No API key configured', 400);
  const maxTokens = opts.maxTokens ?? 1024;
  const timeout = AbortSignal.timeout(30_000);

  if (settings.provider === 'anthropic') {
    const res = await fetch(ENDPOINTS.anthropic, {
      method: 'POST',
      signal: timeout,
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new LlmError(await providerError(res));
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();
  }

  // OpenAI / compatible.
  const res = await fetch(ENDPOINTS.openai, {
    method: 'POST',
    signal: timeout,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new LlmError(await providerError(res));
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

async function providerError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    /* non-JSON error body */
  }
  return `AI provider error (${res.status})${detail ? `: ${detail}` : ''}`;
}
