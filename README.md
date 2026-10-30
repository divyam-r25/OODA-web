# OODA

Competitive intelligence for founders and product teams. OODA watches the public pages of the companies you compete with, shows what changed, and turns it into evidence-backed reports and trackable actions, following the **Observe, Orient, Decide, Act** loop.

OODA is a responsive web application (desktop, tablet and phone browsers) with its own backend.

## What it does

- **Observe.** Collects the pages you choose (pricing, product, careers) with a polite, SSRF-safe fetcher that respects `robots.txt`, and stores dated snapshots.
- **Orient.** Compares each snapshot with the previous one line by line and produces signals with a severity, a confidence, and the exact lines that moved.
- **Decide.** Writes a memo in which every statement is labelled as a *fact* (with a quote verified against the stored page), an *interpretation* (cites sources), or a *hypothesis* (flagged as unsupported). Reports can be reopened, compared across competitors, and exported.
- **Act.** Turns recommendations and signals into tracked actions.

Honesty rules enforced in code, not just in prompts: every citation is checked against stored evidence; unverifiable quotes are downgraded; a first run is a "baseline" and never claims change; pages that could not be collected are listed as limitations; with no AI provider configured, no analysis is invented.

## Quick start

Requires **Node.js 22.13 or newer** (uses the built-in `node:sqlite`).

```bash
npm install
# PowerShell: Copy-Item .env.example .env
# macOS/Linux: cp .env.example .env
# Then edit .env to choose an AI provider (see below).
npm run build
npm start                   # http://127.0.0.1:8787
```

Development with rebuild-on-change and server restart:

```bash
npm run dev
```

`npm run dev` creates an initial build, watches the TypeScript, React and CSS sources, and restarts the Node server whenever the backend bundle changes. It serves the same compiled frontend and API from one origin at `http://127.0.0.1:8787`; do not open the `web/` directory directly.

Open the site, choose **Create a workspace**, add a competitor, and press **Research now**.

### Choosing an analysis provider

Set `AI_PROVIDER` in `.env`:

| Provider | Needed variables |
|---|---|
| `ollama` (local, private) | `OLLAMA_MODEL`, optionally `OLLAMA_BASE_URL` |
| `openai` (or any OpenAI-compatible API) | `OPENAI_API_KEY`, `OPENAI_MODEL`, optionally `OPENAI_BASE_URL` |
| `anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| `none` (default) | nothing. Pages are collected and saved; no reports are written |

Keys stay in the server environment. The Settings page shows whether a provider is connected but never any secret.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Bundles the server to `dist/server/` and the web app to `dist/web/` |
| `npm start` | Runs the production build (loads `.env`) |
| `npm run dev` | Dev mode: rebuilds the web bundle and restarts the server on change |
| `npm run typecheck` | `tsc --noEmit` over shared, server, web, tests |
| `npm test` | Runs the checked-in Node/TypeScript tests. (The repository currently contains no test files.) |
| `npm run test:e2e` | Legacy Playwright command; it requires a `tests/e2e/run.mjs` file, which is not included in this checkout. |
| `npm run check` | typecheck, then tests, then build |

## Repository layout

```
shared/    validation library and report types shared by server and web
server/    HTTP API, SQLite, auth, research pipeline, queue and worker, AI adapters, collection
web/       React 19 + TypeScript single-page app, bundled with esbuild
```

## Health check

`GET /api/health` returns database, worker and provider status without authentication.

## Production deployment

Build and run this as a single Node.js 22.13+ service. The build command is `npm run build`; the start command is `npm start`. The server serves `dist/web/` itself and exposes the API at the same origin under `/api/`, so no frontend deployment, reverse-proxy rewrite, or browser-visible environment variables are needed.

Set these deployment values:

| Setting | Value |
|---|---|
| Node.js | `22.13.0` or newer (required for `node:sqlite`) |
| Build command | `npm ci` (when `package-lock.json` is present), then `npm run build` |
| Start command | `npm start` |
| `HOST` | `0.0.0.0` |
| `PORT` | supplied by the host platform |
| `NODE_ENV` | `production` |
| `DATABASE_PATH` | a writable persistent-volume path, for example `/var/lib/ooda/ooda.sqlite` |
| `STATIC_DIR` | leave unset (defaults to `./dist/web`) |
| `COOKIE_SECURE` | `true` behind HTTPS |
| `TRUST_PROXY` | `true` only when the host supplies `X-Forwarded-For` |

Configure `AI_PROVIDER` and only that provider's server-side credential variables in the deployment environment. Do not put `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or any other AI secret in frontend files or build-time browser variables. SQLite is local to one running instance: use one application instance with a persistent volume, and back up that volume. It is not appropriate for stateless/serverless functions or horizontally scaled replicas sharing no filesystem.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `Cannot find module 'node:sqlite'` or the server will not start | Node is older than 22.13. Upgrade Node. |
| You sign in but are immediately signed out (production) | `COOKIE_SECURE` is true but you are on plain `http://`. Serve over HTTPS, or set `COOKIE_SECURE=false` for a private test. |
| "No AI provider is configured" | Set `AI_PROVIDER` and its variables in `.env`, then restart. |
| Run ends **Partial** with "analysis is unavailable" | Evidence was saved; fix the provider settings and press **Retry run**. |
| A page is "skipped" with a robots.txt message | The site disallows automated access to that page. OODA will not fetch it. |
| "Address points to a private or reserved network" | By design. Only public sites can be tracked. |
| "The page had almost no readable text" | The page renders with JavaScript. OODA reads server-rendered HTML only. Track a different page. |
| Behind a proxy every user shares one rate limit | Set `TRUST_PROXY=true` and make the proxy set `X-Forwarded-For`. |

## Known limitations

See the end of [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). In short: scheduled monitoring, team workspaces, notifications, a multi-agent "boardroom" analysis, and server-side PDF export are not built yet.
