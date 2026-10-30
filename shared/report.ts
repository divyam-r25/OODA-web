import type { FindingKind, Priority, Severity, SignalCategory } from './validate.ts';

export interface Finding {
  id: string;
  kind: FindingKind;
  category: SignalCategory;
  statement: string;
  quote?: string;
  implication: string;
  evidenceIds: string[];
  confidence: number;
  /** True when the model claimed a stronger kind than the evidence supports and the server downgraded it. */
  demoted?: boolean;
}
export interface Recommendation {
  id: string;
  title: string;
  rationale: string;
  priority: Priority;
  evidenceIds: string[];
}
export interface SignalDraft {
  category: SignalCategory;
  severity: Severity;
  confidence: number;
  basis: 'change' | 'observation';
  title: string;
  summary: string;
  evidenceIds: string[];
}
export interface SourceConsidered {
  evidenceId: string;
  url: string;
  title: string;
  fetchedAt: string;
  state: 'baseline' | 'changed' | 'unchanged';
}
export interface ReportContent {
  summary: string;
  findings: Finding[];
  recommendations: Recommendation[];
  limitations: string[];
  sources: SourceConsidered[];
}
