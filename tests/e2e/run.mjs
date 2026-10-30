import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';

console.log('Running OODA E2E sanity check...');
const config = loadConfig({
  DATABASE_PATH: ':memory:',
  PORT: '0',
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  AI_PROVIDER: 'mock',
  WORKER_ENABLED: 'false',
});

const app = createApp({ config, startWorker: false });
const { url } = await app.listen();
console.log(`Test server running on ${url}`);

try {
  // Test health endpoint
  const healthRes = await fetch(`${url}/api/health`);
  if (!healthRes.ok) throw new Error(`Health check failed with status ${healthRes.status}`);
  const healthData = await healthRes.json();
  if (healthData.status !== 'ok') throw new Error(`Health status is ${healthData.status}`);
  console.log('✓ Health check passed');

  // Test static index.html or SPA root
  const pageRes = await fetch(`${url}/`);
  if (!pageRes.ok) throw new Error(`Frontend root check failed with status ${pageRes.status}`);
  console.log('✓ Frontend root check passed');

  console.log('All E2E checks passed successfully!');
} finally {
  await app.close();
}
