import * as v from '../../shared/validate.ts';
import { HttpError, type Router, conflict, notFound, validate } from '../http/core.ts';
import { type Db, newId, nowIso } from '../db/db.ts';
import { aiStatus } from '../config.ts';
import { ownedCompetitor } from './competitors.ts';
import { enqueueRun, requeueRun } from '../worker/queue.ts';
import { logEvent } from '../worker/pipeline.ts';

const createSchema = v.obj({
  competitorId: v.str({ min: 1, max: 64, label: 'Competitor' }),
  focus: v.opt(v.str({ max: 300, label: 'Focus' })),
  idempotencyKey: v.opt(v.str({ min: 8, max: 80, label: 'Idempotency key' })),
});

const runOut = (r: Record<string, unknown>) => ({
  id: r.id, competitorId: r.competitor_id, competitorName: r.competitor_name, status: r.status, stage: r.stage, progress: r.progress,
  focus: r.focus, error: r.error, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, reportId: r.report_id ?? null,
  cancelRequested: !!r.cancel_requested,
});
const RUN_SELECT = `SELECT r.*, c.name AS competitor_name, (SELECT p.id FROM reports p WHERE p.run_id = r.id) AS report_id
  FROM runs r JOIN competitors c ON c.id = r.competitor_id`;

function ownedRun(db: Db, userId: string, id: string) {
  const r = db.get<Record<string, unknown>>(`${RUN_SELECT} WHERE r.id = ? AND r.user_id = ?`, id, userId);
  if (!r) throw notFound('Research run');
  return r;
}

export function registerResearchRoutes(r: Router) {
  r.get('/api/runs', (ctx) => {
    const u = ctx.requireUser();
    const where = ['r.user_id = ?'];
    const p: string[] = [u.id];
    const st = ctx.query.get('status');
    if (st && (v.RUN_STATUSES as readonly string[]).includes(st)) {
      where.push('r.status = ?');
      p.push(st);
    }
    const comp = ctx.query.get('competitorId');
    if (comp) {
      where.push('r.competitor_id = ?');
      p.push(comp);
    }
    const rows = ctx.svc.db.all<Record<string, unknown>>(`${RUN_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 100`, ...p);
    return { runs: rows.map(runOut) };
  });

  r.post('/api/runs', async (ctx) => {
    const u = ctx.requireUser();
    const { db, config } = ctx.svc;
    const b = validate(createSchema, await ctx.body());
    const comp = ownedCompetitor(db, u.id, b.competitorId);
    if (comp.archived) throw conflict('Restore this competitor before researching it.');
    if (b.idempotencyKey) {
      const existing = db.get<{ id: string }>('SELECT id FROM runs WHERE user_id = ? AND idempotency_key = ?', u.id, b.idempotencyKey);
      if (existing) return { run: runOut(ownedRun(db, u.id, existing.id)), warnings: [], reused: true };
    }
    if (db.get("SELECT 1 FROM runs WHERE competitor_id = ? AND status IN ('queued','running')", comp.id as string)) {
      throw conflict('A research run is already in progress for this competitor.');
    }
    const active = Number((db.get<{ c: number }>("SELECT COUNT(*) c FROM runs WHERE user_id = ? AND status IN ('queued','running')", u.id) as { c: number }).c);
    if (active >= config.limits.maxActiveRunsPerUser) throw new HttpError(429, 'rate_limited', `You can have ${config.limits.maxActiveRunsPerUser} runs in progress at once. Wait for one to finish.`);
    const today = Number((db.get<{ c: number }>('SELECT COUNT(*) c FROM runs WHERE user_id = ? AND created_at > ?', u.id, new Date(Date.now() - 86400_000).toISOString()) as { c: number }).c);
    if (today >= config.limits.maxRunsPerDay) throw new HttpError(429, 'rate_limited', 'Daily research limit reached. Try again tomorrow.');
    const id = newId('run');
    db.tx(() => {
      db.run('INSERT INTO runs (id, user_id, competitor_id, focus, idempotency_key, created_at) VALUES (?,?,?,?,?,?)', id, u.id, comp.id as string, b.focus ?? '', b.idempotencyKey ?? null, nowIso());
      enqueueRun(db, id);
      logEvent(db, id, u.id, 'info', 'queued', 'Run queued.');
    });
    ctx.svc.enqueue(id);
    const ai = aiStatus(config);
    return { run: runOut(ownedRun(db, u.id, id)), warnings: ai.configured ? [] : [`${ai.problem} Evidence will be collected, but no analysis will be generated.`], reused: false };
  });

  r.get('/api/runs/:id', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const run = ownedRun(db, u.id, ctx.params.id!);
    const events = db.all<Record<string, unknown>>('SELECT id, ts, level, stage, message FROM run_events WHERE run_id = ? AND user_id = ? ORDER BY id', run.id as string, u.id);
    const evidence = db.all<Record<string, unknown>>(
      `SELECT e.id, e.url, e.title, e.fetched_at, e.excerpt, e.previous_id, re.unchanged FROM run_evidence re JOIN evidence e ON e.id = re.evidence_id WHERE re.run_id = ? AND e.user_id = ? ORDER BY e.url`,
      run.id as string, u.id,
    );
    return {
      run: runOut(run),
      events: events.map((e) => ({ id: e.id, ts: e.ts, level: e.level, stage: e.stage, message: e.message })),
      evidence: evidence.map((e) => ({ id: e.id, url: e.url, title: e.title, fetchedAt: e.fetched_at, excerpt: e.excerpt, state: e.unchanged ? 'unchanged' : e.previous_id ? 'changed' : 'baseline' })),
    };
  });

  r.post('/api/runs/:id/cancel', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const run = ownedRun(db, u.id, ctx.params.id!);
    if (!['queued', 'running'].includes(run.status as string)) throw conflict('This run has already finished.');
    db.tx(() => {
      db.run('UPDATE runs SET cancel_requested = 1 WHERE id = ?', run.id as string);
      if (run.status === 'queued') {
        db.run("UPDATE runs SET status='cancelled', stage='cancelled', progress=0, error='Cancelled by you.', finished_at=? WHERE id = ? AND status='queued'", nowIso(), run.id as string);
        db.run("UPDATE jobs SET status='done' WHERE run_id = ?", run.id as string);
        logEvent(db, run.id as string, u.id, 'info', 'cancelled', 'Run cancelled before it started.');
      } else logEvent(db, run.id as string, u.id, 'info', 'cancelling', 'Cancellation requested. The run will stop at the next safe point.');
    });
    return { run: runOut(ownedRun(db, u.id, run.id as string)) };
  }, { status: 200 });

  r.post('/api/runs/:id/retry', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const run = ownedRun(db, u.id, ctx.params.id!);
    const retryable = ['failed', 'cancelled', 'partial'].includes(run.status as string) && !run.report_id;
    if (!retryable) throw conflict(run.report_id ? 'This run already produced a report. Start a new run instead.' : 'Only failed, cancelled, or incomplete runs can be retried.');
    if (db.get("SELECT 1 FROM runs WHERE competitor_id = ? AND status IN ('queued','running')", run.competitor_id as string)) throw conflict('Another run is already in progress for this competitor.');
    requeueRun(db, run.id as string);
    logEvent(db, run.id as string, u.id, 'info', 'queued', 'Retry requested. Evidence already collected will be reused.');
    ctx.svc.enqueue(run.id as string);
    return { run: runOut(ownedRun(db, u.id, run.id as string)) };
  }, { status: 200 });
}
