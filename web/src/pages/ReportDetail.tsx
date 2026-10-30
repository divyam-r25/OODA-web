import { useState } from 'react';
import { del, get, post } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { cap, fullDate } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { errMsg } from '../lib/runs';
import type { Evidence, ReportContent, ReportMeta, Signal } from '../lib/types';
import { Cites } from '../ui/Cites';
import { EvidenceItem } from '../ui/Evidence';
import { Button, Confidence, ErrorState, KindBadge, PageHead, SeverityGauge, Skeleton, Tag, useUi } from '../ui/ui';

interface Data { report: ReportMeta; content: ReportContent; evidence: Evidence[]; signals: Signal[] }

export function ReportDetail({ id }: { id: string }) {
  const { navigate } = useRouter();
  const { toast, confirm } = useUi();
  const q = useAsync((s) => get<Data>(`/api/reports/${id}`, s), [id]);
  const d = q.data;
  useTitle(d?.report.title ?? 'Report');
  const [active, setActive] = useState<string | null>(null);
  const [made, setMade] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  if (q.error && !d) return <ErrorState error={q.error} retry={q.reload} />;
  if (!d) return <Skeleton lines={10} />;
  const { report, content, evidence, signals } = d;
  const index = new Map(evidence.map((e, i) => [e.id, i + 1]));
  const pick = (eid: string) => { setActive(eid); document.getElementById(`src-${eid}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this report?', body: 'The report and the signals it created are removed. The collected page snapshots are kept.', confirm: 'Delete report', danger: true }))) return;
    try { await del(`/api/reports/${id}`); toast('Report deleted.'); navigate('/app/reports'); } catch (e) { toast(errMsg(e), true); }
  };
  const toAction = async (rid: string, title: string, priority: string) => {
    setBusy(rid);
    try { await post('/api/actions', { title: title.slice(0, 200), priority, reportId: id, competitorId: report.competitorId }); setMade(new Set(made).add(rid)); toast('Added to your actions.'); } catch (e) { toast(errMsg(e), true); } finally { setBusy(''); }
  };
  const facts = content.findings.filter((f) => f.kind === 'fact').length;
  return (
    <>
      <PageHead crumbs={<><Link to="/app/reports">Reports</Link> / <Link to={`/app/competitors/${report.competitorId}`}>{report.competitorName}</Link></>} title={report.title}
        sub={<>Generated {fullDate(report.createdAt)} · {report.hasHistory ? <Tag tone="ok">Compared with history</Tag> : <Tag>Baseline: first snapshot</Tag>} · <span title="The model that wrote this analysis">{report.provider} / {report.model}</span></>}>
        <Button icon="print" onClick={() => window.print()}>Print or save as PDF</Button>
        <a className="btn" href={`/api/reports/${id}/export?format=md`} download><span style={{ display: 'contents' }}>Markdown</span></a>
        <a className="btn" href={`/api/reports/${id}/export?format=json`} download>JSON</a>
        <Button variant="danger" icon="trash" aria-label="Delete report" onClick={remove} />
      </PageHead>
      <div className="cols">
        <article className="sheet sheet-pad" aria-label="Report">
          <div className="memo">
            <p className="lede">{content.summary}</p>
            <div className="legend no-print" style={{ margin: '4px 0 18px' }}><span><KindBadge kind="fact" /> quoted from a source</span><span><KindBadge kind="interpretation" /> inferred</span><span><KindBadge kind="hypothesis" /> not supported yet</span></div>
            {signals.length > 0 && (<><h2>Signals</h2>
              {signals.map((s) => <div key={s.id} className="row wrap" style={{ fontFamily: 'var(--sans)', fontSize: 15, padding: '8px 0', borderTop: '1px solid var(--line)' }}><SeverityGauge level={s.severity} /><Link to={`/app/signals?open=${s.id}`} className="grow" style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }}>{s.title}</Link><Confidence value={s.confidence} /></div>)}</>)}
            <h2>Findings <span className="small muted" style={{ fontFamily: 'var(--sans)', fontWeight: 400 }}>{content.findings.length} total, {facts} stated as fact</span></h2>
            {content.findings.map((f) => (
              <div className="finding" key={f.id}>
                <div className="meta"><KindBadge kind={f.kind} /><span className="small muted">{cap(f.category)}</span><Confidence value={f.confidence} /></div>
                <p>{f.statement} <Cites ids={f.evidenceIds} index={index} active={active} onPick={pick} /></p>
                {f.quote && <div className="quote">“{f.quote}”</div>}
                {f.demoted && <div className="demoted">Downgraded: the model claimed a stronger level of evidence than the sources support.</div>}
                {f.implication && <div className="implication"><b>What it means for you: </b>{f.implication}</div>}
              </div>
            ))}
            <h2>Recommendations</h2>
            {content.recommendations.length === 0 ? <p className="muted" style={{ fontFamily: 'var(--sans)', fontSize: 15 }}>No recommendation was strong enough to be backed by the collected evidence.</p> : content.recommendations.map((r) => (
              <div className="finding" key={r.id}>
                <div className="meta"><span className={`pri pri-${r.priority}`}>{cap(r.priority)} priority</span></div>
                <p><b>{r.title}</b> <Cites ids={r.evidenceIds} index={index} active={active} onPick={pick} /></p>
                <div className="implication">{r.rationale}</div>
                <div className="no-print" style={{ marginTop: 8 }}>{made.has(r.id) ? <Tag tone="ok">Added to actions</Tag> : <Button size="sm" icon="actions" loading={busy === r.id} onClick={() => toAction(r.id, r.title, r.priority)}>Create action</Button>}</div>
              </div>
            ))}
            <h2>What this report could not establish</h2>
            <div className="limits">{content.limitations.length === 0 ? 'No limitations were recorded.' : <ul>{content.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>}</div>
          </div>
        </article>
        <aside className="rail sheet" aria-label="Sources">
          <div className="sheet-head"><h3>Sources</h3><span className="small muted">{evidence.length}</span></div>
          {evidence.map((e, i) => <EvidenceItem key={e.id} e={e} n={i + 1} on={active === e.id} id={`src-${e.id}`} />)}
        </aside>
      </div>
    </>
  );
}
