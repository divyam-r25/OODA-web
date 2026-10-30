import { FetchError } from './net.ts';
import { type FetchOptions, safeFetch } from './safeFetch.ts';

interface Rule { allow: boolean; pattern: string }
const cache = new Map<string, { rules: Rule[]; expires: number }>();
export const clearRobotsCache = () => cache.clear();

export function parseRobots(text: string, agentToken: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      lastWasAgent = false;
      if (val) cur.rules.push({ allow: key === 'allow', pattern: val });
    } else lastWasAgent = false;
  }
  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

export function robotsAllows(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/** Throws FetchError('robots') if disallowed, FetchError('robots_unavailable') if robots.txt cannot be read reliably. */
export async function assertRobotsAllowed(target: string, o: FetchOptions) {
  const u = new URL(target);
  const origin = u.origin;
  let entry = cache.get(origin);
  if (!entry || entry.expires < Date.now()) {
    let rules: Rule[] = [];
    try {
      const r = await safeFetch(`${origin}/robots.txt`, { ...o, maxBytes: 200_000, allowedTypes: /^text\//i, accept: 'text/plain' });
      if (r.status >= 500) throw new FetchError('robots_unavailable', 'robots.txt returned a server error, so the page was skipped to be safe.');
      if (r.status >= 200 && r.status < 300) rules = parseRobots(r.body, o.userAgent.split('/')[0] ?? 'ooda-research');
    } catch (e) {
      if (e instanceof FetchError && (e.code === 'robots_unavailable')) throw e;
      if (e instanceof FetchError && e.code === 'content_type') rules = []; // e.g. HTML 200 page instead of robots.txt
      else if (e instanceof FetchError && (e.code === 'blocked' || e.code === 'dns')) throw e;
      else throw new FetchError('robots_unavailable', 'Could not read robots.txt, so the page was skipped to be safe.');
    }
    entry = { rules, expires: Date.now() + 3600_000 };
    cache.set(origin, entry);
  }
  if (!robotsAllows(entry.rules, u.pathname + u.search)) throw new FetchError('robots', 'The site’s robots.txt does not allow automated access to this page.');
}
