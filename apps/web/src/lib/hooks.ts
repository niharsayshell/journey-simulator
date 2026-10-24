"use client";
import { useEffect, useRef } from "react";
import useSWR, { type SWRConfiguration } from "swr";
import { fetcher } from "./api";

export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: true, ...config });
}

/**
 * Subscribe to the project's Server-Sent Events stream and call `onEvent`
 * for every platform event. Reconnects automatically (EventSource retry).
 */
export function useProjectEvents(projectId: string | undefined, onEvent: (type: string, data: Record<string, unknown>) => void, batchId?: string) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!projectId) return;
    const qs = new URLSearchParams({ projectId, ...(batchId ? { batchId } : {}) });
    const es = new EventSource(`/api/v1/events/stream?${qs}`);
    const types = ["batch.updated", "run.updated", "step.completed"];
    const listener = (e: MessageEvent) => {
      try {
        handler.current(e.type, JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    types.forEach((t) => es.addEventListener(t, listener as EventListener));
    return () => es.close();
  }, [projectId, batchId]);
}
