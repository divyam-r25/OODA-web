import type { Config } from '../config.ts';
import { aiStatus, isOpenRouterFreeModel, normalizeOpenRouterModel } from '../config.ts';

export type AiErrorCode = 'unconfigured' | 'timeout' | 'network' | 'http' | 'empty' | 'quota_exhausted' | 'auth_error';

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string, public retryable: boolean) {
    super(message);
  }
}

export type AiRole = 'analyst' | 'strategist' | 'critic' | 'synthesizer';

export interface AiClient {
  provider: string;
  model: string;
  configured: boolean;
  workflow: 'single' | 'multi_agent';
  generate(system: string, user: string, role?: AiRole): Promise<string>;
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  providerLabel = 'AI provider',
): Promise<unknown> {
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
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AiError('timeout', `The ${providerLabel} took too long to respond (timeout after ${Math.round(timeoutMs / 1000)}s).`, true);
    }
    const causeMsg = (e as Error).cause ? String(((e as Error).cause as Error).message) : (e as Error).message;
    throw new AiError('network', `Could not reach ${providerLabel} (${causeMsg}).`, true);
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 400);

    // Authentication failure
    if (res.status === 401) {
      throw new AiError('auth_error', `Authentication failed for ${providerLabel}. Please check your API key.`, false);
    }

    // Quota or rate limit exhaustion (429, 402, or quota messages)
    if (res.status === 429 || res.status === 402 || /quota|credit|rate[- ]limit|exhaust/i.test(text)) {
      throw new AiError(
        'quota_exhausted',
        `${providerLabel} free quota or rate limit reached. Evidence has been preserved. Please wait a few moments before retrying.`,
        false, // Crucial: quota exhaustion is NOT retryable automatically to avoid spamming
      );
    }

    // Model not found in Ollama (404)
    if (res.status === 404 && /model.*not found/i.test(text)) {
      throw new AiError('unconfigured', `${providerLabel} error: ${text}. Try pulling the model first with 'ollama pull <model>'.`, false);
    }

    const retryable = res.status >= 500;
    throw new AiError('http', `${providerLabel} returned ${res.status}${text ? `: ${text}` : ''}`, retryable);
  }

  return res.json();
}

