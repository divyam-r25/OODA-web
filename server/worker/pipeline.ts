import { createHash } from 'node:crypto';
import type { ReportContent, SourceConsidered } from '../../shared/report.ts';
import { type EvidenceRef, OutputError, extractJson, validateAnalysis } from '../ai/analysis.ts';
import { AiError } from '../ai/provider.ts';
import { type PromptEvidence, SYSTEM_PROMPT, buildUserPrompt } from '../ai/prompts.ts';
import { executeMultiAgentWorkflow } from '../ai/multiAgent.ts';
import { FetchError } from '../collect/net.ts';
import { assertRobotsAllowed } from '../collect/robots.ts';
import { safeFetch } from '../collect/safeFetch.ts';
import { contentHash, diffText, excerptOf, extractText } from '../collect/extract.ts';
import { type Db, newId, nowIso } from '../db/db.ts';
import type { Services } from '../http/core.ts';
import { aiStatus } from '../config.ts';
import { loadProfile } from '../modules/workspace.ts';

export class RetryableError extends Error {}
class CancelledError extends Error {}
const TERMINAL = ['completed', 'partial', 'failed', 'cancelled'];

export function logEvent(db: Db, runId: string, userId: string, level: 'info' | 'warn' | 'error', stage: string, message: string) {
  db.run('INSERT INTO run_events (run_id, user_id, ts, level, stage, message) VALUES (?,?,?,?,?,?)', runId, userId, nowIso(), level, stage, message);
}
function setStage(db: Db, runId: string, stage: string, progress: number) {
  db.run("UPDATE runs SET stage = ?, progress = ? WHERE id = ? AND status IN ('queued','running')", stage, progress, runId);
}
export function finishRun(db: Db, runId: string, status: 'completed' | 'partial' | 'failed' | 'cancelled', error: string | null = null) {
  return db.run("UPDATE runs SET status = ?, stage = ?, progress = ?, error = ?, finished_at = ? WHERE id = ? AND status IN ('queued','running')", status, status === 'completed' ? 'done' : status, status === 'failed' || status === 'cancelled' ? 0 : 100, error, nowIso(), runId);
}

interface RunRow { id: string; user_id: string; competitor_id: string; status: string; focus: string; cancel_requested: number }
interface EvRow { id: string; source_id: string; url: string; final_url: string; title: string; fetched_at: string; content_hash: string; text: string; truncated: number; previous_id: string | null; diff_json: string | null }

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

