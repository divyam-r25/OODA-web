// Small, dependency-free schema validation shared by server and web.
// Deliberately minimal: strings, numbers, enums, arrays, objects, optionals.

export interface Issue {
  path: string;
  message: string;
}
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export interface Schema<T> {
  parse(input: unknown, path?: string): Result<T>;
}
export type Infer<S> = S extends Schema<infer T> ? T : never;

const fail = <T>(path: string, message: string): Result<T> => ({
  ok: false,
  issues: [{ path, message }],
});
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export function str(opts: {
  min?: number;
  max?: number;
  trim?: boolean;
  pattern?: RegExp;
  message?: string;
  label?: string;
} = {}): Schema<string> {
  const { min = 0, max = 10_000, trim = true, pattern, message, label = 'This field' } = opts;
  return {
    parse(input, path = '') {
      if (typeof input !== 'string') return fail(path, `${label} must be text.`);
      const value = trim ? input.trim() : input;
      if (value.length < min) {
        return fail(path, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
      }
      if (value.length > max) return fail(path, `${label} must be at most ${max} characters.`);
      if (pattern && !pattern.test(value)) return fail(path, message ?? `${label} has an invalid format.`);
      return ok(value);
    },
  };
}

export function email(): Schema<string> {
  const inner = str({ min: 3, max: 254, label: 'Email' });
  return {
    parse(input, path = '') {
      const r = inner.parse(input, path);
      if (!r.ok) return r;
      const v = r.value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return fail(path, 'Enter a valid email address.');
      return ok(v);
    },
  };
}

/** http(s) URL with no embedded credentials. Network-level safety (SSRF) is enforced again at fetch time. */
export function url(opts: { max?: number; label?: string } = {}): Schema<string> {
  const { max = 2048, label = 'URL' } = opts;
  const inner = str({ min: 1, max, label });
  return {
    parse(input, path = '') {
      const r = inner.parse(input, path);
      if (!r.ok) return r;
      let raw = r.value;
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        return fail(path, `${label} is not a valid web address.`);
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail(path, `${label} must start with http:// or https://.`);
      if (u.username || u.password) return fail(path, `${label} must not contain a username or password.`);
      if (!u.hostname.includes('.') && !/^[\d.:[\]a-f]+$/i.test(u.hostname) && u.hostname !== 'localhost') {
        return fail(path, `${label} needs a full domain, like example.com.`);
      }
      u.hash = '';
      return ok(u.toString());
    },
  };
}

export function int(opts: { min?: number; max?: number; label?: string } = {}): Schema<number> {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, label = 'This field' } = opts;
  return {
    parse(input, path = '') {
      if (typeof input !== 'number' || !Number.isInteger(input)) return fail(path, `${label} must be a whole number.`);
      if (input < min || input > max) return fail(path, `${label} must be between ${min} and ${max}.`);
      return ok(input);
    },
  };
}

export function num(opts: { min?: number; max?: number; label?: string } = {}): Schema<number> {
  const { min = -Infinity, max = Infinity, label = 'This field' } = opts;
  return {
    parse(input, path = '') {
      if (typeof input !== 'number' || !Number.isFinite(input)) return fail(path, `${label} must be a number.`);
      if (input < min || input > max) return fail(path, `${label} must be between ${min} and ${max}.`);
      return ok(input);
    },
  };
}

export function bool(): Schema<boolean> {
  return {
    parse(input, path = '') {
      return typeof input === 'boolean' ? ok(input) : fail(path, 'Must be true or false.');
    },
  };
}

export function oneOf<const T extends readonly string[]>(values: T, label = 'This field'): Schema<T[number]> {
  return {
    parse(input, path = '') {
      if (typeof input === 'string' && (values as readonly string[]).includes(input)) return ok(input as T[number]);
      return fail(path, `${label} must be one of: ${values.join(', ')}.`);
    },
  };
}

export function arr<T>(item: Schema<T>, opts: { max?: number; min?: number; label?: string } = {}): Schema<T[]> {
  const { max = 100, min = 0, label = 'This list' } = opts;
  return {
    parse(input, path = '') {
      if (!Array.isArray(input)) return fail(path, `${label} must be a list.`);
      if (input.length > max) return fail(path, `${label} can have at most ${max} items.`);
      if (input.length < min) return fail(path, `${label} needs at least ${min} item${min === 1 ? '' : 's'}.`);
      const out: T[] = [];
      const issues: Issue[] = [];
      input.forEach((v, i) => {
        const r = item.parse(v, `${path}[${i}]`);
        if (r.ok) out.push(r.value);
        else issues.push(...r.issues);
      });
      return issues.length ? { ok: false, issues } : ok(out);
    },
  };
}

export function opt<T>(inner: Schema<T>): Schema<T | undefined> {
  return {
    parse(input, path = '') {
      if (input === undefined || input === null || input === '') return ok(undefined);
      return inner.parse(input, path);
    },
  };
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return {
    parse(input, path = '') {
      if (input === null) return ok(null);
      return inner.parse(input, path);
    },
  };
}

export function obj<S extends Record<string, Schema<unknown>>>(shape: S): Schema<{ [K in keyof S]: Infer<S[K]> }> {
  return {
    parse(input, path = '') {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return fail(path, 'Expected an object.');
      }
      const out: Record<string, unknown> = {};
      const issues: Issue[] = [];
      for (const key of Object.keys(shape)) {
        const schema = shape[key]!;
        const r = schema.parse((input as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
        if (r.ok) {
          if (r.value !== undefined) out[key] = r.value;
        } else issues.push(...r.issues);
      }
      return issues.length ? { ok: false, issues } : ok(out as { [K in keyof S]: Infer<S[K]> });
    },
  };
}

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const REVIEW_STATUSES = ['new', 'reviewed', 'actioned', 'dismissed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const RUN_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTION_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const SIGNAL_CATEGORIES = ['pricing', 'product', 'positioning', 'messaging', 'hiring', 'partnership', 'content', 'other'] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];
export const FINDING_KINDS = ['fact', 'interpretation', 'hypothesis'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export const TIERS = ['direct', 'indirect', 'emerging'] as const;
export type Tier = (typeof TIERS)[number];
