import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings } from '@nonlinear/shared';
import { complete, LlmError } from './llm.js';

const ANTHROPIC: AiSettings = {
  enabled: true,
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  apiKey: 'sk-ant-test',
};
const OPENAI: AiSettings = {
  enabled: true,
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'sk-oa-test',
};

afterEach(() => vi.restoreAllMocks());

function mockFetch(response: unknown, ok = true, status = 200) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('llm client', () => {
  it('shapes the Anthropic Messages request and parses the reply', async () => {
    const spy = mockFetch({ content: [{ type: 'text', text: 'hello world' }] });
    const out = await complete(ANTHROPIC, 'be brief', 'say hi');
    expect(out).toBe('hello world');
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toContain('api.anthropic.com');
    const headers = init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBeTruthy();
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe(ANTHROPIC.model);
    expect(body.system).toBe('be brief');
    expect(body.messages).toEqual([{ role: 'user', content: 'say hi' }]);
  });

  it('shapes the OpenAI Chat Completions request and parses the reply', async () => {
    const spy = mockFetch({ choices: [{ message: { content: 'yo' } }] });
    const out = await complete(OPENAI, 'sys', 'usr');
    expect(out).toBe('yo');
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toContain('api.openai.com');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-oa-test');
    const body = JSON.parse(init!.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('raises an LlmError with the provider message on a non-2xx', async () => {
    mockFetch({ error: { message: 'invalid key' } }, false, 401);
    await expect(complete(ANTHROPIC, 's', 'u')).rejects.toBeInstanceOf(LlmError);
    await expect(complete(ANTHROPIC, 's', 'u')).rejects.toThrow(/invalid key/);
  });

  it('rejects when no API key is configured', async () => {
    await expect(complete({ ...ANTHROPIC, apiKey: '' }, 's', 'u')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('label suggestions', () => {
  it('maps model-returned names to label ids, skipping unknown and already-applied', async () => {
    // Stub the LLM to "return" two label names, one unknown.
    vi.doMock('./llm.js', () => ({
      LlmError,
      complete: vi.fn(async () => '["Bug", "Nonexistent", "Feature"]'),
    }));
    const { suggestLabels } = await import('./ai.js');
    const { createDomain, createMemoryStorage } = await import('@nonlinear/core');
    const domain = createDomain(createMemoryStorage());
    await domain.auth.register({
      email: 'a@b.com',
      password: 'hunter2hunter2',
      name: 'A',
      workspaceName: 'W',
    });
    const team = (await domain.ctx.storage.teams.all())[0]!;
    const bug = await domain.labels.create({ teamId: team.id, name: 'Bug', color: '#eb5757' });
    const feature = await domain.labels.create({
      teamId: team.id,
      name: 'Feature',
      color: '#5e6ad2',
    });
    const issue = await domain.issues.create((await domain.ctx.storage.users.all())[0]!.id, {
      teamId: team.id,
      title: 'Crash on save',
      labelIds: [feature.id], // Feature already applied → excluded
    });

    const out = await suggestLabels(domain, ANTHROPIC, issue.id);
    expect(out.map((s) => s.labelId)).toEqual([bug.id]);
    vi.doUnmock('./llm.js');
  });
});
