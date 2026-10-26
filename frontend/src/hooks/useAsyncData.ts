import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../lib/format';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: T | null | ((current: T | null) => T | null)) => void;
}

/**
 * Small data-loading helper with an explicit dependency list. Requests are
 * guarded against setting state after unmount and expose a stable reload()
 * function for post-mutation refreshes.
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (active) setDataState(result);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // The caller controls re-fetching through the deps array and reload().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  const setData = useCallback((updater: T | null | ((current: T | null) => T | null)) => {
    setDataState((current) => (typeof updater === 'function' ? (updater as (c: T | null) => T | null)(current) : updater));
  }, []);

  return { data, loading, error, reload, setData };
}

/** Debounced value helper used by search inputs. */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
