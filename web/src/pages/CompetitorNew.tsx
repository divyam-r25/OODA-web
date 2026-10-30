import { type FormEvent, useState } from 'react';
import { ApiError, post } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { Link, useRouter } from '../lib/router';
import type { Competitor } from '../lib/types';
import { Button, PageHead, SelectField, TextArea, TextField, Alert, useUi } from '../ui/ui';
import { Icon } from '../ui/Icon';

export function CompetitorNew() {
  useTitle('Add competitor');
  const { navigate } = useRouter();
  const { toast } = useUi();
  const [v, setV] = useState({ name: '', url: '', tier: 'direct', notes: '' });
  const [extra, setExtra] = useState<{ url: string; label: string }[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!v.name.trim()) local.name = 'Enter the competitor’s name.';
    if (!v.url.trim()) local.url = 'Enter their website address.';
    setFields(local); setError('');
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const r = await post<{ competitor: Competitor }>('/api/competitors', { ...v, extraSources: extra.filter((x) => x.url.trim()).map((x) => ({ url: x.url, label: x.label || undefined })) });
      toast(`${r.competitor.name} added.`);
      navigate(`/app/competitors/${r.competitor.id}`);
    } catch (err) {
      if (err instanceof ApiError) { setFields(err.fields); setError(Object.keys(err.fields).length ? '' : err.message); } else setError('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead crumbs={<Link to="/app/competitors">Competitors</Link>} title="Add a competitor" sub="Start with their website. Add the specific pages that tend to change, such as pricing, product or careers." />
      <form className="sheet sheet-pad stack" style={{ maxWidth: 760 }} onSubmit={submit} noValidate>
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="form-grid">
          <TextField label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={fields.name} required autoFocus maxLength={120} />
          <SelectField label="Tier" value={v.tier} onChange={(e) => setV({ ...v, tier: e.target.value })} options={[['direct', 'Direct: same customers, same job'], ['indirect', 'Indirect: adjacent alternative'], ['emerging', 'Emerging: early or fast-moving']]} />
          <TextField className="full" label="Website" placeholder="competitor.com" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} error={fields.url} hint="Public pages only. Private or internal addresses are refused." required inputMode="url" autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="stack-sm">
          <span className="label">Additional pages to watch <span className="muted" style={{ fontWeight: 400 }}>(optional, up to 5)</span></span>
          {fields.extraSources && <span className="err small" style={{ color: 'var(--danger)' }}>{fields.extraSources}</span>}
          {extra.map((x, i) => (
            <div className="row" key={i}>
              <input className="input grow" aria-label={`Page ${i + 1} address`} placeholder="competitor.com/pricing" value={x.url} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)))} spellCheck={false} />
              <input className="input" style={{ width: 140 }} aria-label={`Page ${i + 1} label`} placeholder="Label" value={x.label} maxLength={60} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
              <Button variant="quiet" icon="x" aria-label={`Remove page ${i + 1}`} onClick={() => setExtra(extra.filter((_, j) => j !== i))} />
            </div>
          ))}
          {extra.length < 5 && <div><Button size="sm" icon="plus" onClick={() => setExtra([...extra, { url: '', label: '' }])}>Add a page</Button></div>}
        </div>
        <TextArea label="Notes" hint="Anything the analysis should keep in mind, such as why you track them." value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={2000} />
        <p className="small muted row" style={{ margin: 0 }}><Icon name="info" size={16} />OODA reads pages the way a visitor would and follows each site’s robots.txt.</p>
        <div className="row"><Button type="submit" variant="primary" loading={busy}>Add competitor</Button><Button variant="quiet" onClick={() => navigate('/app/competitors')}>Cancel</Button></div>
      </form>
    </>
  );
}
