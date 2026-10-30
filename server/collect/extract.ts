import { createHash } from 'node:crypto';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', euro: '€', pound: '£', yen: '¥',
  times: '×', laquo: '«', raquo: '»', deg: '°',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export interface Extracted {
  title: string;
  text: string;
  truncated: boolean;
}
export const MAX_TEXT_CHARS = 120_000;

const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  return tag ? decodeEntities(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? '').trim() : '';
};

export function extractText(html: string, contentType = 'text/html'): Extracted {
  if (/^text\/plain/i.test(contentType)) {
    const t = normalizeLines(html);
    return { title: t.split('\n')[0]?.slice(0, 120) ?? '', ...cap(t) };
  }
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const title =
    decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? '').replace(/\s+/g, ' ').trim() ||
    meta(h, 'og:title') ||
    decodeEntities((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1] ?? '').replace(/<[^>]+>/g, '')).trim();
  const description = meta(h, 'description') || meta(h, 'og:description');
  h = h.replace(/<(script|style|noscript|svg|template|iframe|head|canvas|object|embed)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  h = h.replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `);
  h = h.replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|li|ul|ol|tr|table|thead|tbody|h[1-6]|br|hr|blockquote|pre|form|dd|dt|dl|figure|figcaption|details|summary)\b[^>]*>/gi, '\n');
  h = h.replace(/<\/?(td|th)\b[^>]*>/gi, ' | ');
  h = h.replace(/<[^>]+>/g, ' ');
  let text = normalizeLines(decodeEntities(h));
  if (description && !text.includes(description.slice(0, 60))) text = `Meta description: ${description}\n${text}`;
  return { title: title.slice(0, 200), ...cap(text) };
}

function normalizeLines(s: string): string {
  const out: string[] = [];
  for (const raw of s.split(/\r?\n/)) {
    const line = raw.replace(/[ \t\u00a0\u200b]+/g, ' ').replace(/^( \| )+|( \| )+$/g, '').trim();
    if (!line || line === '|') continue;
    if (out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.join('\n');
}
function cap(t: string): { text: string; truncated: boolean } {
  return t.length > MAX_TEXT_CHARS ? { text: t.slice(0, MAX_TEXT_CHARS), truncated: true } : { text: t, truncated: false };
}

export const contentHash = (text: string) => createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ')).digest('hex');

export function excerptOf(text: string, max = 320): string {
  const body = text.split('\n').filter((l) => !l.startsWith('Meta description:') && l.length > 25).join(' ');
  const src = body || text;
  if (src.length <= max) return src;
  const cut = src.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 40)) + '…';
}

export interface LineDiff {
  added: string[];
  removed: string[];
  addedCount: number;
  removedCount: number;
}
/** Line-level change between two normalised snapshots (set-based; ignores ordering and trivial lines). */
export function diffText(prev: string, next: string, limit = 60): LineDiff {
  const norm = (l: string) => l.toLowerCase().replace(/\s+/g, ' ').trim();
  const a = prev.split('\n').filter((l) => l.length > 3);
  const b = next.split('\n').filter((l) => l.length > 3);
  const aSet = new Set(a.map(norm));
  const bSet = new Set(b.map(norm));
  const added = b.filter((l) => !aSet.has(norm(l)));
  const removed = a.filter((l) => !bSet.has(norm(l)));
  const clip = (l: string) => (l.length > 300 ? l.slice(0, 300) + '…' : l);
  return { added: added.slice(0, limit).map(clip), removed: removed.slice(0, limit).map(clip), addedCount: added.length, removedCount: removed.length };
}
