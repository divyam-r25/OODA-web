import { type AnchorHTMLAttributes, type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface RouterState {
  path: string;
  search: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}
const Ctx = createContext<RouterState | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState({ path: window.location.pathname, search: window.location.search });
  useEffect(() => {
    const on = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    const url = new URL(to, window.location.origin);
    const same = url.pathname === window.location.pathname;
    if (opts.replace) window.history.replaceState(null, '', url.pathname + url.search);
    else window.history.pushState(null, '', url.pathname + url.search);
    setLoc({ path: url.pathname, search: url.search });
    if (!opts.replace && !same) window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, []);
  const value = useMemo(() => ({ ...loc, navigate }), [loc, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterState {
  const c = useContext(Ctx);
  if (!c) throw new Error('RouterProvider missing');
  return c;
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_m, k: string) => (keys.push(k), '/([^/]+)')) + '/?$');
  const m = re.exec(path);
  if (!m) return null;
  const out: Record<string, string> = {};
  keys.forEach((k, i) => (out[k] = decodeURIComponent(m[i + 1] ?? '')));
  return out;
}

export function useQuery(): [URLSearchParams, (patch: Record<string, string | null>) => void] {
  const { path, search, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
      const qs = next.toString();
      navigate(path + (qs ? `?${qs}` : ''), { replace: true });
    },
    [navigate, path],
  );
  return [params, set];
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string; exact?: boolean };
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function NavLink({ to, prefix, ...rest }: LinkProps & { prefix?: boolean }) {
  const { path } = useRouter();
  const active = prefix ? path === to || path.startsWith(to + '/') : path === to;
  return <Link to={to} aria-current={active ? 'page' : undefined} {...rest} />;
}
