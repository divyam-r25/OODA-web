import type { Server } from 'node:http';
import { type Config, aiStatus, loadConfig } from './config.ts';
import { Db } from './db/db.ts';
import { type AiClient, createAiClient } from './ai/provider.ts';
import { Router, type Services } from './http/core.ts';
import { createHttpServer } from './http/server.ts';
import { registerAuthRoutes } from './modules/auth.ts';
import { registerWorkspaceRoutes } from './modules/workspace.ts';
import { registerCompetitorRoutes } from './modules/competitors.ts';
import { registerActionRoutes } from './modules/actions.ts';
import { registerIntelRoutes } from './modules/intel.ts';
import { registerResearchRoutes } from './modules/research.ts';
import { Worker } from './worker/queue.ts';

export interface App {
  config: Config;
  db: Db;
  server: Server;
  worker: Worker;
  svc: Services;
  listen(): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
}

export function createApp(opts: { config?: Config; ai?: AiClient; startWorker?: boolean } = {}): App {
  const config = opts.config ?? loadConfig();
  const db = new Db(config.databasePath);
  const ai = opts.ai ?? createAiClient(config);
  let worker!: Worker;
  const svc: Services = { config, db, ai, enqueue: () => worker?.nudge() };
  worker = new Worker(svc, 2);

  const router = new Router();
  registerAuthRoutes(router);
  registerWorkspaceRoutes(router);
  registerCompetitorRoutes(router);
  registerActionRoutes(router);
  registerIntelRoutes(router);
  registerResearchRoutes(router);
  router.get('/api/health', () => {
    db.get('SELECT 1');
    const s = aiStatus(config);
    return { status: 'ok', time: new Date().toISOString(), database: 'ok', worker: config.worker.enabled ? 'running' : 'disabled', ai: { provider: s.provider, configured: s.configured } };
  }, { auth: false });

  const server = createHttpServer(config, router, svc);
  return {
    config, db, server, worker, svc,
    listen: () =>
      new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : config.port;
          if ((opts.startWorker ?? config.worker.enabled)) worker.start();
          resolve({ port, url: `http://${config.host}:${port}` });
        });
      }),
    async close() {
      await worker.stop();
      await new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections?.();
      db.close();
    },
  };
}
