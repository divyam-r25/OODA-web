# OODA

Competitive intelligence for founders and product teams. OODA watches public competitor pages, captures dated snapshots, highlights changes line-by-line, and synthesizes evidence-backed reports and trackable actions following the **Observe, Orient, Decide, Act** loop.

---

## Strict Zero-Cost AI Policy (₹0 / $0 Budget)

OODA is built to operate under a strict **₹0 / $0 budget** without requiring any paid subscriptions, credit card entries, or billing accounts.

- **No paid API dependencies**: Runs either genuinely locally via Ollama or via hosted free-tier providers.
- **No silent paid fallbacks**: If a free-tier quota is reached, OODA terminates the analysis cleanly, preserves all collected evidence, and marks the run as **Partial** with an informative message. It will **never** automatically bill or fall back to a paid model.
- **Guaranteed Free Model Enforcement**: In OpenRouter Free mode, only models ending with `:free` (or `openrouter/free`) are allowed. Any paid model is rejected at configuration time.

---

## Zero-Cost AI Modes

### Mode A: Local Ollama (Unlimited Private Local Inference)

Recommended for local development and private servers. Truly unlimited, offline, private, and 100% free.

1. **Install Ollama**:
   - macOS / Linux: `curl -fsSL https://ollama.com/install.sh | sh`
   - Windows: Download from [ollama.com](https://ollama.com).
2. **Download a model**:
   ```bash
   ollama pull llama3.2
   ```
3. **Verify Ollama is running**:
   ```bash
   ollama serve
   ```
4. **Configure `.env`**:
   ```env
   AI_PROVIDER=ollama
   OLLAMA_BASE_URL=http://127.0.0.1:11434
   OLLAMA_MODEL=llama3.2
   ```

> [!IMPORTANT]
> **Cloud / Render Notice**: `127.0.0.1` on cloud hosting (such as Render) refers to the host container itself, **not** your personal computer. Local PC Ollama is not accessible from Render unless you host an Ollama instance with a public reverse proxy. For Render deployments, use **Mode B (OpenRouter Free)** below.

---

### Mode B: OpenRouter Free (Zero-Cost Cloud & Render Deployments)

Designed for public cloud deployments like Render without local hardware.

1. **Get a free OpenRouter API key**:
   - Sign up at [openrouter.ai](https://openrouter.ai).
   - Generate a key at [openrouter.ai/keys](https://openrouter.ai/keys) (No credit card or payment info required).
2. **Select a free model** (must end in `:free` or match `openrouter/free`):
   - `nvidia/nemotron-3-ultra-550b-a55b:free` (Default)
   - `meta-llama/llama-3.3-70b-instruct:free`
   - `google/gemini-2.0-flash-exp:free`
   - `openrouter/free`
3. **Configure `.env` (or Render Environment Variables)**:
   ```env
   AI_PROVIDER=openrouter_free
   OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
   OPENROUTER_API_KEY=your_openrouter_free_key_here
   OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
   ```

> [!NOTE]
> **Free-Tier Limits & Quota Handling**:
> Free models on OpenRouter are shared community resources. Rate limits and availability vary based on provider capacity. When free quota or rate limits are reached (HTTP 429/402), OODA saves all gathered evidence safely and pauses the run with a clear message. You can retry the run later without risk of charges.

> [!WARNING]
> **Data Privacy Notice**:
> When using hosted third-party free endpoints, do not submit confidential, private, or proprietary documents without first reviewing the provider's data logging policies. For strictly confidential research, use **Mode A (Local Ollama)**.

---

## Workflow Modes: Single vs Multi-Agent

Configure the analysis workflow via `AI_WORKFLOW` in `.env`:

```env
AI_WORKFLOW=single        # "single" (default) or "multi_agent"
```

### 1. Single-Agent Mode (`AI_WORKFLOW=single`)
Executes a single, tightly-constrained model prompt that produces the structured findings, signals, and recommendations in one pass. Ideal for minimal latency and strict API rate limits.

### 2. Multi-Agent Pipeline (`AI_WORKFLOW=multi_agent`)
Executes four sequential logical roles using your configured free model:

```
[Collected Evidence] 
        │
        ▼
1. Research Analyst   ── Extracts verifiable facts with exact quotes & citations (E1, E2...).
        │
        ▼
2. Strategy Analyst   ── Evaluates implications, opportunities, threats & recommendations.
        │
        ▼
3. Skeptical Reviewer ── Audits claims against evidence; challenges unquoted facts or false changes.
        │
        ▼
4. Lead Synthesizer   ── Resolves conflicts conservatively into the verified OODA report schema.
        │
        ▼
[Validated Report]
```

- **Sequential Execution**: Agents run sequentially to conserve memory and stay within rate limits.
- **Adversarial Quality Control**: The Skeptical Reviewer independent audit challenges unverified quotes, false claims of historical change on baseline pages, and hallucinations.
- **Role-Specific Models (Optional)**:
  You can optionally assign custom models per role:
  ```env
  OPENROUTER_ANALYST_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
  OPENROUTER_STRATEGIST_MODEL=meta-llama/llama-3.3-70b-instruct:free
  OPENROUTER_CRITIC_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
  OPENROUTER_SYNTHESIS_MODEL=meta-llama/llama-3.3-70b-instruct:free
  ```

---

## Quick Start

Requires **Node.js 22.13 or newer** (uses built-in `node:sqlite`).

```bash
npm install
# Copy .env.example to .env
# Windows PowerShell: Copy-Item .env.example .env
# macOS / Linux:      cp .env.example .env
npm run build
npm start                   # http://127.0.0.1:8787
```

Development with live rebuild and auto-restarting server:
```bash
npm run dev
```

---

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Dev server with watch mode and auto-restart |
| `npm run build` | Bundles server (`dist/server/`) and web app (`dist/web/`) |
| `npm start` | Runs production server (reads `.env`) |
| `npm run typecheck` | Strict `tsc --noEmit` across shared, server, web, and tests |
| `npm test` | Runs the full test suite including zero-cost AI & multi-agent tests |
| `npm run test:e2e` | Runs E2E sanity check against live HTTP server |
| `npm run check` | Runs typecheck, tests, and build |

---

## Evidence Correctness & Security Safeguards

- **Quote Verification**: Facts must include quotes that match the scraped text verbatim (squashed for whitespace/punctuation). If quotes don't match, facts are demoted to interpretations or hypotheses.
- **No False Changes on Baseline**: First-time snapshots are marked as `baseline`. Change signals are strictly refused unless historical diff lines are present.
- **Untrusted Input Isolation**: Scraped web pages are treated strictly as untrusted data using random nonces (`<<<EVIDENCE nonce=...>>>`). Prompt injection instructions inside scraped pages are disregarded.
- **Final Validation**: All agent outputs pass through `extractJson()` and `validateAnalysis()`. Individual agents cannot write directly to the database.

---

## Render backend with Vercel frontend

Render remains the only production application service: it runs the Node server, SQLite database, research worker, and AI integrations. Vercel serves only the compiled React files in `dist/web`; it does not run `dist/server`, create a database, or start a worker.

The root [vercel.json](vercel.json) sends browser requests for `/api/*` to the Render service before applying the SPA fallback. Because the browser calls relative `/api/...` paths, Vercel proxies the request and response without exposing AI or database credentials to the frontend. This includes request methods, JSON bodies, query strings, and session cookies.

### Vercel setup

1. Import this repository as a Vercel project. Framework preset: **Other**; root directory: repository root.
2. Leave Vercel's install and build settings to the committed configuration: `npm ci` and `npm run build`; output directory: `dist/web`.
3. Edit `vercel.json` and replace `REPLACE_WITH_RENDER_HOST` with the hostname of the existing Render web service. For example, if Render is `https://ooda-api.onrender.com`, the destination becomes `https://ooda-api.onrender.com/api/:path*`. Do not add a second `/api` suffix to the hostname.
4. Deploy. Verify `/`, `/assets/...`, `/favicon.svg`, `/theme.js`, and a direct client route such as `/app/dashboard` load. Verify `/api/health` is proxied rather than returning HTML.

### Render setup for Vercel access

Do not change Render's build command, start command, database, worker, or AI configuration. Keep `COOKIE_SECURE=true` and `TRUST_PROXY=true` behind Render's HTTPS proxy. Add this one environment variable on Render, replacing the example with the exact Vercel production URL:

```env
TRUSTED_ORIGINS=https://your-vercel-project.vercel.app
```

Use comma-separated full origins only when more than one specific frontend is required, for example `https://your-vercel-project.vercel.app,https://preview.example.com`. Wildcards, paths, credentials, and arbitrary forwarded hosts are rejected. After configuring it, register or log in from the Vercel domain, refresh the page, start a research run, and confirm the same data is visible through Render: both domains use the same Render backend and database.
