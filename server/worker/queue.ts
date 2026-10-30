import type { Config } from '../config.ts';
import { type Db, newId, nowIso } from '../db/db.ts';
import type { Services } from '../http/core.ts';
import { RetryableError, executeRun, finishRun, logEvent } from './pipeline.ts';

export function enqueueRun(db: Db, runId: string) {
  db.run("INSERT OR IGNORE INTO jobs (id, run_id, status, attempts, run_after, created_at) VALUES (?,?, 'queued', 0, ?, ?)", newId('job'), runId, nowIso(), nowIso());
}

/** Re-open a failed/cancelled run for another attempt. Evidence already collected is kept and reused. */
export function requeueRun(db: Db, runId: string) {
  db.tx(() => {
    db.run("UPDATE runs SET status='queued', stage='queued', progress=0, error=NULL, cancel_requested=0, finished_at=NULL WHERE id = ?", runId);
    const j = db.run("UPDATE jobs SET status='queued', attempts=0, run_after=?, lease_expires=NULL, last_error=NULL WHERE run_id = ?", nowIso(), runId);
    if (!j.changes) enqueueRun(db, runId);
  });
}

function lease(db: Db, config: Config): { id: string; run_id: string; attempts: number } | null {
  return db.tx(() => {
    const now = nowIso();
    db.run("UPDATE jobs SET status='queued' WHERE status='leased' AND lease_expires < ?", now); // crash recovery
    const job = db.get<{ id: string; run_id: string; attempts: number }>("SELECT id, run_id, attempts FROM jobs WHERE status='queued' AND run_after <= ? ORDER BY created_at LIMIT 1", now);
    if (!job) return null;
    db.run("UPDATE jobs SET status='leased', attempts = attempts + 1, lease_expires = ? WHERE id = ?", new Date(Date.now() + config.worker.leaseMs).toISOString(), job.id);
    return { ...job, attempts: job.attempts + 1 };
  });
}

/** Process one ready job. Returns false when the queue is empty. */
export async function processOne(svc: Services, backoffMs = 5000): Promise<boolean> {
  const { db, config } = svc;
  const job = lease(db, config);
  if (!job) return false;
  try {
    await executeRun(svc, job.run_id, job.attempts);
    db.run("UPDATE jobs SET status='done', lease_expires=NULL WHERE id = ?", job.id);
  } catch (e) {
    const run = db.get<{ user_id: string }>('SELECT user_id FROM runs WHERE id = ?', job.run_id);
    const msg = (e as Error).message;
    if (e instanceof RetryableError && job.attempts < config.worker.maxAttempts) {
      db.run("UPDATE jobs SET status='queued', run_after=?, lease_expires=NULL, last_error=? WHERE id = ?", new Date(Date.now() + backoffMs * 2 ** (job.attempts - 1)).toISOString(), msg, job.id);
      db.run("UPDATE runs SET status='queued', stage='retrying' WHERE id = ? AND status='running'", job.run_id);
      if (run) logEvent(db, job.run_id, run.user_id, 'warn', 'retrying', `Temporary problem: ${msg} Will retry (attempt ${job.attempts + 1} of ${config.worker.maxAttempts}).`);
    } else {
      db.run("UPDATE jobs SET status='failed', lease_expires=NULL, last_error=? WHERE id = ?", msg, job.id);
      const hasEvidence = db.get('SELECT 1 FROM run_evidence WHERE run_id = ?', job.run_id);
      const friendly = e instanceof RetryableError ? msg : 'An unexpected error stopped this run.';
      if (!(e instanceof RetryableError)) console.error('[worker] run failed', job.run_id, e);
      finishRun(db, job.run_id, hasEvidence ? 'partial' : 'failed', hasEvidence ? `Evidence was collected, but analysis could not finish: ${friendly}` : friendly);
      if (run) logEvent(db, job.run_id, run.user_id, 'error', 'failed', friendly);
    }
  }
  return true;
}

export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = 0;
  private stopped = true;
  constructor(private svc: Services, private concurrency = 2) {}

  private tick = async () => {
    this.timer = null;
    if (this.stopped) return;
    while (!this.stopped && this.inFlight < this.concurrency) {
      this.inFlight++;
      const got = await processOne(this.svc)
        .catch((e) => {
          console.error('[worker] error', e);
          return false;
        })
        .finally(() => this.inFlight--);
      if (!got) break;
    }
    this.schedule(this.svc.config.worker.pollMs);
  };
  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.tick, ms);
  }
  start() {
    this.stopped = false;
    this.schedule(50);
  }
  /** Wake the loop immediately (e.g. after a run is enqueued). */
  nudge() {
    this.schedule(0);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.inFlight > 0) await new Promise((r) => setTimeout(r, 20));
  }
}
