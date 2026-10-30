import type { ReportContent } from '../../shared/report.ts';

interface Exported {
  report: { title: string; createdAt: string; competitorName: string; provider: string; model: string; hasHistory: boolean };
  content: ReportContent;
  evidence: { id: string; url: string; title: string; fetchedAt: string; excerpt: string }[];
}
const KIND: Record<string, string> = { fact: 'Fact', interpretation: 'Interpretation', hypothesis: 'Hypothesis' };

export function reportToMarkdown({ report, content, evidence }: Exported): string {
  const idx = new Map(evidence.map((e, i) => [e.id, i + 1]));
  const cites = (ids: string[]) => (ids.length ? ' ' + ids.map((i) => `[${idx.get(i) ?? '?'}]`).join('') : '');
  const out: string[] = [];
  out.push(`# ${report.title}`, '', `Competitor: ${report.competitorName}  `, `Generated: ${report.createdAt}  `, `Analysis: ${report.provider} / ${report.model}  `, `Historical comparison: ${report.hasHistory ? 'yes' : 'no (first snapshot)'}`, '');
  out.push('## Summary', '', content.summary, '');
  out.push('## Findings', '');
  for (const f of content.findings) {
    out.push(`- **${KIND[f.kind] ?? f.kind}** (${f.category}, confidence ${Math.round(f.confidence * 100)}%${f.demoted ? ', downgraded for insufficient evidence' : ''}): ${f.statement}${cites(f.evidenceIds)}`);
    if (f.quote) out.push(`  - Source text: “${f.quote}”`);
    if (f.implication) out.push(`  - Implication: ${f.implication}`);
  }
  out.push('', '## Recommendations', '');
  if (!content.recommendations.length) out.push('_None supported by the evidence._');
  for (const r of content.recommendations) out.push(`- **${r.title}** (${r.priority} priority)${cites(r.evidenceIds)}`, `  - ${r.rationale}`);
  out.push('', '## Limitations', '');
  for (const l of content.limitations.length ? content.limitations : ['None recorded.']) out.push(`- ${l}`);
  out.push('', '## Sources', '');
  evidence.forEach((e, i) => out.push(`${i + 1}. ${e.title || e.url}: ${e.url} (collected ${e.fetchedAt})`, `   > ${e.excerpt}`));
  return out.join('\n') + '\n';
}
