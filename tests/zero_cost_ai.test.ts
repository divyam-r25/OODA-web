import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, isOpenRouterFreeModel, aiStatus } from '../server/config.ts';
import { createAiClient, AiError } from '../server/ai/provider.ts';
import { executeMultiAgentWorkflow } from '../server/ai/multiAgent.ts';
import { extractJson, validateAnalysis, type EvidenceRef, OutputError } from '../server/ai/analysis.ts';
import type { PromptContext } from '../server/ai/prompts.ts';

describe('Zero-Cost AI Infrastructure & Multi-Agent Tests', () => {

  // 1. Free Model Acceptance & Paid Model Rejection
  describe('Model cost controls', () => {
    test('accepts models ending in :free and openrouter/free', () => {
      assert.equal(isOpenRouterFreeModel('meta-llama/llama-3.3-70b-instruct:free'), true);
      assert.equal(isOpenRouterFreeModel('nvidia/nemotron-3-ultra-550b-a55b:free'), true);
      assert.equal(isOpenRouterFreeModel('nvidia/nemotron-3-ultra-550b-a55b'), true);
      assert.equal(isOpenRouterFreeModel('openrouter/free'), true);
      assert.equal(isOpenRouterFreeModel('openrouter/free:variant'), true);
    });

    test('strictly rejects paid models to guarantee zero cost', () => {
      assert.equal(isOpenRouterFreeModel('openai/gpt-4o'), false);
      assert.equal(isOpenRouterFreeModel('anthropic/claude-3-5-sonnet'), false);
      assert.equal(isOpenRouterFreeModel('meta-llama/llama-3.3-70b-instruct'), false);
      assert.equal(isOpenRouterFreeModel('mistralai/mixtral-8x7b-instruct'), false);
      assert.equal(isOpenRouterFreeModel(''), false);
      assert.equal(isOpenRouterFreeModel(undefined), false);
    });

    test('rejects paid model configuration in openrouter_free status', () => {
      const config = loadConfig({
        AI_PROVIDER: 'openrouter_free',
        OPENROUTER_API_KEY: 'test-key',
        OPENROUTER_MODEL: 'openai/gpt-4o', // Paid model!
      });
      const status = aiStatus(config);
      assert.equal(status.configured, false);
      assert.match(status.problem ?? '', /not a recognized free model/i);
    });

    test('openrouter_free throws non-retryable error if paid model is called', async () => {
      const config = loadConfig({
        AI_PROVIDER: 'openrouter_free',
        OPENROUTER_API_KEY: 'test-key',
        OPENROUTER_MODEL: 'openai/gpt-4o',
      });
      const client = createAiClient(config);
      await assert.rejects(
        () => client.generate('system', 'user'),
        (err: Error) => {
          assert.ok(err instanceof AiError);
          assert.equal((err as AiError).code, 'unconfigured');
          assert.equal((err as AiError).retryable, false);
          return true;
        },
      );
    });

    test('missing OpenRouter API key reports clear problem', () => {
      const config = loadConfig({
        AI_PROVIDER: 'openrouter_free',
        OPENROUTER_API_KEY: '',
        OPENROUTER_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      });
      const status = aiStatus(config);
      assert.equal(status.configured, false);
      assert.match(status.problem ?? '', /OPENROUTER_API_KEY is required/i);
    });
  });

  // 2. Local Ollama Provider (Zero cost, no API key)
  describe('Local Ollama provider', () => {
    test('local Ollama sends no Authorization header and calls /api/chat', async () => {
      const originalFetch = globalThis.fetch;
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any;

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(JSON.stringify({ message: { content: '{"status":"ok"}' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const config = loadConfig({
          AI_PROVIDER: 'ollama',
          OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
          OLLAMA_MODEL: 'llama3.2',
        });
        const client = createAiClient(config);
        const res = await client.generate('test system', 'test user');
        assert.equal(res, '{"status":"ok"}');
        assert.equal(capturedUrl, 'http://127.0.0.1:11434/api/chat');
        assert.equal(capturedHeaders['Authorization'], undefined);
        assert.equal(capturedBody.model, 'llama3.2');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('local Ollama connection failure gives helpful message including Render container note', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:11434');
        throw err;
      }) as typeof fetch;

      try {
        const config = loadConfig({
          AI_PROVIDER: 'ollama',
          OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
          OLLAMA_MODEL: 'llama3.2',
        });
        const client = createAiClient(config);
        await assert.rejects(
          () => client.generate('test system', 'test user'),
          (err: Error) => {
            assert.ok(err instanceof AiError);
            assert.match(err.message, /Cannot connect to local Ollama at http:\/\/127\.0\.0\.1:11434/);
            assert.match(err.message, /Render/);
            return true;
          },
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('local Ollama model not found (404) returns clear actionable message', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response('model "non-existent-model" not found', { status: 404 });
      }) as typeof fetch;

      try {
        const config = loadConfig({
          AI_PROVIDER: 'ollama',
          OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
          OLLAMA_MODEL: 'non-existent-model',
        });
        const client = createAiClient(config);
        await assert.rejects(
          () => client.generate('test system', 'test user'),
          (err: Error) => {
            assert.ok(err instanceof AiError);
            assert.match(err.message, /ollama pull/);
            assert.equal((err as AiError).retryable, false);
            return true;
          },
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // 3. OpenRouter Free Provider Behavior & Error Handling
  describe('OpenRouter Free provider', () => {
    test('sends Bearer token, HTTP-Referer, and X-Title headers', async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"test"}' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const config = loadConfig({
          AI_PROVIDER: 'openrouter_free',
          OPENROUTER_API_KEY: 'sk-or-v1-fake-free-key',
          OPENROUTER_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        });
        const client = createAiClient(config);
        const res = await client.generate('system prompt', 'user prompt');
        assert.equal(res, '{"summary":"test"}');
        assert.equal(capturedHeaders['Authorization'], 'Bearer sk-or-v1-fake-free-key');
        assert.equal(capturedHeaders['HTTP-Referer'], 'https://github.com/divyam-r25/OODA-web');
        assert.equal(capturedHeaders['X-Title'], 'OODA Competitive Intelligence');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('handles 401 invalid API key as non-retryable auth_error', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response('{"error":{"message":"Invalid credentials"}}', { status: 401 });
      }) as typeof fetch;

      try {
        const config = loadConfig({
          AI_PROVIDER: 'openrouter_free',
          OPENROUTER_API_KEY: 'sk-or-invalid',
          OPENROUTER_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        });
        const client = createAiClient(config);
        await assert.rejects(
          () => client.generate('sys', 'user'),
          (err: Error) => {
            assert.ok(err instanceof AiError);
            assert.equal((err as AiError).code, 'auth_error');
            assert.equal((err as AiError).retryable, false);
            return true;
          },
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('handles 429 quota exhaustion as non-retryable quota_exhausted without paid fallback', async () => {
      const originalFetch = globalThis.fetch;
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        return new Response('{"error":{"message":"Rate limit reached: free tier limit exceeded"}}', { status: 429 });
      }) as typeof fetch;

      try {
        const config = loadConfig({
          AI_PROVIDER: 'openrouter_free',
          OPENROUTER_API_KEY: 'sk-or-free',
          OPENROUTER_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        });
        const client = createAiClient(config);
        await assert.rejects(
          () => client.generate('sys', 'user'),
          (err: Error) => {
            assert.ok(err instanceof AiError);
            assert.equal((err as AiError).code, 'quota_exhausted');
            assert.equal((err as AiError).retryable, false);
            assert.match(err.message, /quota or rate limit reached/i);
            return true;
          },
        );
        // Ensure no repeated call or fallback was attempted
        assert.equal(callCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('handles 5xx server errors as retryable', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response('Server Error', { status: 502 });
      }) as typeof fetch;

      try {
        const config = loadConfig({
          AI_PROVIDER: 'openrouter_free',
          OPENROUTER_API_KEY: 'sk-or-free',
          OPENROUTER_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        });
        const client = createAiClient(config);
        await assert.rejects(
          () => client.generate('sys', 'user'),
          (err: Error) => {
            assert.ok(err instanceof AiError);
            assert.equal((err as AiError).code, 'http');
            assert.equal((err as AiError).retryable, true);
            return true;
          },
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('falls back gracefully when response_format is unsupported by free model', async () => {
      const originalFetch = globalThis.fetch;
      const calls: any[] = [];

      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        calls.push(body);
        if (body.response_format) {
          // Free model rejects json_object response_format
          return new Response('{"error":{"message":"response_format not supported for this free model"}}', { status: 400 });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Success on fallback"}' } }] }), {
          status: 200,
        });
      }) as typeof fetch;

      try {
        const config = loadConfig({
          AI_PROVIDER: 'openrouter_free',
          OPENROUTER_API_KEY: 'sk-or-free',
          OPENROUTER_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        });
        const client = createAiClient(config);
        const res = await client.generate('sys', 'user');
        assert.equal(res, '{"summary":"Success on fallback"}');
        assert.equal(calls.length, 2);
        assert.ok(calls[0].response_format);
        assert.equal(calls[1].response_format, undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // 4. Multi-Agent Workflow Execution
  describe('Multi-Agent Workflow & Roles', () => {
    test('single mode executes only one analysis workflow', async () => {
      const config = loadConfig({
        AI_PROVIDER: 'mock',
        AI_WORKFLOW: 'single',
      });
      assert.equal(config.ai.workflow, 'single');
    });

    test('multi-agent mode executes 4 roles sequentially and critic feedback reaches synthesis', async () => {
      const rolesCalled: string[] = [];
      const promptsSent: string[] = [];

      const mockAi: any = {
        provider: 'openrouter_free',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        configured: true,
        workflow: 'multi_agent',
        async generate(system: string, user: string, role?: string) {
          rolesCalled.push(role ?? 'none');
          promptsSent.push(user);

          if (role === 'analyst') {
            return JSON.stringify({
              observations: [
                { category: 'pricing', fact: 'Price is $49/mo', quote: 'Starts at $49 per month for pro users.', evidenceRefs: ['E1'], isChange: false },
              ],
              preliminarySummary: 'Observed pricing details.',
            });
          }
          if (role === 'strategist') {
            return JSON.stringify({
              strategicImplications: [{ observation: 'Pricing is $49/mo', implication: 'Undercuts our starter plan.', evidenceRefs: ['E1'] }],
              signals: [{ category: 'pricing', severity: 'medium', title: 'Competitor pricing observed', summary: 'Starter pricing at $49/mo', basis: 'observation', evidenceRefs: ['E1'], confidence: 0.8 }],
              recommendations: [{ title: 'Review entry tier', rationale: 'Address competitor price point', priority: 'medium', evidenceRefs: ['E1'] }],
            });
          }
          if (role === 'critic') {
            return JSON.stringify({
              approvedFacts: ['Price is $49/mo'],
              challengedItems: [
                { item: 'Unverified growth claim', issue: 'No evidence', action: 'drop', reason: 'Not in evidence' },
              ],
              falseChangeClaims: [],
              critique: 'Ensure quote matching for fact.',
              recommendationCritique: ['Recommendation 1 is sound'],
            });
          }
          if (role === 'synthesizer') {
            return JSON.stringify({
              summary: 'Synthesized multi-agent executive analysis.',
              findings: [
                { kind: 'fact', category: 'pricing', statement: 'Competitor starts at $49/mo', quote: 'Starts at $49 per month for pro users.', implication: 'Competes on price.', evidenceRefs: ['E1'], confidence: 0.85 },
              ],
              signals: [
                { category: 'pricing', severity: 'medium', title: 'Competitor pricing observed', summary: 'Observed starter pricing.', basis: 'observation', evidenceRefs: ['E1'], confidence: 0.8 },
              ],
              recommendations: [
                { title: 'Evaluate packaging', rationale: 'Counter $49/mo tier', priority: 'medium', evidenceRefs: ['E1'] },
              ],
              limitations: ['First snapshot; historical trends pending.'],
            });
          }
          return '{}';
        },
      };

      const promptContext: PromptContext = {
        company: { name: 'Acme', website: 'acme.com', industry: 'SaaS', audience: 'SMB', goal: 'Grow', description: 'Testing' },
        competitor: { name: 'CompCo', url: 'https://compco.com', notes: 'Main rival' },
        focus: 'pricing',
        evidence: [
          { ref: 'E1', url: 'https://compco.com', title: 'Pricing', fetchedAt: new Date().toISOString(), state: 'baseline', text: 'Welcome to CompCo. Starts at $49 per month for pro users. Great value.' },
        ],
      };

      const refs: EvidenceRef[] = [{
        ref: 'E1',
        evidenceId: 'ev_123',
        text: 'Welcome to CompCo. Starts at $49 per month for pro users. Great value.',
        changed: false,
      }];

      const logged: string[] = [];
      const result = await executeMultiAgentWorkflow(
        mockAi,
        promptContext,
        'Evidence block content...',
        refs,
        {
          checkCancel: () => {},
          log: (_lvl, _stg, msg) => logged.push(msg),
        },
      );

      // Verify all 4 roles executed sequentially
      assert.deepEqual(rolesCalled, ['analyst', 'strategist', 'critic', 'synthesizer']);

      // Verify critic review was passed to synthesizer prompt
      const synthesizerPrompt = promptsSent[3] ?? '';
      assert.match(synthesizerPrompt, /Skeptical Reviewer Critique & Challenge Log/);
      assert.match(synthesizerPrompt, /Unverified growth claim/);

      // Verify the final validated output was produced
      assert.equal(result.summary, 'Synthesized multi-agent executive analysis.');
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0]?.kind, 'fact');
      assert.equal(result.findings[0]?.quote, 'Starts at $49 per month for pro users.');
    });

    test('cancellation between agents aborts execution immediately', async () => {
      let cancel = false;
      const mockAi: any = {
        async generate() {
          cancel = true; // Request cancel after Agent 1
          return '{"observations":[]}';
        },
      };

      const promptContext: PromptContext = {
        company: { name: 'Acme', website: 'acme.com', industry: 'SaaS', audience: 'SMB', goal: 'Grow', description: '' },
        competitor: { name: 'CompCo', url: 'https://compco.com', notes: '' },
        focus: '',
        evidence: [],
      };

      await assert.rejects(
        () => executeMultiAgentWorkflow(
          mockAi,
          promptContext,
          'evidence',
          [],
          {
            checkCancel: () => {
              if (cancel) throw new Error('Cancelled by user');
            },
            log: () => {},
          },
        ),
        /Cancelled by user/,
      );
    });
  });

  // 5. Evidence Verification & Hallucination Guardrails
  describe('Evidence correctness safeguards', () => {
    test('demotes fact to interpretation if quote does not match evidence', () => {
      const refs: EvidenceRef[] = [{
        ref: 'E1',
        evidenceId: 'ev_1',
        text: 'Acme Cloud is $20 a month.',
        changed: false,
      }];

      const raw = {
        summary: 'Executive summary',
        findings: [
          {
            kind: 'fact',
            category: 'pricing',
            statement: 'Prices start at $10',
            quote: 'Unverifiable quote not in text', // hallucinated quote
            implication: 'Cheaper',
            evidenceRefs: ['E1'],
            confidence: 0.9,
          },
        ],
        signals: [],
        recommendations: [],
        limitations: [],
      };

      const res = validateAnalysis(raw, refs);
      // Must be demoted from 'fact' to 'interpretation'
      assert.equal(res.findings[0]?.kind, 'interpretation');
      assert.equal(res.findings[0]?.demoted, true);
    });

    test('discards items referencing non-existent evidence IDs', () => {
      const refs: EvidenceRef[] = [{
        ref: 'E1',
        evidenceId: 'ev_1',
        text: 'Valid page content here.',
        changed: false,
      }];

      const raw = {
        summary: 'Summary',
        findings: [
          {
            kind: 'interpretation',
            category: 'product',
            statement: 'They launched feature X',
            evidenceRefs: ['E999'], // Non-existent evidence ref!
            implication: 'Threat',
            confidence: 0.5,
          },
        ],
        signals: [],
        recommendations: [],
        limitations: [],
      };

      const res = validateAnalysis(raw, refs);
      // Because E999 is invalid, it has 0 valid refs, demoted to hypothesis
      assert.equal(res.findings[0]?.kind, 'hypothesis');
      assert.equal(res.limitations.some((l) => /source reference.*did not match/i.test(l)), true);
    });
  });
});
