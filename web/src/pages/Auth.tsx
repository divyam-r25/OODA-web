import { type FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/hooks';
import { Link } from '../lib/router';
import { Mark } from '../ui/Icon';
import { Alert, Button, TextField } from '../ui/ui';

function Side() {
  return (
    <div className="auth-side">
      <Link to="/" className="brand" style={{ padding: 0 }}><Mark /><b>OODA</b></Link>
      <div>
        <h2>See the move before it becomes the market.</h2>
        <p>Collect public evidence, see what changed, and turn it into decisions your team can act on.</p>
      </div>
      <p className="small" style={{ margin: 0 }}>Every claim in OODA links back to a page we actually collected.</p>
    </div>
  );
}

function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setFields({});
    try { await fn(); } catch (e) {
      if (e instanceof ApiError) { setFields(e.fields); if (!Object.keys(e.fields).length) setError(e.message); else if (e.code !== 'validation_failed') setError(e.message); }
      else setError('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };
  return { busy, error, fields, setFields, run };
}

export function LoginPage() {
  useTitle('Sign in');
  const { login } = useAuth();
  const f = useForm();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!email.trim()) local.email = 'Enter your email.';
    if (!password) local.password = 'Enter your password.';
    if (Object.keys(local).length) return f.setFields(local);
    void f.run(() => login(email, password));
  };
  return (
    <div className="auth">
      <Side />
      <div className="auth-form">
        <form onSubmit={submit} noValidate className="stack" aria-label="Sign in">
          <div><h1>Sign in</h1><p className="muted" style={{ marginTop: 6 }}>Welcome back.</p></div>
          {f.error && <Alert tone="bad">{f.error}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={f.fields.email} required autoFocus />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={f.fields.password} required />
          <Button type="submit" variant="primary" loading={f.busy}>Sign in</Button>
          <p className="small muted">New to OODA? <Link to="/register">Create a workspace</Link></p>
        </form>
      </div>
    </div>
  );
}

export function RegisterPage() {
  useTitle('Create your workspace');
  const { register } = useAuth();
  const f = useForm();
  const [v, setV] = useState({ name: '', email: '', password: '' });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!v.name.trim()) local.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) local.email = 'Enter a valid email address.';
    if (v.password.length < 10) local.password = 'Use at least 10 characters.';
    if (Object.keys(local).length) return f.setFields(local);
    void f.run(() => register(v.name, v.email, v.password));
  };
  return (
    <div className="auth">
      <Side />
      <div className="auth-form">
        <form onSubmit={submit} noValidate className="stack" aria-label="Create account">
          <div><h1>Create your workspace</h1><p className="muted" style={{ marginTop: 6 }}>Free to set up. Add competitors in a minute.</p></div>
          {f.error && <Alert tone="bad">{f.error}</Alert>}
          <TextField label="Your name" autoComplete="name" value={v.name} onChange={set('name')} error={f.fields.name} required autoFocus />
          <TextField label="Work email" type="email" autoComplete="email" value={v.email} onChange={set('email')} error={f.fields.email} required />
          <TextField label="Password" type="password" autoComplete="new-password" value={v.password} onChange={set('password')} error={f.fields.password} hint="At least 10 characters." required />
          <Button type="submit" variant="primary" loading={f.busy}>Create workspace</Button>
          <p className="small muted">Already have an account? <Link to="/login">Sign in</Link></p>
        </form>
      </div>
    </div>
  );
}
