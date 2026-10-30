import { type FormEvent, useState } from 'react';
import { ApiError, del, get, patch, post } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { cap, dayOnly, host, timeAgo } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { errMsg, startRun } from '../lib/runs';
import type { Competitor, ReviewStatus, RunStatus, Severity } from '../lib/types';
import { Button, ErrorState, PageHead, RunStatusTag, SelectField, SeverityGauge, Skeleton, Tag, TextArea, TextField, useUi, EmptyState } from '../ui/ui';
import { Icon } from '../ui/Icon';

interface Detail {
  competitor: Competitor;
  sources: { id: string; url: string; label: string; lastFetched: string | null; lastTitle: string | null; snapshots: number }[];
  runs: { id: string; status: RunStatus; error: string | null; createdAt: string; finishedAt: string | null }[];
  reports: { id: string; title: string; summary: string; createdAt: string; hasHistory: number }[];
  signals: { id: string; title: string; severity: Severity; category: string; reviewStatus: ReviewStatus; createdAt: string }[];
}

export function CompetitorDetail({ id }: { id: string }) {
  const { navigate } = useRouter();
  const { toast, confirm } = useUi();
  const q = useAsync((s) => get<Detail>(`/api/competitors/${id}`, s), [id]);
  const d = q.data;
  useTitle(d?.competitor.name ?? 'Competitor');
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ name: '', tier: 'direct', notes: '' });
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [pageLabel, setPageLabel] = useState('');
  const [pageErr, setPageErr] = useState('');

  if (q.error && !d) return <ErrorState error={q.error} retry={q.reload} />;
  if (!d) return <Skeleton lines={8} />;
  const c = d.competitor;
  const active = d.runs.find((r) => r.status === 'queued' || r.status === 'running');

  const wrap = (key: string, fn: () => Promise<void>) => async () => { setBusy(key); try { await fn(); } catch (e) { toast(errMsg(e), true); } finally { setBusy(''); } };
  const research = wrap('research', async () => { const r = await startRun(c.id); r.warnings.forEach((w) => toast(w)); navigate(`/app/research/${r.run.id}`); });
  const archive = wrap('archive', async () => { await patch(`/api/competitors/${c.id}`, { archived: !c.archived }); toast(c.archived ? 'Restored.' : 'Archived.'); q.reload(); });
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${c.name}?`, body: 'This permanently deletes their snapshots, reports, signals and research history. Actions you created are kept.', confirm: 'Delete competitor', danger: true });
    if (ok) await wrap('delete', async () => { await del(`/api/competitors/${c.id}`); toast('Competitor deleted.'); navigate('/app/competitors'); })();
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); setFieldErr({}); setBusy('save');
    try { await patch(`/api/competitors/${c.id}`, edit); setEditing(false); toast('Saved.'); q.reload(); } catch (err) { if (err instanceof ApiError) setFieldErr(err.fields); else toast(errMsg(err), true); } finally { setBusy(''); }
  };
  const addPage = async (e: FormEvent) => {
    e.preventDefault(); setPageErr('');
    if (!pageUrl.trim()) return setPageErr('Enter a page address.');
    setBusy('page');
    try { await post(`/api/competitors/${c.id}/sources`, { url: pageUrl, label: pageLabel || undefined }); setPageUrl(''); setPageLabel(''); toast('Page added.'); q.reload(); } catch (err) { setPageErr(err instanceof ApiError ? (err.fields.url ?? err.message) : 'Could not add the page.'); } finally { setBusy(''); }
  };
  const removePage = (sid: string) => wrap('rm' + sid, async () => { await del(`/api/competitors/${c.id}/sources/${sid}`); q.reload(); })();

  return (
    <>
      <PageHead crumbs={<Link to="/app/competitors">Competitors</Link>} title={c.name} sub={<><a href={c.url} target="_blank" rel="noopener noreferrer">{host(c.url)} <Icon name="external" size={13} /></a> · <Tag>{cap(c.tier)}</Tag>{c.archived && <> <Tag>Archived</Tag></>}</>}>
        {!c.archived && <Button variant="primary" icon="research" loading={busy === 'research'} disabled={!!active} onClick={research}>{active ? 'Research running' : 'Research now'}</Button>}
        <Button icon="edit" onClick={() => { setEdit({ name: c.name, tier: c.tier, notes: c.notes }); setEditing(!editing); }}>Edit</Button>
        <Button loading={busy === 'archive'} onClick={archive}>{c.archived ? 'Restore' : 'Archive'}</Button>
        <Button variant="danger" icon="trash" aria-label={`Delete ${c.name}`} onClick={remove} />
      </PageHead>
      {active && <p className="small" style={{ marginBottom: 16 }}><Link to={`/app/research/${active.id}`}>A research run is in progress. Follow it →</Link></p>}
      {editing && (
        <form className="sheet sheet-pad stack" style={{ marginBottom: 24, maxWidth: 720 }} onSubmit={save}>
          <div className="form-grid"><TextField label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={fieldErr.name} maxLength={120} required /><SelectField label="Tier" value={edit.tier} onChange={(e) => setEdit({ ...edit, tier: e.target.value })} options={[['direct', 'Direct'], ['indirect', 'Indirect'], ['emerging', 'Emerging']]} /></div>
          <TextArea label="Notes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} error={fieldErr.notes} maxLength={2000} />
          <div className="row"><Button type="submit" variant="primary" loading={busy === 'save'}>Save changes</Button><Button variant="quiet" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      )}
      <div className="cols">
        <div className="stack">
          <section className="sheet" aria-labelledby="pages-h">
            <div className="sheet-head"><h2 id="pages-h">Tracked pages</h2></div>
            <div className="table-wrap"><table className="table stack-narrow"><thead><tr><th>Page</th><th>Last collected</th><th className="num">Snapshots</th><th><span className="sr-only">Remove</span></th></tr></thead><tbody>
              {d.sources.map((s) => (
                <tr key={s.id}>
                  <td className="title-cell"><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label || s.lastTitle || host(s.url)}</a><div className="small muted truncate" style={{ maxWidth: 380 }}>{s.url}</div></td>
                  <td data-label="Last collected" className="muted">{s.lastFetched ? timeAgo(s.lastFetched) : 'Not yet'}</td>
                  <td data-label="Snapshots" className="num">{s.snapshots}</td>
                  <td style={{ textAlign: 'right' }}>{d.sources.length > 1 && <Button variant="quiet" size="sm" icon="x" aria-label={`Stop tracking ${s.label || s.url}`} loading={busy === 'rm' + s.id} onClick={() => removePage(s.id)} />}</td>
                </tr>
              ))}
            </tbody></table></div>
            <form className="row wrap" style={{ padding: '14px 22px', borderTop: '1px solid var(--line)' }} onSubmit={addPage} aria-label="Add a tracked page">
              <input className="input grow" style={{ minWidth: 200 }} aria-label="Page address" placeholder="Add a page, e.g. competitor.com/pricing" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} aria-invalid={!!pageErr} spellCheck={false} />
              <input className="input" style={{ width: 130 }} aria-label="Label" placeholder="Label" value={pageLabel} maxLength={60} onChange={(e) => setPageLabel(e.target.value)} />
              <Button type="submit" size="sm" icon="plus" loading={busy === 'page'}>Add</Button>
              {pageErr && <span className="err small" role="alert" style={{ color: 'var(--danger)', flexBasis: '100%' }}>{pageErr}</span>}
            </form>
          </section>

          <section className="sheet" aria-labelledby="sig-h">
            <div className="sheet-head"><h2 id="sig-h">Signals</h2><Link to={`/app/signals?competitorId=${c.id}`} className="small">Open in signals</Link></div>
            {d.signals.length === 0 ? <EmptyState title="No signals yet">Signals appear after a research run finds something worth your attention.</EmptyState> : d.signals.map((s) => (
              <div className="list-row" key={s.id}><SeverityGauge level={s.severity} /><div className="grow"><Link to={`/app/signals?open=${s.id}`}>{s.title}</Link><div className="small muted">{cap(s.category)} · {timeAgo(s.createdAt)}</div></div><Tag tone={s.reviewStatus === 'new' ? 'info' : undefined}>{cap(s.reviewStatus)}</Tag></div>
            ))}
          </section>
        </div>
        <div className="stack">
          <section className="sheet" aria-labelledby="rep-h">
            <div className="sheet-head"><h3 id="rep-h">Reports</h3></div>
            {d.reports.length === 0 ? <p className="muted small" style={{ padding: '14px 22px', margin: 0 }}>No reports yet.</p> : d.reports.map((r) => (
              <div className="list-row" key={r.id}><div className="grow"><Link to={`/app/reports/${r.id}`}>{dayOnly(r.createdAt)}</Link><div className="small muted">{r.hasHistory ? 'Compared with history' : 'Baseline'}</div></div></div>
            ))}
          </section>
          <section className="sheet" aria-labelledby="runs-h2">
            <div className="sheet-head"><h3 id="runs-h2">Research history</h3></div>
            {d.runs.length === 0 ? <p className="muted small" style={{ padding: '14px 22px', margin: 0 }}>Not researched yet.</p> : d.runs.map((r) => (
              <div className="list-row" key={r.id}><div className="grow"><Link to={`/app/research/${r.id}`}>{timeAgo(r.finishedAt ?? r.createdAt)}</Link></div><RunStatusTag status={r.status} /></div>
            ))}
          </section>
          {c.notes && <section className="sheet sheet-pad"><h3 style={{ marginBottom: 8 }}>Notes</h3><p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.notes}</p></section>}
        </div>
      </div>
    </>
  );
}
