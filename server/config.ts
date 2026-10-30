// All configuration comes from environment variables. Nothing here is ever sent to the browser.
const env = process.env;
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const int = (v: string | undefined, d: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
};

export type AiProviderName = 'none' | 'ollama' | 'openrouter_free' | 'openai' | 'anthropic' | 'mock';
export type AiWorkflowMode = 'single' | 'multi_agent';

export function isOpenRouterFreeModel(model: string | undefined): boolean {
  if (!model) return false;
  const m = model.trim().toLowerCase();
  if (m.endsWith(':free')) return true;
  if (m === 'openrouter/free' || m.startsWith('openrouter/free:')) return true;
  if (m === 'nvidia/nemotron-3-ultra-550b-a55b' || m === 'nvidia/nemotron-3-ultra-550b-a55b:free') return true;
  return false;
}

export function normalizeOpenRouterModel(model: string): string {
  const m = model.trim();
  if (m.toLowerCase() === 'nvidia/nemotron-3-ultra-550b-a55b') return 'nvidia/nemotron-3-ultra-550b-a55b:free';
  return m;
}

export interface Config {
  env: string;
  port: number;
  host: string;
  databasePath: string;
  staticDir: string;
  cookieSecure: boolean;
  sessionDays: number;
  allowRegistration: boolean;
  trustProxy: boolean;
  ai: {
    provider: AiProviderName;
    workflow: AiWorkflowMode;
    timeoutMs: number;
    ollamaBaseUrl: string;
    ollamaModel: string;
    ollamaAnalystModel: string;
    ollamaStrategistModel: string;
    ollamaCriticModel: string;
    ollamaSynthesisModel: string;
    openrouterBaseUrl: string;
    openrouterApiKey: string;
    openrouterModel: string;
    openrouterAnalystModel: string;
    openrouterStrategistModel: string;
    openrouterCriticModel: string;
    openrouterSynthesisModel: string;
    openaiBaseUrl: string;
    openaiApiKey: string;
    openaiModel: string;
    anthropicApiKey: string;
    anthropicBaseUrl: string;
    anthropicModel: string;
  };
  fetch: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    userAgent: string;
    allowPrivateNetwork: boolean;
    respectRobots: boolean;
  };
  worker: { enabled: boolean; pollMs: number; maxAttempts: number; leaseMs: number };
  limits: { maxActiveRunsPerUser: number; maxRunsPerDay: number; maxCompetitors: number; maxSourcesPerCompetitor: number };
}

export function loadConfig(overrides: Partial<Record<string, string>> = {}): Config {
  const e = { ...env, ...overrides } as Record<string, string | undefined>;
  const nodeEnv = e.NODE_ENV ?? 'development';
  let provider = (e.AI_PROVIDER ?? 'none').toLowerCase() as Config['ai']['provider'];
  if (!['none', 'ollama', 'openrouter_free', 'openai', 'anthropic', 'mock'].includes(provider)) provider = 'none';
  if (provider === 'mock' && nodeEnv === 'production' && !bool(e.ALLOW_MOCK_AI, false)) {
    throw new Error('AI_PROVIDER=mock is refused in production. Set a real provider (ollama, openrouter_free, openai, anthropic).');
  }

  const rawWorkflow = (e.AI_WORKFLOW ?? 'single').toLowerCase();
  const workflow: AiWorkflowMode = rawWorkflow === 'multi_agent' ? 'multi_agent' : 'single';

  return {
    env: nodeEnv,
    port: int(e.PORT, 8787),
    host: e.HOST ?? '127.0.0.1',
    databasePath: e.DATABASE_PATH ?? './data/ooda.sqlite',
    staticDir: e.STATIC_DIR ?? './dist/web',
    cookieSecure: bool(e.COOKIE_SECURE, nodeEnv === 'production'),
    sessionDays: int(e.SESSION_DAYS, 14),
    allowRegistration: bool(e.ALLOW_REGISTRATION, true),
    trustProxy: bool(e.TRUST_PROXY, false),
    ai: {
      provider,
      workflow,
      timeoutMs: int(e.AI_TIMEOUT_MS, 120_000),
      ollamaBaseUrl: e.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
      ollamaModel: e.OLLAMA_MODEL ?? '',
      ollamaAnalystModel: e.OLLAMA_ANALYST_MODEL ?? '',
      ollamaStrategistModel: e.OLLAMA_STRATEGIST_MODEL ?? '',
      ollamaCriticModel: e.OLLAMA_CRITIC_MODEL ?? '',
      ollamaSynthesisModel: e.OLLAMA_SYNTHESIS_MODEL ?? '',
      openrouterBaseUrl: e.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      openrouterApiKey: e.OPENROUTER_API_KEY ?? '',
      openrouterModel: e.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free',
      openrouterAnalystModel: e.OPENROUTER_ANALYST_MODEL ?? '',
      openrouterStrategistModel: e.OPENROUTER_STRATEGIST_MODEL ?? '',
      openrouterCriticModel: e.OPENROUTER_CRITIC_MODEL ?? '',
      openrouterSynthesisModel: e.OPENROUTER_SYNTHESIS_MODEL ?? '',
      openaiBaseUrl: e.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      openaiApiKey: e.OPENAI_API_KEY ?? '',
      openaiModel: e.OPENAI_MODEL ?? '',
      anthropicApiKey: e.ANTHROPIC_API_KEY ?? '',
      anthropicBaseUrl: e.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
      anthropicModel: e.ANTHROPIC_MODEL ?? '',
    },
    fetch: {
      timeoutMs: int(e.FETCH_TIMEOUT_MS, 15_000),
      maxBytes: int(e.FETCH_MAX_BYTES, 2_000_000),
      maxRedirects: int(e.FETCH_MAX_REDIRECTS, 4),
      userAgent: e.FETCH_USER_AGENT ?? 'OODA-Research/2.0 (+competitive-intelligence; respects robots.txt)',
      allowPrivateNetwork: bool(e.ALLOW_PRIVATE_FETCH, false),
      respectRobots: bool(e.RESPECT_ROBOTS, true),
    },
    worker: {
      enabled: bool(e.WORKER_ENABLED, true),
      pollMs: int(e.WORKER_POLL_MS, 1000),
      maxAttempts: int(e.WORKER_MAX_ATTEMPTS, 3),
      leaseMs: int(e.WORKER_LEASE_MS, 10 * 60_000),
    },
    limits: {
      maxActiveRunsPerUser: int(e.MAX_ACTIVE_RUNS, 3),
      maxRunsPerDay: int(e.MAX_RUNS_PER_DAY, 40),
      maxCompetitors: int(e.MAX_COMPETITORS, 50),
      maxSourcesPerCompetitor: int(e.MAX_SOURCES_PER_COMPETITOR, 6),
    },
  };
}

