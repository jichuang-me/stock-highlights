import type { SearchStock, StockHighlightsResponse } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

async function apiRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
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

export function getStockHighlights(code: string, signal?: AbortSignal) {
  return apiRequest<StockHighlightsResponse>(`/api/stocks/${encodeURIComponent(code)}/highlights`, signal);
}
