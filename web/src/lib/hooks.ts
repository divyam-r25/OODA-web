import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export interface Async<T> { data: T | null; error: ApiError | null; loading: boolean; reload: () => void; setData: (d: T | null) => void }

/** Fetches on mount and when deps change. Keeps previous data visible while reloading. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    fnRef.current(ctl.signal)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => { if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'error', 'Something went wrong.')); })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

export function useTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · OODA` : 'OODA: competitive intelligence'; }, [title]);
}
