import { type FormEvent, useState } from 'react';
import { ApiError, get, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAsync, useTitle } from '../lib/hooks';
import type { AiInfo, Profile } from '../lib/types';
import { Alert, Button, ErrorState, PageHead, Segmented, Skeleton, Tag, TextArea, TextField, useUi } from '../ui/ui';

interface S { account: { name: string; email: string }; profile: Profile; ai: AiInfo; limits: Record<string, number>; collection: { respectRobots: boolean; timeoutMs: number; maxBytes: number } }

export function SettingsPage() {
  useTitle('Settings');
  const { toast } = useUi();
  const { logout } = useAuth();
  const q = useAsync((s) => get<S>('/api/settings', s), []);
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => { try { const t = localStorage.getItem('ooda-theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } });
  const d = q.data;
  const form = p ?? d?.profile ?? null;
  const applyTheme = (t: typeof theme) => {
    setTheme(t);
    try { if (t === 'system') { localStorage.removeItem('ooda-theme'); document.documentElement.removeAttribute('data-theme'); } else { localStorage.setItem('ooda-theme', t); document.documentElement.setAttribute('data-theme', t); } } catch { /* storage blocked */ }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!form) return; setErr({}); setBusy(true);
    try { const r = await put<{ profile: Profile }>('/api/settings/profile', form); setP(r.profile); toast('Profile saved.'); } catch (er) { if (er instanceof ApiError) { setErr(er.fields); if (!Object.keys(er.fields).length) toast(er.message, true); } } finally { setBusy(false); }
  };
  if (q.error && !d) return <ErrorState error={q.error} retry={q.reload} />;
  if (!d || !form) return <><PageHead title="Settings" /><Skeleton lines={8} /></>;
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...form, [k]: e.target.value });
  return (
    <>
      <PageHead title="Settings" sub="Your company profile shapes every analysis. The rest is how this server is set up." />
      <div className="stack" style={{ maxWidth: 820 }}>
        <form className="sheet" onSubmit={save} aria-labelledby="prof-h" noValidate>
          <div className="sheet-head"><h2 id="prof-h">Your company</h2></div>
          <div className="sheet-pad stack">
            <p className="muted small" style={{ margin: 0 }}>OODA uses this to say what a competitor’s move means for <i>you</i>. It is included in analysis requests; nothing else about you is.</p>
            <div className="form-grid">
              <TextField label="Company name" value={form.companyName} onChange={set('companyName')} error={err.companyName} maxLength={120} />
              <TextField label="Website" value={form.website} onChange={set('website')} error={err.website} placeholder="yourcompany.com" />
              <TextField label="Industry" value={form.industry} onChange={set('industry')} error={err.industry} maxLength={120} />
              <TextField label="Who you sell to" value={form.audience} onChange={set('audience')} error={err.audience} maxLength={300} />
              <TextField className="full" label="Current goal" value={form.goal} onChange={set('goal')} error={err.goal} maxLength={300} placeholder="e.g. Win more mid-market deals this quarter" />
              <TextArea className="full" label="About" value={form.description} onChange={set('description')} error={err.description} maxLength={1000} />
            </div>
            <div><Button type="submit" variant="primary" loading={busy}>Save profile</Button></div>
          </div>
        </form>

        <section className="sheet" aria-labelledby="ai-h">
          <div className="sheet-head">
            <h2 id="ai-h">Analysis provider</h2>
            <div className="row wrap gap-sm">
              {d.ai.configured ? <Tag tone="ok">Connected</Tag> : <Tag tone="warn">Not configured</Tag>}
              {d.ai.isFree && <Tag tone="info">Zero-Cost ($0)</Tag>}
              <Tag>{d.ai.workflow === 'multi_agent' ? 'Multi-Agent (4 Roles)' : 'Single Agent'}</Tag>
            </div>
          </div>
          <div className="sheet-pad stack">
            {d.ai.configured ? (
              <div className="stack-sm">
                <p style={{ margin: 0 }}>
                  Provider: <b>{d.ai.provider}</b> {d.ai.isLocal ? '(Local Inference)' : d.ai.isFree ? '(Hosted Free Tier)' : ''} · Default Model:{' '}
                  <span className="mono">{d.ai.model}</span> · Workflow: <b>{d.ai.workflow === 'multi_agent' ? 'Multi-Agent Pipeline' : 'Single Agent'}</b>
                </p>
                {d.ai.workflow === 'multi_agent' && (
                  <div className="card-sub pad-sm small muted stack-sm">
                    <div><b>4-Role Sequential Workflow:</b></div>
                    <div>1. <b>Research Analyst:</b> Extracts verified facts and exact quotes with evidence refs (E1, E2...).</div>
                    <div>2. <b>Strategy Analyst:</b> Evaluates competitive implications and formulates recommendations.</div>
                    <div>3. <b>Skeptical Reviewer:</b> Audits quotes, challenges unsupported claims, and flags baseline errors.</div>
                    <div>4. <b>Lead Synthesizer:</b> Conservative conflict resolution into final verified OODA report.</div>
                    {d.ai.roleModels && Object.values(d.ai.roleModels).some(Boolean) && (
                      <div className="mono small">
                        Role Models: Analyst: {d.ai.roleModels.analyst || d.ai.model} | Strategist: {d.ai.roleModels.strategist || d.ai.model} | Critic: {d.ai.roleModels.critic || d.ai.model} | Synthesis: {d.ai.roleModels.synthesizer || d.ai.model}
                      </div>
                    )}
                  </div>
                )}
                {d.ai.provider === 'ollama' && (
                  <Alert>
                    <b>Local Ollama Active:</b> Truly unlimited, zero-cost private inference. Ollama runs locally on your machine (<span className="mono">http://127.0.0.1:11434</span>).
                    <br /><span className="small">Cloud Notice: If deployed on a cloud container (like Render), 127.0.0.1 refers to the container, not your personal computer. For cloud deployments, use <span className="mono">AI_PROVIDER=openrouter_free</span>.</span>
                  </Alert>
                )}
                {d.ai.provider === 'openrouter_free' && (
                  <Alert>
                    <b>OpenRouter Free Active:</b> Zero-cost hosted inference for cloud deployments. Only models ending in <span className="mono">:free</span> (or <span className="mono">openrouter/free</span>) are permitted.
                    <br /><span className="small">If the free-tier rate limit or quota is exhausted, collected evidence is preserved and runs stop safely with zero billing.</span>
                  </Alert>
                )}
              </div>
            ) : (
              <Alert tone="warn">
                <b>Configuration Issue:</b> {d.ai.problem}
                <br /><span className="small">Set your provider in the server environment (<span className="mono">.env</span>) and restart. Pages can still be collected and stored without AI.</span>
              </Alert>
            )}
            {d.ai.provider === 'mock' && (
              <Alert>The deterministic test provider is active. It builds output from the collected text without a language model, so use it for testing only.</Alert>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              All API keys and provider endpoints live strictly in the server environment (see <span className="mono">.env.example</span>). Secrets are never sent to your browser.
            </p>
          </div>
        </section>

        <section className="sheet" aria-labelledby="col-h">
          <div className="sheet-head"><h2 id="col-h">Collection rules</h2></div>
          <div className="sheet-pad small stack-sm">
            <div>robots.txt: <b>{d.collection.respectRobots ? 'respected' : 'ignored'}</b></div>
            <div>Page timeout: <b>{d.collection.timeoutMs / 1000}s</b> · Size cap: <b>{(d.collection.maxBytes / 1_000_000).toFixed(1)} MB</b></div>
            <div>Limits: up to <b>{d.limits.maxCompetitors}</b> competitors, <b>{d.limits.maxSourcesPerCompetitor}</b> pages each, <b>{d.limits.maxActiveRunsPerUser}</b> runs at once, <b>{d.limits.maxRunsPerDay}</b> runs per day.</div>
            <div className="muted">Private, internal and non-standard-port addresses are always refused.</div>
          </div>
        </section>

        <section className="sheet" aria-labelledby="look-h">
          <div className="sheet-head"><h2 id="look-h">Appearance and account</h2></div>
          <div className="sheet-pad stack">
            <div className="row wrap"><span className="label">Theme</span><Segmented label="Theme" value={theme} onChange={applyTheme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} /></div>
            <div className="row wrap between"><span>Signed in as <b>{d.account.name}</b> ({d.account.email})</span><Button icon="logout" onClick={() => logout()}>Sign out</Button></div>
          </div>
        </section>
      </div>
    </>
  );
}
