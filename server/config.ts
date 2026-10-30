// All configuration comes from environment variables. Nothing here is ever sent to the browser.
const env = process.env;
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const int = (v: string | undefined, d: number) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
};

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
    provider: 'none' | 'ollama' | 'openai' | 'anthropic' | 'mock';
    timeoutMs: number;
    ollamaBaseUrl: string;
    ollamaModel: string;
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
  if (!['none', 'ollama', 'openai', 'anthropic', 'mock'].includes(provider)) provider = 'none';
  if (provider === 'mock' && nodeEnv === 'production' && !bool(e.ALLOW_MOCK_AI, false)) {
    throw new Error('AI_PROVIDER=mock is refused in production. Set a real provider (ollama, openai, anthropic).');
  }
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
      timeoutMs: int(e.AI_TIMEOUT_MS, 120_000),
      ollamaBaseUrl: e.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
      ollamaModel: e.OLLAMA_MODEL ?? '',
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

export function aiStatus(c: Config): { provider: string; configured: boolean; model: string; problem?: string } {
  const a = c.ai;
  switch (a.provider) {
    case 'ollama':
      return a.ollamaModel
        ? { provider: 'ollama', configured: true, model: a.ollamaModel }
        : { provider: 'ollama', configured: false, model: '', problem: 'OLLAMA_MODEL is not set.' };
    case 'openai':
      return a.openaiApiKey && a.openaiModel
        ? { provider: 'openai', configured: true, model: a.openaiModel }
        : { provider: 'openai', configured: false, model: a.openaiModel, problem: 'OPENAI_API_KEY and OPENAI_MODEL are required.' };
    case 'anthropic':
      return a.anthropicApiKey && a.anthropicModel
        ? { provider: 'anthropic', configured: true, model: a.anthropicModel }
        : { provider: 'anthropic', configured: false, model: a.anthropicModel, problem: 'ANTHROPIC_API_KEY and ANTHROPIC_MODEL are required.' };
    case 'mock':
      return { provider: 'mock', configured: true, model: 'deterministic-test-provider' };
    default:
      return { provider: 'none', configured: false, model: '', problem: 'No AI provider is configured (AI_PROVIDER).' };
  }
}
