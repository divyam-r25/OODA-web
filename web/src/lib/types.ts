export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type RunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type ReviewStatus = 'new' | 'reviewed' | 'actioned' | 'dismissed';
export type FindingKind = 'fact' | 'interpretation' | 'hypothesis';
export type Tier = 'direct' | 'indirect' | 'emerging';

export interface User { id: string; email: string; name: string }
export interface Profile { companyName: string; website: string; industry: string; audience: string; goal: string; description: string }
export interface Competitor {
  id: string; name: string; url: string; tier: Tier; notes: string; archived: boolean; createdAt: string; updatedAt: string;
  sourceCount?: number; newSignals?: number; reportCount?: number; lastRun?: { id: string; status: RunStatus; finishedAt: string | null } | null;
}
export interface Run {
  id: string; competitorId: string; competitorName: string; status: RunStatus; stage: string; progress: number; focus: string;
  error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; reportId: string | null; cancelRequested: boolean;
}
export interface RunEvent { id: number; ts: string; level: 'info' | 'warn' | 'error'; stage: string; message: string }
export interface RunEvidence { id: string; url: string; title: string; fetchedAt: string; excerpt: string; state: 'baseline' | 'changed' | 'unchanged' }
export interface Signal {
  id: string; title: string; summary: string; severity: Severity; category: string; confidence: number; basis: 'change' | 'observation';
  reviewStatus: ReviewStatus; reviewedAt: string | null; createdAt: string; competitorId: string; competitorName: string; reportId: string; runId: string; evidenceCount: number;
}
export interface Evidence {
  id: string; url: string; finalUrl: string; title: string; fetchedAt: string; excerpt: string; httpStatus: number; truncated: boolean; hasPrevious: boolean;
  diff: { added: string[]; removed: string[]; addedCount: number; removedCount: number } | null;
}
export interface Finding { id: string; kind: FindingKind; category: string; statement: string; quote?: string; implication: string; evidenceIds: string[]; confidence: number; demoted?: boolean }
export interface Recommendation { id: string; title: string; rationale: string; priority: 'low' | 'medium' | 'high'; evidenceIds: string[] }
export interface ReportContent { summary: string; findings: Finding[]; recommendations: Recommendation[]; limitations: string[]; sources: { evidenceId: string; url: string; title: string; fetchedAt: string; state: string }[] }
export interface ReportMeta { id: string; title: string; createdAt: string; provider: string; model: string; hasHistory: boolean; competitorId: string; competitorName: string; runId: string }
export interface ReportListItem { id: string; title: string; summary: string; createdAt: string; hasHistory: boolean; provider: string; model: string; competitorId: string; competitorName: string; signalCount: number }
export interface ActionItem {
  id: string; title: string; description: string; status: 'todo' | 'in_progress' | 'done'; priority: 'low' | 'medium' | 'high'; dueDate: string | null;
  competitorId: string | null; competitorName: string | null; signalId: string | null; signalTitle: string | null; reportId: string | null; reportTitle: string | null;
  createdAt: string; completedAt: string | null;
}
export interface AiInfo {
  provider: string;
  configured: boolean;
  model: string;
  workflow: 'single' | 'multi_agent';
  isLocal: boolean;
  isFree: boolean;
  problem: string | null;
  roleModels?: { analyst?: string; strategist?: string; critic?: string; synthesizer?: string };
}

