import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const UPSTREAM = 'http://127.0.0.1:11434/api/chat';
const TIMEOUT_MS = 300_000;

export function bridgeConfig(env = process.env) {
  const token = env.OLLAMA_PROXY_TOKEN ?? '';
  if (token.length < 32) throw new Error('OLLAMA_PROXY_TOKEN must be at least 32 characters.');
  const port = Number(env.OLLAMA_BRIDGE_PORT ?? '11435');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('OLLAMA_BRIDGE_PORT must be a valid TCP port.');
  return { token, port };
}

function authorized(value, token) {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(value ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('too_large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  try { JSON.parse(raw.toString('utf8')); } catch { throw new Error('invalid_json'); }
  return raw;
}

/** A loopback-only, single-flight bridge to a local Ollama /api/chat endpoint. */
export function createBridge(token, fetchImpl = fetch) {
  let busy = false;
  return createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/chat') return send(res, 404, { error: 'not_found' });
    if (!authorized(req.headers.authorization, token)) return send(res, 401, { error: 'unauthorized' });
    if ((req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') return send(res, 415, { error: 'json_required' });
    const length = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return send(res, 413, { error: 'payload_too_large' });
    if (busy) return send(res, 429, { error: 'temporarily_busy' });
    busy = true;
    try {
      const body = await readJsonBody(req);
      const upstream = await fetchImpl(UPSTREAM, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await upstream.text();
      try { JSON.parse(text); } catch { return send(res, 502, { error: 'upstream_invalid_response' }); }
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(text);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'too_large') send(res, 413, { error: 'payload_too_large' });
      else if (code === 'invalid_json') send(res, 400, { error: 'invalid_json' });
      else send(res, 502, { error: 'upstream_unavailable' });
    } finally { busy = false; }
  });
}

export function startBridge(env = process.env) {
  const { token, port } = bridgeConfig(env);
  const server = createBridge(token);
  server.listen(port, '127.0.0.1', () => console.log(`Ollama bridge listening on 127.0.0.1:${port}`));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startBridge();
