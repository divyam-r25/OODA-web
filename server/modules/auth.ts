import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as v from '../../shared/validate.ts';
import { type AuthUser, HttpError, type Router, rateLimit, validate } from '../http/core.ts';
import { type Db, newId, nowIso } from '../db/db.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
export const SESSION_COOKIE = 'ooda_sid';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// A fixed hash so unknown-email logins cost the same as wrong-password logins.
const DUMMY_HASH = await hashPassword('not-a-real-password');

export function sessionUser(db: Db, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = db.get<{ id: string; email: string; name: string; expires_at: string }>(
    `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    sha256(token),
  );
  if (!row || row.expires_at < nowIso()) return null;
  return { id: row.id, email: row.email, name: row.name };
}

function startSession(db: Db, userId: string, days: number): { token: string; maxAgeSec: number } {
  const token = randomBytes(32).toString('base64url');
  const maxAgeSec = days * 86400;
  db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
  db.run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token),
    userId,
    nowIso(),
    new Date(Date.now() + maxAgeSec * 1000).toISOString(),
  );
  return { token, maxAgeSec };
}

const registerSchema = v.obj({
  name: v.str({ min: 1, max: 80, label: 'Name' }),
  email: v.email(),
  password: v.str({ min: 10, max: 128, trim: false, label: 'Password' }),
});
const loginSchema = v.obj({
  email: v.email(),
  password: v.str({ min: 1, max: 128, trim: false, label: 'Password' }),
});

export function registerAuthRoutes(r: Router) {
  r.post(
    '/api/auth/register',
    async (ctx) => {
      const { config, db } = ctx.svc;
      if (!config.allowRegistration) throw new HttpError(403, 'registration_closed', 'Registration is disabled on this server.');
      rateLimit(`reg:${ctx.ip}`, 10, 60 * 60_000);
      const input = validate(registerSchema, await ctx.body());
      if (input.password.toLowerCase().includes(input.email.split('@')[0]!.toLowerCase()) && input.email.split('@')[0]!.length > 3) {
        throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { fields: { password: 'Password should not contain your email name.' } });
      }
      if (db.get('SELECT 1 FROM users WHERE email = ?', input.email)) {
        throw new HttpError(409, 'email_taken', 'An account with this email already exists.', { fields: { email: 'This email is already registered.' } });
      }
      const id = newId('usr');
      const hash = await hashPassword(input.password);
      db.tx(() => {
        db.run('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', id, input.email, input.name, hash, nowIso());
        db.run('INSERT INTO workspaces (user_id, updated_at) VALUES (?, ?)', id, nowIso());
      });
      const s = startSession(db, id, config.sessionDays);
      ctx.setCookie(SESSION_COOKIE, s.token, { maxAgeSec: s.maxAgeSec });
      return { user: { id, email: input.email, name: input.name } };
    },
    { auth: false },
  );

  r.post(
    '/api/auth/login',
    async (ctx) => {
      const { config, db } = ctx.svc;
      const input = validate(loginSchema, await ctx.body());
      rateLimit(`login:${ctx.ip}`, 30, 15 * 60_000);
      rateLimit(`login:${input.email}`, 8, 15 * 60_000);
      const row = db.get<{ id: string; email: string; name: string; password_hash: string }>(
        'SELECT id, email, name, password_hash FROM users WHERE email = ?',
        input.email,
      );
      const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
      const s = startSession(db, row.id, config.sessionDays);
      ctx.setCookie(SESSION_COOKIE, s.token, { maxAgeSec: s.maxAgeSec });
      return { user: { id: row.id, email: row.email, name: row.name } };
    },
    { auth: false, status: 200 },
  );

  r.post(
    '/api/auth/logout',
    async (ctx) => {
      const tok = /ooda_sid=([^;]+)/.exec(ctx.req.headers.cookie ?? '')?.[1];
      if (tok) ctx.svc.db.run('DELETE FROM sessions WHERE id = ?', sha256(decodeURIComponent(tok)));
      ctx.setCookie(SESSION_COOKIE, '', { clear: true });
      return undefined;
    },
    { auth: false },
  );

  r.get('/api/auth/me', (ctx) => ({ user: ctx.user }), { auth: false });
}
