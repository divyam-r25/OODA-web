import { spawn } from 'node:child_process';

const node = process.execPath;
function runInitialBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(node, ['scripts/build.mjs'], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Initial build failed with exit code ${code}.`))));
  });
}

await runInitialBuild();

const children = [
  spawn(node, ['scripts/build.mjs', '--watch'], { stdio: 'inherit' }),
  spawn(node, ['--env-file-if-exists=.env', '--watch', 'dist/server/index.js'], { stdio: 'inherit' }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`Development process stopped (${signal ?? `exit code ${code}`}).`);
      stop(code ?? 1);
    }
  });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
