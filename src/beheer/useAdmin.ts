import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { adminApi, type ApiInit, type ApiResult } from "../lib/api";

export type AdminData<T> = { data: T | null; error: string | null; loading: boolean; reload(): void };

type State<T> = { path: string | null; data: T | null; error: string | null; loading: boolean };

/** What to say when something from the server does not come. */
export function loadProblem(status: number): string {
  return status === 0 ? "Geen verbinding. Probeer het opnieuw." : "Er ging iets mis. Probeer het opnieuw.";
}

/** Goes to another page. Unlike the router's own function it stays the same one, so an effect that uses it does not run again on every page change. */
export function useGo(): (to: string) => void {
  const navigate = useNavigate();
  const latest = useRef(navigate);
  useEffect(() => {
    latest.current = navigate;
  });
  return useCallback((to: string) => void latest.current(to, { replace: true }), []);
}

/**
 * Fetches a beheer resource and keeps it. `null` fetches nothing. Another path starts empty; `reload` keeps
 * what is on screen until the new answer is there. A 401 means the session has ended: back to login.
 */
export function useAdminData<T>(path: string | null): AdminData<T> {
  const go = useGo();
  const [state, setState] = useState<State<T>>({ path, data: null, error: null, loading: path !== null });
  const [round, setRound] = useState(0);

  // What is on screen belongs to the path it was fetched for.
  if (state.path !== path) setState({ path, data: null, error: null, loading: path !== null });

  useEffect(() => {
    if (path === null) return;
    let left = false;
    void adminApi<T>(path).then((answer) => {
      if (left) return;
      if (answer.ok) return setState({ path, data: answer.data, error: null, loading: false });
      if (answer.status === 401) return go("/beheer/login");
      setState((before) => ({ ...before, error: loadProblem(answer.status), loading: false }));
    });
    return () => {
      left = true;
    };
  }, [path, round, go]);

  const reload = useCallback(() => {
    setState((before) => ({ ...before, loading: true }));
    setRound((n) => n + 1);
  }, []);

  return { data: state.data, error: state.error, loading: state.loading, reload };
}

/** A change sent to the server. The caller explains a refusal; a 401 also leads back to login. */
export function useAdminWrite(): <T>(path: string, method: string, json?: unknown, more?: Pick<ApiInit, "raw" | "timeoutMs">) => Promise<ApiResult<T>> {
  const go = useGo();
  return useCallback(
    async <T,>(path: string, method: string, json?: unknown, more?: Pick<ApiInit, "raw" | "timeoutMs">) => {
      const answer = await adminApi<T>(path, { method, json, ...more });
      if (!answer.ok && answer.status === 401) go("/beheer/login");
      return answer;
    },
    [go],
  );
}
