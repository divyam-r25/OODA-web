import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Issue, Schema } from '../../shared/validate.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found.`);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign in to continue.');
export const conflict = (m: string) => new HttpError(409, 'conflict', m);
export const badRequest = (m: string, details?: unknown) => new HttpError(400, 'bad_request', m, details);

export function validate<T>(schema: Schema<T>, input: unknown): T {
  const r = schema.parse(input);
  if (r.ok) return r.value;
  const fields: Record<string, string> = {};
  for (const i of r.issues as Issue[]) fields[i.path || '_'] = fields[i.path || '_'] ?? i.message;
  throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { fields });
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface Services {
  config: Config;
  db: Db;
  enqueue: (runId: string) => void;
  ai: import('../ai/provider.ts').AiClient;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  user: AuthUser | null;
  ip: string;
  svc: Services;
  body(): Promise<unknown>;
  setCookie(name: string, value: string, opts?: { maxAgeSec?: number; clear?: boolean }): void;
  /** Returns the authenticated user or throws 401. */
  requireUser(): AuthUser;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  auth: boolean;
  handler: Handler;
  status: number;
}

export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler, opts: { auth?: boolean; status?: number } = {}) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/\/:([a-zA-Z]+)/g, (_m, k: string) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, re, keys, auth: opts.auth ?? true, handler, status: opts.status ?? 200 });
  }
  get = (p: string, h: Handler, o?: { auth?: boolean }) => this.add('GET', p, h, o);
  post = (p: string, h: Handler, o?: { auth?: boolean; status?: number }) => this.add('POST', p, h, { status: 201, ...o });
  patch = (p: string, h: Handler, o?: { auth?: boolean }) => this.add('PATCH', p, h, o);
  put = (p: string, h: Handler, o?: { auth?: boolean }) => this.add('PUT', p, h, o);
  del = (p: string, h: Handler, o?: { auth?: boolean }) => this.add('DELETE', p, h, o);

  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
      return { route, params };
    }
    return pathMatched ? 'method' : null;
  }
}

// ── rate limiting (in-memory, per process) ─────────────────────────────
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return;
  }
  b.count++;
  if (b.count > max) {
    const retry = Math.ceil((b.resetAt - now) / 1000);
    throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${retry}s.`, undefined, { 'Retry-After': String(retry) });
  }
}
export const resetRateLimits = () => buckets.clear();

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const MAX_BODY = 256 * 1024;
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'Request body is too large.');
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax). */
export function checkOrigin(req: IncomingMessage, trustedOrigins: readonly string[] = []) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')) return;
  const origin = req.headers.origin;
  if (!origin) return;
  let normalized: string;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('invalid origin');
    normalized = parsed.origin;
  } catch {
    throw new HttpError(403, 'bad_origin', 'Cross-site request blocked.');
  }
  // Preserve direct same-host requests, and allow only explicitly configured proxy origins.
  if (new URL(normalized).host !== req.headers.host && !trustedOrigins.includes(normalized)) {
    throw new HttpError(403, 'bad_origin', 'Cross-site request blocked.');
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
