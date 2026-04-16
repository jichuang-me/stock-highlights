import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  History,
  BarChart3,
  FileText,
  Clock3,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Filter,
  Activity,
  RefreshCw,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from './components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './components/ui/accordion';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';

const API_BASE_URL = (import.meta as any)?.env?.VITE_API_BASE_URL || 
  (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8001'
    : window.location.origin); // 动态识别：如果是 HF 全栈部署，则请求同源 API

type SearchStock = {
  code: string;
  name: string;
  industry?: string;
  price?: number;
  pct?: number;
};

type Summary = {
  riskCount: number;
  positiveCount: number;
  confidence: number;
  totalRiskScore: number;
  totalPositiveScore: number;
};

type Outlook = {
  consensus: string;
  shortTerm: string;
  valuation: string;
};

type EvidenceItem = {
  source: string;
  title: string;
  time: string;
  weight: string;
  excerpt: string;
  url?: string;
};

type HistoryItem = {
  date: string;
  action: string;
  desc: string;
  delta: string;
  label?: string;
  side?: 'risk' | 'positive';
  highlightId?: string;
};

type HighlightItem = {
  id: string;
  side: 'risk' | 'positive';
  label: string;
  stars: number;
  score: number;
  category: string;
  why: string;
  interpretation: string;
  factors: string[];
  evidence: EvidenceItem[];
  history: HistoryItem[];
  priority?: number;
  freshness?: string;
};

type StockResponse = {
  stock: {
    code: string;
    name: string;
    industry?: string;
  };
  summary: Summary;
  marketImpression: string;
  headline: string;
  outlook: Outlook;
  highlights: HighlightItem[];
  radar?: Array<{ k: string; v: number }>;
  xueqiu?: {
    popularity: number;
    sentiment: string;
    opinion: string;
    analysis: string;
    timestamp: string;
  };
};

type SnapshotPoint = {
  snapshotDate: string;
  riskScore: number;
  positiveScore: number;
  headline?: string;
};

type StockViewModel = {
  code: string;
  name: string;
  industry: string;
  marketImpression: string;
  headline: string;
  summary: Summary;
  outlook: Outlook;
  highlights: HighlightItem[];
  radar: Array<{ k: string; v: number }>;
  trend: Array<{ date: string; risk: number; positive: number }>;
  xueqiu?: {
    popularity: number;
    sentiment: string;
    opinion: string;
    analysis: string;
  };
};

async function apiRequest<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

const stockHighlightsApi = {
  searchStocks(q: string) {
    return apiRequest<SearchStock[]>(`/api/stocks/search?q=${encodeURIComponent(q)}`);
  },
  getStockHighlights(code: string) {
    return apiRequest<StockResponse>(`/api/stocks/${encodeURIComponent(code)}/highlights`);
  },
  getStockSnapshots(code: string) {
    return apiRequest<SnapshotPoint[]>(`/api/stocks/${encodeURIComponent(code)}/snapshots`);
  },
  getStockHistory(code: string) {
    return apiRequest<HistoryItem[]>(`/api/stocks/${encodeURIComponent(code)}/history`);
  },
};

const sideStyle = {
  risk: {
    badge: 'bg-red-50 text-red-700 border-red-200',
    chip: 'bg-red-50 text-red-700',
    icon: AlertTriangle,
    label: '风险',
  },
  positive: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    chip: 'bg-emerald-50 text-emerald-700',
    icon: Sparkles,
    label: '亮点',
  },
} as const;

function scoreToStars(n: number) {
  return '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, 5 - n));
}

function cnDelta(text?: string) {
  if (!text) return '暂无';
  return text.startsWith('+') ? `上升 ${text}` : text;
}

