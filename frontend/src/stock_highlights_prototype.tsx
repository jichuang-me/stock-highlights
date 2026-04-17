import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Activity, TrendingUp, AlertTriangle, Sparkles, 
  ChevronRight, ArrowUpRight, ArrowDownRight, Zap, History, 
  ExternalLink, Clock3, Filter, BarChart3, ShieldAlert,
  Loader2, FileText, LayoutDashboard, Database, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ResponsiveContainer, ComposedChart, XAxis, YAxis, Tooltip, 
  Area, Line, Scatter, RadarChart, PolarGrid, PolarAngleAxis, 
  PolarRadiusAxis, Radar 
} from 'recharts';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, 
  DialogDescription 
} from './components/ui/dialog';
import { 
  Card, CardContent, CardHeader, CardTitle 
} from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";

// --- API Helper ---
const API_BASE = ''; // Use relative paths for better stability on Hugging Face

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, options);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API Error (${response.status}): ${errorBody || response.statusText}`);
  }
  return response.json();
}

const stockHighlightsApi = {
  async searchStocks(keyword: string): Promise<SearchStock[]> {
    return apiRequest<SearchStock[]>(`/api/stocks/search?q=${encodeURIComponent(keyword)}`);
  },
  async getStockHighlights(code: string): Promise<any> {
    return apiRequest<any>(`/api/stocks/${encodeURIComponent(code)}/highlights`);
  },
  async getStockHistory(code: string): Promise<any> {
    return apiRequest<any>(`/api/stocks/${encodeURIComponent(code)}/history`);
  },
  async getStockSnapshots(code: string): Promise<SnapshotPoint[]> {
    return apiRequest<SnapshotPoint[]>(`/api/stocks/${encodeURIComponent(code)}/snapshots`);
  },
  async saveSnapshot(code: string, data: any): Promise<any> {
    return apiRequest<any>(`/api/stocks/${encodeURIComponent(code)}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }
};

// --- 类型定义 ---
export interface StockSnapshot {
  date: string;
  price: number;
}

export interface MarketImpression {
  summary: string;
  positioning: string;
  investor_focus: string;
}

export interface StockOutlook {
  consensus: string;
  shortTerm: string;
  valuation: string;
  catalysts: string[];
}

export interface Summary {
  totalRiskScore: number;
  totalPositiveScore: number;
  riskCount: number;
  positiveCount: number;
  sentiment: 'bullish' | 'neutral' | 'bearish';
  confidence: number;
}

export interface EvidenceItem {
  source: string;
  title: string;
  excerpt: string;
  time: string;
  url?: string;
  weight: '高' | '中' | '低';
}

export interface HistoryItem {
  date: string;
  action: string;
  desc: string;
  delta?: string;
}

export interface HighlightItem {
  id: string;
  side: 'risk' | 'positive';
  label: string;
  why: string;
  interpretation: string;
  score: number;
  stars: number;
  category: string;
  evidence: EvidenceItem[];
  history: HistoryItem[];
  factors?: string[];
  game_view?: string;
  priority?: number;
}

export interface StockViewModel {
  code: string;
  name: string;
  industry: string;
  marketImpression: MarketImpression;
  headline: string;
  summary: Summary;
  outlook: StockOutlook;
  highlights: HighlightItem[];
  radar: { k: string; v: number }[];
  price?: number;
  pctChange?: number;
  trend: any[];
  priceHistory?: StockSnapshot[];
  xueqiu?: {
    rank: number;
    popularity: number;
    followers: number;
  };
  liveNews?: any[];
}

export interface SearchStock {
  code: string;
  name: string;
  industry: string;
  price?: number;
  pct?: number;
}

export interface SnapshotPoint {
  id: string;
  timestamp: string;
  summary: Summary;
  highlights: HighlightItem[];
  price?: number;
}

