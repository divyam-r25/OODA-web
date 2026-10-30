import { type FormEvent, useState } from 'react';
import { get } from '../lib/api';
import { useAsync, useInterval, useTitle } from '../lib/hooks';
import { STAGE_LABEL, timeAgo } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { errMsg, startRun } from '../lib/runs';
import type { AiInfo, Competitor, Run } from '../lib/types';
import { Alert, Button, EmptyState, ErrorState, LinkButton, PageHead, RunStatusTag, SelectField, Skeleton, TextField, useUi } from '../ui/ui';

export function ResearchPage() {
  useTitle('Research');
  const { navigate } = useRouter();
  const { toast } = useUi();
  const comps = useAsync((s) => get<{ competitors: Competitor[] }>('/api/competitors', s), []);
  const runs = useAsync((s) => get<{ runs: Run[] }>('/api/runs', s), []);
  const settings = useAsync((s) => get<{ ai: AiInfo }>('/api/settings', s), []);
  const live = !!runs.data?.runs.some((r) => r.status === 'queued' || r.status === 'running');
  useInterval(runs.reload, live ? 2500 : null);
  const [pick, setPick] = useState('');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = comps.data?.competitors ?? [];
  const chosen = pick || list[0]?.id || '';

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!chosen) return setErr('Choose a competitor first.');
    setBusy(true);
    try { const r = await startRun(chosen, focus); r.warnings.forEach((w) => toast(w)); navigate(`/app/research/${r.run.id}`); } catch (er) { setErr(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title="Research" sub="A run collects the tracked pages, compares them with the last snapshot, and writes up what it found. Progress is saved, so you can leave and come back." />
      {settings.data && !settings.data.ai.configured && <div style={{ marginBottom: 18 }}><Alert tone="warn" action={<Link to="/app/settings">Setup</Link>}>{settings.data.ai.problem} Runs will collect and save evidence but cannot write reports.</Alert></div>}
      <section className="sheet" aria-labelledby="new-h" style={{ marginBottom: 26 }}>
        <div className="sheet-head"><h2 id="new-h">New run</h2></div>
        {comps.loading && !comps.data ? <div className="sheet-pad"><Skeleton lines={2} /></div> : list.length === 0 ? (
          <EmptyState title="Add a competitor first" action={<LinkButton to="/app/competitors/new" variant="primary" icon="plus">Add competitor</LinkButton>}>Research needs at least one competitor with a page to watch.</EmptyState>
        ) : (
          <form className="sheet-pad stack" onSubmit={submit} noValidate>
            {err && <Alert tone="bad">{err}</Alert>}
            <div className="form-grid">
              <SelectField label="Competitor" value={chosen} onChange={(e) => setPick(e.target.value)} options={list.map((c) => [c.id, c.name])} />
              <TextField label="Focus (optional)" placeholder="e.g. pricing and packaging" value={focus} maxLength={300} onChange={(e) => setFocus(e.target.value)} hint="Steers what the analysis pays attention to." />
            </div>
            <div><Button type="submit" variant="primary" icon="research" loading={busy}>Start research</Button></div>
          </form>
        )}
      </section>
      <section className="sheet" aria-labelledby="hist-h">
        <div className="sheet-head"><h2 id="hist-h">Run history</h2></div>
        {runs.error && !runs.data ? <ErrorState error={runs.error} retry={runs.reload} /> : !runs.data ? <div className="sheet-pad"><Skeleton lines={4} /></div> : runs.data.runs.length === 0 ? <p className="muted" style={{ padding: '18px 22px', margin: 0 }}>No runs yet.</p> : (
          <div className="table-wrap"><table className="table stack-narrow"><thead><tr><th>Competitor</th><th>Status</th><th>Stage</th><th>Started</th><th>Result</th></tr></thead><tbody>
            {runs.data.runs.map((r) => (
              <tr key={r.id}>
                <td className="title-cell"><Link to={`/app/research/${r.id}`}>{r.competitorName}</Link>{r.focus && <div className="small muted">Focus: {r.focus}</div>}</td>
                <td data-label="Status"><RunStatusTag status={r.status} /></td>
                <td data-label="Stage">{r.status === 'queued' || r.status === 'running' ? <span className="row"><span className="bar" style={{ width: 70 }}><b style={{ width: `${r.progress}%` }} /></span><span className="small muted">{STAGE_LABEL[r.stage] ?? r.stage}</span></span> : <span className="muted">{STAGE_LABEL[r.stage] ?? r.stage}</span>}</td>
                <td data-label="Started" className="muted nowrap">{timeAgo(r.createdAt)}</td>
                <td data-label="Result">{r.reportId ? <Link to={`/app/reports/${r.reportId}`}>Open report</Link> : r.error ? <span className="small muted truncate" style={{ display: 'block', maxWidth: 260 }} title={r.error}>{r.error}</span> : <span className="muted">-</span>}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}
