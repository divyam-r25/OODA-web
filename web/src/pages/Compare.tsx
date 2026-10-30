import { useState } from 'react';
import { get } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { cap, dayOnly } from '../lib/format';
import { Link, useQuery } from '../lib/router';
import type { Competitor, Evidence, Finding } from '../lib/types';
import { Cites } from '../ui/Cites';
import { EvidenceItem } from '../ui/Evidence';
import { Alert, EmptyState, ErrorState, KindBadge, LinkButton, PageHead, Skeleton } from '../ui/ui';

interface Cmp {
  columns: { competitor: { id: string; name: string; url: string }; report: { id: string; title: string; createdAt: string; summary: string } | null; findings: Finding[]; limitations: string[] }[];
  evidence: Evidence[];
  categories: string[];
}

export function ComparePage() {
  useTitle('Compare');
  const [qp, setQp] = useQuery();
  const ids = (qp.get('ids') ?? '').split(',').filter(Boolean);
  const comps = useAsync((s) => get<{ competitors: Competitor[] }>('/api/competitors', s), []);
  const ready = ids.length >= 2 && ids.length <= 4;
  const q = useAsync((s) => (ready ? get<Cmp>(`/api/compare?ids=${ids.join(',')}`, s) : Promise.resolve(null)), [ids.join(',')]);
  const [active, setActive] = useState<string | null>(null);
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 4);
    setQp({ ids: next.join(',') || null });
  };
  const list = comps.data?.competitors ?? [];
  const d = q.data;
  const index = new Map((d?.evidence ?? []).map((e, i) => [e.id, i + 1]));
  const rows = d ? d.categories.filter((c) => d.columns.some((col) => col.findings.some((f) => f.category === c))) : [];
  const pick = (id: string) => { setActive(id); document.getElementById(`cmp-src-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  return (
    <>
      <PageHead title="Compare" sub="Put competitors side by side, finding by finding. Every cell comes from each competitor’s latest report and links to the page it came from." />
      <section className="sheet sheet-pad" aria-labelledby="pick-h" style={{ marginBottom: 22 }}>
        <h2 id="pick-h" style={{ fontSize: 17, marginBottom: 12 }}>Choose 2 to 4 competitors</h2>
        {comps.loading && !comps.data ? <Skeleton lines={2} /> : list.length < 2 ? <p className="muted" style={{ margin: 0 }}>You need at least two competitors to compare. <Link to="/app/competitors/new">Add one</Link>.</p> : (
          <div className="row wrap" role="group" aria-labelledby="pick-h" style={{ gap: '10px 22px' }}>
            {list.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={ids.includes(c.id)} disabled={!ids.includes(c.id) && ids.length >= 4} onChange={() => toggle(c.id)} />{c.name}</label>)}
          </div>
        )}
      </section>
      {!ready ? <EmptyState title="Pick at least two competitors">The comparison appears here as soon as you do.</EmptyState> : q.error && !d ? <ErrorState error={q.error} retry={q.reload} /> : !d ? <Skeleton lines={8} /> : (
        <>
          {d.columns.some((c) => !c.report) && <div style={{ marginBottom: 16 }}><Alert tone="warn">{d.columns.filter((c) => !c.report).map((c) => c.competitor.name).join(', ')} {d.columns.filter((c) => !c.report).length === 1 ? 'has' : 'have'} no report yet, so there is nothing to compare. Run research first.</Alert></div>}
          <section className="sheet" style={{ overflowX: 'auto' }} aria-label="Comparison matrix">
            {rows.length === 0 ? <EmptyState title="No findings to compare yet">None of these competitors has a report with findings.</EmptyState> : (
              <table className="matrix">
                <thead><tr><th scope="col"><span className="sr-only">Category</span></th>{d.columns.map((c) => (
                  <th scope="col" key={c.competitor.id}><Link to={`/app/competitors/${c.competitor.id}`} style={{ fontFamily: 'var(--serif)', fontSize: 18 }}>{c.competitor.name}</Link><div className="small muted" style={{ fontWeight: 400 }}>{c.report ? <Link to={`/app/reports/${c.report.id}`}>Report from {dayOnly(c.report.createdAt)}</Link> : 'No report'}</div></th>
                ))}</tr></thead>
                <tbody>{rows.map((cat) => (
                  <tr key={cat}><th scope="row">{cat}</th>{d.columns.map((col) => {
                    const fs = col.findings.filter((f) => f.category === cat);
                    return <td key={col.competitor.id}>{fs.length === 0 ? <span className="none">{col.report ? 'Nothing found on this' : 'No report'}</span> : fs.map((f) => (
                      <div className="cell-item" key={f.id}><div style={{ marginBottom: 4 }}><KindBadge kind={f.kind} /></div>{f.statement} <Cites ids={f.evidenceIds} index={index} active={active} onPick={pick} /></div>
                    ))}</td>;
                  })}</tr>
                ))}</tbody>
              </table>
            )}
          </section>
          {d.columns.some((c) => c.limitations.length > 0) && (
            <section className="sheet sheet-pad" style={{ marginTop: 22 }}><h3 style={{ marginBottom: 10 }}>What these reports could not establish</h3>
              {d.columns.filter((c) => c.limitations.length).map((c) => <details key={c.competitor.id} style={{ marginBottom: 8 }}><summary><b>{c.competitor.name}</b> ({c.limitations.length})</summary><ul className="small" style={{ margin: '8px 0 0' }}>{c.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></details>)}
            </section>
          )}
          {d.evidence.length > 0 && (
            <section className="sheet" style={{ marginTop: 22 }} aria-labelledby="src-h"><div className="sheet-head"><h3 id="src-h">Sources</h3></div>
              {d.evidence.map((e, i) => <EvidenceItem key={e.id} e={e} n={i + 1} on={active === e.id} id={`cmp-src-${e.id}`} />)}
            </section>
          )}
          <p className="small muted" style={{ marginTop: 16 }}>Want a different angle? <LinkButton to="/app/research" variant="quiet" size="sm">Run more research</LinkButton></p>
          <span className="sr-only">{cap('end')}</span>
        </>
      )}
    </>
  );
}