// --- 工具函数与样式常量 ---
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
    '新增': { label: '新增', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    '升级': { label: '升级', className: 'bg-red-50 text-red-700 border-red-200' },
    '强化': { label: '强化', className: 'bg-orange-50 text-orange-700 border-orange-200' },
    '维持高位': { label: '高位', className: 'bg-rose-50 text-rose-700 border-rose-200' },
    '缓和': { label: '缓和', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    '已解除': { label: '已解除', className: 'bg-slate-100 text-slate-700 border-slate-200' },
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
    '公司公告': 5,
    '年度报告': 4,
    '财报数据': 4,
    '财务指标': 4,
    '法院/监管': 3,
    '行业观察': 2,
    '业务动态': 2,
    '市场观察': 1,
    '综合判断': 1,
  };
  const weightRank: Record<string, number> = { '高': 3, '中': 2, '低': 1 };
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

function SectionTitle({ icon: Icon, title, subtitle, action }: { icon: any; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-slate-100 p-2">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function HighlightCard({ 
  item, 
  onOpen, 
  diff 
}: { 
  item: HighlightItem; 
  onOpen: (item: HighlightItem) => void;
  diff?: 'new' | 'changed' | 'removed' | 'better' | 'worse' | null;
}) {
  const style = sideStyle[item.side];
  const Icon = style.icon;
  const statusBadge = getLatestHistoryBadge(item);
  const latestAction = item.history?.[item.history.length - 1]?.action || item.history?.[0]?.action || '';
  const isResolved = ['已解除', '缓和'].includes(latestAction);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-3xl border p-4 transition hover:border-slate-300 hover:shadow-sm md:p-5 
        ${isResolved ? 'bg-slate-50 opacity-60' : ''}
        ${diff === 'new' ? 'border-amber-400 bg-amber-50/20' : ''}
        ${diff === 'better' ? 'border-emerald-400' : ''}
        ${diff === 'worse' ? 'border-red-400' : ''}
      `}
    >
      <div className="mb-3 flex items-center justify-end">
        <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => onOpen(item)}>
          查看详情
        </Button>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`mt-0.5 rounded-2xl p-2 ${style.chip}`}>
              <Icon className="h-4 w-4" />
            </div>
            {diff && (
              <Badge variant="outline" className={`rounded-full ${sideStyle[item.side].badge}`}>
                {diff.toUpperCase()}
              </Badge>
            )}
            {statusBadge && (
              <Badge variant="outline" className={`rounded-full ${statusBadge.className}`}>
                {statusBadge.label}
              </Badge>
            )}
            <Badge variant="outline" className="rounded-full">
              影响力 {scoreToStars(item.stars)}
            </Badge>
            <Badge variant="outline" className="rounded-full bg-slate-900 text-white border-none">
              Score {item.score}
            </Badge>
          </div>
          
          <div className="mt-3 flex items-start gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-xl font-semibold tracking-tight">{item.label}</div>
                {item.game_view && (
                  <Badge variant="outline" className="rounded-full bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                    <Zap size={10} className="mr-1 inline-block" /> 深度博弈
                  </Badge>
                )}
              </div>
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
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-slate-600">
                影响力 {scoreToStars(item.stars)} | 评分 {item.score}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5"><Zap size={40} /></div>
                <div className="flex items-center gap-2 text-sm font-bold text-amber-800 uppercase tracking-widest mb-3">
                  <Sparkles size={16} /> Game Insight / 博弈逻辑研判
                </div>
                <p className="text-sm font-medium leading-relaxed text-amber-900 italic">
                   "{item.game_view || '该事件触发常规逻辑判定，暂无深度博弈偏离信息。'}"
                </p>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-sm font-semibold">核心判断</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.why}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600 font-medium">基本面解读：{item.interpretation}</p>
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

              <div>
                <div className="mb-3 text-sm font-semibold">证据链</div>
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
                      </div>
                      <div className="mt-2 text-sm font-semibold">{ev.title}</div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{ev.excerpt}</p>
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

// --- Safe Storage Utility to prevent crashes in restricted browsers ---
const safeLocalStorage = {
  getItem(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* ignore if blocked */ }
  }
};

export default function StockHighlightsPrototype() {
  const [stockState, setStockState] = useState<{
    data: StockViewModel | null;
    history: any[];
    loading: boolean;
    error: string;
  }>({ data: null, history: [], loading: false, error: '' });

  const [selectedCode, setSelectedCode] = useState(() => safeLocalStorage.getItem('last_stock_code') || '');
  const [recentStocks, setRecentStocks] = useState<SearchStock[]>(() => {
    try { 
      const stored = safeLocalStorage.getItem('recent_stocks');
      return stored ? JSON.parse(stored) : []; 
    } catch { return []; }
  });
  
  const [sideFilter, setSideFilter] = useState('all');
  const [sortMode, setSortMode] = useState('score');
  const [activeHighlight, setActiveHighlight] = useState<HighlightItem | null>(null);
  const [isQuickSearching, setIsQuickSearching] = useState(false);
  const [quickSearchInput, setQuickSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchStock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compareWindow, setCompareWindow] = useState('1m');

  const [snapshots, setSnapshots] = useState<SnapshotPoint[]>([]);
  const [compareBase, setCompareBase] = useState<SnapshotPoint | null>(null);
  const [isSnapshotDrawerOpen, setIsSnapshotDrawerOpen] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || activeHighlight) return;
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
    if (!isQuickSearching) return;
    let ignore = false;
    async function loadQuickResults() {
      const keyword = quickSearchInput.trim();
      if (!keyword) { setSearchResults([]); return; }
      setIsSearching(true);
      try {
        const results = await stockHighlightsApi.searchStocks(keyword);
        if (!ignore) { setSearchResults(results || []); setSelectedIndex(0); }
      } catch { if (!ignore) setSearchResults([]); } finally { if (!ignore) setIsSearching(false); }
    }
    const timer = setTimeout(loadQuickResults, 150);
    return () => { clearTimeout(timer); ignore = true; };
  }, [quickSearchInput, isQuickSearching]);

  const loadSnapshots = async (code: string) => {
    try { const data = await stockHighlightsApi.getStockSnapshots(code); setSnapshots(data || []); } catch {}
  };

  const handleSaveSnapshot = async () => {
    if (!stockState.data || !selectedCode) return;
    setIsSavingSnapshot(true);
    try {
      await stockHighlightsApi.saveSnapshot(selectedCode, {
        summary: stockState.data.summary,
        highlights: stockState.data.highlights,
        price: stockState.data.price
      });
      await loadSnapshots(selectedCode);
    } catch { alert("快照保存失败"); } finally { setIsSavingSnapshot(false); }
  };

  useEffect(() => {
    if (!selectedCode) return;
    let ignore = false;
    async function fetchAll() {
      setStockState(s => ({ ...s, loading: true, error: '' }));
      try {
        const [highlightsRes, histRes] = await Promise.all([
          stockHighlightsApi.getStockHighlights(selectedCode),
          stockHighlightsApi.getStockHistory(selectedCode),
        ]);
        if (ignore) return;
        setStockState({
          loading: false, error: '', history: histRes || [],
          data: {
            ...highlightsRes.stock,
            marketImpression: highlightsRes.marketImpression || { 
              summary: '暂无分析', 
              positioning: '待研判', 
              investor_focus: '保持关注' 
            },
            headline: highlightsRes.headline || '智能扫描中...',
            summary: highlightsRes.summary || { 
              totalRiskScore: 0, totalPositiveScore: 0, 
              riskCount: 0, positiveCount: 0, 
              sentiment: 'neutral', confidence: 0 
            },
            outlook: highlightsRes.outlook || { 
              consensus: '观测中', 
              shortTerm: '中性', 
              valuation: '合理', 
              catalysts: [] 
            },
            highlights: highlightsRes.highlights || [],
            radar: (highlightsRes.radar && highlightsRes.radar.length > 0) ? highlightsRes.radar : getDefaultRadarFromSummary(highlightsRes.summary || {}),
            trend: (highlightsRes.priceHistory || []).map((p: any) => ({
              date: (p.date || '').slice(5),
              price: p.price || 0,
              risk: (highlightsRes.summary?.totalRiskScore) || 0,
              positive: (highlightsRes.summary?.totalPositiveScore) || 0,
              isEvent: (histRes || []).some((h: any) => h.date === p.date)
            })),
            price: highlightsRes.stock?.price || 0,
            pctChange: highlightsRes.stock?.pctChange || 0,
            xueqiu: highlightsRes.xueqiu || { rank: 0, popularity: 0, followers: 0 },
            liveNews: highlightsRes.liveNews || []
          }
        });
      } catch (err: any) { if (!ignore) setStockState({ data: null, history: [], loading: false, error: err?.message || '获取数据失败' }); }
    }
    fetchAll();
    loadSnapshots(selectedCode);
  }, [selectedCode]);

  const filteredHighlights = useMemo(() => {
    if (!stockState.data) return [];
    let items = [...stockState.data.highlights];
    if (sideFilter !== 'all') items = items.filter(i => i.side === sideFilter);
    return items.map(item => {
      const latest = item.history?.[item.history.length - 1]?.action || item.history?.[0]?.action || '';
      let priority = 3;
      if (latest === '已解除') priority = 0;
      else if (latest === '缓和') priority = 1;
      else if (item.side === 'risk') priority = item.stars >= 5 ? 5 : item.stars >= 4 ? 4 : 3;
      else priority = item.stars >= 4 ? 5 : item.stars >= 3 ? 4 : 3;
      return { ...item, priority };
    }).sort((a, b) => b.priority - a.priority || b.score - a.score);
  }, [stockState.data, sideFilter, sortMode]);

  const selectStock = (stock: SearchStock) => {
    setSelectedCode(stock.code);
    safeLocalStorage.setItem('last_stock_code', stock.code);
    const updated = [stock, ...recentStocks.filter(s => s.code !== stock.code)].slice(0, 6);
    setRecentStocks(updated);
    safeLocalStorage.setItem('recent_stocks', JSON.stringify(updated));
    setIsQuickSearching(false);
  };

  const compareSummary = useMemo(() => {
    if (!stockState.data) return { riskDelta: 0, positiveDelta: 0 };
    return { riskDelta: 0, positiveDelta: 0 }; // Simplified for now
  }, [stockState.data]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">个股智策 | 穿透式投研终端</h1>
              <p className="text-xs text-slate-400">基于巨潮真实公告证据链的深度价值挖掘</p>
            </div>
          </div>
        </header>

        {isQuickSearching && (
          <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsQuickSearching(false)}>
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
                  <Search className="w-5 h-5 text-zinc-500" />
                  <input
                    autoFocus
                    ref={(el) => el && el.focus()}
                    className="bg-transparent border-none outline-none text-white text-lg w-full placeholder:text-zinc-600"
                    placeholder="输入代码、拼音或简称..."
                    value={quickSearchInput}
                    onChange={e => setQuickSearchInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'ArrowDown') setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1));
                      if (e.key === 'ArrowUp') setSelectedIndex(prev => Math.max(prev - 1, 0));
                      if (e.key === 'Enter' && searchResults[selectedIndex]) selectStock(searchResults[selectedIndex]);
                      if (e.key === 'Escape') setIsQuickSearching(false);
                    }}
                  />
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-2">
                  {isSearching && (
                    <div className="flex items-center justify-center p-8 text-zinc-500">
                      <Loader2 className="h-6 w-6 animate-spin mr-2" />
                      搜索中...
                    </div>
                  )}
                  {!isSearching && searchResults.length === 0 && quickSearchInput.trim() !== '' && (
                    <div className="p-8 text-center text-zinc-500 italic">未找到匹配的股票</div>
                  )}
                  {searchResults.map((item, idx) => (
                    <div 
                      key={item.code} 
                      onClick={() => selectStock(item)} 
                      className={`flex cursor-pointer items-center justify-between rounded-xl p-4 transition ${idx === selectedIndex ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-white/10 px-2 py-1 text-xs font-mono font-bold text-white tracking-widest">{item.code}</div>
                        <div className="font-bold">{item.name}</div>
                        <div className="text-xs text-zinc-600">{item.industry}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-mono font-bold leading-none">{item.price?.toFixed(2)}</div>
                          <div className={`text-[10px] font-bold ${(item.pct || 0) >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                            {(item.pct || 0) >= 0 ? '+' : ''}{item.pct?.toFixed(2)}%
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 opacity-20" />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 rounded-2xl border bg-white p-1">
            {['all', 'risk', 'positive'].map(val => (
              <button key={val} onClick={() => setSideFilter(val)} className={`px-4 py-1.5 text-sm font-medium rounded-xl transition ${sideFilter === val ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {val === 'all' ? '全部' : val === 'risk' ? '风险' : '亮点'}
              </button>
            ))}
          </div>
        </div>

        {!stockState.data ? (
          <div className="rounded-[40px] border border-dashed border-slate-200 bg-white p-20 text-center shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-900 shadow-xl">
              <Activity className="h-10 w-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">智能终端就绪</h2>
            <p className="mt-3 text-sm text-slate-500">按键盘任意键开启智能透视分析</p>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
            <div className="space-y-6">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-3xl border bg-slate-900 p-6 text-white shadow-2xl relative overflow-hidden">
                <div className="relative z-10">
                  <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-4">
                      <h2 className="text-3xl font-black">{stockState.data.name}</h2>
                      <span className="font-mono text-slate-400">{stockState.data.code}</span>
                      <div className="ml-4 flex items-center gap-3 border-l border-slate-700 pl-4">
                        <span className="text-2xl font-black">{stockState.data.price}</span>
                        <span className={`text-sm font-black ${(stockState.data.pctChange || 0) >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                          {(stockState.data.pctChange || 0) >= 0 ? '+' : ''}{stockState.data.pctChange?.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-black text-blue-400 uppercase tracking-widest">
                      <Sparkles size={14} /> Market Impression / 市场印象
                    </div>
                    <p className="text-lg font-medium text-slate-100">{stockState.data.marketImpression.summary}</p>
                    <div className="grid grid-cols-2 gap-4 pt-2">
                       <div className="text-xs text-slate-400"><span className="font-bold text-white">定位:</span> {stockState.data.marketImpression.positioning}</div>
                       <div className="text-xs text-slate-400"><span className="font-bold text-white">关注点:</span> {stockState.data.marketImpression.investor_focus}</div>
                    </div>
                  </div>
                </div>
              </motion.div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader><SectionTitle icon={BarChart3} title="情报趋势" /></CardHeader>
                  <CardContent className="h-[280px] p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={stockState.data.trend}>
                        <XAxis dataKey="date" tick={{fontSize: 9}} />
                        <YAxis yAxisId="left" tick={{fontSize: 10}} domain={[0, 100]} />
                        <YAxis yAxisId="right" orientation="right" tick={{fontSize: 10}} domain={['auto', 'auto']} />
                        <Tooltip />
                        <Area yAxisId="right" type="monotone" dataKey="price" stroke="#3b82f6" fillOpacity={0.1} fill="#3b82f6" />
                        <Line yAxisId="left" type="stepAfter" dataKey="risk" stroke="#ef4444" strokeWidth={2} dot={false} />
                        <Line yAxisId="left" type="stepAfter" dataKey="positive" stroke="#10b981" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader><SectionTitle icon={ShieldAlert} title="数据穿透画像" /></CardHeader>
                  <CardContent className="h-[280px] p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={stockState.data.radar}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="k" tick={{fontSize: 10}} />
                        <Radar name="强度" dataKey="v" stroke="#0f172a" fill="#0f172a" fillOpacity={0.15} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={FileText} title="核心看点卡片" /></CardHeader>
                <CardContent className="space-y-4">
                  <Accordion type="multiple" defaultValue={["risk", "positive"]} className="space-y-3">
                    <AccordionItem value="risk" className="rounded-2xl border">
                      <AccordionTrigger className="px-4 font-semibold">分析面：潜在隐忧与风险线索</AccordionTrigger>
                      <AccordionContent className="space-y-4 px-2 pb-2">
                        {filteredHighlights.filter(i => i.side === 'risk').map(item => <HighlightCard key={item.id} item={item} onOpen={setActiveHighlight} />)}
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="positive" className="rounded-2xl border">
                      <AccordionTrigger className="px-4 font-semibold">基本面：价值亮点与博弈机会</AccordionTrigger>
                      <AccordionContent className="space-y-4 px-2 pb-2">
                        {filteredHighlights.filter(i => i.side === 'positive').map(item => <HighlightCard key={item.id} item={item} onOpen={setActiveHighlight} />)}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
              
              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={TrendingUp} title="未来预期" /></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-bold">分析师共识</div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">{stockState.data.outlook.consensus}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-bold">短期预期</div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">{stockState.data.outlook.shortTerm}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-bold">催化剂</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {stockState.data.outlook.catalysts.map(c => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={Zap} title="7x24 实时速递" /></CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[600px] overflow-y-auto">
                    {stockState.data.liveNews?.map((news, i) => (
                      <div key={i} className="border-b p-4 last:border-0 hover:bg-slate-50 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-slate-400">{news.time}</span>
                          <Badge variant="outline" className="text-[8px]">{news.source}</Badge>
                        </div>
                        <h4 className="text-sm font-bold leading-snug">{news.title}</h4>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={Clock3} title="研究快照" /></CardHeader>
                <CardContent className="space-y-3">
                  <Button onClick={() => setIsSnapshotDrawerOpen(true)} variant="outline" className="w-full rounded-xl">查看历史快照 ({snapshots.length})</Button>
                  <Button onClick={handleSaveSnapshot} disabled={isSavingSnapshot} className="w-full rounded-xl bg-slate-900 text-white">记录当前快照</Button>
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
