import { useCallback, useEffect, useRef, useState } from "react";
import type { HiggsfieldStatusResponse } from "api";

import { api } from "~/lib/api";

export type CliStatusState =
  | { state: "loading" }
  | { state: "ready"; data: HiggsfieldStatusResponse }
  | { state: "request_failed"; error: string };

export function useCliStatus(pollIntervalMs = 15_000) {
  const [status, setStatus] = useState<CliStatusState>({ state: "loading" });
  const inFlight = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const response = force
        ? await api.status.$get({ query: { refresh: "1" } })
        : await api.status.$get();
      const data = (await response.json()) as HiggsfieldStatusResponse;
      setStatus({ state: "ready", data });
    } catch (error) {
      setStatus({
        state: "request_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, pollIntervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pollIntervalMs, refresh]);

  return { status, refresh };
}
