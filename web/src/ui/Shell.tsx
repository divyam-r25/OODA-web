import { type ReactNode, useEffect, useState } from 'react';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NavLink, useRouter } from '../lib/router';
import { Icon, Mark } from './Icon';
import { Button } from './ui';

const GROUPS: { verb: string; items: { to: string; label: string; icon: string; badge?: boolean }[] }[] = [
  { verb: 'Observe', items: [{ to: '/app/signals', label: 'Signals', icon: 'signals', badge: true }, { to: '/app/research', label: 'Research', icon: 'research' }] },
  { verb: 'Orient', items: [{ to: '/app/competitors', label: 'Competitors', icon: 'competitors' }, { to: '/app/compare', label: 'Compare', icon: 'compare' }] },
  { verb: 'Decide', items: [{ to: '/app/reports', label: 'Reports', icon: 'reports' }] },
  { verb: 'Act', items: [{ to: '/app/actions', label: 'Actions', icon: 'actions' }] },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { path, navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [newSignals, setNewSignals] = useState(0);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    get<{ total: number }>('/api/signals?status=new&limit=1').then((r) => setNewSignals(r.total)).catch(() => undefined);
  }, [path]);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open]);

  return (
    <div className="shell">
      <a href="#main" className="skip">Skip to content</a>
      <div className="compactbar">
        <Button variant="quiet" icon="menu" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)} />
        <b>OODA</b>
      </div>
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary">
        <NavLink to="/app" className="brand" aria-label="OODA briefing"><Mark /><span><b>OODA</b><small>Competitive intelligence</small></span></NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/app"><Icon name="briefing" />Briefing</NavLink>
          {GROUPS.map((g, i) => (
            <div key={g.verb} role="group" aria-label={g.verb}>
              <div className="nav-group" aria-hidden="true"><span>{g.verb}</span>{i + 1} of 4</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} prefix>
                  <Icon name={it.icon} />{it.label}
                  {it.badge && newSignals > 0 && <span className="count" aria-label={`${newSignals} new`}>{newSignals > 99 ? '99+' : newSignals}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <nav className="nav" aria-label="Account"><NavLink to="/app/settings"><Icon name="settings" />Settings</NavLink></nav>
          <div className="userbox">
            <span className="avatar" aria-hidden="true">{(user?.name ?? '?').slice(0, 1).toUpperCase()}</span>
            <span className="who grow truncate"><b className="truncate">{user?.name}</b><span className="truncate">{user?.email}</span></span>
          </div>
          <Button variant="quiet" size="sm" icon="logout" onClick={async () => { await logout(); navigate('/'); }}>Sign out</Button>
        </div>
      </aside>
      {open && <div onClick={() => setOpen(false)} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 35 }} />}
      <main className="main" id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
