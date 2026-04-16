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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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

const API_BASE_URL = (import.meta as any)?.env?.VITE_API_BASE_URL || 'http://localhost:8000';

type SearchStock = {
  code: string;
  name: string;
  industry?: string;
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
  const [query, setQuery] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [sideFilter, setSideFilter] = useState('all');
  const [sortMode, setSortMode] = useState('score');
  const [stock, setStock] = useState<StockViewModel | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchStock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [activeHighlight, setActiveHighlight] = useState<HighlightItem | null>(null);
  const [compareWindow, setCompareWindow] = useState('1m');

  useEffect(() => {
    let ignore = false;
    async function loadSearchResults() {
      const keyword = query.trim();
      if (!keyword) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
      try {
        const results = await stockHighlightsApi.searchStocks(keyword);
        if (!ignore) setSearchResults(results || []);
      } catch {
        if (!ignore) setSearchResults([]);
      } finally {
        if (!ignore) setIsSearching(false);
      }
    }
    loadSearchResults();
    return () => {
      ignore = true;
    };
  }, [query]);

  useEffect(() => {
    if (!selectedCode) {
      setStock(null);
      setHistoryRows([]);
      return;
    }
    let ignore = false;
    async function loadStock() {
      setIsLoading(true);
      setLoadError('');
      try {
        const [highlightsRes, snapshots, history] = await Promise.all([
          stockHighlightsApi.getStockHighlights(selectedCode),
          stockHighlightsApi.getStockSnapshots(selectedCode),
          stockHighlightsApi.getStockHistory(selectedCode),
        ]);
        if (ignore) return;
        setStock({
          code: highlightsRes.stock.code,
          name: highlightsRes.stock.name,
          industry: highlightsRes.stock.industry || '未分类行业',
          marketImpression: highlightsRes.marketImpression,
          headline: highlightsRes.headline,
          summary: highlightsRes.summary,
          outlook: highlightsRes.outlook,
          highlights: highlightsRes.highlights || [],
          radar: highlightsRes.radar && highlightsRes.radar.length > 0 ? highlightsRes.radar : getDefaultRadarFromSummary(highlightsRes.summary),
          trend: (snapshots || []).map((item) => ({
            date: String(item.snapshotDate).slice(5),
            risk: item.riskScore,
            positive: item.positiveScore,
          })),
        });
        setHistoryRows(history || []);
      } catch (err: any) {
        if (!ignore) {
          setStock(null);
          setHistoryRows([]);
          setLoadError(err?.message || '加载真实数据失败，请检查后端接口。');
        }
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    loadStock();
    return () => {
      ignore = true;
    };
  }, [selectedCode]);

  const filteredHighlights = useMemo(() => {
    if (!stock) return [] as HighlightItem[];
    let items = [...stock.highlights];
    if (sideFilter !== 'all') items = items.filter((i) => i.side === sideFilter);

    function getPriority(item: HighlightItem) {
      const latest = item.history?.[item.history.length - 1]?.action || item.history?.[0]?.action || '';
      if (latest === '已解除') return 0;
      if (latest === '缓和') return 1;
      if (item.side === 'risk') {
        if (item.stars >= 5 || ['升级', '维持高位'].includes(latest)) return 5;
        if (item.stars >= 4) return 4;
        return 3;
      }
      if (latest === '强化' && item.stars >= 4) return 5;
      if (item.stars >= 3) return 4;
      return 3;
    }

    const rows = items.map((item) => ({
      ...item,
      priority: getPriority(item),
      freshness: item.history?.[0]?.date || '',
    }));

    rows.sort((a, b) => {
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      if (sortMode === 'recent') return (b.freshness || '').localeCompare(a.freshness || '');
      if (sortMode === 'stars') return b.stars - a.stars;
      return b.score - a.score;
    });

    return rows;
  }, [stock, sideFilter, sortMode]);

  const latestChanges = useMemo(() => {
    if (historyRows.length > 0) return historyRows.slice(0, 8);
    return [] as HistoryItem[];
  }, [historyRows]);

  const compareSummary = useMemo(() => {
    if (!stock) return { riskDelta: 0, positiveDelta: 0, addedLabels: [], strengthenedLabels: [] as string[] };
    const windows = { '1m': 1, '3m': 3, '6m': 6 } as const;
    const months = windows[compareWindow as keyof typeof windows] || 1;
    const trend = stock.trend || [];
    if (trend.length === 0) return { riskDelta: 0, positiveDelta: 0, addedLabels: [], strengthenedLabels: [] as string[] };
    const currentPoint = trend[trend.length - 1];
    const baseIndex = Math.max(0, trend.length - 1 - months);
    const basePoint = trend[baseIndex] || trend[0];
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);
    const cutoff = cutoffDate.toISOString().slice(0, 10);
    return {
      riskDelta: (currentPoint?.risk || 0) - (basePoint?.risk || 0),
      positiveDelta: (currentPoint?.positive || 0) - (basePoint?.positive || 0),
      addedLabels: stock.highlights.filter((item) => (item.history || []).some((h) => h.action === '新增' && h.date >= cutoff)).map((item) => item.label).slice(0, 4),
      strengthenedLabels: stock.highlights.filter((item) => (item.history || []).some((h) => ['升级', '强化', '维持高位'].includes(h.action) && h.date >= cutoff)).map((item) => item.label).slice(0, 4),
    };
  }, [compareWindow, stock]);

  const topRisk = useMemo(() => filteredHighlights.find((h) => h.side === 'risk') || null, [filteredHighlights]);
  const topPositive = useMemo(() => filteredHighlights.find((h) => h.side === 'positive') || null, [filteredHighlights]);
  const canLoadDirectly = /^[0-9]{6}$/.test(query.trim());

  function handleDirectLoad() {
    const code = query.trim();
    if (!/^[0-9]{6}$/.test(code)) return;
    setSelectedCode(code);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6 rounded-3xl border bg-white p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                <Activity className="h-3.5 w-3.5" /> 个股看点
              </div>
              <h1 className="text-2xl font-bold tracking-tight md:text-4xl">个股看点</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600 md:text-base">
                仅展示真实后端返回的数据、原文证据与历史变化；没有真实数据时不显示任何演示内容。
              </p>
            </div>
            <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
              真实数据模式
            </Badge>
          </div>
        </motion.div>

        <div className="mb-6 grid gap-3 lg:grid-cols-[1.4fr_220px_180px_180px_140px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && /^[0-9]{6}$/.test(query.trim())) handleDirectLoad();
              }}
              className="h-11 rounded-2xl pl-10"
              placeholder="输入股票名称或6位股票代码，例如 龙元建设 / 600491"
            />
          </div>
          <Select value={selectedCode} onValueChange={setSelectedCode}>
            <SelectTrigger className="h-11 rounded-2xl bg-white">
              <SelectValue placeholder="先搜索，再选择股票" />
            </SelectTrigger>
            <SelectContent>
              {searchResults.length > 0 ? (
                searchResults.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name} · {s.code}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="__empty" disabled>
                  {isSearching ? '正在搜索…' : '搜索接口无结果，可直接输入6位代码后点右侧加载'}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <Select value={sideFilter} onValueChange={setSideFilter}>
            <SelectTrigger className="h-11 rounded-2xl bg-white"><SelectValue placeholder="方向筛选" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部方向</SelectItem>
              <SelectItem value="risk">仅看风险</SelectItem>
              <SelectItem value="positive">仅看亮点</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortMode} onValueChange={setSortMode}>
            <SelectTrigger className="h-11 rounded-2xl bg-white"><SelectValue placeholder="排序方式" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="score">按影响度</SelectItem>
              <SelectItem value="stars">按星级</SelectItem>
              <SelectItem value="recent">按最近变化</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            className="h-11 rounded-2xl"
            variant={canLoadDirectly ? 'default' : 'outline'}
            disabled={!canLoadDirectly}
            onClick={handleDirectLoad}
          >
            {isLoading && selectedCode === query.trim() ? <Loader2 className="h-4 w-4 animate-spin" /> : '按代码加载'}
          </Button>
        </div>

        {isLoading ? (
          <div className="rounded-3xl border bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-500" />
            </div>
            <div className="text-base font-semibold">正在加载真实数据</div>
            <div className="mt-2 text-sm text-slate-500">请稍候，正在从后端接口获取看点、趋势和历史记录。</div>
          </div>
        ) : !stock ? (
          <div className="rounded-3xl border bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <FileText className="h-5 w-5 text-slate-500" />
            </div>
            <div className="text-base font-semibold">暂无真实数据</div>
            <div className="mt-2 text-sm text-slate-500">可先输入股票名称使用搜索接口；若搜索接口尚未实现，也可直接输入 6 位股票代码后点击“按代码加载”。</div>
            {loadError && <div className="mt-3 text-sm text-amber-700">{loadError}</div>}
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
            <div className="space-y-6">
              <div className="rounded-2xl bg-blue-50 p-4">
                <div className="text-sm font-semibold text-blue-800">投资视角结论</div>
                <div className="mt-2 space-y-2 text-sm text-blue-900">
                  <div>• 短期判断：{stock.summary.totalRiskScore > stock.summary.totalPositiveScore ? '当前风险端仍更占主导，适合先看风险是否扩散。' : '当前亮点端更占优势，但仍需验证兑现质量。'}</div>
                  <div>• 中期影响：{stock.summary.totalRiskScore > stock.summary.totalPositiveScore ? '若高分风险不缓解，估值与预期仍容易承压。' : '若亮点持续兑现，估值中枢有望获得支撑。'}</div>
                  <div>• 关键观察点：</div>
                  <ul className="ml-4 list-disc">
                    {stock.highlights.slice(0, 3).flatMap((h) => (h.factors || []).slice(0, 1)).map((f, i) => <li key={`${f}-${i}`}>{f}</li>)}
                  </ul>
                </div>
              </div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-bold tracking-tight">{stock.name}</h2>
                  <Badge variant="outline" className="rounded-full">{stock.code}</Badge>
                  <Badge variant="secondary" className="rounded-full">{stock.industry}</Badge>
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{stock.marketImpression}</p>
                <div className="mt-5 rounded-2xl bg-slate-900 p-4 text-white md:p-5">
                  <div className="flex items-center gap-2 text-sm text-slate-300"><Sparkles className="h-4 w-4" /> 今日摘要</div>
                  <div className="mt-2 text-lg font-semibold leading-8">{stock.headline}</div>
                </div>
              </motion.div>

              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader><SectionTitle icon={BarChart3} title="风险 / 亮点趋势" subtitle="支持查看强度变化，便于回顾动态演变" /></CardHeader>
                  <CardContent>
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={stock.trend || []}>
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip />
                          <Line type="monotone" dataKey="risk" strokeWidth={2.5} dot={false} />
                          <Line type="monotone" dataKey="positive" strokeWidth={2.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader><SectionTitle icon={ShieldAlert} title="多维看点画像" subtitle="把复杂信息压缩成可横向比较的维度" /></CardHeader>
                  <CardContent>
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={stock.radar || []}>
                          <PolarGrid />
                          <PolarAngleAxis dataKey="k" />
                          <PolarRadiusAxis />
                          <Radar dataKey="v" fillOpacity={0.22} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
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
                <CardHeader><SectionTitle icon={History} title="变化解释（WHY CHANGE）" subtitle="直接说明近阶段强弱变化是由哪些看点驱动的" /></CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-red-50 p-4">
                      <div className="text-sm font-semibold text-red-800">风险变化解释</div>
                      <p className="mt-2 text-sm leading-6 text-red-900">
                        {compareSummary.riskDelta > 0 ? (
                          <>
                            近阶段风险强度上升，主要由
                            <button className="mx-1 underline font-medium" onClick={() => {
                              const target = stock.highlights.find((h) => h.label === compareSummary.strengthenedLabels[0]);
                              if (target) setActiveHighlight(target);
                            }}>
                              {compareSummary.strengthenedLabels[0] || '高分风险持续强化'}
                            </button>
                            驱动。若对应事件继续扩散，风险端仍可能维持高位。
                          </>
                        ) : compareSummary.riskDelta < 0 ? '近阶段风险强度有所缓和，说明部分高压因素未继续恶化，但仍需观察是否出现反复。' : '近阶段风险强度整体平稳，说明高分风险尚未出现明显扩散或解除。'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-4">
                      <div className="text-sm font-semibold text-emerald-800">亮点变化解释</div>
                      <p className="mt-2 text-sm leading-6 text-emerald-900">
                        {compareSummary.positiveDelta > 0 ? (
                          <>
                            近阶段亮点强度提升，主要来自
                            <button className="mx-1 underline font-medium" onClick={() => {
                              const target = stock.highlights.find((h) => h.label === compareSummary.addedLabels[0]);
                              if (target) setActiveHighlight(target);
                            }}>
                              {compareSummary.addedLabels[0] || '新增亮点兑现'}
                            </button>
                            的强化，说明市场开始交易修复或成长预期。
                          </>
                        ) : compareSummary.positiveDelta < 0 ? '近阶段亮点强度回落，说明前期预期未继续强化，需警惕亮点进入兑现空窗。' : '近阶段亮点强度整体稳定，说明当前亮点仍停留在原有阶段，尚未出现明显强化或弱化。'}
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
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stock.outlook?.consensus || '数据暂不可用'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-semibold">短期预期</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stock.outlook?.shortTerm || '数据暂不可用'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-semibold">估值变化预期</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stock.outlook?.valuation || '数据暂不可用'}</p>
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
                    const matched = stock.highlights.find((h) => h.id === item.highlightId) || stock.highlights.find((h) => h.label === item.label && h.side === item.side) || stock.highlights.find((h) => h.label === item.label);
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
