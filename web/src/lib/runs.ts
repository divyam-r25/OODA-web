import { ApiError, post } from './api';
import type { Run } from './types';

/** Starts a research run. The idempotency key makes accidental double-clicks safe. */
export async function startRun(competitorId: string, focus = ''): Promise<{ run: Run; warnings: string[]; reused: boolean }> {
  const key = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return post('/api/runs', { competitorId, focus: focus.trim() || undefined, idempotencyKey: key });
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
