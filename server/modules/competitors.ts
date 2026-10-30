import * as v from '../../shared/validate.ts';
import { HttpError, type Router, conflict, notFound, validate } from '../http/core.ts';
import { type Db, newId, nowIso } from '../db/db.ts';
import { assertPublicUrlShape } from '../collect/net.ts';

const sourceInput = v.obj({ url: v.url({ label: 'Page URL' }), label: v.opt(v.str({ max: 60, label: 'Label' })) });
const createSchema = v.obj({
  name: v.str({ min: 1, max: 120, label: 'Name' }),
  url: v.url({ label: 'Website' }),
  tier: v.opt(v.oneOf(v.TIERS, 'Tier')),
  notes: v.opt(v.str({ max: 2000, label: 'Notes' })),
  extraSources: v.opt(v.arr(sourceInput, { max: 5, label: 'Extra pages' })),
});
const patchSchema = v.obj({
  name: v.opt(v.str({ min: 1, max: 120, label: 'Name' })),
  tier: v.opt(v.oneOf(v.TIERS, 'Tier')),
  notes: v.opt(v.str({ max: 2000, label: 'Notes' })),
  archived: v.opt(v.bool()),
});

export function ownedCompetitor(db: Db, userId: string, id: string) {
  const row = db.get<Record<string, unknown>>('SELECT * FROM competitors WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Competitor');
  return row;
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function present(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    tier: r.tier,
    notes: r.notes,
    archived: !!r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function registerCompetitorRoutes(r: Router) {
  r.get('/api/competitors', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const q = (ctx.query.get('q') ?? '').trim().slice(0, 100);
    const tier = ctx.query.get('tier');
    const archived = ctx.query.get('archived') === 'true' ? 1 : 0;
    const where = ['c.user_id = ?', 'c.archived = ?'];
    const params: (string | number)[] = [u.id, archived];
    if (q) {
      where.push("(c.name LIKE ? ESCAPE '\\' OR c.url LIKE ? ESCAPE '\\')");
      params.push(like(q), like(q));
    }
    if (tier && (v.TIERS as readonly string[]).includes(tier)) {
      where.push('c.tier = ?');
      params.push(tier);
    }
    const sort = ctx.query.get('sort') === 'name' ? 'c.name COLLATE NOCASE' : 'c.created_at DESC';
    const rows = db.all<Record<string, unknown>>(
      `SELECT c.*,
        (SELECT COUNT(*) FROM tracked_sources t WHERE t.competitor_id = c.id) AS source_count,
        (SELECT COUNT(*) FROM signals s WHERE s.competitor_id = c.id AND s.review_status = 'new') AS new_signals,
        (SELECT COUNT(*) FROM reports p WHERE p.competitor_id = c.id) AS report_count,
        (SELECT r.id FROM runs r WHERE r.competitor_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_id,
        (SELECT r.status FROM runs r WHERE r.competitor_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_status,
        (SELECT r.finished_at FROM runs r WHERE r.competitor_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_at
       FROM competitors c WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT 200`,
      ...(params as never[]),
    );
    return {
      competitors: rows.map((c) => ({
        ...present(c),
        sourceCount: c.source_count,
        newSignals: c.new_signals,
        reportCount: c.report_count,
        lastRun: c.last_run_id ? { id: c.last_run_id, status: c.last_run_status, finishedAt: c.last_run_at } : null,
      })),
    };
  });

  r.post('/api/competitors', async (ctx) => {
    const u = ctx.requireUser();
    const { db, config } = ctx.svc;
    const input = validate(createSchema, await ctx.body());
    const count = Number((db.get<{ c: number }>('SELECT COUNT(*) c FROM competitors WHERE user_id = ?', u.id) as { c: number }).c);
    if (count >= config.limits.maxCompetitors) throw new HttpError(403, 'limit_reached', `You can track up to ${config.limits.maxCompetitors} competitors.`);
    const urls = [{ url: input.url, label: 'Homepage' }, ...(input.extraSources ?? []).map((s) => ({ url: s.url, label: s.label ?? '' }))];
    const seen = new Set<string>();
    for (const s of urls) {
      try {
        assertPublicUrlShape(s.url, config.fetch.allowPrivateNetwork);
      } catch (e) {
        throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { fields: { url: (e as Error).message } });
      }
      if (seen.has(s.url)) throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { fields: { extraSources: 'Each page can only be added once.' } });
      seen.add(s.url);
    }
    if (urls.length > config.limits.maxSourcesPerCompetitor) throw new HttpError(422, 'validation_failed', 'Too many pages.', { fields: { extraSources: `Track at most ${config.limits.maxSourcesPerCompetitor} pages per competitor.` } });
    if (db.get('SELECT 1 FROM competitors WHERE user_id = ? AND url = ?', u.id, input.url)) throw conflict('You are already tracking this website.');
    const id = newId('cmp');
    const t = nowIso();
    db.tx(() => {
      db.run(
        'INSERT INTO competitors (id, user_id, name, url, tier, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        id, u.id, input.name, input.url, input.tier ?? 'direct', input.notes ?? '', t, t,
      );
      for (const s of urls) {
        db.run('INSERT INTO tracked_sources (id, user_id, competitor_id, url, label, created_at) VALUES (?,?,?,?,?,?)', newId('src'), u.id, id, s.url, s.label, t);
      }
    });
    return { competitor: present(ownedCompetitor(db, u.id, id)) };
  });

  r.get('/api/competitors/:id', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const c = ownedCompetitor(db, u.id, ctx.params.id!);
    const sources = db.all<Record<string, unknown>>(
      `SELECT t.id, t.url, t.label,
        (SELECT e.fetched_at FROM evidence e WHERE e.source_id = t.id ORDER BY e.fetched_at DESC LIMIT 1) AS last_fetched,
        (SELECT e.title FROM evidence e WHERE e.source_id = t.id ORDER BY e.fetched_at DESC LIMIT 1) AS last_title,
        (SELECT COUNT(*) FROM evidence e WHERE e.source_id = t.id) AS snapshots
       FROM tracked_sources t WHERE t.competitor_id = ? AND t.user_id = ? ORDER BY t.created_at`,
      c.id as string, u.id,
    );
    const runs = db.all(
      `SELECT id, status, stage, progress, error, created_at AS createdAt, finished_at AS finishedAt FROM runs WHERE competitor_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10`,
      c.id as string, u.id,
    );
    const reports = db.all(
      `SELECT id, title, summary, created_at AS createdAt, has_history AS hasHistory FROM reports WHERE competitor_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10`,
      c.id as string, u.id,
    );
    const signals = db.all(
      `SELECT id, title, severity, category, confidence, basis, review_status AS reviewStatus, created_at AS createdAt FROM signals WHERE competitor_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20`,
      c.id as string, u.id,
    );
    return {
      competitor: present(c),
      sources: sources.map((s) => ({ id: s.id, url: s.url, label: s.label, lastFetched: s.last_fetched, lastTitle: s.last_title, snapshots: s.snapshots })),
      runs,
      reports,
      signals,
    };
  });

  r.patch('/api/competitors/:id', async (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const c = ownedCompetitor(db, u.id, ctx.params.id!);
    const p = validate(patchSchema, await ctx.body());
    db.run(
      'UPDATE competitors SET name=?, tier=?, notes=?, archived=?, updated_at=? WHERE id=? AND user_id=?',
      p.name ?? (c.name as string), p.tier ?? (c.tier as string), p.notes ?? (c.notes as string),
      p.archived === undefined ? Number(c.archived) : p.archived ? 1 : 0, nowIso(), c.id as string, u.id,
    );
    return { competitor: present(ownedCompetitor(db, u.id, c.id as string)) };
  });

  r.del('/api/competitors/:id', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const c = ownedCompetitor(db, u.id, ctx.params.id!);
    const active = db.get("SELECT 1 FROM runs WHERE competitor_id = ? AND status IN ('queued','running')", c.id as string);
    if (active) throw conflict('Cancel the active research run before deleting this competitor.');
    db.run('DELETE FROM competitors WHERE id = ? AND user_id = ?', c.id as string, u.id);
    return undefined;
  });

  r.post('/api/competitors/:id/sources', async (ctx) => {
    const u = ctx.requireUser();
    const { db, config } = ctx.svc;
    const c = ownedCompetitor(db, u.id, ctx.params.id!);
    const s = validate(sourceInput, await ctx.body());
    try {
      assertPublicUrlShape(s.url, config.fetch.allowPrivateNetwork);
    } catch (e) {
      throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { fields: { url: (e as Error).message } });
    }
    const n = Number((db.get<{ c: number }>('SELECT COUNT(*) c FROM tracked_sources WHERE competitor_id = ?', c.id as string) as { c: number }).c);
    if (n >= config.limits.maxSourcesPerCompetitor) throw new HttpError(403, 'limit_reached', `Track at most ${config.limits.maxSourcesPerCompetitor} pages per competitor.`);
    if (db.get('SELECT 1 FROM tracked_sources WHERE competitor_id = ? AND url = ?', c.id as string, s.url)) throw conflict('This page is already tracked.');
    const id = newId('src');
    db.run('INSERT INTO tracked_sources (id, user_id, competitor_id, url, label, created_at) VALUES (?,?,?,?,?,?)', id, u.id, c.id as string, s.url, s.label ?? '', nowIso());
    return { source: { id, url: s.url, label: s.label ?? '' } };
  });

  r.del('/api/competitors/:id/sources/:sourceId', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const c = ownedCompetitor(db, u.id, ctx.params.id!);
    const n = Number((db.get<{ c: number }>('SELECT COUNT(*) c FROM tracked_sources WHERE competitor_id = ?', c.id as string) as { c: number }).c);
    if (n <= 1) throw conflict('A competitor needs at least one tracked page.');
    const res = db.run('DELETE FROM tracked_sources WHERE id = ? AND competitor_id = ? AND user_id = ?', ctx.params.sourceId!, c.id as string, u.id);
    if (!res.changes) throw notFound('Page');
    return undefined;
  });
}
