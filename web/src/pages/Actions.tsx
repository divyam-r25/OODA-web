import { type FormEvent, useState } from 'react';
import { ApiError, del, get, patch, post } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { cap, dayOnly, isOverdue } from '../lib/format';
import { Link } from '../lib/router';
import { errMsg } from '../lib/runs';
import type { ActionItem } from '../lib/types';
import { Icon } from '../ui/Icon';
import { Button, EmptyState, ErrorState, PageHead, SelectField, Skeleton, TextArea, TextField, useUi } from '../ui/ui';

const LANES: [ActionItem['status'], string][] = [['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']];

function Card({ a, reload }: { a: ActionItem; reload: () => void }) {
  const { toast, confirm } = useUi();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: a.title, description: a.description, priority: a.priority, dueDate: a.dueDate ?? '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await fn(); if (ok) toast(ok); reload(); } catch (e) { if (e instanceof ApiError && Object.keys(e.fields).length) setErr(e.fields); else toast(errMsg(e), true); } finally { setBusy(false); } };
  const move = (status: ActionItem['status']) => run(() => patch(`/api/actions/${a.id}`, { status }));
  const save = (e: FormEvent) => { e.preventDefault(); setErr({}); void run(async () => { await patch(`/api/actions/${a.id}`, { title: f.title, description: f.description, priority: f.priority, dueDate: f.dueDate || null }); setEdit(false); }, 'Saved.'); };
  const remove = async () => { if (await confirm({ title: 'Delete this action?', body: a.title, confirm: 'Delete', danger: true })) await run(() => del(`/api/actions/${a.id}`)); };
  const overdue = isOverdue(a.dueDate, a.status === 'done');
  if (edit) return (
    <form className="task" onSubmit={save} aria-label={`Edit ${a.title}`}>
      <TextField label="Title" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} error={err.title} required />
      <TextArea label="Notes" value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <div className="form-grid"><SelectField label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as ActionItem['priority'] })} options={[['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} /><TextField label="Due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} error={err.dueDate} /></div>
      <div className="row"><Button type="submit" size="sm" variant="primary" loading={busy}>Save</Button><Button size="sm" variant="quiet" onClick={() => setEdit(false)}>Cancel</Button></div>
    </form>
  );
  return (
    <div className={`task ${a.status === 'done' ? 'done' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <label className="check" style={{ marginTop: 2 }}><input type="checkbox" checked={a.status === 'done'} disabled={busy} onChange={(e) => move(e.target.checked ? 'done' : 'todo')} aria-label={`Mark "${a.title}" ${a.status === 'done' ? 'not done' : 'done'}`} /></label>
        <div className="grow"><div className="t-title">{a.title}</div>{a.description && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{a.description}</div>}</div>
      </div>
      <div className="row wrap small">
        <span className={`pri pri-${a.priority}`}>{cap(a.priority)}</span>
        {a.dueDate && <span className={overdue ? 'overdue' : 'muted'}>{overdue ? 'Overdue · ' : 'Due '}{dayOnly(a.dueDate)}</span>}
        {a.competitorName && a.competitorId && <Link to={`/app/competitors/${a.competitorId}`}>{a.competitorName}</Link>}
        {a.signalId && <Link to={`/app/signals?open=${a.signalId}`}>From signal</Link>}
        {a.reportId && <Link to={`/app/reports/${a.reportId}`}>From report</Link>}
      </div>
      <div className="row wrap no-print">
        {a.status !== 'todo' && a.status !== 'done' && <Button size="sm" variant="quiet" onClick={() => move('todo')}>← To do</Button>}
        {a.status === 'todo' && <Button size="sm" onClick={() => move('in_progress')}>Start</Button>}
        {a.status === 'in_progress' && <Button size="sm" variant="primary" icon="check" onClick={() => move('done')}>Done</Button>}
        {a.status === 'done' && <Button size="sm" variant="quiet" onClick={() => move('in_progress')}>Reopen</Button>}
        <span className="grow" />
        <Button size="sm" variant="quiet" icon="edit" aria-label={`Edit ${a.title}`} onClick={() => setEdit(true)} />
        <Button size="sm" variant="quiet" icon="trash" aria-label={`Delete ${a.title}`} onClick={remove} />
      </div>
    </div>
  );
}

export function ActionsPage() {
  useTitle('Actions');
  const { toast } = useUi();
  const q = useAsync((s) => get<{ actions: ActionItem[] }>('/api/actions', s), []);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [due, setDue] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pri, setPri] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr({});
    if (!title.trim()) return setErr({ title: 'Describe the action.' });
    setBusy(true);
    try { await post('/api/actions', { title, priority, dueDate: due || undefined }); setTitle(''); setDue(''); toast('Action added.'); q.reload(); } catch (er) { if (er instanceof ApiError && Object.keys(er.fields).length) setErr(er.fields); else toast(errMsg(er), true); } finally { setBusy(false); }
  };
  const all = q.data?.actions;
  const shown = all?.filter((a) => !pri || a.priority === pri);
  const open = all?.filter((a) => a.status !== 'done').length ?? 0;
  return (
    <>
      <PageHead title="Actions" sub={all ? `${open} open. Turn what you learned into things that get done.` : 'Turn what you learned into things that get done.'}>
        <select className="input" style={{ width: 'auto' }} aria-label="Filter by priority" value={pri} onChange={(e) => setPri(e.target.value)}><option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      </PageHead>
      <form className="sheet sheet-pad" onSubmit={add} aria-label="Add an action" style={{ marginBottom: 24 }} noValidate>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <div className="grow" style={{ minWidth: 240 }}><TextField label="New action" placeholder="e.g. Review our Team plan price against Acme" value={title} onChange={(e) => setTitle(e.target.value)} error={err.title} maxLength={200} /></div>
          <div style={{ width: 130 }}><SelectField label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} options={[['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} /></div>
          <div style={{ width: 170 }}><TextField label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} error={err.dueDate} /></div>
          <div style={{ paddingTop: 26 }}><Button type="submit" variant="primary" icon="plus" loading={busy}>Add</Button></div>
        </div>
      </form>
      {q.error && !all ? <ErrorState error={q.error} retry={q.reload} /> : !shown ? <Skeleton lines={6} /> : all!.length === 0 ? (
        <section className="sheet"><EmptyState title="Nothing to do yet">Add an action above, or create one from a signal or a report recommendation.</EmptyState></section>
      ) : (
        <div className="board">
          {LANES.map(([status, label]) => {
            const items = shown.filter((a) => a.status === status);
            return (
              <section key={status} aria-labelledby={`lane-${status}`}>
                <div className="lane-head"><h3 id={`lane-${status}`}>{label}</h3><span className="small muted">{items.length}</span></div>
                {items.length === 0 ? <p className="small muted" style={{ border: '1px dashed var(--line-strong)', borderRadius: 6, padding: 16, margin: 0 }}>{status === 'done' ? 'Finished actions land here.' : 'Empty.'}</p> : items.map((a) => <Card key={a.id} a={a} reload={q.reload} />)}
              </section>
            );
          })}
        </div>
      )}
      <span className="sr-only"><Icon name="check" /></span>
    </>
  );
}
