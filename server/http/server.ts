import { createServer, type Server } from 'node:http';
import type { Config } from '../config.ts';
import {
  type AuthUser,
  type Ctx,
  HttpError,
  type Router,
  type Services,
  SECURITY_HEADERS,
  checkOrigin,
  clientIp,
  parseCookies,
  rateLimit,
  readJson,
} from './core.ts';
import { serveStatic } from './static.ts';
import { sessionUser, SESSION_COOKIE } from '../modules/auth.ts';

export function createHttpServer(config: Config, router: Router, svc: Services): Server {
  return createServer(async (req, res) => {
    const started = Date.now();
    const ip = clientIp(req, config.trustProxy);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const isApi = url.pathname.startsWith('/api/');
    try {
      if (!isApi) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
        if (serveStatic(config.staticDir, req, res, SECURITY_HEADERS)) return;
        throw new HttpError(404, 'not_found', 'Not found. Has the web app been built? Run: npm run build');
      }
      rateLimit(`ip:${ip}`, 600, 60_000);
      checkOrigin(req);
      const matched = router.match(req.method ?? 'GET', url.pathname);
      if (matched === null) throw new HttpError(404, 'not_found', 'Unknown API route.');
      if (matched === 'method') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
      const { route, params } = matched;
      const cookies = parseCookies(req.headers.cookie);
      const user: AuthUser | null = sessionUser(svc.db, cookies[SESSION_COOKIE]);
      const setCookies: string[] = [];
      let cached: Promise<unknown> | undefined;
      const ctx: Ctx = {
        req,
        res,
        url,
        params,
        query: url.searchParams,
        user,
        ip,
        svc,
        body: () => (cached ??= readJson(req)),
        setCookie(name, value, o = {}) {
          const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
          if (config.cookieSecure) parts.push('Secure');
          if (o.clear) parts.push('Max-Age=0');
          else if (o.maxAgeSec) parts.push(`Max-Age=${o.maxAgeSec}`);
          setCookies.push(parts.join('; '));
        },
        requireUser() {
          if (!user) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
          return user;
        },
      };
      if (route.auth) ctx.requireUser();
      const result = await route.handler(ctx);
      if (res.headersSent || res.writableEnded) return; // handler streamed its own response (e.g. file export)
      const body = result === undefined ? null : JSON.stringify(result);
      const headers: Record<string, string | string[]> = { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' };
      if (setCookies.length) headers['Set-Cookie'] = setCookies;
      if (body === null) {
        res.writeHead(204, headers);
        res.end();
      } else {
        res.writeHead(route.status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
        res.end(body);
      }
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, 'internal_error', 'Something went wrong on our side.');
      if (!(e instanceof HttpError)) console.error('[error]', req.method, url.pathname, e);
      if (!res.headersSent) {
        if (isApi) {
          res.writeHead(err.status, {
            ...SECURITY_HEADERS,
            ...err.headers,
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(JSON.stringify({ error: { code: err.code, message: err.message, details: err.details } }));
        } else {
          res.writeHead(err.status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(err.message);
        }
      } else res.end();
    } finally {
      if (config.env !== 'test' && isApi) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
}