export async function executeRun(svc: Services, runId: string, attempt: number): Promise<void> {
  const { db, config, ai } = svc;
  const run = db.get<RunRow>('SELECT * FROM runs WHERE id = ?', runId);
  if (!run || TERMINAL.includes(run.status)) return; // idempotent: never reprocess a finished run
  const uid = run.user_id;
  const log = (level: 'info' | 'warn' | 'error', stage: string, msg: string) => logEvent(db, runId, uid, level, stage, msg);
  const checkCancel = () => {
    const r = db.get<{ cancel_requested: number }>('SELECT cancel_requested FROM runs WHERE id = ?', runId);
    if (r?.cancel_requested) throw new CancelledError();
  };

  try {
    db.run("UPDATE runs SET status='running', started_at = COALESCE(started_at, ?), stage='validating', progress=3 WHERE id = ?", nowIso(), runId);
    log('info', 'validating', attempt > 1 ? `Attempt ${attempt}: resuming run.` : 'Run started.');
    const competitor = db.get<{ id: string; name: string; url: string; notes: string }>('SELECT id, name, url, notes FROM competitors WHERE id = ? AND user_id = ?', run.competitor_id, uid);
    if (!competitor) {
      finishRun(db, runId, 'failed', 'The competitor no longer exists.');
      return;
    }
    const sources = db.all<{ id: string; url: string; label: string }>('SELECT id, url, label FROM tracked_sources WHERE competitor_id = ? AND user_id = ? ORDER BY created_at', competitor.id, uid);
    if (!sources.length) {
      finishRun(db, runId, 'failed', 'This competitor has no tracked pages.');
      return;
    }

    // ── Collect ────────────────────────────────────────────────────────
    setStage(db, runId, 'collecting', 8);
    const failures: { url: string; code: string; message: string }[] = [];
    for (const [i, src] of sources.entries()) {
      checkCancel();
      if (db.get('SELECT 1 FROM run_evidence WHERE run_id = ? AND source_id = ?', runId, src.id)) continue; // resume after retry
      setStage(db, runId, 'collecting', 8 + Math.round((i / sources.length) * 42));
      const opts = { ...config.fetch, accept: undefined };
      try {
        if (config.fetch.respectRobots) await assertRobotsAllowed(src.url, opts);
        const res = await safeFetch(src.url, opts);
        if (res.status < 200 || res.status >= 300) throw new FetchError('http', `The page returned HTTP ${res.status}.`);
        const ex = extractText(res.body, res.contentType);
        if (ex.text.length < 40) throw new FetchError('http', 'The page had almost no readable text (it may need JavaScript to render).');
        const hash = contentHash(ex.text);
        const prev = db.get<EvRow>('SELECT * FROM evidence WHERE source_id = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1', src.id);
        if (prev && prev.content_hash === hash) {
          db.run('INSERT OR IGNORE INTO run_evidence (run_id, source_id, evidence_id, unchanged) VALUES (?,?,?,1)', runId, src.id, prev.id);
          log('info', 'collecting', `${src.url}: unchanged since ${prev.fetched_at.slice(0, 10)}.`);
          continue;
        }
        const diff = prev ? diffText(prev.text, ex.text) : null;
        const evId = newId('evd');
        db.tx(() => {
          db.run(
            `INSERT INTO evidence (id, user_id, competitor_id, source_id, url, final_url, title, fetched_at, http_status, content_hash, excerpt, text, text_bytes, truncated, previous_id, diff_json)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            evId, uid, competitor.id, src.id, src.url, res.finalUrl, ex.title || src.url, nowIso(), res.status, hash, excerptOf(ex.text), ex.text,
            Buffer.byteLength(ex.text), ex.truncated || res.truncated ? 1 : 0, prev?.id ?? null, diff ? JSON.stringify(diff) : null,
          );
          db.run('INSERT OR IGNORE INTO run_evidence (run_id, source_id, evidence_id, unchanged) VALUES (?,?,?,0)', runId, src.id, evId);
        });
        log('info', 'collecting', prev ? `${src.url}: changed (${diff!.addedCount} lines added, ${diff!.removedCount} removed).` : `${src.url}: first snapshot captured.`);
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        const fe = e instanceof FetchError ? e : new FetchError('network', `Unexpected collection error: ${(e as Error).message}`);
        failures.push({ url: src.url, code: fe.code, message: fe.message });
        log('warn', 'collecting', `Skipped ${src.url}: ${fe.message}`);
      }
    }
    checkCancel();
    const linked = db.all<EvRow & { unchanged: number }>(
      `SELECT e.*, re.unchanged FROM run_evidence re JOIN evidence e ON e.id = re.evidence_id WHERE re.run_id = ? ORDER BY e.url`, runId,
    );
    if (!linked.length) {
      const detail = failures.map((f) => `${f.url}: ${f.message}`).join(' | ');
      const transient = failures.some((f) => f.code === 'network' || f.code === 'timeout' || f.code === 'robots_unavailable');
      if (transient && attempt < config.worker.maxAttempts) throw new RetryableError(`No pages could be collected (${detail}).`);
      finishRun(db, runId, 'failed', `No pages could be collected. ${detail}`);
      log('error', 'collecting', 'No pages could be collected.');
      return;
    }

    // ── Normalise / compare ────────────────────────────────────────────
    setStage(db, runId, 'comparing', 55);
    const hasHistory = linked.some((e) => e.previous_id !== null || e.unchanged === 1);
    const allUnchanged = linked.every((e) => e.unchanged === 1);
    const priorReport = db.get('SELECT 1 FROM reports WHERE competitor_id = ? AND user_id = ?', competitor.id, uid);
    if (allUnchanged && priorReport) {
      finishRun(db, runId, failures.length ? 'partial' : 'completed', failures.length ? `${failures.length} page(s) could not be collected.` : null);
      log('info', 'comparing', 'No page changed since the last run, so no new report was generated.');
      return;
    }
    if (db.get('SELECT 1 FROM reports WHERE run_id = ?', runId)) {
      finishRun(db, runId, failures.length ? 'partial' : 'completed', failures.length ? `${failures.length} page(s) could not be collected.` : null);
      return; // a previous attempt already saved the report
    }

    // ── Analyse ────────────────────────────────────────────────────────
    setStage(db, runId, 'analyzing', 62);
    if (!ai.configured) {
      finishRun(db, runId, 'partial', `Evidence was collected, but analysis is unavailable: ${aiStatus(config).problem ?? 'no AI provider configured.'}`);
      log('warn', 'analyzing', 'No AI provider configured. Evidence saved without analysis.');
      return;
    }
    const refs: EvidenceRef[] = [];
    const promptEvidence: PromptEvidence[] = linked.map((e, i) => {
      const ref = `E${i + 1}`;
      const changed = e.previous_id !== null && e.unchanged === 0;
      refs.push({ ref, evidenceId: e.id, text: e.text + (e.diff_json ? '\n' + JSON.parse(e.diff_json).added.join('\n') : ''), changed });
      const prevRow = e.previous_id ? db.get<{ fetched_at: string }>('SELECT fetched_at FROM evidence WHERE id = ?', e.previous_id) : undefined;
      return {
        ref, url: e.url, title: e.title, fetchedAt: e.fetched_at, text: e.text,
        state: e.unchanged === 1 ? 'unchanged' : changed ? 'changed' : 'baseline',
        ...(e.diff_json && changed ? { diff: { ...JSON.parse(e.diff_json), since: prevRow?.fetched_at.slice(0, 10) } } : {}),
      };
    });
    const promptCtx = {
      company: { ...loadProfile(db, uid), name: loadProfile(db, uid).companyName },
      competitor,
      focus: run.focus,
      evidence: promptEvidence,
    };
    const { prompt, truncatedRefs } = buildUserPrompt(promptCtx);
    let validated: ReturnType<typeof validateAnalysis> | null = null;
    let lastProblem = '';

    if (config.ai.workflow === 'multi_agent') {
      try {
        validated = await executeMultiAgentWorkflow(ai, promptCtx, prompt, refs, {
          checkCancel,
          log: (lvl, stg, msg) => log(lvl, stg, msg),
        });
      } catch (e) {
        if (e instanceof AiError && e.retryable && attempt < config.worker.maxAttempts) {
          throw new RetryableError(e.message);
        } else if (e instanceof AiError) {
          finishRun(db, runId, 'partial', `Evidence was collected, but analysis failed: ${e.message}`);
          log('error', 'analyzing', e.message);
          return;
        } else if (e instanceof OutputError) {
          finishRun(db, runId, 'partial', `Evidence was collected, but multi-agent analysis could not be validated: ${e.message}`);
          log('error', 'analyzing', e.message);
          return;
        } else {
          throw e;
        }
      }
    } else {
      // Single-agent workflow
      log('info', 'analyzing', 'Single-agent analyst evaluating evidence...');
      for (let tryNo = 1; tryNo <= 2 && !validated; tryNo++) {
        checkCancel();
        setStage(db, runId, tryNo === 1 ? 'analyzing' : 'validating_output', tryNo === 1 ? 65 : 80);
        try {
          const raw = await ai.generate(SYSTEM_PROMPT, tryNo === 1 ? prompt : `${prompt}\n\nYour previous reply was rejected: ${lastProblem}\nReturn ONLY one valid JSON object that follows the schema.`);
          setStage(db, runId, 'validating_output', 82);
          validated = validateAnalysis(extractJson(raw), refs);
        } catch (e) {
          if (e instanceof OutputError) {
            lastProblem = e.message;
            log('warn', 'validating_output', `Model output rejected: ${e.message}${tryNo === 1 ? ' Retrying once.' : ''}`);
          } else if (e instanceof AiError && e.retryable && attempt < config.worker.maxAttempts) {
            throw new RetryableError(e.message);
          } else if (e instanceof AiError) {
            finishRun(db, runId, 'partial', `Evidence was collected, but analysis failed: ${e.message}`);
            log('error', 'analyzing', e.message);
            return;
          } else throw e;
        }
      }
      if (!validated) {
        finishRun(db, runId, 'partial', `Evidence was collected, but the model's output could not be validated (${lastProblem}).`);
        return;
      }
    }

    // ── Persist ────────────────────────────────────────────────────────
    setStage(db, runId, 'saving', 90);
    checkCancel();
    const limitations = [...validated.limitations];
    if (!hasHistory) limitations.unshift('This is the first snapshot of these pages, so nothing can be said about change over time yet.');
    for (const f of failures) limitations.push(`Could not collect ${f.url}: ${f.message}`);
    if (linked.some((e) => e.truncated)) limitations.push('Some pages were longer than the collection limit and were truncated.');
    if (truncatedRefs.length) limitations.push(`The analysis saw only the first part of ${truncatedRefs.length} long page${truncatedRefs.length === 1 ? '' : 's'}.`);
    const sourcesConsidered: SourceConsidered[] = linked.map((e) => ({
      evidenceId: e.id, url: e.url, title: e.title, fetchedAt: e.fetched_at,
      state: e.unchanged === 1 ? 'unchanged' : e.previous_id ? 'changed' : 'baseline',
    }));
    const content: ReportContent = { summary: validated.summary, findings: validated.findings, recommendations: validated.recommendations, limitations, sources: sourcesConsidered };
    const reportId = newId('rpt');
    const compName = competitor.name;
    db.tx(() => {
      if (db.get("SELECT 1 FROM runs WHERE id = ? AND status = 'cancelled'", runId)) throw new CancelledError();
      db.run(
        'INSERT OR IGNORE INTO reports (id, user_id, competitor_id, run_id, title, summary, content_json, provider, model, has_history, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        reportId, uid, competitor.id, runId, `${compName}: ${new Date().toISOString().slice(0, 10)}`, validated!.summary, JSON.stringify(content), ai.provider, ai.model, hasHistory ? 1 : 0, nowIso(),
      );
      for (const e of linked) db.run('INSERT OR IGNORE INTO report_evidence (report_id, evidence_id) VALUES (?,?)', reportId, e.id);
      for (const s of validated!.signals) {
        const key = sha1([competitor.id, s.category, s.title.toLowerCase().replace(/\s+/g, ' '), [...s.evidenceIds].sort().join(',')].join('|'));
        const sid = newId('sig');
        const ins = db.run(
          `INSERT OR IGNORE INTO signals (id, user_id, competitor_id, run_id, report_id, category, severity, confidence, basis, title, summary, dedupe_key, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          sid, uid, competitor.id, runId, reportId, s.category, s.severity, s.confidence, s.basis, s.title, s.summary, key, nowIso(),
        );
        if (ins.changes) for (const evId of s.evidenceIds) db.run('INSERT OR IGNORE INTO signal_evidence (signal_id, evidence_id) VALUES (?,?)', sid, evId);
      }
    });
    const partialMsg = failures.length ? `${failures.length} of ${sources.length} pages could not be collected.` : null;
    finishRun(db, runId, failures.length ? 'partial' : 'completed', partialMsg);
    log('info', 'saving', `Report saved with ${validated.findings.length} findings and ${validated.signals.length} signals.`);
  } catch (e) {
    if (e instanceof CancelledError) {
      finishRun(db, runId, 'cancelled', 'Cancelled by you.');
      logEvent(db, runId, uid, 'info', 'cancelled', 'Run cancelled.');
      return;
    }
    throw e;
  }
}
