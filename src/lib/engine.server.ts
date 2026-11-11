/**
 * The one place every call to the video Engine goes through. Adds the Bearer
 * key, waits out a sleeping Engine and maps failures to { code, message }.
 * Server-only: the key never reaches the browser.
 */
export type EngineError = { code: string; message: string };
export type EngineResult<T = unknown> = { ok: true; data: T } | { ok: false; error: EngineError };
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Options = { fetchImpl?: typeof fetch; timeoutMs?: number; wake?: boolean };

export function engineConfigured(): boolean {
  return Boolean(process.env["ENGINE_URL"] && process.env["ENGINE_API_KEY"]);
}

export async function engineClient<T = unknown>(method: Method, path: string, body?: unknown, opts: Options = {}): Promise<EngineResult<T>> {
  const key = process.env["ENGINE_API_KEY"];
  const base = process.env["ENGINE_URL"]?.replace(/\/+$/, "");
  if (!base || !key) return { ok: false, error: { code: "ENGINE_NOT_CONFIGURED", message: "Video clipping isn't switched on yet." } };
  const f = opts.fetchImpl ?? fetch;
  const send = () => f(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  try {
    let res = opts.wake === false ? await send() : await sendWaking(send);
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get("Retry-After")) || 1, 30);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await send();
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    const env = json as { success?: boolean; error?: { code?: string; message?: string } } | null;
    if (!res.ok || env?.success === false) {
      return { ok: false, error: { code: env?.error?.code ?? `HTTP_${res.status}`, message: env?.error?.message ?? (text.slice(0, 300) || res.statusText) } };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: { code: "ENGINE_UNREACHABLE", message: e instanceof Error ? e.message : "Engine unreachable" } };
  }
}

/**
 * The Engine sleeps when idle and its host restarts it on the next request,
 * which can mean a refused connection or a 502 while it boots. That is a cold
 * start, not a failure, so wait and ask again.
 */
const WAKE_WAITS_MS = [2000, 4000, 8000];
const COLD_START = new Set([502, 503, 504]);

async function sendWaking(send: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await send();
      if (!COLD_START.has(res.status) || attempt >= WAKE_WAITS_MS.length) return res;
    } catch (e) {
      if (attempt >= WAKE_WAITS_MS.length) throw e;
    }
    await new Promise((r) => setTimeout(r, WAKE_WAITS_MS[attempt]));
  }
}
