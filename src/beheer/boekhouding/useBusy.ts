import { useCallback, useRef, useState } from "react";

/** Runs one request at a time: `busy` is true while it is on its way, and a second tap meanwhile does nothing. */
export function useBusy(): [busy: boolean, run: (job: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async (job: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await job();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
