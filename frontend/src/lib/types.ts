export type SearchStock = {
  code: string;
  name: string;
  industry?: string | null;
  price: number;
  pct: number;
};

export type StockInfo = {
  code: string;
  name: string;
  industry?: string | null;
};

export type StockSummary = {
  riskCount: number;
  positiveCount: number;
  sentiment: 'positive' | 'negative' | 'neutral';
};

export type EvidenceItem = {
  source: string;
  title: string;
  published_at: string;
  url: string;
};

export type HighlightItem = {
  id: string;
  side: 'risk' | 'positive';
  label: string;
  score: number;
  category: string;
  why: string;
  interpretation: string;
  game_view: string;
  evidence: EvidenceItem[];
};

export type NewsItem = {
  title: string;
  time: string;
  url: string;
  source: string;
  tag?: string | null;
};

export type RadarPoint = {
  k: string;
  v: number;
};

export type StockHighlightsResponse = {
  stock: StockInfo;
  summary: StockSummary;
  marketImpression: string;
  price: number;
  pctChange: number;
  highlights: HighlightItem[];
  liveNews: NewsItem[];
  radar: RadarPoint[];
};
