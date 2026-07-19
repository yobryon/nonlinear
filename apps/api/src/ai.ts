import type { AiSettings, LabelSuggestion, PulseFeed } from '@nonlinear/shared';
import type { Domain } from '@nonlinear/core';
import { complete, LlmError } from './llm.js';

/**
 * AI feature orchestration over the BYO-key LLM client. Each function gathers
 * domain data, prompts the model, and parses the reply back into typed data —
 * keeping prompt-engineering out of the route handlers and the domain.
 */

/** Suggest labels for an issue from the team's existing label set. */
export async function suggestLabels(
  domain: Domain,
  settings: AiSettings,
  issueId: string,
): Promise<LabelSuggestion[]> {
  const issue = await domain.ctx.storage.issues.get(issueId);
  if (!issue) throw new LlmError('Issue not found', 404);
  const labels = (await domain.ctx.storage.labels.all()).filter(
    (l) => l.teamId === issue.teamId || l.teamId === null,
  );
  if (labels.length === 0) return [];

  const catalog = labels.map((l) => l.name);
  const system =
    'You label software issues. Choose only from the provided label list. ' +
    'Reply with a JSON array of the exact label names that apply (0 to 3 of them), nothing else.';
  const user =
    `Available labels: ${JSON.stringify(catalog)}\n\n` +
    `Issue title: ${issue.title}\n` +
    `Issue description: ${issue.description?.slice(0, 2000) || '(none)'}`;

  const reply = await complete(settings, system, user, { maxTokens: 200 });
  const names = parseStringArray(reply);
  const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l]));
  const seen = new Set<string>();
  const out: LabelSuggestion[] = [];
  for (const n of names) {
    const label = byName.get(n.trim().toLowerCase());
    if (label && !seen.has(label.id) && !issue.labelIds.includes(label.id)) {
      seen.add(label.id);
      out.push({ labelId: label.id, name: label.name });
    }
  }
  return out;
}

/** Summarize the Pulse feed into a short digest paragraph. */
export async function summarizePulse(settings: AiSettings, feed: PulseFeed): Promise<string> {
  if (feed.items.length === 0) return 'Nothing happened in the selected window.';
  const system =
    'You write a brief, upbeat status digest for a product team. 2–4 sentences, ' +
    'plain text, no bullet points, no preamble. Focus on what shipped and any risks.';
  const lines = feed.items
    .slice(0, 60)
    .map((i) => `- [${i.type}] ${i.title}${i.detail ? ` — ${i.detail}` : ''}`)
    .join('\n');
  const user = `Activity over the last ${feed.sinceDays} days:\n${lines}`;
  return complete(settings, system, user, { maxTokens: 400 });
}

/** Extract a JSON string array from a model reply, tolerating stray prose/fences. */
function parseStringArray(reply: string): string[] {
  const match = reply.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
