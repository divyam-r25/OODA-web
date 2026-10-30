export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 204) {
    await res.arrayBuffer().catch(() => undefined); // drain the empty body so the browser does not cancel the stream
    return undefined as T;
  }
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON */
  }
  if (!res.ok) {
    const err = json?.error;
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('ooda:unauthorized'));
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status}).`, err?.details?.fields ?? {});
  }
  return json as T;
}
export const get = <T,>(p: string, s?: AbortSignal) => api<T>('GET', p, undefined, s);
export const post = <T,>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const patch = <T,>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const put = <T,>(p: string, b: unknown) => api<T>('PUT', p, b);
export const del = <T,>(p: string) => api<T>('DELETE', p);
