import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Vercel config builds the static frontend and keeps API proxying before SPA fallback', async () => {
  const config = JSON.parse(await readFile(resolve(import.meta.dirname, '..', 'vercel.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(config.installCommand, 'npm ci');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist/web');
  const rewrites = config.rewrites as { source: string; destination: string }[];
  assert.deepEqual(rewrites.map((rewrite) => rewrite.source), ['/api/:path*', '/(.*)']);
  assert.match(rewrites[0]!.destination, /^https:\/\/[^/]+\.onrender\.com\/api\/:path\*$/);
  assert.equal(rewrites[1]!.destination, '/index.html');
});
