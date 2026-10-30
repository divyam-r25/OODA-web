import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, get, patch, post } from '../lib/api';
import { useAsync, useDebounced, useTitle } from '../lib/hooks';
import { cap, timeAgo } from '../lib/format';
import { Link, useQuery } from '../lib/router';
import type { Competitor, Evidence, ReviewStatus, Signal } from '../lib/types';
import { Icon } from '../ui/Icon';
import { EvidenceItem } from '../ui/Evidence';
import { Alert, Button, Confidence, EmptyState, ErrorState, PageHead, SeverityGauge, Skeleton, Tag, TextField, SelectField, useUi } from '../ui/ui';

const PAGE = 20;
const CATS = ['pricing', 'product', 'positioning', 'messaging', 'hiring', 'partnership', 'content', 'other'];
const STATUS_TONE: Record<ReviewStatus, 'info' | 'ok' | 'warn' | undefined> = { new: 'info', reviewed: 'ok', actioned: 'ok', dismissed: undefined };

function Detail({ s, onStatus }: { s: Signal; onStatus: (id: string, st: ReviewStatus) => void }) {
  const { toast } = useUi();
  const q = useAsync((sig) => get<{ evidence: Evidence[]; actions: { id: string; title: string; status: string }[] }>(`/api/signals/${s.id}`, sig), [s.id]);
  const [making, setMaking] = useState(false);
  const [form, setForm] = useState({ title: `Respond to: ${s.title}`.slice(0, 200), priority: s.severity === 'critical' || s.severity === 'high' ? 'high' : 'medium', dueDate: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const mark = async (st: ReviewStatus) => { setBusy(st); try { await patch(`/api/signals/${s.id}`, { reviewStatus: st }); onStatus(s.id, st); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update.', true); } finally { setBusy(''); } };
  const create = async (e: FormEvent) => {
    e.preventDefault(); setErr({}); setBusy('act');
    try { await post('/api/actions', { title: form.title, priority: form.priority, dueDate: form.dueDate || undefined, signalId: s.id, competitorId: s.competitorId, reportId: s.reportId }); toast('Action created.'); onStatus(s.id, 'actioned'); setMaking(false); q.reload(); }
    catch (er) { if (er instanceof ApiError) { setErr(er.fields); if (!Object.keys(er.fields).length) toast(er.message, true); } } finally { setBusy(''); }
  };
  return (
    <div style={{ padding: '4px 22px 22px' }}>
      <p style={{ maxWidth: '70ch' }}>{s.summary || 'No further detail was provided.'}</p>
      <div className="row wrap small muted" style={{ marginBottom: 14 }}>
        <Tag tone={s.basis === 'change' ? 'warn' : undefined} title={s.basis === 'change' ? 'Seen by comparing two stored snapshots' : 'Seen in the current snapshot; no earlier snapshot was used'}>{s.basis === 'change' ? 'Observed change' : 'Observation'}</Tag>
        <Confidence value={s.confidence} /><Link to={`/app/reports/${s.reportId}`}>Open report</Link>
      </div>
      <h4 style={{ marginBottom: 6 }}>Evidence</h4>
      {q.error ? <Alert tone="bad">Could not load the evidence.</Alert> : !q.data ? <Skeleton lines={3} /> : q.data.evidence.length === 0 ? <p className="muted small">No evidence is attached to this signal.</p> : (
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--sheet)' }}>{q.data.evidence.map((e, i) => <EvidenceItem key={e.id} e={e} n={i + 1} />)}</div>
      )}
      {q.data && q.data.actions.length > 0 && <p className="small" style={{ marginTop: 12 }}>Linked actions: {q.data.actions.map((a, i) => <span key={a.id}>{i > 0 && ', '}<Link to="/app/actions">{a.title}</Link> ({cap(a.status)})</span>)}</p>}
      <div className="row wrap" style={{ marginTop: 16 }}>
        {s.reviewStatus !== 'reviewed' && <Button size="sm" icon="check" loading={busy === 'reviewed'} onClick={() => mark('reviewed')}>Mark reviewed</Button>}
        {s.reviewStatus !== 'dismissed' && <Button size="sm" icon="x" loading={busy === 'dismissed'} onClick={() => mark('dismissed')}>Dismiss</Button>}
        {s.reviewStatus !== 'new' && <Button size="sm" variant="quiet" loading={busy === 'new'} onClick={() => mark('new')}>Mark as new</Button>}
        <Button size="sm" variant="primary" icon="actions" onClick={() => setMaking(!making)} aria-expanded={making}>Create action</Button>
      </div>
      {making && (
        <form className="sheet sheet-pad stack" style={{ marginTop: 14, maxWidth: 620 }} onSubmit={create} aria-label="Create action">
          <TextField label="What will you do?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={err.title} maxLength={200} required />
          <div className="form-grid">
            <SelectField label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={[['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} />
            <TextField label="Due date" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} error={err.dueDate} />
          </div>
          <div className="row"><Button type="submit" variant="primary" size="sm" loading={busy === 'act'}>Save action</Button><Button size="sm" variant="quiet" onClick={() => setMaking(false)}>Cancel</Button></div>
        </form>
      )}
    </div>
  );
}

export function SignalsPage() {
  useTitle('Signals');
  const [qp, setQp] = useQuery();
  const [text, setText] = useState(qp.get('q') ?? '');
  const dq = useDebounced(text);
  const status = qp.get('status') ?? '';
  const severity = qp.get('severity') ?? '';
  const category = qp.get('category') ?? '';
  const competitorId = qp.get('competitorId') ?? '';
  const basis = qp.get('basis') ?? '';
  const sort = qp.get('sort') ?? 'newest';
  const offset = Number(qp.get('offset') ?? 0) || 0;
  const openId = qp.get('open') ?? '';
  const comps = useAsync((s) => get<{ competitors: Competitor[] }>('/api/competitors', s), []);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort, ...(dq ? { q: dq } : {}), ...(status ? { status } : {}), ...(severity ? { severity } : {}), ...(category ? { category } : {}), ...(competitorId ? { competitorId } : {}), ...(basis ? { basis } : {}) });
  const q = useAsync((s) => get<{ signals: Signal[]; total: number }>(`/api/signals?${params}`, s), [params.toString()]);
  const [local, setLocal] = useState<Record<string, ReviewStatus>>({});
  const list = q.data?.signals;
  const total = q.data?.total ?? 0;
  const filtered = !!(dq || status || severity || category || competitorId || basis);
  const openRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => { openRef.current?.scrollIntoView({ block: 'center' }); }, [openId, list?.length]);
  const onStatus = (id: string, st: ReviewStatus) => setLocal((l) => ({ ...l, [id]: st }));
  const clear = () => { setText(''); setQp({ q: null, status: null, severity: null, category: null, competitorId: null, basis: null, offset: null }); };
  const sel = (key: string, label: string, value: string, opts: [string, string][]) => (
    <select className="input" aria-label={label} value={value} onChange={(e) => setQp({ [key]: e.target.value || null, offset: null })}>{[['', label] as [string, string], ...opts].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  );
  return (
    <>
      <PageHead title="Signals" sub="Things worth noticing, each tied to the page text that raised it. Review them, dismiss the noise, and turn the rest into actions." />
      <div className="toolbar" role="search">
        <div className="search"><Icon name="search" size={16} /><input className="input" aria-label="Search signals" placeholder="Search signals" value={text} onChange={(e) => { setText(e.target.value); setQp({ q: e.target.value || null, offset: null }); }} /></div>
        {sel('status', 'Any status', status, [['new', 'New'], ['reviewed', 'Reviewed'], ['actioned', 'Actioned'], ['dismissed', 'Dismissed']])}
        {sel('severity', 'Any severity', severity, [['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']])}
        {sel('category', 'Any category', category, CATS.map((c) => [c, cap(c)]))}
        {sel('competitorId', 'Any competitor', competitorId, (comps.data?.competitors ?? []).map((c) => [c.id, c.name]))}
        {sel('basis', 'Any basis', basis, [['change', 'Observed change'], ['observation', 'Observation']])}
        {sel('sort', 'Newest first', sort === 'newest' ? '' : sort, [['severity', 'Most severe first']])}
        {filtered && <Button variant="quiet" size="sm" onClick={clear}>Clear</Button>}
      </div>
      <section className="sheet" aria-live="polite">
        {q.error && !list ? <ErrorState error={q.error} retry={q.reload} /> : !list ? <div className="sheet-pad"><Skeleton lines={6} /></div> : list.length === 0 ? (
          filtered ? <EmptyState title="No signals match" action={<Button onClick={clear}>Clear filters</Button>}>Try widening the filters.</EmptyState>
          : <EmptyState title="No signals yet" action={<Link className="btn btn-primary" to="/app/research">Start research</Link>}>Signals are created when a research run finds something noteworthy in the pages you track.</EmptyState>
        ) : (
          <>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Severity</th><th>Signal</th><th>Competitor</th><th>Confidence</th><th>Found</th><th>Status</th></tr></thead>
              <tbody>
                {list.flatMap((s) => {
                  const st = local[s.id] ?? s.reviewStatus;
                  const open = openId === s.id;
                  const row = { ...s, reviewStatus: st };
                  return [
                    <tr key={s.id} ref={open ? openRef : undefined}>
                      <td><SeverityGauge level={s.severity} /></td>
                      <td className="title-cell"><button type="button" aria-expanded={open} onClick={() => setQp({ open: open ? null : s.id })} style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, display: 'block' }}><Icon name="chevron" size={14} className={`chev ${open ? 'open' : ''}`} />{' '}{s.title}</button><div className="small muted" style={{ paddingLeft: 18 }}>{cap(s.category)} · {s.basis === 'change' ? 'observed change' : 'observation'} · {s.evidenceCount} source{s.evidenceCount === 1 ? '' : 's'}</div></td>
                      <td><Link to={`/app/competitors/${s.competitorId}`}>{s.competitorName}</Link></td>
                      <td><Confidence value={s.confidence} /></td>
                      <td className="muted nowrap">{timeAgo(s.createdAt)}</td>
                      <td><Tag tone={STATUS_TONE[st]}>{cap(st)}</Tag></td>
                    </tr>,
                    open && <tr key={s.id + '-d'}><td colSpan={6} style={{ padding: 0, background: 'var(--paper)' }}><Detail s={row} onStatus={onStatus} /></td></tr>,
                  ];
                })}
              </tbody>
            </table></div>
            <div className="row between" style={{ padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
              <span className="small muted">Showing {offset + 1} to {Math.min(offset + PAGE, total)} of {total}</span>
              <span className="row"><Button size="sm" disabled={offset === 0} onClick={() => setQp({ offset: String(Math.max(0, offset - PAGE)) || null })}>Previous</Button><Button size="sm" disabled={offset + PAGE >= total} onClick={() => setQp({ offset: String(offset + PAGE) })}>Next</Button></span>
            </div>
          </>
        )}
      </section>
    </>
  );
}
