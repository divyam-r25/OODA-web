import { get } from '../lib/api';
import { useAsync, useInterval, useTitle } from '../lib/hooks';
import { cap, dayOnly, isOverdue, plural, timeAgo } from '../lib/format';
import { Link } from '../lib/router';
import type { Profile, RunStatus, Severity } from '../lib/types';
import { Alert, ErrorState, LinkButton, PageHead, RunStatusTag, SeverityGauge, Skeleton, Tag, EmptyState } from '../ui/ui';
import { useAuth } from '../lib/auth';

interface Dash {
  counts: { competitors: number; newSignals: number; criticalNew: number; activeRuns: number; reports: number; openActions: number; overdueActions: number };
  queue: { id: string; title: string; severity: Severity; category: string; confidence: number; basis: string; createdAt: string; competitorId: string; competitorName: string }[];
  runs: { id: string; status: RunStatus; stage: string; progress: number; createdAt: string; finishedAt: string | null; competitorName: string; competitorId: string }[];
  stale: { id: string; name: string; lastResearched: string | null }[];
  actions: { id: string; title: string; priority: string; status: string; dueDate: string | null }[];
  ai: { configured: boolean; problem: string | null };
  profile: Profile;
}

function briefing(c: Dash['counts']) {
  if (c.competitors === 0) return <>Nothing is being watched yet. Add a competitor and OODA will start collecting their public pages.</>;
  const parts: React.ReactNode[] = [];
  if (c.newSignals > 0) parts.push(<span key="s"><em>{plural(c.newSignals, 'signal')}</em> {c.newSignals === 1 ? 'is' : 'are'} waiting for review{c.criticalNew > 0 ? <>, {c.criticalNew} of high or critical severity</> : null}.</span>);
  else parts.push(<span key="s">No signals are waiting for review.</span>);
  if (c.activeRuns > 0) parts.push(<span key="r"> {plural(c.activeRuns, 'research run')} {c.activeRuns === 1 ? 'is' : 'are'} in progress.</span>);
  if (c.overdueActions > 0) parts.push(<span key="o"> <em>{plural(c.overdueActions, 'action')}</em> {c.overdueActions === 1 ? 'is' : 'are'} overdue.</span>);
  else if (c.openActions > 0) parts.push(<span key="a"> {plural(c.openActions, 'action')} still open.</span>);
  return <>{parts}</>;
}

export function Dashboard() {
  useTitle('Briefing');
  const { user } = useAuth();
  const q = useAsync((s) => get<Dash>('/api/dashboard', s), []);
  const live = (q.data?.counts.activeRuns ?? 0) > 0;
  useInterval(q.reload, live ? 3000 : null);
  const d = q.data;
  return (
    <>
      <PageHead title="Briefing" sub={`${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${d?.profile.companyName ? ` · ${d.profile.companyName}` : ''}`}>
        <LinkButton to="/app/research" variant="primary" icon="research">Start research</LinkButton>
      </PageHead>
      {q.error && !d ? <ErrorState error={q.error} retry={q.reload} /> : !d ? <Skeleton lines={7} /> : (
        <>
          {!d.ai.configured && <div style={{ marginBottom: 20 }}><Alert tone="warn" action={<Link to="/app/settings">See setup</Link>}>Analysis is switched off: {d.ai.problem} Pages can still be collected, but no reports will be written.</Alert></div>}
          {!d.profile.companyName && d.counts.competitors > 0 && <div style={{ marginBottom: 20 }}><Alert action={<Link to="/app/settings">Add profile</Link>}>Tell OODA about your own company so recommendations are written for you, not for a generic business.</Alert></div>}
          <p className="briefing" aria-live="polite">{user ? `${user.name.split(' ')[0]}, ` : ''}{briefing(d.counts)}</p>
          {d.counts.competitors === 0 ? (
            <div className="sheet"><EmptyState title="Add your first competitor" action={<LinkButton to="/app/competitors/new" variant="primary" icon="plus">Add competitor</LinkButton>}>Give OODA a website, and optionally the pricing or product pages you care about. It will keep dated snapshots and tell you what changes.</EmptyState></div>
          ) : (
            <div className="cols">
              <section className="sheet" aria-labelledby="queue-h">
                <div className="sheet-head"><h2 id="queue-h">Needs your review</h2><Link to="/app/signals?status=new" className="small">All signals</Link></div>
                {d.queue.length === 0 ? <EmptyState title="Inbox zero">New signals appear here after a research run finds something worth your attention.</EmptyState> : (
                  <div className="table-wrap"><table className="table stack-narrow"><thead><tr><th>Severity</th><th>Signal</th><th>Competitor</th><th>Found</th></tr></thead><tbody>
                    {d.queue.map((s) => (
                      <tr key={s.id}>
                        <td data-label="Severity"><SeverityGauge level={s.severity} /></td>
                        <td className="title-cell"><Link to={`/app/signals?open=${s.id}`}>{s.title}</Link><div className="small muted">{cap(s.category)} · {s.basis === 'change' ? 'observed change' : 'observation'}</div></td>
                        <td data-label="Competitor"><Link to={`/app/competitors/${s.competitorId}`}>{s.competitorName}</Link></td>
                        <td data-label="Found" className="muted nowrap">{timeAgo(s.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody></table></div>
                )}
              </section>
              <div className="stack">
                <section className="sheet" aria-labelledby="runs-h">
                  <div className="sheet-head"><h3 id="runs-h">Recent research</h3><Link to="/app/research" className="small">All</Link></div>
                  {d.runs.length === 0 ? <p className="muted small" style={{ padding: '14px 22px', margin: 0 }}>No research has run yet.</p> : d.runs.map((r) => (
                    <div className="list-row" key={r.id}><div className="grow"><Link to={`/app/research/${r.id}`}>{r.competitorName}</Link><div className="small muted">{timeAgo(r.finishedAt ?? r.createdAt)}</div></div><RunStatusTag status={r.status} /></div>
                  ))}
                </section>
                <section className="sheet" aria-labelledby="act-h">
                  <div className="sheet-head"><h3 id="act-h">Open actions</h3><Link to="/app/actions" className="small">All</Link></div>
                  {d.actions.length === 0 ? <p className="muted small" style={{ padding: '14px 22px', margin: 0 }}>Nothing on your list.</p> : d.actions.map((a) => (
                    <div className="list-row" key={a.id}><div className="grow"><Link to="/app/actions">{a.title}</Link><div className="small muted">{a.dueDate ? <span className={isOverdue(a.dueDate, false) ? 'overdue' : ''}>Due {dayOnly(a.dueDate)}</span> : 'No due date'}</div></div><span className={`pri pri-${a.priority}`}>{cap(a.priority)}</span></div>
                  ))}
                </section>
                {d.stale.length > 0 && (
                  <section className="sheet" aria-labelledby="stale-h">
                    <div className="sheet-head"><h3 id="stale-h">Gone quiet</h3></div>
                    {d.stale.map((c) => <div className="list-row" key={c.id}><div className="grow"><Link to={`/app/competitors/${c.id}`}>{c.name}</Link></div><Tag tone="warn">{c.lastResearched ? `Last checked ${timeAgo(c.lastResearched)}` : 'Never researched'}</Tag></div>)}
                  </section>
                )}
              </div>
            </div>
          )}
          <p className="small muted" style={{ marginTop: 28 }}>Tracking {plural(d.counts.competitors, 'competitor')}, {plural(d.counts.reports, 'saved report')}.</p>
        </>
      )}
    </>
  );
}
