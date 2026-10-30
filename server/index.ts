import { createApp } from './app.ts';
import { aiStatus, loadConfig } from './config.ts';

const config = loadConfig();
const app = createApp({ config });
const { url } = await app.listen();
const ai = aiStatus(config);
console.log(`OODA listening on ${url}`);
console.log(`  database : ${config.databasePath}`);
console.log(`  AI       : ${ai.configured ? `${ai.provider} (${ai.model})` : `not configured. ${ai.problem}`}`);
console.log(`  worker   : ${config.worker.enabled ? 'in-process' : 'disabled'}`);

let closing = false;
const shutdown = async (sig: string) => {
  if (closing) return;
  closing = true;
  console.log(`\n${sig} received, shutting down...`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
