import { useCallback, useEffect, useRef, useState } from 'react';

import { getStockHighlights } from '../lib/api';
import type { AnalysisProfile, StockHighlightsResponse } from '../lib/types';

type HighlightsState = {
  data: StockHighlightsResponse | null;
  loading: boolean;
  error: string;
};

function profileSignature(profile?: AnalysisProfile | null) {
  if (!profile) {
    return '';
  }

  return [
    profile.id,
    profile.mode,
    profile.kind,
    profile.vendor,
    profile.model,
    profile.baseUrl || '',
    profile.apiKey || '',
  ].join('|');
}

export function useStockHighlights(code: string, profile?: AnalysisProfile | null) {
  const [state, setState] = useState<HighlightsState>({
    data: null,
    loading: false,
    error: '',
  });
  const pollTimerRef = useRef<number | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const currentProfileKey = profileSignature(profile);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const load = useCallback(
    async (options?: { isInitial?: boolean; refresh?: boolean }) => {
      if (!code) {
        return;
      }

      const { isInitial = false, refresh = false } = options ?? {};
      activeControllerRef.current?.abort();
      const controller = new AbortController();
      activeControllerRef.current = controller;

      if (isInitial || refresh) {
        setState((current) => ({ ...current, loading: true, error: '' }));
      }

      try {
        const data = await getStockHighlights(code, controller.signal, refresh, profile);
        if (controller.signal.aborted) {
          return;
        }

        setState({ data, loading: false, error: '' });
        clearPoll();

        if (data.analysisPending) {
          pollTimerRef.current = window.setTimeout(() => {
            void load();
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
    },
    [clearPoll, code, currentProfileKey, profile],
  );

  useEffect(() => {
    if (!code) {
      setState({ data: null, loading: false, error: '' });
      clearPoll();
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      return;
    }

    void load({ isInitial: true });

    return () => {
      activeControllerRef.current?.abort();
      clearPoll();
    };
  }, [clearPoll, code, currentProfileKey, load]);

  const refreshAnalysis = useCallback(async () => {
    clearPoll();
    await load({ refresh: true });
  }, [clearPoll, load]);

  return { ...state, refreshAnalysis };
}
