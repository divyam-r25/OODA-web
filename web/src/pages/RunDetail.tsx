import { useState } from 'react';
import { get, post } from '../lib/api';
import { useAsync, useInterval, useTitle } from '../lib/hooks';
import { STAGE_LABEL, clock, dayOnly, fullDate, host } from '../lib/format';
import { Link } from '../lib/router';
import { errMsg } from '../lib/runs';
import type { Run, RunEvent, RunEvidence } from '../lib/types';
import { Icon } from '../ui/Icon';
import { Alert, Button, ErrorState, LinkButton, PageHead, RunStatusTag, Skeleton, Tag, useUi } from '../ui/ui';

interface Data { run: Run; events: RunEvent[]; evidence: RunEvidence[] }
const STEPS = ['Collect', 'Compare', 'Analyse', 'Check sources', 'Save'];
const STAGE_IDX: Record<string, number> = { collecting: 0, validating: 0, queued: 0, retrying: 0, comparing: 1, analyzing: 2, validating_output: 3, saving: 4 };
const STATE_TONE = { baseline: 'info', changed: 'warn', unchanged: undefined } as const;
const STATE_LABEL = { baseline: 'First snapshot', changed: 'Changed', unchanged: 'Unchanged' } as const;

export function RunDetail({ id }: { id: string }) {
  const { toast } = useUi();
  const q = useAsync((s) => get<Data>(`/api/runs/${id}`, s), [id]);
  const d = q.data;
  const active = d ? d.run.status === 'queued' || d.run.status === 'running' : false;
  useInterval(q.reload, active ? 1500 : null);
  useTitle(d ? `Research: ${d.run.competitorName}` : 'Research');
  const [busy, setBusy] = useState('');
  if (q.error && !d) return <ErrorState error={q.error} retry={q.reload} />;
  if (!d) return <Skeleton lines={8} />;
  const r = d.run;
  const act = (kind: 'cancel' | 'retry') => async () => {
    setBusy(kind);
    try { await post(`/api/runs/${id}/${kind}`); toast(kind === 'cancel' ? 'Cancelling…' : 'Retrying…'); q.reload(); } catch (e) { toast(errMsg(e), true); } finally { setBusy(''); }
  };
  const idx = STAGE_IDX[r.stage] ?? (r.status === 'completed' || r.status === 'partial' ? STEPS.length : 0);
  const finished = !active;
  const canRetry = (r.status === 'failed' || r.status === 'cancelled' || r.status === 'partial') && !r.reportId;
  return (
    <>
      <PageHead crumbs={<><Link to="/app/research">Research</Link> / {r.competitorName}</>} title={<>Research: {r.competitorName}</>} sub={<><RunStatusTag status={r.status} /> {r.focus && <>· Focus: {r.focus} </>}· Started {fullDate(r.startedAt ?? r.createdAt)}</>}>
        {active && <Button icon="stop" loading={busy === 'cancel'} disabled={r.cancelRequested} onClick={act('cancel')}>{r.cancelRequested ? 'Cancelling…' : 'Cancel run'}</Button>}
        {canRetry && <Button icon="refresh" variant="primary" loading={busy === 'retry'} onClick={act('retry')}>Retry run</Button>}
        {r.reportId && <LinkButton to={`/app/reports/${r.reportId}`} variant="primary" icon="reports">Open report</LinkButton>}
      </PageHead>

      <section className="sheet sheet-pad" aria-label="Progress" style={{ marginBottom: 22 }}>
        <ol className="steps" aria-label="Pipeline stages" style={{ padding: 0 }}>
          {STEPS.map((s, i) => <li key={s} className={r.status === 'failed' && i === idx ? 'bad' : i < idx || (finished && r.status !== 'failed' && r.status !== 'cancelled') ? 'done' : i === idx && active ? 'now' : ''} aria-current={i === idx && active ? 'step' : undefined}>{s}</li>)}
        </ol>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="bar grow" role="progressbar" aria-valuenow={r.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Run progress"><b style={{ width: `${r.progress}%` }} /></div>
          <span className="small muted nowrap" aria-live="polite">{active ? `${STAGE_LABEL[r.stage] ?? r.stage} · ${r.progress}%` : STAGE_LABEL[r.stage] ?? r.stage}</span>
        </div>
      </section>

      {r.status === 'failed' && <div style={{ marginBottom: 20 }}><Alert tone="bad">{r.error ?? 'This run failed.'} <span className="muted">You can retry once the problem is fixed. Pages already collected are reused.</span></Alert></div>}
      {r.status === 'partial' && <div style={{ marginBottom: 20 }}><Alert tone="warn">{r.error ?? 'This run finished with gaps.'}{r.reportId ? ' The report lists exactly what is missing.' : ''}</Alert></div>}
      {r.status === 'cancelled' && <div style={{ marginBottom: 20 }}><Alert>This run was cancelled. Evidence collected before then is kept.</Alert></div>}
      {r.status === 'completed' && !r.reportId && <div style={{ marginBottom: 20 }}><Alert tone="ok">Nothing changed since the last run, so no new report was needed.</Alert></div>}

      <div className="cols">
        <section className="sheet" aria-labelledby="ev-h">
          <div className="sheet-head"><h2 id="ev-h">Pages collected</h2><span className="small muted">{d.evidence.length}</span></div>
          {d.evidence.length === 0 ? <p className="muted" style={{ padding: '18px 22px', margin: 0 }}>{active ? 'Collecting…' : 'No pages were collected.'}</p> : d.evidence.map((e) => (
            <div className="src" key={e.id}>
              <div className="row between wrap"><b style={{ fontSize: 14.5 }}>{e.title || host(e.url)}</b><Tag tone={STATE_TONE[e.state]}>{STATE_LABEL[e.state]}</Tag></div>
              <a className="url" href={e.url} target="_blank" rel="noopener noreferrer">{e.url} <Icon name="external" size={12} /></a>
              <div className="small muted">Collected {dayOnly(e.fetchedAt)}</div>
              <p className="ex">{e.excerpt}</p>
            </div>
          ))}
        </section>
        <section className="sheet" aria-labelledby="log-h">
          <div className="sheet-head"><h3 id="log-h">Activity</h3></div>
          <ul className="log" style={{ padding: '8px 18px 14px' }} aria-live="polite">
            {d.events.map((e) => <li key={e.id}><span className="t">{clock(e.ts)}</span><span className={e.level} aria-hidden="true">{e.level === 'info' ? '·' : '!'}</span><span className={e.level}>{e.message}</span></li>)}
          </ul>
        </section>
      </div>
    </>
  );
}
