import { type Finding, type Recommendation, type SignalDraft } from '../../shared/report.ts';
import { FINDING_KINDS, PRIORITIES, SEVERITIES, SIGNAL_CATEGORIES, type SignalCategory } from '../../shared/validate.ts';

export interface EvidenceRef {
  ref: string;
  evidenceId: string;
  text: string;
  changed: boolean;
}
export interface ValidatedAnalysis {
  summary: string;
  findings: Finding[];
  signals: SignalDraft[];
  recommendations: Recommendation[];
  limitations: string[];
  dropped: string[];
}
export class OutputError extends Error {}

/** Pull a JSON object out of model output, tolerating code fences and surrounding prose. */
export function extractJson(raw: string): unknown {
  const s = raw.trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)?.[1];
  if (fenced) {
    try {
      return JSON.parse(fenced.trim());
    } catch {
      /* fall through */
    }
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  throw new OutputError('The model did not return valid JSON.');
}

const squash = (s: string) =>
  s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
const asStr = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const clamp01 = (x: unknown, d = 0.5) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
const oneOf = <T extends string>(x: unknown, list: readonly T[]): T | null => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : null);

export function validateAnalysis(raw: unknown, refs: EvidenceRef[]): ValidatedAnalysis {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new OutputError('Model output must be a JSON object.');
  const o = raw as Record<string, unknown>;
  const byRef = new Map(refs.map((r) => [r.ref.toUpperCase(), r]));
  const dropped: string[] = [];
  const summary = asStr(o.summary, 1200);
  if (!summary) throw new OutputError('Model output is missing a summary.');

  const resolve = (x: unknown): EvidenceRef[] => {
    if (!Array.isArray(x)) return [];
    const out: EvidenceRef[] = [];
    for (const r of x) {
      const hit = typeof r === 'string' ? byRef.get(r.trim().toUpperCase()) : undefined;
      if (hit && !out.includes(hit)) out.push(hit);
    }
    return out;
  };
  const invalidRefs = (x: unknown) => (Array.isArray(x) ? x.filter((r) => typeof r !== 'string' || !byRef.has(r.trim().toUpperCase())).length : 0);

  const findings: Finding[] = [];
  let badRefCount = 0;
  (Array.isArray(o.findings) ? o.findings : []).slice(0, 30).forEach((f: unknown, i) => {
    if (typeof f !== 'object' || f === null) return void dropped.push(`finding ${i + 1}: not an object`);
    const r = f as Record<string, unknown>;
    const statement = asStr(r.statement, 600);
    const cited = resolve(r.evidenceRefs);
    badRefCount += invalidRefs(r.evidenceRefs);
    let kind = oneOf(r.kind, FINDING_KINDS);
    if (!statement || !kind) return void dropped.push(`finding ${i + 1}: missing statement or invalid kind`);
    let demoted = false;
    let quote: string | undefined;
    if (kind === 'fact') {
      const q = asStr(r.quote, 400);
      const verified = q.length >= 8 && q.length <= 240 && cited.some((c) => squash(c.text).includes(squash(q)));
      if (verified) quote = q;
      else {
        kind = cited.length ? 'interpretation' : 'hypothesis';
        demoted = true;
      }
    }
    if (kind === 'interpretation' && !cited.length) {
      kind = 'hypothesis';
      demoted = true;
    }
    findings.push({
      id: `f${findings.length + 1}`,
      kind,
      category: oneOf(r.category, SIGNAL_CATEGORIES) ?? 'other',
      statement,
      ...(quote ? { quote } : {}),
      implication: asStr(r.implication, 600),
      evidenceIds: cited.map((c) => c.evidenceId),
      confidence: clamp01(r.confidence),
      ...(demoted ? { demoted: true } : {}),
    });
  });
  const demotedCount = findings.filter((f) => f.demoted).length;

  const signals: SignalDraft[] = [];
  (Array.isArray(o.signals) ? o.signals : []).slice(0, 12).forEach((s: unknown, i) => {
    if (typeof s !== 'object' || s === null) return;
    const r = s as Record<string, unknown>;
    const cited = resolve(r.evidenceRefs);
    badRefCount += invalidRefs(r.evidenceRefs);
    const title = asStr(r.title, 160);
    if (!title || !cited.length) return void dropped.push(`signal ${i + 1}: no valid source reference`);
    const wantsChange = r.basis === 'change';
    const basis: 'change' | 'observation' = wantsChange && cited.some((c) => c.changed) ? 'change' : 'observation';
    if (wantsChange && basis === 'observation') dropped.push(`signal ${i + 1}: claimed a change without changed evidence; recorded as an observation`);
    signals.push({
      category: (oneOf(r.category, SIGNAL_CATEGORIES) ?? 'other') as SignalCategory,
      severity: oneOf(r.severity, SEVERITIES) ?? 'low',
      confidence: clamp01(r.confidence),
      basis,
      title,
      summary: asStr(r.summary, 700),
      evidenceIds: cited.map((c) => c.evidenceId),
    });
  });

  const recommendations: Recommendation[] = [];
  (Array.isArray(o.recommendations) ? o.recommendations : []).slice(0, 10).forEach((x: unknown, i) => {
    if (typeof x !== 'object' || x === null) return;
    const r = x as Record<string, unknown>;
    const cited = resolve(r.evidenceRefs);
    badRefCount += invalidRefs(r.evidenceRefs);
    const title = asStr(r.title, 200);
    if (!title || !cited.length) return void dropped.push(`recommendation ${i + 1}: no valid source reference`);
    recommendations.push({
      id: `r${recommendations.length + 1}`,
      title,
      rationale: asStr(r.rationale, 700),
      priority: oneOf(r.priority, PRIORITIES) ?? 'medium',
      evidenceIds: cited.map((c) => c.evidenceId),
    });
  });

  const limitations = (Array.isArray(o.limitations) ? o.limitations : []).map((l) => asStr(l, 300)).filter(Boolean).slice(0, 10);
  if (badRefCount) limitations.push(`${badRefCount} source reference${badRefCount === 1 ? '' : 's'} in the model output did not match any collected evidence and ${badRefCount === 1 ? 'was' : 'were'} removed.`);
  if (demotedCount) limitations.push(`${demotedCount} statement${demotedCount === 1 ? '' : 's'} claimed a stronger evidence level than the sources support and ${demotedCount === 1 ? 'was' : 'were'} downgraded.`);
  const unusable = dropped.filter((d) => /no valid source reference|missing statement/.test(d)).length;
  if (unusable) limitations.push(`${unusable} item${unusable === 1 ? '' : 's'} without a valid source reference ${unusable === 1 ? 'was' : 'were'} discarded.`);
  if (!findings.length) throw new OutputError('Model output contained no usable findings.');
  return { summary, findings, signals, recommendations, limitations, dropped };
}
