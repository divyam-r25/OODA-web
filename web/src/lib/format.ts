export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (Number.isNaN(s)) return '';
  if (s < 45) return 'just now';
  const units: [number, string][] = [[60, 'min'], [3600, 'hour'], [86400, 'day'], [604800, 'week'], [2629800, 'month']];
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  if (s < 604800) { const d = Math.round(s / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  if (s < 2629800) { const w = Math.round(s / 604800); return `${w} week${w === 1 ? '' : 's'} ago`; }
  void units;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export const fullDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const dayOnly = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function host(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const isOverdue = (due: string | null, done: boolean) => !!due && !done && due < new Date().toISOString().slice(0, 10);
export const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued', validating: 'Starting', collecting: 'Collecting pages', comparing: 'Comparing with history', analyzing: 'Analysing',
  validating_output: 'Checking sources', saving: 'Saving', done: 'Done', retrying: 'Retrying', cancelling: 'Cancelling', cancelled: 'Cancelled', failed: 'Failed', completed: 'Done', partial: 'Done',
};
