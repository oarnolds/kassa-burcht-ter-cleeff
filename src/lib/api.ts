// One way to talk to the Worker. A call never throws: it answers with the data or with a reason.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type ApiInit = { method?: string; json?: unknown };

// A request that hangs on bad wifi counts as offline after this long.
const TIMEOUT_MS = 15_000;

async function request<T>(path: string, init: ApiInit, headers: Record<string, string>): Promise<ApiResult<T>> {
  const method = init.method ?? "GET";
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      credentials: "same-origin",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, error: "offline" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as { error?: unknown } | null)?.error;
    return { ok: false, status: response.status, error: typeof code === "string" ? code : "server" };
  }
  return { ok: true, data: body as T };
}

/** Beheer: the session cookie travels along; writes carry the header the server asks for. */
export function adminApi<T>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  const write = (init.method ?? "GET") !== "GET";
  return request<T>(path, init, write ? { "X-Requested-With": "kassa" } : {});
}

/** Kassa: the paired iPad identifies itself with its token. */
export function kassaApi<T>(path: string, token: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  return request<T>(path, init, { Authorization: `Bearer ${token}` });
}
