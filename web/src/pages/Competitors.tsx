import { useState } from 'react';
import { get } from '../lib/api';
import { useAsync, useDebounced, useTitle } from '../lib/hooks';
import { cap, host, timeAgo } from '../lib/format';
import { Link, useQuery, useRouter } from '../lib/router';
import { errMsg, startRun } from '../lib/runs';
import type { Competitor } from '../lib/types';
import { Icon } from '../ui/Icon';
import { Button, EmptyState, ErrorState, LinkButton, PageHead, RunStatusTag, Skeleton, Tag, useUi } from '../ui/ui';

export function CompetitorsPage() {
  useTitle('Competitors');
  const [qp, setQp] = useQuery();
  const { navigate } = useRouter();
  const { toast } = useUi();
  const [text, setText] = useState(qp.get('q') ?? '');
  const dq = useDebounced(text);
  const tier = qp.get('tier') ?? '';
  const archived = qp.get('archived') === 'true';
  const sort = qp.get('sort') ?? 'new';
  const [busy, setBusy] = useState<string | null>(null);
  const q = useAsync((s) => get<{ competitors: Competitor[] }>(`/api/competitors?${new URLSearchParams({ q: dq, ...(tier ? { tier } : {}), ...(archived ? { archived: 'true' } : {}), sort }).toString()}`, s), [dq, tier, archived, sort]);
  const list = q.data?.competitors;
  const filtered = !!(dq || tier || archived);

  const research = async (c: Competitor) => {
    setBusy(c.id);
    try { const r = await startRun(c.id); r.warnings.forEach((w) => toast(w)); navigate(`/app/research/${r.run.id}`); } catch (e) { toast(errMsg(e), true); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHead title="Competitors" sub="The companies you track. OODA keeps a dated snapshot of each page you choose."><LinkButton to="/app/competitors/new" variant="primary" icon="plus">Add competitor</LinkButton></PageHead>
      <div className="toolbar" role="search">
        <div className="search"><Icon name="search" size={16} /><input className="input" aria-label="Search competitors" placeholder="Search by name or website" value={text} onChange={(e) => { setText(e.target.value); setQp({ q: e.target.value || null }); }} /></div>
        <select className="input" aria-label="Filter by tier" value={tier} onChange={(e) => setQp({ tier: e.target.value || null })}><option value="">All tiers</option><option value="direct">Direct</option><option value="indirect">Indirect</option><option value="emerging">Emerging</option></select>
        <select className="input" aria-label="Sort" value={sort} onChange={(e) => setQp({ sort: e.target.value === 'new' ? null : e.target.value })}><option value="new">Newest first</option><option value="name">Name A to Z</option></select>
        <label className="check small"><input type="checkbox" checked={archived} onChange={(e) => setQp({ archived: e.target.checked ? 'true' : null })} />Show archived</label>
      </div>
      <section className="sheet">
        {q.error && !list ? <ErrorState error={q.error} retry={q.reload} /> : !list ? <div className="sheet-pad"><Skeleton lines={5} /></div> : list.length === 0 ? (
          filtered ? <EmptyState title="No matches" action={<Button onClick={() => { setText(''); setQp({ q: null, tier: null, archived: null }); }}>Clear filters</Button>}>Nothing matches your search. Try a different name or clear the filters.</EmptyState>
          : <EmptyState title="No competitors yet" action={<LinkButton to="/app/competitors/new" variant="primary" icon="plus">Add your first competitor</LinkButton>}>Start with the one you lose deals to, or the one your customers mention most.</EmptyState>
        ) : (
          <div className="table-wrap"><table className="table stack-narrow">
            <thead><tr><th>Competitor</th><th>Tier</th><th className="num">Pages</th><th>Last research</th><th className="num">New signals</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="title-cell"><Link to={`/app/competitors/${c.id}`}>{c.name}</Link><div className="small muted">{host(c.url)}</div></td>
                  <td data-label="Tier"><Tag>{cap(c.tier)}</Tag>{c.archived && <> <Tag>Archived</Tag></>}</td>
                  <td data-label="Pages" className="num">{c.sourceCount}</td>
                  <td data-label="Last research">{c.lastRun ? <span className="row"><RunStatusTag status={c.lastRun.status} /><span className="small muted">{timeAgo(c.lastRun.finishedAt)}</span></span> : <span className="muted">Never</span>}</td>
                  <td data-label="New signals" className="num">{c.newSignals ? <Link to={`/app/signals?status=new&competitorId=${c.id}`}><b>{c.newSignals}</b></Link> : <span className="muted">0</span>}</td>
                  <td style={{ textAlign: 'right' }}>{!c.archived && <Button size="sm" icon="research" loading={busy === c.id} onClick={() => research(c)}>Research</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