export function aiStatus(c: Config): {
  provider: string;
  configured: boolean;
  model: string;
  workflow: AiWorkflowMode;
  isLocal: boolean;
  isFree: boolean;
  problem?: string;
} {
  const a = c.ai;
  const workflow = a.workflow;
  switch (a.provider) {
    case 'ollama': {
      const isLocal = true;
      const isFree = true;
      if (!a.ollamaModel) {
        return { provider: 'ollama', configured: false, model: '', workflow, isLocal, isFree, problem: 'OLLAMA_MODEL is not set.' };
      }
      return { provider: 'ollama', configured: true, model: a.ollamaModel, workflow, isLocal, isFree };
    }
    case 'openrouter_free': {
      const isLocal = false;
      const isFree = true;
      if (!a.openrouterApiKey) {
        return {
          provider: 'openrouter_free',
          configured: false,
          model: a.openrouterModel,
          workflow,
          isLocal,
          isFree,
          problem: 'OPENROUTER_API_KEY is required for OpenRouter Free.',
        };
      }
      if (!a.openrouterModel) {
        return {
          provider: 'openrouter_free',
          configured: false,
          model: '',
          workflow,
          isLocal,
          isFree,
          problem: 'OPENROUTER_MODEL is not set.',
        };
      }
      if (!isOpenRouterFreeModel(a.openrouterModel)) {
        return {
          provider: 'openrouter_free',
          configured: false,
          model: a.openrouterModel,
          workflow,
          isLocal,
          isFree,
          problem: `Model "${a.openrouterModel}" is not a recognized free model. To prevent accidental charges, openrouter_free only accepts models ending in ':free' (e.g. nvidia/nemotron-3-ultra-550b-a55b:free) or 'openrouter/free'.`,
        };
      }
      // Check role models if in multi_agent mode
      if (workflow === 'multi_agent') {
        const roles = [
          { role: 'analyst', m: a.openrouterAnalystModel },
          { role: 'strategist', m: a.openrouterStrategistModel },
          { role: 'critic', m: a.openrouterCriticModel },
          { role: 'synthesis', m: a.openrouterSynthesisModel },
        ];
        for (const { role, m } of roles) {
          if (m && !isOpenRouterFreeModel(m)) {
            return {
              provider: 'openrouter_free',
              configured: false,
              model: a.openrouterModel,
              workflow,
              isLocal,
              isFree,
              problem: `Role model OPENROUTER_${role.toUpperCase()}_MODEL="${m}" is not a free model. Only free models ending in ':free' are allowed.`,
            };
          }
        }
      }
      return {
        provider: 'openrouter_free',
        configured: true,
        model: normalizeOpenRouterModel(a.openrouterModel),
        workflow,
        isLocal,
        isFree,
      };
    }
    case 'openai':
      return a.openaiApiKey && a.openaiModel
        ? { provider: 'openai', configured: true, model: a.openaiModel, workflow, isLocal: false, isFree: false }
        : { provider: 'openai', configured: false, model: a.openaiModel, workflow, isLocal: false, isFree: false, problem: 'OPENAI_API_KEY and OPENAI_MODEL are required.' };
    case 'anthropic':
      return a.anthropicApiKey && a.anthropicModel
        ? { provider: 'anthropic', configured: true, model: a.anthropicModel, workflow, isLocal: false, isFree: false }
        : { provider: 'anthropic', configured: false, model: a.anthropicModel, workflow, isLocal: false, isFree: false, problem: 'ANTHROPIC_API_KEY and ANTHROPIC_MODEL are required.' };
    case 'mock':
      return { provider: 'mock', configured: true, model: 'deterministic-test-provider', workflow, isLocal: true, isFree: true };
    default:
      return { provider: 'none', configured: false, model: '', workflow, isLocal: false, isFree: false, problem: 'No AI provider is configured (AI_PROVIDER).' };
  }
}
