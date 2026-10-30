import type { ReportContent } from '../../shared/report.ts';
import * as v from '../../shared/validate.ts';
import { HttpError, type Router, notFound, validate } from '../http/core.ts';
import type { Db } from '../db/db.ts';
import { nowIso } from '../db/db.ts';
import { reportToMarkdown } from './export.ts';

const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const SEV_ORDER = "CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

const sigOut = (s: Record<string, unknown>) => ({
  id: s.id, title: s.title, summary: s.summary, severity: s.severity, category: s.category, confidence: s.confidence, basis: s.basis,
  reviewStatus: s.review_status, reviewedAt: s.reviewed_at, createdAt: s.created_at, competitorId: s.competitor_id, competitorName: s.competitor_name,
  reportId: s.report_id, runId: s.run_id, evidenceCount: s.evidence_count,
});

export function evidenceFor(db: Db, userId: string, ids: string[]) {
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  return db.all<Record<string, unknown>>(
    `SELECT id, url, final_url, title, fetched_at, excerpt, http_status, truncated, previous_id, diff_json FROM evidence WHERE user_id = ? AND id IN (${marks})`,
    userId, ...ids,
  ).map((e) => ({
    id: e.id as string, url: e.url as string, finalUrl: e.final_url as string, title: e.title as string, fetchedAt: e.fetched_at as string,
    excerpt: e.excerpt as string, httpStatus: e.http_status as number,
    truncated: !!e.truncated, hasPrevious: !!e.previous_id,
    diff: e.diff_json ? (() => { const d = JSON.parse(e.diff_json as string); return { added: d.added.slice(0, 12), removed: d.removed.slice(0, 12), addedCount: d.addedCount, removedCount: d.removedCount }; })() : null,
  }));
}

