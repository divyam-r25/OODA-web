import { type ButtonHTMLAttributes, type ReactNode, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Link } from '../lib/router';
import type { ApiError } from '../lib/api';
import type { FindingKind, RunStatus, Severity } from '../lib/types';
import { Icon } from './Icon';

export function Spinner({ size = 16 }: { size?: number }) {
  return <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" /></svg>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger' | 'default'; size?: 'sm' | 'md'; loading?: boolean; icon?: string };
export function Button({ variant = 'default', size = 'md', loading, icon, children, className = '', disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant === 'primary' && 'btn-primary', variant === 'quiet' && 'btn-quiet', variant === 'danger' && 'btn-danger', size === 'sm' && 'btn-sm', !children && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" {...rest} className={cls} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  );
}
export function LinkButton({ to, variant = 'default', size = 'md', icon, children }: { to: string; variant?: 'primary' | 'quiet' | 'default'; size?: 'sm' | 'md'; icon?: string; children: ReactNode }) {
  const cls = ['btn', variant === 'primary' && 'btn-primary', variant === 'quiet' && 'btn-quiet', size === 'sm' && 'btn-sm'].filter(Boolean).join(' ');
  return <Link to={to} className={cls}>{icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}{children}</Link>;
}

interface FieldShell { label: string; hint?: string; error?: string; required?: boolean; className?: string }
function Shell({ label, hint, error, required, className = '', children, id }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true" className="muted"> *</span>}</label>
      {children}
      {hint && !error && <span className="hint" id={`${id}-h`}>{hint}</span>}
      {error && <span className="err" id={`${id}-e`} role="alert"><Icon name="alert" size={15} />{error}</span>}
    </div>
  );
}
type InputProps = FieldShell & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'>;
export function TextField({ label, hint, error, required, className, ...rest }: InputProps) {
  const id = useId();
  return (
    <Shell id={id} {...{ label, hint, error, required, className }}>
      <input id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} required={required} {...rest} />
    </Shell>
  );
}
type AreaProps = FieldShell & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;
export function TextArea({ label, hint, error, required, className, ...rest }: AreaProps) {
  const id = useId();
  return (
    <Shell id={id} {...{ label, hint, error, required, className }}>
      <textarea id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest} />
    </Shell>
  );
}
type SelProps = FieldShell & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'> & { options: [string, string][] };
export function SelectField({ label, hint, error, required, className, options, ...rest }: SelProps) {
  const id = useId();
  return (
    <Shell id={id} {...{ label, hint, error, required, className }}>
      <select id={id} className="input" aria-invalid={error ? true : undefined} {...rest}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </Shell>
  );
}

export function Tag({ tone, children, title }: { tone?: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode; title?: string }) {
  return <span className={`tag ${tone ?? ''}`} title={title}>{children}</span>;
}
const SEV_N: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
export function SeverityGauge({ level }: { level: Severity }) {
  return (
    <span className={`sev sev-${level}`} title={`Severity: ${level}`}>
      <i aria-hidden="true">{[1, 2, 3, 4].map((n) => <b key={n} className={n <= SEV_N[level] ? 'on' : ''} />)}</i>
      {level[0]!.toUpperCase() + level.slice(1)}
    </span>
  );
}
export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return <span className="conf" title="Confidence as assessed by the analysis model, not a measured probability"><i aria-hidden="true"><b style={{ width: `${pct}%` }} /></i>{pct}%</span>;
}
const KIND_HELP: Record<FindingKind, string> = {
  fact: 'Stated directly in a collected source, with a verified quote',
  interpretation: 'An inference drawn from cited sources',
  hypothesis: 'Plausible but not supported by collected evidence',
};
export function KindBadge({ kind }: { kind: FindingKind }) {
  return <span className={`kind kind-${kind}`} title={KIND_HELP[kind]}>{kind[0]!.toUpperCase() + kind.slice(1)}</span>;
}
export function Cite({ n, active, onClick }: { n: number; active?: boolean; onClick?: () => void }) {
  return <button type="button" className={`cite ${active ? 'on' : ''}`} onClick={onClick} aria-label={`Source ${n}`}>{n}</button>;
}
const RUN_TONE: Record<RunStatus, 'ok' | 'warn' | 'bad' | 'info' | undefined> = { queued: 'info', running: 'info', completed: 'ok', partial: 'warn', failed: 'bad', cancelled: undefined };
const RUN_LABEL: Record<RunStatus, string> = { queued: 'Queued', running: 'Running', completed: 'Completed', partial: 'Partial', failed: 'Failed', cancelled: 'Cancelled' };
export function RunStatusTag({ status }: { status: RunStatus }) {
  const live = status === 'queued' || status === 'running';
  return <Tag tone={RUN_TONE[status]}>{live && <span className="dot pulse" />}{RUN_LABEL[status]}</Tag>;
}

export function PageHead({ title, sub, crumbs, children }: { title: ReactNode; sub?: ReactNode; crumbs?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="grow">{crumbs && <div className="crumbs">{crumbs}</div>}<h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="row wrap no-print">{children}</div>}
    </header>
  );
}
export function Alert({ tone, children, action }: { tone?: 'warn' | 'bad' | 'ok'; children: ReactNode; action?: ReactNode }) {
  return <div className={`alert ${tone ?? ''}`} role={tone === 'bad' ? 'alert' : 'status'}><Icon name={tone === 'ok' ? 'check' : tone ? 'alert' : 'info'} size={18} /><div className="grow">{children}</div>{action}</div>;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function ErrorState({ error, retry }: { error: ApiError; retry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <h3>{error.status === 404 ? 'We could not find that' : 'This did not load'}</h3>
      <p>{error.message}</p>
      {retry && error.status !== 404 && <Button icon="refresh" onClick={retry}>Try again</Button>}
    </div>
  );
}
export function Skeleton({ lines = 4 }: { lines?: number }) {
  return <div aria-busy="true" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <span key={i} className="skel" style={{ width: `${95 - ((i * 17) % 45)}%` }} />)}</div>;
}
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

// ── toasts + confirm ─────────────────────────────────────
interface Toast { id: number; msg: string; bad?: boolean }
interface Confirm { title: string; body: string; confirm: string; danger?: boolean; resolve: (ok: boolean) => void }
const UiCtx = createContext<{ toast: (m: string, bad?: boolean) => void; confirm: (o: Omit<Confirm, 'resolve'>) => Promise<boolean> } | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<Confirm | null>(null);
  const seq = useRef(0);
  const toast = useCallback((msg: string, bad?: boolean) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg, bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 7000 : 4000);
  }, []);
  const confirm = useCallback((o: Omit<Confirm, 'resolve'>) => new Promise<boolean>((resolve) => setDlg({ ...o, resolve })), []);
  const close = (ok: boolean) => { dlg?.resolve(ok); setDlg(null); };
  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`} role={t.bad ? 'alert' : 'status'}>{t.msg}</div>)}</div>
      {dlg && <ConfirmDialog d={dlg} close={close} />}
    </UiCtx.Provider>
  );
}
function ConfirmDialog({ d, close }: { d: Confirm; close: (ok: boolean) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const on = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="dialog-back" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-b">
        <h2 id="dlg-t">{d.title}</h2><p id="dlg-b" className="muted" style={{ margin: 0 }}>{d.body}</p>
        <div className="row"><Button onClick={() => close(false)}>Cancel</Button><button ref={ref} type="button" className={`btn ${d.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{d.confirm}</button></div>
      </div>
    </div>
  );
}
export function useUi() {
  const c = useContext(UiCtx);
  if (!c) throw new Error('UiProvider missing');
  return c;
}
