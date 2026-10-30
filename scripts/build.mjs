import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { build, context } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const webRoot = resolve(root, 'web');
const webOut = resolve(root, 'dist', 'web');
const serverOut = resolve(root, 'dist', 'server');
const webEntry = resolve(webRoot, 'src', 'main.tsx');
const serverEntry = resolve(root, 'server', 'index.ts');
const watching = process.argv.includes('--watch');

function urlPath(path) {
  return `/${relative(webOut, resolve(path)).split(sep).join('/')}`;
}

async function writeHtml(result) {
  if (result.errors.length) return;
  const entry = Object.entries(result.metafile.outputs).find(([, output]) => resolve(output.entryPoint ?? '') === webEntry);
  if (!entry) throw new Error('esbuild did not produce a frontend entry point.');

  const [jsFile, output] = entry;
  if (!output.cssBundle) throw new Error('esbuild did not produce the frontend stylesheet.');
  const template = await readFile(resolve(webRoot, 'index.html'), 'utf8');
  const html = template.replaceAll('%JS%', urlPath(jsFile)).replaceAll('%CSS%', urlPath(output.cssBundle));
  await mkdir(webOut, { recursive: true });
  await writeFile(resolve(webOut, 'index.html'), html);
  await cp(resolve(webRoot, 'public'), webOut, { recursive: true, force: true });
}

const frontendOptions = {
  absWorkingDir: root,
  entryPoints: [webEntry],
  outdir: webOut,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  entryNames: 'assets/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  sourcemap: watching ? 'inline' : false,
  minify: !watching,
  metafile: true,
  logLevel: 'info',
};

const backendOptions = {
  absWorkingDir: root,
  entryPoints: [serverEntry],
  outfile: resolve(serverOut, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: watching ? 'inline' : false,
  minify: false,
  logLevel: 'info',
};

async function buildOnce() {
  await rm(resolve(root, 'dist'), { recursive: true, force: true });
  const [frontend] = await Promise.all([build(frontendOptions), build(backendOptions)]);
  await writeHtml(frontend);
}

if (!watching) {
  await buildOnce();
  console.log('Built frontend in dist/web and server in dist/server.');
} else {
  const frontend = await context({
    ...frontendOptions,
    plugins: [{ name: 'write-html', setup(pluginBuild) { pluginBuild.onEnd(writeHtml); } }],
  });
  const backend = await context(backendOptions);
  await Promise.all([frontend.rebuild(), backend.rebuild()]);
  await Promise.all([frontend.watch(), backend.watch()]);
  console.log('Watching web/ and server/ for changes.');

  const stop = async () => {
    await Promise.all([frontend.dispose(), backend.dispose()]);
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
