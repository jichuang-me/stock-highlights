import type { AnalysisProfile, SearchStock, StockHighlightsResponse } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function buildAnalysisHeaders(profile?: AnalysisProfile | null) {
  if (!profile) {
    return {};
  }

  return {
    'X-AI-Profile-Label': profile.label,
    'X-AI-Profile-Kind': profile.kind,
    'X-AI-Profile-Mode': profile.mode,
    'X-AI-Profile-Vendor': profile.vendor,
    'X-AI-Profile-Model': profile.model,
    'X-AI-Profile-Base-Url': profile.baseUrl || '',
    'X-AI-Profile-Api-Key': profile.apiKey || '',
  };
}

async function apiRequest<T>(path: string, signal?: AbortSignal, headers?: HeadersInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json', ...headers },
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json();
}

export function searchStocks(query: string, signal?: AbortSignal) {
  return apiRequest<SearchStock[]>(`/api/stocks/search?q=${encodeURIComponent(query)}`, signal);
}

export function getStockHighlights(
  code: string,
  signal?: AbortSignal,
  refresh = false,
  profile?: AnalysisProfile | null,
) {
  const suffix = refresh ? '?refresh=true' : '';
  return apiRequest<StockHighlightsResponse>(
    `/api/stocks/${encodeURIComponent(code)}/highlights${suffix}`,
    signal,
    buildAnalysisHeaders(profile),
  );
}
