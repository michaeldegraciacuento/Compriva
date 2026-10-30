"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, toApiError } from "@/lib/api";

export interface ApiQuery<T> {
  data: T | undefined;
  error: ApiError | null;
  /** True only while there is nothing to show yet (first load). */
  loading: boolean;
  /** True during any request, including background reloads. */
  fetching: boolean;
  reload: () => Promise<void>;
}

/**
 * Minimal data loader for client components. Re-runs when `key` changes,
 * keeps the previous data on screen while reloading (no skeleton flash) and
 * ignores responses that arrive after a newer request started.
 */
export function useApiQuery<T>(key: readonly unknown[], fetcher: () => Promise<T>): ApiQuery<T> {
  const serializedKey = JSON.stringify(key);
  // `key` records which request the state answers; while it differs from the current key, a load is in flight.
  const [state, setState] = useState<{ key: string | null; data?: T; error: ApiError | null }>({ key: null, error: null });
  const [reloading, setReloading] = useState(false);
  const fetcherRef = useRef(fetcher);
  const requestId = useRef(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(async (forKey: string) => {
    const id = ++requestId.current;
    try {
      const result = await fetcherRef.current();
      if (id === requestId.current) setState({ key: forKey, data: result, error: null });
    } catch (caught) {
      if (id === requestId.current) setState((current) => ({ key: forKey, data: current.data, error: toApiError(caught) }));
    }
  }, []);

  useEffect(() => {
    void load(serializedKey);
  }, [serializedKey, load]);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      await load(serializedKey);
    } finally {
      setReloading(false);
    }
  }, [load, serializedKey]);

  const fetching = reloading || state.key !== serializedKey;
  return { data: state.data, error: state.error, loading: fetching && state.data === undefined, fetching, reload };
}
