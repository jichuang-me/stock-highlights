import { useEffect, useRef, useState } from 'react';

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
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!code) {
      setState({ data: null, loading: false, error: '' });
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
      }
      return;
    }

    const controller = new AbortController();

    const clearPoll = () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const load = async (isInitial: boolean) => {
      if (isInitial) {
        setState((current) => ({ ...current, loading: true, error: '' }));
      }

      try {
        const data = await getStockHighlights(code, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setState({ data, loading: false, error: '' });
        clearPoll();

        if (data.analysisPending) {
          pollTimerRef.current = window.setTimeout(() => {
            void load(false);
          }, 4000);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        clearPoll();
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : '加载失败',
        });
      }
    };

    void load(true);

    return () => {
      controller.abort();
      clearPoll();
    };
  }, [code]);

  return state;
}
