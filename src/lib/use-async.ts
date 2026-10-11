import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { message } from './errors';

/** Loads data when the screen gains focus; `reload` fetches again (pull-to-refresh, after actions). */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(undefined);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, deps);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { data, error, loading, reload };
}
