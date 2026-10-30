import type { Config } from '../config.ts';
import { aiStatus } from '../config.ts';

export class AiError extends Error {
  constructor(public code: 'unconfigured' | 'timeout' | 'network' | 'http' | 'empty', message: string, public retryable: boolean) {
    super(message);
  }
}

export interface AiClient {
  provider: string;
  model: string;
  configured: boolean;
  generate(system: string, user: string): Promise<string>;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout', 'The AI provider took too long to respond.', true);
    throw new AiError('network', `Could not reach the AI provider (${(e as Error).cause ? String(((e as Error).cause as Error).message) : (e as Error).message}).`, true);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    throw new AiError('http', `AI provider returned ${res.status}${text ? `: ${text}` : ''}`, retryable);
  }
  return res.json();
}

export function createAiClient(config: Config): AiClient {
  const a = config.ai;
  const status = aiStatus(config);
  if (!status.configured) {
    return {
      provider: status.provider,
      model: '',
      configured: false,
      async generate() {
        throw new AiError('unconfigured', status.problem ?? 'No AI provider configured.', false);
      },
    };
  }
  switch (a.provider) {
    case 'ollama':
      return {
        provider: 'ollama',
        model: a.ollamaModel,
        configured: true,
        async generate(system, user) {
          const j = (await post(
            `${a.ollamaBaseUrl.replace(/\/$/, '')}/api/chat`,
            {},
            { model: a.ollamaModel, stream: false, format: 'json', options: { temperature: 0.2 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
            a.timeoutMs,
          )) as { message?: { content?: string } };
          const out = j.message?.content;
          if (!out) throw new AiError('empty', 'The AI provider returned an empty response.', true);
          return out;
        },
      };
    case 'openai':
      return {
        provider: 'openai',
        model: a.openaiModel,
        configured: true,
        async generate(system, user) {
          const url = `${a.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`;
          const headers = { Authorization: `Bearer ${a.openaiApiKey}` };
          const base = { model: a.openaiModel, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
          let j: { choices?: { message?: { content?: string } }[] };
          try {
            j = (await post(url, headers, { ...base, response_format: { type: 'json_object' } }, a.timeoutMs)) as typeof j;
          } catch (e) {
            // Some OpenAI-compatible servers reject response_format; retry once without it.
            if (e instanceof AiError && e.code === 'http' && /response_format/i.test(e.message)) j = (await post(url, headers, base, a.timeoutMs)) as typeof j;
            else throw e;
          }
          const out = j.choices?.[0]?.message?.content;
          if (!out) throw new AiError('empty', 'The AI provider returned an empty response.', true);
          return out;
        },
      };
    case 'anthropic':
      return {
        provider: 'anthropic',
        model: a.anthropicModel,
        configured: true,
        async generate(system, user) {
          const j = (await post(
            `${a.anthropicBaseUrl.replace(/\/$/, '')}/v1/messages`,
            { 'x-api-key': a.anthropicApiKey, 'anthropic-version': '2023-06-01' },
            { model: a.anthropicModel, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] },
            a.timeoutMs,
          )) as { content?: { type: string; text?: string }[] };
          const out = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
          if (!out) throw new AiError('empty', 'The AI provider returned an empty response.', true);
          return out;
        },
      };
    case 'mock': {
      return {
        provider: 'mock',
        model: 'deterministic-test-provider',
        configured: true,
        async generate(system, user) {
          const { mockAnalyst } = await import('./mock.ts');
          return mockAnalyst(system, user);
        },
      };
    }
    default:
      throw new Error('unreachable');
  }
}
