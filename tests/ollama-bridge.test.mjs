import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeConfig, createBridge } from '../scripts/ollama-bridge.mjs';

const token = 'a'.repeat(32);

async function withBridge(fetchImpl, run) {
  const server = createBridge(token, fetchImpl);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const request = (base, path = '/api/chat', options = {}) => fetch(base + path, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'safe-model', messages: [] }), ...options,
});

test('bridge refuses missing or short startup tokens', () => {
  assert.throws(() => bridgeConfig({}), /at least 32/);
  assert.throws(() => bridgeConfig({ OLLAMA_PROXY_TOKEN: 'short' }), /at least 32/);
  assert.deepEqual(bridgeConfig({ OLLAMA_PROXY_TOKEN: token, OLLAMA_BRIDGE_PORT: '11435' }), { token, port: 11435 });
});

test('bridge authenticates, forwards only the fixed Ollama endpoint, and preserves JSON response', async () => {
  let target = '';
  await withBridge(async (url, options) => {
    target = url;
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 });
  }, async (base) => {
    const response = await request(base);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: { content: 'ok' } });
  });
  assert.equal(target, 'http://127.0.0.1:11434/api/chat');
});

test('bridge rejects invalid tokens, methods, routes, non-JSON and oversized input', async () => {
  await withBridge(async () => new Response('{}'), async (base) => {
    assert.equal((await request(base, '/api/chat', { headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' } })).status, 401);
    assert.equal((await fetch(`${base}/api/chat`, { method: 'GET' })).status, 404);
    assert.equal((await request(base, '/api/pull')).status, 404);
    assert.equal((await request(base, '/api/chat', { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' } })).status, 415);
    const oversized = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'x'.repeat(2 * 1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);
  });
});

test('bridge returns safe upstream errors and allows only one active generation', async () => {
  await withBridge(async () => { throw new Error('private upstream failure'); }, async (base) => {
    const response = await request(base);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'upstream_unavailable' });
  });
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  await withBridge(async () => { await waiting; return new Response('{}'); }, async (base) => {
    const first = request(base);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await request(base);
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: 'temporarily_busy' });
    release();
    assert.equal((await first).status, 200);
  });
});
