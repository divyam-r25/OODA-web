import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Serves built web assets, with SPA fallback to index.html for non-file routes. Returns false if nothing to serve. */
export function serveStatic(dir: string, req: IncomingMessage, res: ServerResponse, headers: Record<string, string>): boolean {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) return false;
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = resolve(join(root, normalize(pathname)));
  if (file !== root && !file.startsWith(root + sep)) return false; // path traversal guard
  const isAsset = extname(file) !== '';
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (isAsset) return false;
    file = join(root, 'index.html');
  }
  const ext = extname(file);
  const immutable = /\.[A-Z0-9]{8}\.(js|css)$/i.test(file);
  res.writeHead(200, {
    ...headers,
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}
