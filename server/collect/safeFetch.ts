import http from 'node:http';
import https from 'node:https';
import { FetchError, assertPublicUrlShape, resolvePublic } from './net.ts';

export interface FetchOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
  allowPrivateNetwork: boolean;
  accept?: string;
  allowedTypes?: RegExp;
}
export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

const HTML_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

function decode(buf: Buffer, contentType: string): string {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, '') ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function once(url: URL, pinned: { address: string; family: 4 | 6 }, o: FetchOptions, deadline: number): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'User-Agent': o.userAgent,
          Accept: o.accept ?? 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5',
          'Accept-Encoding': 'identity',
          'Accept-Language': 'en',
        },
        // Pin the TCP connection to the address we vetted, so DNS cannot change between check and connect.
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts && opts.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)) as never,
        timeout: remaining,
        servername: /^[\d.]+$|:/.test(url.hostname) ? undefined : url.hostname,
      },
      (res) => resolve({ res, req }),
    );
    req.on('timeout', () => req.destroy(new FetchError('timeout', 'The site took too long to respond.')));
    req.on('error', (e) => reject(e instanceof FetchError ? e : new FetchError('network', `Network error: ${(e as NodeJS.ErrnoException).code ?? e.message}`)));
    req.end();
  });
}

/** SSRF-safe GET: validates scheme/port/host, resolves and pins to a public IP, re-validates every redirect hop,
 *  enforces an overall deadline and a body size cap, and restricts content types. */
export async function safeFetch(rawUrl: string, o: FetchOptions): Promise<FetchResult> {
  const deadline = Date.now() + o.timeoutMs;
  let current = rawUrl;
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    const url = assertPublicUrlShape(current, o.allowPrivateNetwork);
    const pinned = await resolvePublic(url.hostname, o.allowPrivateNetwork);
    const { res, req } = await once(url, pinned, o, deadline);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      try {
        current = new URL(res.headers.location, url).toString();
      } catch {
        throw new FetchError('http', 'The site returned an invalid redirect.');
      }
      continue;
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (status >= 200 && status < 300 && !(o.allowedTypes ?? HTML_TYPES).test(contentType)) {
      res.resume();
      throw new FetchError('content_type', `Unsupported content type (${contentType || 'unknown'}). Only web pages are collected.`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    const timer = setTimeout(() => req.destroy(new FetchError('timeout', 'The site took too long to respond.')), Math.max(1, deadline - Date.now()));
    try {
      await new Promise<void>((resolve, reject) => {
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > o.maxBytes) {
            chunks.push(c.subarray(0, c.length - (size - o.maxBytes)));
            truncated = true;
            req.destroy();
            resolve();
          } else chunks.push(c);
        });
        res.on('end', resolve);
        res.on('error', (e) => (truncated ? resolve() : reject(e instanceof FetchError ? e : new FetchError('network', 'Connection lost while reading the page.'))));
        res.on('close', resolve);
        req.on('error', (e) => (truncated ? resolve() : reject(e instanceof FetchError ? e : new FetchError('network', 'Connection lost while reading the page.'))));
      });
    } finally {
      clearTimeout(timer);
    }
    return { requestedUrl: rawUrl, finalUrl: current, status, contentType, body: decode(Buffer.concat(chunks), contentType), truncated };
  }
  throw new FetchError('redirects', 'The site redirected too many times.');
}