function getLatestHistoryBadge(item?: { history?: HistoryItem[] }) {
  const latest = item?.history?.[item.history.length - 1]?.action || item?.history?.[0]?.action || '';
  const map: Record<string, { label: string; className: string }> = {
    新增: { label: '新增', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    升级: { label: '升级', className: 'bg-red-50 text-red-700 border-red-200' },
    强化: { label: '强化', className: 'bg-orange-50 text-orange-700 border-orange-200' },
    维持高位: { label: '高位', className: 'bg-rose-50 text-rose-700 border-rose-200' },
    缓和: { label: '缓和', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    已解除: { label: '已解除', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  };
  return map[latest] || null;
}

function buildWhyTree(item?: HighlightItem | null) {
  if (!item) return [];
  const latestAction = item.history?.[item.history.length - 1]?.action || item.history?.[0]?.action || '新增';
  const firstEvidence = item.evidence?.[0]?.title || '公开披露信息';
  const firstFactor = item.factors?.[0] || '关键影响因素';
  return [
    `触发事件：${firstEvidence}`,
    `识别信号：${firstFactor}`,
    `状态变化：${latestAction}`,
    `系统判断：${item.label}`,
    `影响结论：${item.interpretation}`,
  ];
}

function getSourceClass(source?: string) {
  if (source === '公司公告') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (source === '年度报告' || source === '财报数据' || source === '财务指标') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (source === '法院/监管') return 'bg-red-50 text-red-700 border-red-200';
  if (source === '行业观察' || source === '业务动态') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (source === '市场观察') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-violet-50 text-violet-700 border-violet-200';
}

function sortEvidence(evidence: EvidenceItem[] = []) {
  const sourceRank: Record<string, number> = {
    公司公告: 5,
    年度报告: 4,
    财报数据: 4,
    财务指标: 4,
    '法院/监管': 3,
    行业观察: 2,
    业务动态: 2,
    市场观察: 1,
    综合判断: 1,
  };
  const weightRank: Record<string, number> = { 高: 3, 中: 2, 低: 1 };
  return [...evidence].sort((a, b) => {
    const sourceDiff = (sourceRank[b.source] || 0) - (sourceRank[a.source] || 0);
    if (sourceDiff !== 0) return sourceDiff;
    return (weightRank[b.weight] || 0) - (weightRank[a.weight] || 0);
  });
}

function getDefaultRadarFromSummary(summary?: Summary) {
  if (!summary) return [];
  return [
    { k: '风险强度', v: summary.totalRiskScore || 0 },
    { k: '亮点强度', v: summary.totalPositiveScore || 0 },
    { k: '风险数量', v: Math.min((summary.riskCount || 0) * 18, 100) },
    { k: '亮点数量', v: Math.min((summary.positiveCount || 0) * 18, 100) },
    { k: '可信度', v: summary.confidence || 0 },
  ];
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-2xl bg-slate-100 p-2">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function HighlightCard({ item, onOpen }: { item: HighlightItem; onOpen: (item: HighlightItem) => void }) {
  const style = sideStyle[item.side];
  const Icon = style.icon;
  const statusBadge = getLatestHistoryBadge(item);
  const latestAction = item.history?.[item.history.length - 1]?.action || item.history?.[0]?.action || '';
  const isResolved = ['已解除', '缓和'].includes(latestAction);
  const priorityLabel =
    item.side === 'risk'
      ? item.priority && item.priority >= 5
        ? '核心风险'
        : item.priority && item.priority >= 4
        ? '重点风险'
        : '一般风险'
      : item.priority && item.priority >= 5
      ? '已强化亮点'
      : item.priority && item.priority >= 4
      ? '潜力亮点'
      : '一般亮点';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-3xl border p-4 transition hover:border-slate-300 hover:shadow-sm md:p-5 ${isResolved ? 'bg-slate-50 opacity-60' : ''}`}
    >
      <div className="mb-3 flex items-center justify-end">
        <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => onOpen(item)}>
          查看详情
        </Button>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`rounded-full ${style.badge}`}>
              {style.label}
            </Badge>
            <span className="text-xs text-slate-400">更新 {item.history?.[0]?.date || '未知'}</span>
            <Badge variant="secondary" className="rounded-full">
              {item.category}
            </Badge>
            <Badge variant="outline" className={`rounded-full ${item.side === 'risk' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {priorityLabel}
            </Badge>
            {statusBadge && (
              <Badge variant="outline" className={`rounded-full ${statusBadge.className}`}>
                {statusBadge.label}
              </Badge>
            )}
            <Badge variant="outline" className="rounded-full">
              影响度 {scoreToStars(item.stars)}
            </Badge>
          </div>
          <div className="mt-3 flex items-start gap-3">
            <div className={`mt-0.5 rounded-2xl p-2 ${style.chip}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-semibold tracking-tight">{item.label}</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.why}</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function HighlightDialog({ item, onClose }: { item: HighlightItem | null; onClose: () => void }) {
  const sortedEvidence = useMemo(() => sortEvidence(item?.evidence || []), [item]);

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl sm:max-w-3xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
                <span>{item.label}</span>
                <Badge variant="outline" className={`rounded-full ${sideStyle[item.side].badge}`}>
                  {sideStyle[item.side].label}
                </Badge>
                {getLatestHistoryBadge(item) && (
                  <Badge variant="outline" className={`rounded-full ${getLatestHistoryBadge(item)?.className}`}>
                    {getLatestHistoryBadge(item)?.label}
                  </Badge>
                )}
                <Badge variant="secondary" className="rounded-full">
                  {item.category}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-slate-600">
                影响度 {scoreToStars(item.stars)} · 影响分 {item.score}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <div className="rounded-2xl bg-blue-50 p-4">
                <div className="text-sm font-semibold text-blue-800">投资视角结论</div>
                <div className="mt-2 space-y-2 text-sm text-blue-900">
                  <div>• 短期判断：{item.side === 'risk' ? '该风险仍处于作用期，需谨慎应对。' : '该亮点仍在验证阶段，适合跟踪观察。'}</div>
                  <div>• 中期影响：{item.side === 'risk' ? '若未缓解，可能持续压制估值与预期。' : '若兑现，将对估值形成支撑。'}</div>
                  <div>• 关键观察点：</div>
                  <ul className="ml-4 list-disc">
                    {(item.factors || []).slice(0, 3).map((f, i) => (
                      <li key={`${f}-${i}`}>{f}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-sm font-semibold">核心判断</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.why}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.interpretation}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(item.factors || []).map((factor) => (
                    <Badge key={factor} variant="secondary" className="rounded-full">
                      {factor}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold">原因链（WHY TREE）</div>
                <div className="space-y-3">
                  {buildWhyTree(item).map((node, idx) => (
                    <div key={`${node}-${idx}`} className="flex items-start gap-3">
                      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-slate-400" />
                      <div className="flex-1 rounded-2xl bg-white p-3 text-sm leading-6 text-slate-700">{node}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-sm font-semibold">证据摘要</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  当前最强证据主要来自
                  <span className="mx-1 font-medium text-slate-900">{sortedEvidence[0]?.source || '公开信息'}</span>
                  ，核心依据为
                  <span className="mx-1 font-medium text-slate-900">{sortedEvidence[0]?.title || '暂无标题'}</span>
                  。这类来源通常对看点判断影响更大，建议优先阅读。
                </p>
              </div>

              <div>
                <div className="mb-3 text-sm font-semibold">证据链（已按来源与权重排序）</div>
                <div className="space-y-3">
                  {sortedEvidence.map((ev, idx) => (
                    <div key={`${ev.title}-${idx}`} className="rounded-2xl border bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {idx === 0 && (
                          <Badge variant="outline" className="rounded-full bg-violet-50 text-violet-700 border-violet-200">
                            核心证据
                          </Badge>
                        )}
                        <Badge variant="outline" className={`rounded-full ${getSourceClass(ev.source)}`}>
                          {ev.source}
                        </Badge>
                        <Badge variant="secondary" className="rounded-full">权重 {ev.weight}</Badge>
                        <span className="text-xs text-slate-500">{ev.time}</span>
                        {ev.url && (
                          <a className="inline-flex items-center gap-1 text-xs text-slate-500 underline" href={ev.url} target="_blank" rel="noreferrer">
                            原文 <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <div className="mt-2 text-sm font-semibold">{ev.title}</div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{ev.excerpt}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 text-sm font-semibold">完整历史时间线</div>
                <div className="space-y-3">
                  {(item.history || []).map((h, idx) => (
                    <div key={`${h.date}-${idx}`} className="flex items-start gap-3 rounded-2xl border p-4">
                      <div className="rounded-2xl bg-slate-100 p-2">
                        <History className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold">{h.action}</div>
                          <Badge variant="secondary" className="rounded-full">{h.date}</Badge>
                          <Badge variant="outline" className="rounded-full">{cnDelta(h.delta)}</Badge>
                        </div>
                        <div className="mt-1 text-sm text-slate-600">{h.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function StockHighlightsPrototype() {
  // 核心状态：聚合为单一事实来源
  const [stockState, setStockState] = useState<{
    data: StockViewModel | null;
    history: HistoryItem[];
    loading: boolean;
    error: string;
  }>({ data: null, history: [], loading: false, error: '' });

  const [selectedCode, setSelectedCode] = useState(() => localStorage.getItem('last_stock_code') || '');
  const [recentStocks, setRecentStocks] = useState<SearchStock[]>(() => {
    try { return JSON.parse(localStorage.getItem('recent_stocks') || '[]'); } catch { return []; }
  });
  
  const [sideFilter, setSideFilter] = useState('all');
  const [sortMode, setSortMode] = useState('score');
  const [activeHighlight, setActiveHighlight] = useState<HighlightItem | null>(null);
  
  // 搜索相关项
  const [searchResults, setSearchResults] = useState<SearchStock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isQuickSearching, setIsQuickSearching] = useState(false);
  const [quickSearchInput, setQuickSearchInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compareWindow, setCompareWindow] = useState('1m');

  // 全局键盘监听：灵动小键盘逻辑
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果已经打开了 Dialog，或者正在输入框中，不触发
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || activeHighlight) {
        return;
      }

      // 如果按下的是字母、数字
      if (/^[a-z0-9]$/i.test(e.key)) {
        setIsQuickSearching(true);
        setQuickSearchInput(e.key);
        setSelectedIndex(0);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeHighlight]);

  useEffect(() => {
    if (!isQuickSearching) {
      setQuickSearchInput('');
      return;
    }

    let ignore = false;
    async function loadQuickResults() {
      const keyword = quickSearchInput.trim();
      if (!keyword) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const results = await stockHighlightsApi.searchStocks(keyword);
        if (!ignore) {
          setSearchResults(results || []);
          setSelectedIndex(0);
        }
      } catch {
        if (!ignore) setSearchResults([]);
      } finally {
        if (!ignore) setIsSearching(false);
      }
    }

    const timer = setTimeout(loadQuickResults, 150);
    return () => {
      clearTimeout(timer);
      ignore = true;
    };
  }, [quickSearchInput, isQuickSearching]);


  useEffect(() => {
    if (!selectedCode) {
      setStockState({ data: null, history: [], loading: false, error: '' });
      return;
    }
    
    let ignore = false;
    async function fetchAll() {
      setStockState(s => ({ ...s, loading: true, error: '' }));
      try {
        const [highlightsRes, snapshots, history] = await Promise.all([
          stockHighlightsApi.getStockHighlights(selectedCode),
          stockHighlightsApi.getStockSnapshots(selectedCode),
          stockHighlightsApi.getStockHistory(selectedCode),
        ]);
        
        if (ignore) return;
        
        setStockState({
          loading: false,
          error: '',
          history: history || [],
          data: {
            code: highlightsRes.stock.code,
            name: highlightsRes.stock.name,
            industry: highlightsRes.stock.industry || '未分类行业',
            marketImpression: highlightsRes.marketImpression,
            headline: highlightsRes.headline,
            summary: highlightsRes.summary,
            outlook: highlightsRes.outlook,
            highlights: highlightsRes.highlights || [],
            radar: highlightsRes.radar?.length ? highlightsRes.radar : getDefaultRadarFromSummary(highlightsRes.summary),
            trend: (snapshots || []).map(p => ({
              date: String(p.snapshotDate).slice(5),
              risk: p.riskScore,
              positive: p.positiveScore,
            })),
            xueqiu: highlightsRes.xueqiu
          }
        });
      } catch (err: any) {
        if (!ignore) {
          setStockState({ data: null, history: [], loading: false, error: err?.message || '获取数据失败' });
        }
      }
    }
    fetchAll();
    return () => { ignore = true; };
  }, [selectedCode]);

  const filteredHighlights = useMemo(() => {
    if (!stockState.data) return [];
    let items = [...stockState.data.highlights];
    if (sideFilter !== 'all') items = items.filter(i => i.side === sideFilter);

    const rows = items.map(item => {
      const latest = item.history?.[item.history.length - 1]?.action || item.history?.[0]?.action || '';
      let priority = 3;
      if (latest === '已解除') priority = 0;
      else if (latest === '缓和') priority = 1;
      else if (item.side === 'risk') {
        priority = item.stars >= 5 || ['升级', '维持高位'].includes(latest) ? 5 : item.stars >= 4 ? 4 : 3;
      } else {
        priority = latest === '强化' && item.stars >= 4 ? 5 : item.stars >= 3 ? 4 : 3;
      }
      return { ...item, priority, freshness: item.history?.[0]?.date || '' };
    });

    return rows.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (sortMode === 'recent') return b.freshness.localeCompare(a.freshness);
      return sortMode === 'stars' ? b.stars - a.stars : b.score - a.score;
    });
  }, [stockState.data, sideFilter, sortMode]);

  const latestChanges = useMemo(() => stockState.history.slice(0, 8), [stockState.history]);

  const compareSummary = useMemo(() => {
    const defaultRes = { riskDelta: 0, positiveDelta: 0, addedLabels: [], strengthenedLabels: [] as string[] };
    if (!stockState.data) return defaultRes;
    const trend = stockState.data.trend || [];
    if (!trend.length) return defaultRes;

    const windows = { '1m': 1, '3m': 3, '6m': 6 } as const;
    const months = windows[compareWindow as keyof typeof windows] || 1;
    const currentPrice = trend[trend.length - 1];
    const basePoint = trend[Math.max(0, trend.length - 1 - months)] || trend[0];
    
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    return {
      riskDelta: currentPrice.risk - basePoint.risk,
      positiveDelta: currentPrice.positive - basePoint.positive,
      addedLabels: stockState.data.highlights
        .filter(i => (i.history || []).some(h => h.action === '新增' && h.date >= cutoffStr))
        .map(i => i.label).slice(0, 4),
      strengthenedLabels: stockState.data.highlights
        .filter(i => (i.history || []).some(h => ['升级', '强化', '维持高位'].includes(h.action) && h.date >= cutoffStr))
        .map(i => i.label).slice(0, 4),
    };
  }, [compareWindow, stockState.data]);

  const topRisk = useMemo(() => filteredHighlights.find(h => h.side === 'risk') || null, [filteredHighlights]);
  const topPositive = useMemo(() => filteredHighlights.find(h => h.side === 'positive') || null, [filteredHighlights]);

  const selectStock = (stock: SearchStock | string) => {
    const code = typeof stock === 'string' ? stock : stock.code;
    setSelectedCode(code);
    localStorage.setItem('last_stock_code', code);
    
    // 更新最近搜索
    if (typeof stock !== 'string') {
      const updated = [stock, ...recentStocks.filter(s => s.code !== stock.code)].slice(0, 6);
      setRecentStocks(updated);
      localStorage.setItem('recent_stocks', JSON.stringify(updated));
    }
    
    setIsQuickSearching(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6">
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-200">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">个股智策 <span className="mx-1 text-slate-300 font-light">|</span> <span className="text-slate-500 font-medium">穿透式投研终端</span></h1>
                <Badge variant="outline" className="rounded-full border-red-200 bg-red-50 text-[10px] py-0 px-2 font-bold text-red-700 uppercase tracking-wider animate-pulse">
                  Terminal v2.1.0 AI-FORCE
                </Badge>
              </div>
              <p className="mt-0.5 text-xs font-medium text-slate-400">
                基于巨潮真实公告证据链的深度价值挖掘 · 生产级语义穿透系统
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <div className="text-right">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">System Status</div>
              <div className="mt-1 flex items-center justify-end gap-1.5 text-xs font-semibold text-emerald-600">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                后台数据链已连接
              </div>
            </div>
          </div>
        </motion.div>

        {/* 灵动小键盘 Overlay */}
        {isQuickSearching && (
          <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/40 pt-[15vh] backdrop-blur-md" onClick={() => setIsQuickSearching(false)}>
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }}
              className="relative w-full max-w-xl overflow-hidden rounded-3xl border bg-white shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="relative border-b p-4">
                <Search className="absolute left-6 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  className="w-full bg-transparent pl-10 pr-10 text-xl font-medium outline-none placeholder:text-slate-300"
                  placeholder="搜索代码、首字母或名称..."
                  value={quickSearchInput}
                  onChange={e => setQuickSearchInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setIsQuickSearching(false);
                    if (e.key === 'ArrowDown') setSelectedIndex(s => Math.min(s + 1, (quickSearchInput ? searchResults : recentStocks).length - 1));
                    if (e.key === 'ArrowUp') setSelectedIndex(s => Math.max(s - 1, 0));
                    if (e.key === 'Enter') {
                      const list = quickSearchInput ? searchResults : recentStocks;
                      const selected = list[selectedIndex];
                      if (selected) {
                        selectStock(selected);
                      } else if (/^\d{6}$/.test(quickSearchInput)) {
                        selectStock({ code: quickSearchInput, name: `代码 ${quickSearchInput}`, industry: '快速穿透' });
                      }
                    }
                  }}
                />
                <button 
                  onClick={() => setIsQuickSearching(false)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-2 hover:bg-slate-100"
                >
                  <RefreshCw className="h-4 w-4 rotate-45 text-slate-400" />
                </button>
              </div>
              <div className="max-h-[460px] min-h-[100px] overflow-y-auto p-2">
                {!quickSearchInput && recentStocks.length > 0 && (
                  <div className="mb-2 px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">最近查看 RECENT_TICKERS</div>
                )}
                {isSearching && searchResults.length === 0 ? (
                  <div className="flex items-center justify-center p-12 text-slate-400">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 智能情报检索中...
                  </div>
                ) : (quickSearchInput ? searchResults : recentStocks).length > 0 ? (
                      (quickSearchInput ? searchResults : recentStocks).map((item, idx) => (
                      <div
                        key={item.code}
                        onClick={() => selectStock(item)}
                        className={`flex cursor-pointer items-center justify-between rounded-2xl p-4 transition ${idx === selectedIndex ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="rounded-xl bg-slate-900 px-2.5 py-1 text-xs font-mono font-bold text-white tracking-widest leading-none shadow-sm">{item.code}</div>
                          <div>
                            <div className="text-lg font-bold text-slate-900 leading-tight">{item.name}</div>
                            <div className="mt-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{item.industry || 'MARKET_STOCK'}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {item.price !== undefined && (
                            <div className="text-right">
                              <div className="text-lg font-mono font-bold text-slate-900">
                                {item.price.toFixed(2)}
                              </div>
                              <div className={`text-[10px] font-bold font-mono ${(item.pct || 0) >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                {(item.pct || 0) >= 0 ? '+' : ''}{((item.pct || 0) * 100).toFixed(2)}%
                              </div>
                            </div>
                          )}
                          <ChevronRight className={`h-5 w-5 transition ${idx === selectedIndex ? 'text-slate-900 translate-x-1' : 'text-slate-300'}`} />
                        </div>
                      </div>
                    ))
                ) : (
                  <div className="p-16 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50">
                      <Search className="h-6 w-6 text-slate-200" />
                    </div>
                    <div className="text-sm font-bold text-slate-300 uppercase tracking-widest">
                      {quickSearchInput ? 'NO_MATCHING_COMMAND' : 'WAITING_FOR_INPUT'}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      输入拼音首字母如 'payh' 开启搜索
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-slate-50/50 p-3 text-center text-[10px] text-slate-400 border-t font-mono uppercase tracking-widest">
                UP/DOWN TO SELECT · ENTER TO EXECUTE · ESC TO DISMISS
              </div>
            </motion.div>
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-400 font-medium tracking-wider uppercase">
            键盘输入任何内容即可开启搜索 · 直接输入 6 位代码快速触达
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border bg-white p-1">
              {['all', 'risk', 'positive'].map(val => (
                <button
                  key={val}
                  onClick={() => setSideFilter(val)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-xl transition ${sideFilter === val ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {val === 'all' ? '全部' : val === 'risk' ? '风险' : '亮点'}
                </button>
              ))}
            </div>
            <Select value={sortMode} onValueChange={setSortMode}>
              <SelectTrigger className="h-9 w-[160px] rounded-2xl bg-white text-sm"><SelectValue placeholder="排序方式" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score">按影响力</SelectItem>
                <SelectItem value="stars">按星级</SelectItem>
                <SelectItem value="recent">最近更新</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {stockState.loading ? (
          <div className="rounded-3xl border bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-500" />
            </div>
            <div className="text-base font-semibold">正在检索穿透数据...</div>
          </div>
        ) : !stockState.data ? (
          <div className="rounded-[40px] border border-dashed border-slate-200 bg-white p-20 text-center shadow-sm">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-900 shadow-xl shadow-slate-200">
                <Activity className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Intelligent Terminal Ready</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">
                {stockState.error ? `ERR_SYSTEM: ${stockState.error}` : '系统已就绪。正在监听全域公告与研报数据，按键盘任意键开启智能透视分析。'}
              </p>
              <div className="mt-8 flex items-center justify-center gap-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> CNINFO_DISCLOSURE
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-500" /> EASTMONEY_HUB
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
            <div className="space-y-6">
              <div className="rounded-2xl bg-blue-50 p-4">
                <div className="text-sm font-semibold text-blue-800">投研洞察逻辑</div>
                <div className="mt-2 space-y-2 text-sm text-blue-900">
                  <div>• 风险敞口：{stockState.data.summary.totalRiskScore > stockState.data.summary.totalPositiveScore ? '当前系统探测到风险因子密集且权重较高，建议优先排查。' : '当前风险端保持在基准线水平，未出现显著扩散信号。'}</div>
                  <div>• 边际变化：{stockState.data.summary.riskCount > 0 ? '需结合公告时效性，观察是否有风险因子的缓和或解除。' : '暂无显著负面信号。'}</div>
                </div>
              </div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold tracking-tight">{stockState.data.name}</h2>
                    <Badge variant="outline" className="rounded-full shadow-sm">{stockState.data.code}</Badge>
                    <Badge variant="secondary" className="rounded-full">{stockState.data.industry}</Badge>
                  </div>
                  {stockState.data.xueqiu && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`rounded-full border-none px-3 py-1 font-bold ${stockState.data.xueqiu.sentiment === 'bullish' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                        {stockState.data.xueqiu.sentiment === 'bullish' ? '🔥 看多情绪高涨' : '🧊 情绪回归冷静'}
                      </Badge>
                      <Badge variant="outline" className="rounded-full bg-slate-900 font-mono text-[10px] text-white">
                        POP_RANK: {stockState.data.xueqiu.popularity}
                      </Badge>
                    </div>
                  )}
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 font-medium">{stockState.data.marketImpression}</p>
                <div className="mt-5 rounded-2xl bg-slate-900 p-4 text-white md:p-5 shadow-inner">
                  <div className="flex items-center gap-2 text-sm text-slate-400 font-mono"><Sparkles className="h-4 w-4" /> CROSS_SOURCE_INSIGHT</div>
                  <div className="mt-2 text-lg font-bold leading-tight">{stockState.data.headline}</div>
                  {stockState.data.xueqiu?.analysis && (
                    <div className="mt-3 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-400">
                      分析官点评：{stockState.data.xueqiu.analysis}
                    </div>
                  )}
                </div>
              </motion.div>

              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader><SectionTitle icon={BarChart3} title="情报趋势" subtitle="风险与亮点因子的时序强度演变" /></CardHeader>
                  <CardContent className="h-[280px] p-4">
                    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                      <LineChart data={stockState.data.trend || []}>
                        <XAxis dataKey="date" tick={{fontSize: 10}} />
                        <YAxis tick={{fontSize: 10}} />
                        <Tooltip contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} />
                        <Line type="stepAfter" name="风险" dataKey="risk" stroke="#ef4444" strokeWidth={3} dot={false} />
                        <Line type="stepAfter" name="亮点" dataKey="positive" stroke="#10b981" strokeWidth={3} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader><SectionTitle icon={ShieldAlert} title="数据穿透画像" subtitle="基于公告证据权重的核心维度量化" /></CardHeader>
                  <CardContent className="flex h-[320px] items-center justify-center p-4">
                    <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={stockState.data.radar || []}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="k" tick={{fontSize: 12, fontWeight: 500}} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                        <Radar name="强度" dataKey="v" stroke="#0f172a" fill="#0f172a" fillOpacity={0.15} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <SectionTitle icon={FileText} title="核心看点卡片" subtitle="每条看点都包含结论、原因、证据和历史变化" />
                    <div className="flex items-center gap-2 text-sm text-slate-500"><Filter className="h-4 w-4" /> 当前共 {filteredHighlights.length} 条</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Accordion type="multiple" defaultValue={["risk", "positive"]} className="w-full space-y-3">
                    <AccordionItem value="risk" className="rounded-2xl border">
                      <AccordionTrigger className="px-4 text-base font-semibold">风险看点</AccordionTrigger>
                      <AccordionContent className="space-y-4 px-2 pb-2">
                        {filteredHighlights.filter((i) => i.side === 'risk').map((item) => <HighlightCard key={item.id} item={item} onOpen={setActiveHighlight} />)}
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="positive" className="rounded-2xl border">
                      <AccordionTrigger className="px-4 text-base font-semibold">亮点看点</AccordionTrigger>
                      <AccordionContent className="space-y-4 px-2 pb-2">
                        {filteredHighlights.filter((i) => i.side === 'positive').map((item) => <HighlightCard key={item.id} item={item} onOpen={setActiveHighlight} />)}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <SectionTitle icon={TrendingUp} title="对比模式" subtitle="直接比较当前与近 1 / 3 / 6 个月的变化" />
                    <Select value={compareWindow} onValueChange={setCompareWindow}>
                      <SelectTrigger className="h-10 w-[140px] rounded-2xl bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1m">近 1 个月</SelectItem>
                        <SelectItem value="3m">近 3 个月</SelectItem>
                        <SelectItem value="6m">近 6 个月</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">风险强度变化</div>
                      <div className="mt-2 text-2xl font-bold">{compareSummary.riskDelta >= 0 ? '+' : ''}{compareSummary.riskDelta}</div>
                      <p className="mt-2 text-sm text-slate-600">正值表示风险强度抬升，负值表示风险缓和。</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">亮点强度变化</div>
                      <div className="mt-2 text-2xl font-bold">{compareSummary.positiveDelta >= 0 ? '+' : ''}{compareSummary.positiveDelta}</div>
                      <p className="mt-2 text-sm text-slate-600">正值表示亮点增强，负值表示亮点减弱。</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">新增看点</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(compareSummary.addedLabels.length > 0 ? compareSummary.addedLabels : ['暂无']).map((label) => <Badge key={label} variant="secondary" className="rounded-full">{label}</Badge>)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">强化 / 升级看点</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(compareSummary.strengthenedLabels.length > 0 ? compareSummary.strengthenedLabels : ['暂无']).map((label) => <Badge key={label} variant="secondary" className="rounded-full">{label}</Badge>)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={History} title="边际驱动分析" subtitle="深度解析近期分值波动的关键推手" /></CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-red-50 p-4 border border-red-100">
                      <div className="text-sm font-bold text-red-800 uppercase tracking-wider">Risk Driver</div>
                      <p className="mt-2 text-sm leading-relaxed text-red-900">
                        {compareSummary.riskDelta > 0 ? (
                          <>
                            风险敞口扩大，主因：
                            <button className="mx-1 underline font-bold" onClick={() => {
                              const target = stockState.data?.highlights.find(h => h.label === compareSummary.strengthenedLabels[0]);
                              if (target) setActiveHighlight(target);
                            }}>
                              {compareSummary.strengthenedLabels[0] || '核心风险强化'}
                            </button>
                            。此类因子具备较强惯性，建议规避。
                          </>
                        ) : compareSummary.riskDelta < 0 ? '风险端出现边际改善，原有高压因子有所缓解，属于正面信号。' : '风险格局保持死锁，暂无新增冲击，但也未见逻辑反转。'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-100">
                      <div className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Value Driver</div>
                      <p className="mt-2 text-sm leading-relaxed text-emerald-900">
                        {compareSummary.positiveDelta > 0 ? (
                          <>
                            价值面增强，动力源：
                            <button className="mx-1 underline font-bold" onClick={() => {
                              const target = stockState.data?.highlights.find(h => h.label === compareSummary.addedLabels[0]);
                              if (target) setActiveHighlight(target);
                            }}>
                              {compareSummary.addedLabels[0] || '新增逻辑确认'}
                            </button>
                            。建议关注业绩兑现力度。
                          </>
                        ) : compareSummary.positiveDelta < 0 ? '亮点逻辑出现钝化，市场关注度可能自然回落，建议审慎追踪。' : '亮点因子供需平衡，处于逻辑真空期。'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={TrendingUp} title="未来预期" subtitle="帮助理解后续 1-3 个月的关注重点" /></CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-semibold">分析师共识</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stockState.data.outlook?.consensus || '数据暂不可用'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-semibold">短期预期</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stockState.data.outlook?.shortTerm || '数据暂不可用'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-semibold">估值变化预期</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stockState.data.outlook?.valuation || '数据暂不可用'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={Clock3} title="最近动态变化" subtitle="直接看新增、升级、缓和等动作" /></CardHeader>
                <CardContent className="space-y-3">
                    {latestChanges.map((item, idx) => {
                      const style = sideStyle[item.side as 'risk' | 'positive'];
                      const Icon = item.side === 'risk' ? ArrowUpRight : ArrowDownRight;
                      const matched = stockState.data?.highlights.find((h: HighlightItem) => h.id === item.highlightId) || stockState.data?.highlights.find((h: HighlightItem) => h.label === item.label && h.side === item.side) || stockState.data?.highlights.find((h: HighlightItem) => h.label === item.label);
                      return (
                        <button
                          key={`${item.label}-${idx}`}
                          type="button"
                          className="flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition hover:border-slate-300 hover:shadow-sm"
                          onClick={() => matched && setActiveHighlight(matched)}
                        >
                          <div className={`rounded-2xl p-2 ${style.chip}`}><Icon className="h-4 w-4" /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className={`rounded-full ${style.badge}`}>{style.label}</Badge>
                              <span className="text-xs text-slate-500">{item.date}</span>
                            </div>
                            <div className="mt-1 text-sm font-semibold">{item.label}</div>
                            <div className="mt-1 text-sm text-slate-600">{item.action} · {item.desc}</div>
                          </div>
                          <ChevronRight className="mt-1 h-4 w-4 text-slate-400" />
                        </button>
                      );
                    })}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={Sparkles} title="市场博弈结构" subtitle="识别当前多空对冲的关键主线" /></CardHeader>
                <CardContent>
                  <div className="rounded-2xl bg-purple-50 p-4 text-sm leading-6 text-purple-900">
                    {topRisk && topPositive ? (
                      <>
                        <div>• 当前存在明显博弈：</div>
                        <div>风险：{topRisk.label}</div>
                        <div>对冲：{topPositive.label}</div>
                        <div>• 关键判断：需观察哪一因素先兑现，将更大程度主导股价方向。</div>
                      </>
                    ) : (
                      <div>当前暂无明显多空冲突结构。</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        <HighlightDialog item={activeHighlight} onClose={() => setActiveHighlight(null)} />
      </div>
    </div>
  );
}
