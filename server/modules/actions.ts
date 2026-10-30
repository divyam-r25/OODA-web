import * as v from '../../shared/validate.ts';
import { type Router, notFound, validate, HttpError } from '../http/core.ts';
import { type Db, newId, nowIso } from '../db/db.ts';

const date = v.str({ pattern: /^\d{4}-\d{2}-\d{2}$/, message: 'Use a date like 2026-12-31.', label: 'Due date', max: 10 });
const link = v.opt(v.str({ max: 64 }));
const createSchema = v.obj({
  title: v.str({ min: 1, max: 200, label: 'Title' }),
  description: v.opt(v.str({ max: 2000, label: 'Description' })),
  priority: v.opt(v.oneOf(v.PRIORITIES, 'Priority')),
  dueDate: v.opt(date),
  competitorId: link,
  signalId: link,
  reportId: link,
});
const patchSchema = v.obj({
  title: v.opt(v.str({ min: 1, max: 200, label: 'Title' })),
  description: v.opt(v.str({ max: 2000, label: 'Description' })),
  status: v.opt(v.oneOf(v.ACTION_STATUSES, 'Status')),
  priority: v.opt(v.oneOf(v.PRIORITIES, 'Priority')),
  dueDate: v.opt(v.nullable(date)),
});

const SELECT = `SELECT a.*, c.name AS competitor_name, s.title AS signal_title, r.title AS report_title
  FROM actions a LEFT JOIN competitors c ON c.id = a.competitor_id LEFT JOIN signals s ON s.id = a.signal_id LEFT JOIN reports r ON r.id = a.report_id`;
const present = (a: Record<string, unknown>) => ({
  id: a.id, title: a.title, description: a.description, status: a.status, priority: a.priority, dueDate: a.due_date,
  competitorId: a.competitor_id, competitorName: a.competitor_name, signalId: a.signal_id, signalTitle: a.signal_title,
  reportId: a.report_id, reportTitle: a.report_title, createdAt: a.created_at, updatedAt: a.updated_at, completedAt: a.completed_at,
});

function assertOwned(db: Db, table: string, id: string | undefined, userId: string, field: string) {
  if (!id) return null;
  if (!db.get(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`, id, userId)) {
    throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { fields: { [field]: 'That item does not exist.' } });
  }
  return id;
}

export function registerActionRoutes(r: Router) {
  r.get('/api/actions', (ctx) => {
    const u = ctx.requireUser();
    const where = ['a.user_id = ?'];
    const p: string[] = [u.id];
    for (const [q, col, list] of [['status', 'a.status', v.ACTION_STATUSES], ['priority', 'a.priority', v.PRIORITIES]] as const) {
      const val = ctx.query.get(q);
      if (val && (list as readonly string[]).includes(val)) {
        where.push(`${col} = ?`);
        p.push(val);
      }
    }
    const comp = ctx.query.get('competitorId');
    if (comp) {
      where.push('a.competitor_id = ?');
      p.push(comp);
    }
    const rows = ctx.svc.db.all<Record<string, unknown>>(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE a.status WHEN 'done' THEN 1 ELSE 0 END, a.due_date IS NULL, a.due_date, CASE a.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.created_at DESC LIMIT 300`,
      ...p,
    );
    return { actions: rows.map(present) };
  });

  r.post('/api/actions', async (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const b = validate(createSchema, await ctx.body());
    const id = newId('act');
    const t = nowIso();
    const compId = assertOwned(db, 'competitors', b.competitorId, u.id, 'competitorId');
    const sigId = assertOwned(db, 'signals', b.signalId, u.id, 'signalId');
    const repId = assertOwned(db, 'reports', b.reportId, u.id, 'reportId');
    db.run(
      'INSERT INTO actions (id, user_id, title, description, priority, due_date, competitor_id, signal_id, report_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, u.id, b.title, b.description ?? '', b.priority ?? 'medium', b.dueDate ?? null, compId, sigId, repId, t, t,
    );
    if (sigId) db.run("UPDATE signals SET review_status = 'actioned', reviewed_at = ? WHERE id = ? AND user_id = ? AND review_status = 'new'", t, sigId, u.id);
    return { action: present(db.get<Record<string, unknown>>(`${SELECT} WHERE a.id = ?`, id)!) };
  });

  r.patch('/api/actions/:id', async (ctx) => {
    const u = ctx.requireUser();
    const { db } = ctx.svc;
    const a = db.get<Record<string, unknown>>('SELECT * FROM actions WHERE id = ? AND user_id = ?', ctx.params.id!, u.id);
    if (!a) throw notFound('Action');
    const b = validate(patchSchema, await ctx.body());
    const raw = (await ctx.body()) as Record<string, unknown>;
    const status = b.status ?? (a.status as string);
    const completedAt = status === 'done' ? (a.status === 'done' ? (a.completed_at as string) : nowIso()) : null;
    const due = 'dueDate' in raw ? (b.dueDate ?? null) : (a.due_date as string | null);
    db.run(
      'UPDATE actions SET title=?, description=?, status=?, priority=?, due_date=?, completed_at=?, updated_at=? WHERE id=? AND user_id=?',
      b.title ?? (a.title as string), b.description ?? (a.description as string), status, b.priority ?? (a.priority as string), due, completedAt, nowIso(), a.id as string, u.id,
    );
    return { action: present(db.get<Record<string, unknown>>(`${SELECT} WHERE a.id = ?`, a.id as string)!) };
  });

  r.del('/api/actions/:id', (ctx) => {
    const u = ctx.requireUser();
    if (!ctx.svc.db.run('DELETE FROM actions WHERE id = ? AND user_id = ?', ctx.params.id!, u.id).changes) throw notFound('Action');
    return undefined;
  });
}
