import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, type App } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';

describe('OODA Application Tests', () => {
  let app: App;
  let baseUrl: string;

  before(async () => {
    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      AI_PROVIDER: 'mock',
      WORKER_ENABLED: 'false',
    });
    app = createApp({ config, startWorker: false });
    const { url } = await app.listen();
    baseUrl = url;
  });

  after(async () => {
    await app.close();
  });

  test('health endpoint returns ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.database, 'ok');
  });

  test('auth register and login flow', async () => {
    const email = `founder_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    // Register
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alex Founder', email, password }),
    });
    assert.equal(regRes.status, 201);
    const regCookie = regRes.headers.get('set-cookie');
    assert.ok(regCookie, 'Expected session cookie on registration');

    // Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.email, email);
    assert.equal(loginData.user.name, 'Alex Founder');
  });

  test('unauthorized access to competitors is blocked', async () => {
    const res = await fetch(`${baseUrl}/api/competitors`);
    assert.equal(res.status, 401);
  });
});
