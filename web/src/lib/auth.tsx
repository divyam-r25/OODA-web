import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post } from './api';
import type { User } from './types';

interface AuthState {
  status: 'loading' | 'anon' | 'authed';
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  useEffect(() => {
    get<{ user: User | null }>('/api/auth/me').then((r) => { setUser(r.user); setStatus(r.user ? 'authed' : 'anon'); }).catch(() => setStatus('anon'));
    const lost = () => { setUser(null); setStatus('anon'); };
    window.addEventListener('ooda:unauthorized', lost);
    return () => window.removeEventListener('ooda:unauthorized', lost);
  }, []);
  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ user: User }>('/api/auth/login', { email, password });
    setUser(r.user); setStatus('authed');
  }, []);
  const register = useCallback(async (name: string, email: string, password: string) => {
    const r = await post<{ user: User }>('/api/auth/register', { name, email, password });
    setUser(r.user); setStatus('authed');
  }, []);
  const logout = useCallback(async () => { await post('/api/auth/logout').catch(() => undefined); setUser(null); setStatus('anon'); }, []);
  const value = useMemo(() => ({ status, user, login, register, logout }), [status, user, login, register, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
