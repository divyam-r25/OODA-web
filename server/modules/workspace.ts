import * as v from '../../shared/validate.ts';
import { type Router, validate } from '../http/core.ts';
import { nowIso } from '../db/db.ts';
import { aiStatus } from '../config.ts';

const profileSchema = v.obj({
  companyName: v.str({ max: 120, label: 'Company name' }),
  website: v.opt(v.url({ label: 'Website' })),
  industry: v.str({ max: 120, label: 'Industry' }),
  audience: v.str({ max: 300, label: 'Audience' }),
  goal: v.str({ max: 300, label: 'Goal' }),
  description: v.str({ max: 1000, label: 'Description' }),
});

interface WsRow {
  company_name: string;
  website: string;
  industry: string;
  audience: string;
  goal: string;
  description: string;
}
export const loadProfile = (db: import('../db/db.ts').Db, userId: string) => {
  const w = db.get<WsRow>('SELECT * FROM workspaces WHERE user_id = ?', userId);
  return {
    companyName: w?.company_name ?? '',
    website: w?.website ?? '',
    industry: w?.industry ?? '',
    audience: w?.audience ?? '',
    goal: w?.goal ?? '',
    description: w?.description ?? '',
  };
};

export function registerWorkspaceRoutes(r: Router) {
  r.get('/api/settings', (ctx) => {
    const u = ctx.requireUser();
    const { db, config } = ctx.svc;
    const ai = aiStatus(config);
    return {
      account: u,
      profile: loadProfile(db, u.id),
      ai: {
        provider: ai.provider,
        configured: ai.configured,
        model: ai.model,
        workflow: ai.workflow,
        isLocal: ai.isLocal,
        isFree: ai.isFree,
        problem: ai.problem ?? null,
        roleModels: {
          analyst: config.ai.provider === 'ollama' ? config.ai.ollamaAnalystModel : config.ai.openrouterAnalystModel,
          strategist: config.ai.provider === 'ollama' ? config.ai.ollamaStrategistModel : config.ai.openrouterStrategistModel,
          critic: config.ai.provider === 'ollama' ? config.ai.ollamaCriticModel : config.ai.openrouterCriticModel,
          synthesizer: config.ai.provider === 'ollama' ? config.ai.ollamaSynthesisModel : config.ai.openrouterSynthesisModel,
        },
      },
      limits: config.limits,
      collection: { respectRobots: config.fetch.respectRobots, timeoutMs: config.fetch.timeoutMs, maxBytes: config.fetch.maxBytes },
    };
  });

  r.put('/api/settings/profile', async (ctx) => {
    const u = ctx.requireUser();
    const p = validate(profileSchema, await ctx.body());
    ctx.svc.db.run(
      `UPDATE workspaces SET company_name=?, website=?, industry=?, audience=?, goal=?, description=?, updated_at=? WHERE user_id=?`,
      p.companyName,
      p.website ?? '',
      p.industry,
      p.audience,
      p.goal,
      p.description,
      nowIso(),
      u.id,
    );
    return { profile: loadProfile(ctx.svc.db, u.id) };
  });

  r.get('/api/dashboard', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const n = (sql: string, ...p: string[]) => Number((db.get<{ c: number }>(sql, ...p) as { c: number }).c);
    const counts = {
      competitors: n('SELECT COUNT(*) c FROM competitors WHERE user_id=? AND archived=0', u.id),
      newSignals: n("SELECT COUNT(*) c FROM signals WHERE user_id=? AND review_status='new'", u.id),
      criticalNew: n("SELECT COUNT(*) c FROM signals WHERE user_id=? AND review_status='new' AND severity IN ('high','critical')", u.id),
      activeRuns: n("SELECT COUNT(*) c FROM runs WHERE user_id=? AND status IN ('queued','running')", u.id),
      reports: n('SELECT COUNT(*) c FROM reports WHERE user_id=?', u.id),
      openActions: n("SELECT COUNT(*) c FROM actions WHERE user_id=? AND status!='done'", u.id),
      overdueActions: n("SELECT COUNT(*) c FROM actions WHERE user_id=? AND status!='done' AND due_date IS NOT NULL AND due_date < date('now')", u.id),
    };
    const queue = db.all(
      `SELECT s.id, s.title, s.severity, s.category, s.confidence, s.basis, s.created_at AS createdAt, c.id AS competitorId, c.name AS competitorName
       FROM signals s JOIN competitors c ON c.id = s.competitor_id
       WHERE s.user_id = ? AND s.review_status = 'new'
       ORDER BY CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, s.created_at DESC LIMIT 8`,
      u.id,
    );
    const runs = db.all(
      `SELECT r.id, r.status, r.stage, r.progress, r.created_at AS createdAt, r.finished_at AS finishedAt, c.name AS competitorName, c.id AS competitorId
       FROM runs r JOIN competitors c ON c.id = r.competitor_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 5`,
      u.id,
    );
    const stale = db.all(
      `SELECT c.id, c.name, (SELECT MAX(finished_at) FROM runs r WHERE r.competitor_id = c.id AND r.status IN ('completed','partial')) AS lastResearched
       FROM competitors c WHERE c.user_id = ? AND c.archived = 0
       AND COALESCE((SELECT MAX(finished_at) FROM runs r WHERE r.competitor_id = c.id AND r.status IN ('completed','partial')), '') < ?
       ORDER BY lastResearched IS NOT NULL, lastResearched LIMIT 6`,
      u.id,
      new Date(Date.now() - 14 * 86400_000).toISOString(),
    );
    const actions = db.all(
      `SELECT id, title, priority, status, due_date AS dueDate FROM actions WHERE user_id = ? AND status != 'done'
       ORDER BY due_date IS NULL, due_date, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 5`,
      u.id,
    );
    const ai = aiStatus(ctx.svc.config);
    return { counts, queue, runs, stale, actions, ai: { configured: ai.configured, problem: ai.problem ?? null }, profile: loadProfile(db, u.id) };
  });
}