export function registerIntelRoutes(r: Router) {
  // ── signals ─────────────────────────────────────────────
  r.get('/api/signals', (ctx) => {
    const u = ctx.requireUser();
    const where = ['s.user_id = ?'];
    const p: (string | number)[] = [u.id];
    const eq = (q: string, col: string, allowed?: readonly string[]) => {
      const val = ctx.query.get(q);
      if (val && (!allowed || allowed.includes(val))) {
        where.push(`${col} = ?`);
        p.push(val);
      }
    };
    eq('severity', 's.severity', v.SEVERITIES);
    eq('category', 's.category', v.SIGNAL_CATEGORIES);
    eq('status', 's.review_status', v.REVIEW_STATUSES);
    eq('competitorId', 's.competitor_id');
    eq('basis', 's.basis', ['change', 'observation']);
    const q = (ctx.query.get('q') ?? '').trim().slice(0, 100);
    if (q) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.summary LIKE ? ESCAPE '\\')");
      p.push(like(q), like(q));
    }
    const minConf = Number(ctx.query.get('minConfidence'));
    if (Number.isFinite(minConf) && minConf > 0) {
      where.push('s.confidence >= ?');
      p.push(Math.min(1, minConf));
    }
    const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 25));
    const offset = Math.max(0, Number(ctx.query.get('offset')) || 0);
    const order = ctx.query.get('sort') === 'severity' ? `${SEV_ORDER}, s.created_at DESC` : 's.created_at DESC';
    const base = `FROM signals s JOIN competitors c ON c.id = s.competitor_id WHERE ${where.join(' AND ')}`;
    const total = Number((ctx.svc.db.get<{ c: number }>(`SELECT COUNT(*) c ${base}`, ...(p as never[])) as { c: number }).c);
    const rows = ctx.svc.db.all<Record<string, unknown>>(
      `SELECT s.*, c.name AS competitor_name, (SELECT COUNT(*) FROM signal_evidence se WHERE se.signal_id = s.id) AS evidence_count ${base} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...(p as never[]), limit, offset,
    );
    return { signals: rows.map(sigOut), total, limit, offset };
  });

  r.get('/api/signals/:id', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const s = db.get<Record<string, unknown>>(
      `SELECT s.*, c.name AS competitor_name, 0 AS evidence_count FROM signals s JOIN competitors c ON c.id = s.competitor_id WHERE s.id = ? AND s.user_id = ?`,
      ctx.params.id!, u.id,
    );
    if (!s) throw notFound('Signal');
    const ids = db.all<{ evidence_id: string }>('SELECT evidence_id FROM signal_evidence WHERE signal_id = ?', s.id as string).map((x) => x.evidence_id);
    const actions = db.all('SELECT id, title, status FROM actions WHERE signal_id = ? AND user_id = ?', s.id as string, u.id);
    return { signal: { ...sigOut(s), evidenceCount: ids.length }, evidence: evidenceFor(db, u.id, ids), actions };
  });

  r.patch('/api/signals/:id', async (ctx) => {
    const u = ctx.requireUser();
    const b = validate(v.obj({ reviewStatus: v.oneOf(v.REVIEW_STATUSES, 'Review status') }), await ctx.body());
    const res = ctx.svc.db.run('UPDATE signals SET review_status = ?, reviewed_at = ? WHERE id = ? AND user_id = ?', b.reviewStatus, b.reviewStatus === 'new' ? null : nowIso(), ctx.params.id!, u.id);
    if (!res.changes) throw notFound('Signal');
    return { ok: true, reviewStatus: b.reviewStatus };
  });

  // ── reports ─────────────────────────────────────────────
  r.get('/api/reports', (ctx) => {
    const u = ctx.requireUser();
    const where = ['p.user_id = ?'];
    const prm: string[] = [u.id];
    const comp = ctx.query.get('competitorId');
    if (comp) {
      where.push('p.competitor_id = ?');
      prm.push(comp);
    }
    const q = (ctx.query.get('q') ?? '').trim().slice(0, 100);
    if (q) {
      where.push("(p.title LIKE ? ESCAPE '\\' OR p.summary LIKE ? ESCAPE '\\')");
      prm.push(like(q), like(q));
    }
    const rows = ctx.svc.db.all<Record<string, unknown>>(
      `SELECT p.id, p.title, p.summary, p.created_at, p.has_history, p.provider, p.model, c.id AS cid, c.name AS cname,
        (SELECT COUNT(*) FROM signals s WHERE s.report_id = p.id) AS signal_count
       FROM reports p JOIN competitors c ON c.id = p.competitor_id WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT 200`,
      ...prm,
    );
    return { reports: rows.map((x) => ({ id: x.id, title: x.title, summary: x.summary, createdAt: x.created_at, hasHistory: !!x.has_history, provider: x.provider, model: x.model, competitorId: x.cid, competitorName: x.cname, signalCount: x.signal_count })) };
  });

  const loadReport = (db: Db, userId: string, id: string) => {
    const p = db.get<Record<string, unknown>>(
      `SELECT p.*, c.name AS competitor_name FROM reports p JOIN competitors c ON c.id = p.competitor_id WHERE p.id = ? AND p.user_id = ?`, id, userId);
    if (!p) throw notFound('Report');
    const content = JSON.parse(p.content_json as string) as ReportContent;
    const evIds = db.all<{ evidence_id: string }>('SELECT evidence_id FROM report_evidence WHERE report_id = ?', id).map((e) => e.evidence_id);
    const evidence = evidenceFor(db, userId, evIds);
    const signals = db.all<Record<string, unknown>>(
      `SELECT s.*, c.name AS competitor_name, (SELECT COUNT(*) FROM signal_evidence se WHERE se.signal_id = s.id) AS evidence_count FROM signals s JOIN competitors c ON c.id = s.competitor_id WHERE s.report_id = ? AND s.user_id = ? ORDER BY ${SEV_ORDER}`, id, userId).map(sigOut);
    const report = { id: p.id as string, title: p.title as string, createdAt: p.created_at as string, provider: p.provider as string, model: p.model as string, hasHistory: !!p.has_history, competitorId: p.competitor_id as string, competitorName: p.competitor_name as string, runId: p.run_id as string };
    return { report, content, evidence, signals };
  };

  r.get('/api/reports/:id', (ctx) => {
    const u = ctx.requireUser();
    return loadReport(ctx.svc.db, u.id, ctx.params.id!);
  });

  r.get('/api/reports/:id/export', (ctx) => {
    const u = ctx.requireUser();
    const fmt = ctx.query.get('format') ?? 'md';
    const data = loadReport(ctx.svc.db, u.id, ctx.params.id!);
    const slug = data.report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';
    if (fmt !== 'md' && fmt !== 'json') throw new HttpError(400, 'bad_request', 'format must be md or json.');
    const body = fmt === 'json' ? JSON.stringify(data, null, 2) : reportToMarkdown(data);
    ctx.res.writeHead(200, {
      'Content-Type': fmt === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="ooda-${slug}.${fmt}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    ctx.res.end(body);
    return Symbol.for('handled');
  });

  r.del('/api/reports/:id', (ctx) => {
    const u = ctx.requireUser();
    if (!ctx.svc.db.run('DELETE FROM reports WHERE id = ? AND user_id = ?', ctx.params.id!, u.id).changes) throw notFound('Report');
    return undefined;
  });

  // ── compare ─────────────────────────────────────────────
  r.get('/api/compare', (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const ids = (ctx.query.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length < 2 || ids.length > 4) throw new HttpError(400, 'bad_request', 'Choose between 2 and 4 competitors to compare.');
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'bad_request', 'Each competitor can only be selected once.');
    const columns = ids.map((id) => {
      const c = db.get<{ id: string; name: string; url: string }>('SELECT id, name, url FROM competitors WHERE id = ? AND user_id = ?', id, u.id);
      if (!c) throw notFound('Competitor');
      const rep = db.get<Record<string, unknown>>('SELECT id, title, summary, content_json, created_at FROM reports WHERE competitor_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', id, u.id);
      const content = rep ? (JSON.parse(rep.content_json as string) as ReportContent) : null;
      return { competitor: c, report: rep ? { id: rep.id, title: rep.title, createdAt: rep.created_at, summary: rep.summary } : null, findings: content?.findings ?? [], limitations: content?.limitations ?? [] };
    });
    const evIds = [...new Set(columns.flatMap((c) => c.findings.flatMap((f) => f.evidenceIds)))];
    return { columns, evidence: evidenceFor(db, u.id, evIds), categories: v.SIGNAL_CATEGORIES };
  });
}
