import { useEffect, useState } from 'react';

import { getStockHighlights } from '../lib/api';
import type { StockHighlightsResponse } from '../lib/types';

type HighlightsState = {
  data: StockHighlightsResponse | null;
  loading: boolean;
  error: string;
};

export function useStockHighlights(code: string) {
  const [state, setState] = useState<HighlightsState>({
    data: null,
    loading: false,
    error: '',
  });

  useEffect(() => {
    if (!code) {
      setState({ data: null, loading: false, error: '' });
      return;
    }

    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: '' }));

    getStockHighlights(code, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: '' });
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : '加载失败',
        });
      });

    return () => controller.abort();
  }, [code]);

  return state;
}
