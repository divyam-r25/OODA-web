import { useState } from 'react';
import { get } from '../lib/api';
import { useAsync, useDebounced, useTitle } from '../lib/hooks';
import { dayOnly } from '../lib/format';
import { Link, useQuery } from '../lib/router';
import type { ReportListItem } from '../lib/types';
import { Icon } from '../ui/Icon';
import { EmptyState, ErrorState, LinkButton, PageHead, Skeleton, Tag, Button } from '../ui/ui';

export function ReportsPage() {
  useTitle('Reports');
  const [qp, setQp] = useQuery();
  const [text, setText] = useState(qp.get('q') ?? '');
  const dq = useDebounced(text);
  const q = useAsync((s) => get<{ reports: ReportListItem[] }>(`/api/reports?${new URLSearchParams(dq ? { q: dq } : {})}`, s), [dq]);
  const list = q.data?.reports;
  return (
    <>
      <PageHead title="Reports" sub="Every analysis is saved, so you can reopen it, check its sources, and export it."><LinkButton to="/app/research" icon="research">New research</LinkButton></PageHead>
      <div className="toolbar" role="search"><div className="search"><Icon name="search" size={16} /><input className="input" aria-label="Search reports" placeholder="Search reports" value={text} onChange={(e) => { setText(e.target.value); setQp({ q: e.target.value || null }); }} /></div></div>
      <section className="sheet">
        {q.error && !list ? <ErrorState error={q.error} retry={q.reload} /> : !list ? <div className="sheet-pad"><Skeleton lines={5} /></div> : list.length === 0 ? (
          dq ? <EmptyState title="No reports match" action={<Button onClick={() => { setText(''); setQp({ q: null }); }}>Clear search</Button>}>Try a different search.</EmptyState>
          : <EmptyState title="No reports yet" action={<LinkButton to="/app/research" variant="primary">Start research</LinkButton>}>Reports are written at the end of a research run that found something to say.</EmptyState>
        ) : (
          <div className="table-wrap"><table className="table stack-narrow"><thead><tr><th>Report</th><th>Competitor</th><th>Basis</th><th className="num">Signals</th><th>Date</th></tr></thead><tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td className="title-cell"><Link to={`/app/reports/${r.id}`}>{r.title}</Link><div className="small muted truncate" style={{ maxWidth: 440 }}>{r.summary}</div></td>
                <td data-label="Competitor"><Link to={`/app/competitors/${r.competitorId}`}>{r.competitorName}</Link></td>
                <td data-label="Basis"><Tag tone={r.hasHistory ? 'ok' : undefined}>{r.hasHistory ? 'Compared with history' : 'Baseline'}</Tag></td>
                <td data-label="Signals" className="num">{r.signalCount}</td>
                <td data-label="Date" className="muted nowrap">{dayOnly(r.createdAt)}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}
