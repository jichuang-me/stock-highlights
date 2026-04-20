import { useEffect, useState } from 'react';

import { searchStocks } from '../lib/api';
import type { SearchStock } from '../lib/types';

export function useStockSearch(query: string) {
  const [results, setResults] = useState<SearchStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setResults([]);
      setError('');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const data = await searchStocks(normalized, controller.signal);
        setResults(data || []);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        setResults([]);
        setError(err instanceof Error ? err.message : '搜索失败');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  return { results, loading, error };
}
