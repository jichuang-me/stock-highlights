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
  thesis: string;
  importance: string;
  interpretation: string;
  game_view: string;
  evidenceChain: string[];
  evidence: EvidenceItem[];
};

export type NewsItem = {
  title: string;
  time: string;
  url: string;
  source: string;
  tag?: string | null;
};

export type BoardLinkedStock = {
  code: string;
  name: string;
  pct?: number | null;
  role: string;
  reason: string;
};

export type BoardContext = {
  industry: string;
  boardName?: string | null;
  boardPct?: number | null;
  boardRank?: number | null;
  upCount?: number | null;
  downCount?: number | null;
  netInflow?: number | null;
  leader?: string | null;
  leaderPct?: number | null;
  role: string;
  roleReason?: string | null;
  summary: string;
  linkedStocks: BoardLinkedStock[];
};

export type ValuationSnapshot = {
  pe: string;
  pb: string;
  roe: string;
};

export type AnalystConsensus = {
  stance: '看好' | '中性' | '看空';
  rationale: string;
};

export type ShortTermOutlook = {
  catalysts: string[];
  earningsExpectation: string;
};

export type ValuationOutlook = {
  currentLevel: string;
  targetRange: string;
  upsideDrivers: string[];
  downsideRisks: string[];
};

export type FutureOutlook = {
  analystConsensus: AnalystConsensus;
  shortTermOutlook: ShortTermOutlook;
  valuationOutlook: ValuationOutlook;
};

export type RadarPoint = {
  k: string;
  v: number;
};

export type StockHighlightsResponse = {
  stock: StockInfo;
  summary: StockSummary;
  headline?: string | null;
  marketImpression: string;
  analysisMode: 'ai' | 'rules';
  analysisPending: boolean;
  analysisModel?: string | null;
  analysisUpdatedAt?: string | null;
  analysisProfileLabel?: string | null;
  aiTopPositiveLabel?: string | null;
  aiTopRiskLabel?: string | null;
  aiTurningPoint?: string | null;
  price: number;
  pctChange: number;
  valuationSnapshot: ValuationSnapshot;
  futureOutlook: FutureOutlook;
  highlights: HighlightItem[];
  liveNews: NewsItem[];
  boardContext?: BoardContext | null;
  radar: RadarPoint[];
};

export type AnalysisProfileMode = 'server' | 'custom';

export type AnalysisProfileKind = 'free' | 'api' | 'local';

export type AnalysisProfile = {
  id: string;
  label: string;
  kind: AnalysisProfileKind;
  mode: AnalysisProfileMode;
  vendor: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  note?: string;
};