export function createAiClient(config: Config): AiClient {
  const a = config.ai;
  const status = aiStatus(config);
  const workflow = a.workflow;

  if (!status.configured) {
    return {
      provider: status.provider,
      model: '',
      configured: false,
      workflow,
      async generate() {
        throw new AiError('unconfigured', status.problem ?? 'No AI provider configured.', false);
      },
    };
  }

  switch (a.provider) {
    case 'ollama': {
      const getOllamaModel = (role?: AiRole) => {
        if (role === 'analyst' && a.ollamaAnalystModel) return a.ollamaAnalystModel;
        if (role === 'strategist' && a.ollamaStrategistModel) return a.ollamaStrategistModel;
        if (role === 'critic' && a.ollamaCriticModel) return a.ollamaCriticModel;
        if (role === 'synthesizer' && a.ollamaSynthesisModel) return a.ollamaSynthesisModel;
        return a.ollamaModel;
      };

      return {
        provider: 'ollama',
        model: a.ollamaModel,
        configured: true,
        workflow,
        async generate(system, user, role) {
          const targetModel = getOllamaModel(role);
          const endpoint = `${a.ollamaBaseUrl.replace(/\/$/, '')}/api/chat`;
          try {
            const j = (await post(
              endpoint,
              a.ollamaProxyToken ? { Authorization: `Bearer ${a.ollamaProxyToken}` } : {},
              {
                model: targetModel,
                stream: false,
                format: 'json',
                options: { temperature: 0.2 },
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: user },
                ],
              },
              a.timeoutMs,
              'local Ollama',
            )) as { message?: { content?: string } };

            const out = j.message?.content;
            if (!out) throw new AiError('empty', 'Ollama returned an empty response.', true);
            return out;
          } catch (e) {
            if (e instanceof AiError && e.code === 'network') {
              const cloudNote = a.ollamaBaseUrl.includes('127.0.0.1')
                ? ' Note: If running on cloud hosting (like Render), 127.0.0.1 refers to the container, not your personal computer.'
                : '';
              throw new AiError(
                'network',
                `Cannot connect to local Ollama at ${a.ollamaBaseUrl}. Ensure Ollama is running ('ollama serve').${cloudNote}`,
                true,
              );
            }
            throw e;
          }
        },
      };
    }

    case 'openrouter_free': {
      const getOpenRouterModel = (role?: AiRole) => {
        let m = a.openrouterModel;
        if (role === 'analyst' && a.openrouterAnalystModel) m = a.openrouterAnalystModel;
        else if (role === 'strategist' && a.openrouterStrategistModel) m = a.openrouterStrategistModel;
        else if (role === 'critic' && a.openrouterCriticModel) m = a.openrouterCriticModel;
        else if (role === 'synthesizer' && a.openrouterSynthesisModel) m = a.openrouterSynthesisModel;

        if (!isOpenRouterFreeModel(m)) {
          throw new AiError(
            'unconfigured',
            `Rejected non-free model "${m}". OpenRouter Free provider only allows models ending in ':free' (or 'openrouter/free') to prevent accidental billing.`,
            false,
          );
        }
        return normalizeOpenRouterModel(m);
      };

      return {
        provider: 'openrouter_free',
        model: normalizeOpenRouterModel(a.openrouterModel),
        configured: true,
        workflow,
        async generate(system, user, role) {
          const targetModel = getOpenRouterModel(role);
          const url = `${a.openrouterBaseUrl.replace(/\/$/, '')}/chat/completions`;
          // Headers: server-side only, never logged
          const headers: Record<string, string> = {
            Authorization: `Bearer ${a.openrouterApiKey}`,
            'HTTP-Referer': 'https://github.com/divyam-r25/OODA-web',
            'X-Title': 'OODA Competitive Intelligence',
          };
          const base = {
            model: targetModel,
            temperature: 0.2,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          };

          let j: { choices?: { message?: { content?: string } }[] };
          try {
            // First attempt with json_object response format
            j = (await post(url, headers, { ...base, response_format: { type: 'json_object' } }, a.timeoutMs, 'OpenRouter Free')) as typeof j;
          } catch (e) {
            // Some free models on OpenRouter do not support response_format; fallback once without it
            if (e instanceof AiError && e.code === 'http' && /response_format|json_object/i.test(e.message)) {
              j = (await post(url, headers, base, a.timeoutMs, 'OpenRouter Free')) as typeof j;
            } else {
              throw e;
            }
          }

          const out = j.choices?.[0]?.message?.content;
          if (!out) throw new AiError('empty', 'OpenRouter Free returned an empty response.', true);
          return out;
        },
      };
    }

    case 'openai':
      return {
        provider: 'openai',
        model: a.openaiModel,
        configured: true,
        workflow,
        async generate(system, user) {
          const url = `${a.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`;
          const headers = { Authorization: `Bearer ${a.openaiApiKey}` };
          const base = { model: a.openaiModel, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
          let j: { choices?: { message?: { content?: string } }[] };
          try {
            j = (await post(url, headers, { ...base, response_format: { type: 'json_object' } }, a.timeoutMs, 'OpenAI')) as typeof j;
          } catch (e) {
            if (e instanceof AiError && e.code === 'http' && /response_format/i.test(e.message)) {
              j = (await post(url, headers, base, a.timeoutMs, 'OpenAI')) as typeof j;
            } else throw e;
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
        workflow,
        async generate(system, user) {
          const j = (await post(
            `${a.anthropicBaseUrl.replace(/\/$/, '')}/v1/messages`,
            { 'x-api-key': a.anthropicApiKey, 'anthropic-version': '2023-06-01' },
            { model: a.anthropicModel, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] },
            a.timeoutMs,
            'Anthropic',
          )) as { content?: { type: string; text?: string }[] };
          const out = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
          if (!out) throw new AiError('empty', 'The AI provider returned an empty response.', true);
          return out;
        },
      };

    case 'mock':
      return {
        provider: 'mock',
        model: 'deterministic-test-provider',
        configured: true,
        workflow,
        async generate(system, user, role) {
          const { mockAnalyst } = await import('./mock.ts');
          return mockAnalyst(system, user, role);
        },
      };

    default:
      throw new Error('unreachable');
  }
}

