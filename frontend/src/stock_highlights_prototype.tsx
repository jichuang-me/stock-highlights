/// <reference types="vite/client" />
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
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from './components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './components/ui/accordion';
import {
  ComposedChart,
  Line,
  Area,
  Scatter,
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

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
  lastUpdate?: string;
  sentiment?: string;
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
  game_view?: string;
  factors: string[];
  evidence: EvidenceItem[];
  history: HistoryItem[];
  priority?: number;
  freshness?: string;
};

type MarketImpression = {
  summary: string;
  positioning: string;
  attention: string;
};

type StockOutlook = {
  consensus: string;
  shortTerm: string;
  valuation: string;
};

type StockResponse = {
  stock: {
    code: string;
    name: string;
    industry?: string;
  };
  summary: Summary;
  marketImpression: MarketImpression;
  headline: string;
  price?: number;
  pctChange?: number;
  outlook: StockOutlook;
  highlights: HighlightItem[];
  radar?: Array<{ k: string; v: number }>;
  xueqiu?: {
    popularity: number;
    followers: number;
    rank: string;
    sentiment: string;
  };
  liveNews?: {
    title: string;
    time: string;
    url: string;
    source: string;
    tag?: string;
  }[];
  priceHistory?: { date: string; price: number }[];
};

type StockViewModel = {
  code: string;
  name: string;
  industry: string;
  marketImpression: MarketImpression;
  headline: string;
  price?: number;
  pctChange?: number;
  summary: Summary;
  outlook: StockOutlook;
  highlights: HighlightItem[];
  radar: Array<{ k: string; v: number }>;
  trend: Array<{ date: string; risk: number; positive: number; price?: number; isEvent?: boolean }>;
  xueqiu?: {
    popularity: number;
    followers: number;
    rank: string;
    sentiment: string;
  };
  liveNews?: {
    title: string;
    time: string;
    url: string;
    source: string;
    tag?: string;
  }[];
  priceHistory?: { date: string; price: number }[];
};

type SnapshotPoint = {
  id: string;
  timestamp: string;
  summary: Summary;
  highlights: HighlightItem[];
  price?: number;
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
  saveSnapshot(code: string, data: any) {
    return fetch(`${API_BASE_URL}/api/stocks/${encodeURIComponent(code)}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(res => res.json());
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
    鏂板: { label: '鏂板', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    鍗囩骇: { label: '鍗囩骇', className: 'bg-red-50 text-red-700 border-red-200' },
    寮哄寲: { label: '寮哄寲', className: 'bg-orange-50 text-orange-700 border-orange-200' },
    缁存寔楂樹綅: { label: '楂樹綅', className: 'bg-rose-50 text-rose-700 border-rose-200' },
    缂撳拰: { label: '缂撳拰', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    宸茶В闄? { label: '宸茶В闄?, className: 'bg-slate-100 text-slate-700 border-slate-200' },
  };
  return map[latest] || null;
}

function buildWhyTree(item?: HighlightItem | null) {
  if (!item) return [];
  const latestAction = item.history?.[item.history.length - 1]?.action || item.history?.[0]?.action || '鏂板';
  const firstEvidence = item.evidence?.[0]?.title || '鍏紑鎶湶淇℃伅';
  const firstFactor = item.factors?.[0] || '鍏抽敭褰卞搷鍥犵礌';
  return [
    `瑙﹀彂浜嬩欢锛?{firstEvidence}`,
    `璇嗗埆淇″彿锛?{firstFactor}`,
    `鐘舵€佸彉鍖栵細${latestAction}`,
    `绯荤粺鍒ゆ柇锛?{item.label}`,
    `褰卞搷缁撹锛?{item.interpretation}`,
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
    鍏徃鍏憡: 5,
    骞村害鎶ュ憡: 4,
    璐㈡姤鏁版嵁: 4,
    璐㈠姟鎸囨爣: 4,
    '娉曢櫌/鐩戠': 3,
    琛屼笟瑙傚療: 2,
    涓氬姟鍔ㄦ€? 2,
    甯傚満瑙傚療: 1,
    缁煎悎鍒ゆ柇: 1,
  };
  const weightRank: Record<string, number> = { 楂? 3, 涓? 2, 浣? 1 };
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
  const isResolved = ['宸茶В闄?, '缂撳拰'].includes(latestAction);
  const priorityLabel =
    item.side === 'risk'
      ? item.priority && item.priority >= 5
        ? '鏍稿績椋庨櫓'
        : item.priority && item.priority >= 4
        ? '閲嶇偣椋庨櫓'
        : '涓€鑸闄?
      : item.priority && item.priority >= 5
      ? '宸插己鍖栦寒鐐?
      : item.priority && item.priority >= 4
      ? '娼滃姏浜偣'
      : '涓€鑸寒鐐?;

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
              褰卞搷搴?{scoreToStars(item.stars)}
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
                    <Zap size={10} className="mr-1 inline-block" /> 娣卞害鍗氬紙
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
                <Badge variant="secondary" className="rounded-full">
                  {item.category}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-slate-600">
                褰卞搷搴?{scoreToStars(item.stars)} 路 褰卞搷鍒?{item.score}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5"><Zap size={40} /></div>
                <div className="flex items-center gap-2 text-sm font-bold text-amber-800 uppercase tracking-widest mb-3">
                  <Sparkles size={16} /> Game Insight / 鍗氬紙閫昏緫鐮斿垽
                </div>
                <p className="text-sm font-medium leading-relaxed text-amber-900 italic">
                  鈥?{item.game_view || '璇ヤ簨浠惰Е鍙戝父瑙勯€昏緫鍒ゅ畾锛屾殏鏃犳繁搴﹀崥寮堝亸绂讳俊鎭€?} 鈥?
                </p>
                <div className="mt-3 flex gap-2">
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none rounded-full text-[10px]">閫昏緫鍙嶈浆鐐?/Badge>
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none rounded-full text-[10px]">璧勯噾鍗氬紙</Badge>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-sm font-semibold">鏍稿績鍒ゆ柇</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.why}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600 font-medium">鍩烘湰闈㈣В璇伙細{item.interpretation}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(item.factors || []).map((factor) => (
                    <Badge key={factor} variant="secondary" className="rounded-full">
                      {factor}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold">鍘熷洜閾撅紙WHY TREE锛?/div>
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
                <div className="text-sm font-semibold">璇佹嵁鎽樿</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  褰撳墠鏈€寮鸿瘉鎹富瑕佹潵鑷?
                  <span className="mx-1 font-medium text-slate-900">{sortedEvidence[0]?.source || '鍏紑淇℃伅'}</span>
                  锛屾牳蹇冧緷鎹负
                  <span className="mx-1 font-medium text-slate-900">{sortedEvidence[0]?.title || '鏆傛棤鏍囬'}</span>
                  銆傝繖绫绘潵婧愰€氬父瀵圭湅鐐瑰垽鏂奖鍝嶆洿澶э紝寤鸿浼樺厛闃呰銆?
                </p>
              </div>

              <div>
                <div className="mb-3 text-sm font-semibold">璇佹嵁閾撅紙宸叉寜鏉ユ簮涓庢潈閲嶆帓搴忥級</div>
                <div className="space-y-3">
                  {sortedEvidence.map((ev, idx) => (
                    <div key={`${ev.title}-${idx}`} className="rounded-2xl border bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {idx === 0 && (
                          <Badge variant="outline" className="rounded-full bg-violet-50 text-violet-700 border-violet-200">
                            鏍稿績璇佹嵁
                          </Badge>
                        )}
                        <Badge variant="outline" className={`rounded-full ${getSourceClass(ev.source)}`}>
                          {ev.source}
                        </Badge>
                        <Badge variant="secondary" className="rounded-full">鏉冮噸 {ev.weight}</Badge>
                        <span className="text-xs text-slate-500">{ev.time}</span>
                        {ev.url && (
                          <a className="inline-flex items-center gap-1 text-xs text-slate-500 underline" href={ev.url} target="_blank" rel="noreferrer">
                            鍘熸枃 <ExternalLink className="h-3 w-3" />
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
  // 鏍稿績鐘舵€侊細鑱氬悎涓哄崟涓€浜嬪疄鏉ユ簮
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
  
  // 蹇収涓庡姣旂郴缁?(v4.0)
  const [snapshots, setSnapshots] = useState<SnapshotPoint[]>([]);
  const [compareBase, setCompareBase] = useState<SnapshotPoint | null>(null);
  const [isSnapshotDrawerOpen, setIsSnapshotDrawerOpen] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);

  // 鎼滅储鐩稿叧椤?
  const [searchResults, setSearchResults] = useState<SearchStock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isQuickSearching, setIsQuickSearching] = useState(false);
  const [quickSearchInput, setQuickSearchInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compareWindow, setCompareWindow] = useState('1m');

  // 鍏ㄥ眬閿洏鐩戝惉锛氱伒鍔ㄥ皬閿洏閫昏緫
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 濡傛灉宸茬粡鎵撳紑浜?Dialog锛屾垨鑰呮鍦ㄨ緭鍏ユ涓紝涓嶈Е鍙?
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || activeHighlight) {
        return;
      }

      // 濡傛灉鎸変笅鐨勬槸瀛楁瘝銆佹暟瀛?
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

  // 鍔犺浇蹇収鍒楄〃
  const loadSnapshots = async (code: string) => {
    try {
      const data = await stockHighlightsApi.getStockSnapshots(code);
      setSnapshots(data || []);
    } catch {}
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
    } catch (err) {
      alert("蹇収淇濆瓨澶辫触");
    } finally {
      setIsSavingSnapshot(false);
    }
  };


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
            industry: highlightsRes.stock.industry || '鏈垎绫昏涓?,
            marketImpression: highlightsRes.marketImpression,
            headline: highlightsRes.headline,
            summary: highlightsRes.summary,
            outlook: highlightsRes.outlook,
            highlights: highlightsRes.highlights || [],
            radar: highlightsRes.radar?.length ? highlightsRes.radar : getDefaultRadarFromSummary(highlightsRes.summary),
            trend: (highlightsRes.priceHistory || []).map(p => {
              const histDate = p.date.slice(5); // MM-DD
              // 瀵绘壘褰撳ぉ鐨勫巻鍙茶褰曪紙鑻ユ湁鏇存柊鍒欐爣璁颁负浜嬩欢锛?
              const isEvent = (history || []).some(h => h.date === p.date);
              return {
                date: histDate,
                price: p.price,
                risk: highlightsRes.summary.totalRiskScore, // 榛樿鏄剧ず褰撳墠鍒嗗€硷紝鍚庣画鍙墿灞曞巻鍙插垎鍊煎洖婧?
                positive: highlightsRes.summary.totalPositiveScore,
                isEvent: isEvent
              };
            }),
            priceHistory: highlightsRes.priceHistory,
            xueqiu: highlightsRes.xueqiu,
            liveNews: highlightsRes.liveNews
          }
        });
      } catch (err: any) {
        if (!ignore) {
          setStockState({ data: null, history: [], loading: false, error: err?.message || '鑾峰彇鏁版嵁澶辫触' });
        }
      }
    }
    fetchAll();
    loadSnapshots(selectedCode);
    setCompareBase(null); // 鍒囨崲鑲＄エ鏃堕噸缃姣?
    return () => { ignore = true; };
  }, [selectedCode]);

  const filteredHighlights = useMemo(() => {
    if (!stockState.data) return [];
    let items = [...stockState.data.highlights];
    if (sideFilter !== 'all') items = items.filter(i => i.side === sideFilter);

    const rows = items.map(item => {
      const latest = item.history?.[item.history.length - 1]?.action || item.history?.[0]?.action || '';
      let priority = 3;
      if (latest === '宸茶В闄?) priority = 0;
      else if (latest === '缂撳拰') priority = 1;
      else if (item.side === 'risk') {
        priority = item.stars >= 5 || ['鍗囩骇', '缁存寔楂樹綅'].includes(latest) ? 5 : item.stars >= 4 ? 4 : 3;
      } else {
        priority = latest === '寮哄寲' && item.stars >= 4 ? 5 : item.stars >= 3 ? 4 : 3;
      }
      return { ...item, priority, freshness: item.history?.[0]?.date || '' };
    });

    return rows.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (sortMode === 'recent') return b.freshness.localeCompare(a.freshness);
      return sortMode === 'stars' ? b.stars - a.stars : b.score - a.score;
    });
  }, [stockState.data, sideFilter, sortMode]);

  // 瀵规瘮绠楁硶 (v4.0)
  const getHighlightDiff = (item: HighlightItem) => {
    if (!compareBase) return null;
    const oldItem = compareBase.highlights.find(h => h.id === item.id);
    if (!oldItem) return 'new';
    
    if (item.side === 'risk') {
      if (item.score > oldItem.score) return 'worse';
      if (item.score < oldItem.score) return 'better';
    } else {
      if (item.score > oldItem.score) return 'better';
      if (item.score < oldItem.score) return 'worse';
    }
    
    if (item.why !== oldItem.why || item.interpretation !== oldItem.interpretation) return 'changed';
    return null;
  };

  const removedHighlights = useMemo(() => {
    if (!compareBase || !stockState.data) return [];
    return compareBase.highlights.filter(oh => !stockState.data?.highlights.some(nh => nh.id === oh.id));
  }, [compareBase, stockState.data]);

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
        .filter(i => (i.history || []).some(h => h.action === '鏂板' && h.date >= cutoffStr))
        .map(i => i.label).slice(0, 4),
      strengthenedLabels: stockState.data.highlights
        .filter(i => (i.history || []).some(h => ['鍗囩骇', '寮哄寲', '缁存寔楂樹綅'].includes(h.action) && h.date >= cutoffStr))
        .map(i => i.label).slice(0, 4),
    };
  }, [compareWindow, stockState.data]);

  const topRisk = useMemo(() => filteredHighlights.find(h => h.side === 'risk') || null, [filteredHighlights]);
  const topPositive = useMemo(() => filteredHighlights.find(h => h.side === 'positive') || null, [filteredHighlights]);

  const selectStock = (stock: SearchStock | string) => {
    const code = typeof stock === 'string' ? stock : stock.code;
    setSelectedCode(code);
    localStorage.setItem('last_stock_code', code);
    
    // 鏇存柊鏈€杩戞悳绱?
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
                <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">涓偂鏅虹瓥 <span className="mx-1 text-slate-300 font-light">|</span> <span className="text-slate-500 font-medium">绌块€忓紡鎶曠爺缁堢</span></h1>
                <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] py-0 px-2 font-bold text-emerald-700 uppercase tracking-wider animate-pulse">
                  Terminal v4.2.0 FINAL
                </Badge>
              </div>
              <p className="mt-0.5 text-xs font-medium text-slate-400">
                鍩轰簬宸ㄦ疆鐪熷疄鍏憡璇佹嵁閾剧殑娣卞害浠峰€兼寲鎺?路 鐢熶骇绾ц涔夌┛閫忕郴缁?
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <div className="text-right">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">System Status</div>
              <div className="mt-1 flex items-center justify-end gap-1.5 text-xs font-semibold text-emerald-600">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                鍚庡彴鏁版嵁閾惧凡杩炴帴
              </div>
            </div>
          </div>
        </motion.div>

        {/* 鐏靛姩灏忛敭鐩?Overlay */}
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
                  placeholder="鎼滅储浠ｇ爜銆侀瀛楁瘝鎴栧悕绉?.."
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
                        selectStock({ code: quickSearchInput, name: `浠ｇ爜 ${quickSearchInput}`, industry: '蹇€熺┛閫? });
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
                  <div className="mb-2 px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">鏈€杩戞煡鐪?RECENT_TICKERS</div>
                )}
                {isSearching && searchResults.length === 0 ? (
                  <div className="flex items-center justify-center p-12 text-slate-400">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 鏅鸿兘鎯呮姤妫€绱腑...
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
                      杈撳叆鎷奸煶棣栧瓧姣嶅 'payh' 寮€鍚悳绱?
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-slate-50/50 p-3 text-center text-[10px] text-slate-400 border-t font-mono uppercase tracking-widest">
                UP/DOWN TO SELECT 路 ENTER TO EXECUTE 路 ESC TO DISMISS
              </div>
            </motion.div>
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-400 font-medium tracking-wider uppercase">
            閿洏杈撳叆浠讳綍鍐呭鍗冲彲寮€鍚悳绱?路 鐩存帴杈撳叆 6 浣嶄唬鐮佸揩閫熻Е杈?
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border bg-white p-1">
              {['all', 'risk', 'positive'].map(val => (
                <button
                  key={val}
                  onClick={() => setSideFilter(val)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-xl transition ${sideFilter === val ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {val === 'all' ? '鍏ㄩ儴' : val === 'risk' ? '椋庨櫓' : '浜偣'}
                </button>
              ))}
            </div>
            <Select value={sortMode} onValueChange={setSortMode}>
              <SelectTrigger className="h-9 w-[160px] rounded-2xl bg-white text-sm"><SelectValue placeholder="鎺掑簭鏂瑰紡" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score">鎸夊奖鍝嶅姏</SelectItem>
                <SelectItem value="stars">鎸夋槦绾?/SelectItem>
                <SelectItem value="recent">鏈€杩戞洿鏂?/SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {stockState.loading ? (
          <div className="rounded-3xl border bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-500" />
            </div>
            <div className="text-base font-semibold">姝ｅ湪妫€绱㈢┛閫忔暟鎹?..</div>
          </div>
        ) : !stockState.data ? (
          <div className="rounded-[40px] border border-dashed border-slate-200 bg-white p-20 text-center shadow-sm">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-900 shadow-xl shadow-slate-200">
                <Activity className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Intelligent Terminal Ready</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">
                {stockState.error ? `ERR_SYSTEM: ${stockState.error}` : '绯荤粺宸插氨缁€傛鍦ㄧ洃鍚叏鍩熷叕鍛婁笌鐮旀姤鏁版嵁锛屾寜閿洏浠绘剰閿紑鍚櫤鑳介€忚鍒嗘瀽銆?}
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
              {/* v2.2.9: 鏍稿績甯傚満鍗拌薄/蹇収 (Prominent Recovery) */}
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border bg-slate-900 p-6 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Zap size={80} /></div>
                <div className="relative z-10">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-4">
                      <h2 className="text-3xl font-black tracking-tight">{stockState.data.name}</h2>
                      <span className="font-mono text-slate-400 font-bold">{stockState.data.code}</span>
                      <div className="flex items-center gap-3 ml-4 border-l border-slate-700 pl-4">
                        <span className="text-2xl font-black font-mono text-white">{stockState.data.price?.toLocaleString()}</span>
                        <span className={`text-sm font-black px-2 py-0.5 rounded-lg ${(stockState.data.pctChange || 0) >= 0 ? 'bg-red-500/20 text-red-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                          {(stockState.data.pctChange || 0) >= 0 ? '+' : ''}{stockState.data.pctChange?.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-slate-700 text-slate-400 font-mono tracking-widest text-[9px] uppercase">
                      INTELLIGENCE_LAYER_v4.1.5_STABLE
                    </Badge>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-black text-blue-400 uppercase tracking-widest">
                      <Sparkles size={14} /> Market Impression / 甯傚満鍗拌薄
                    </div>
                    <p className="text-lg font-medium leading-relaxed text-slate-100">
                      {stockState.data.marketImpression}
                    </p>
                    <div className="flex items-center gap-6 pt-2">
                       <div className="text-xs text-slate-400"><span className="font-bold text-white tracking-widest uppercase">Sentiment:</span> {stockState.data.summary.sentiment === 'bullish' ? '馃敟 鐪嬪' : '馃 涓€?鐪嬬┖'}</div>
                       <div className="text-xs text-slate-400"><span className="font-bold text-white tracking-widest uppercase">Popularity:</span> No.{stockState.data.xueqiu?.rank || 'N/A'}</div>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-4 pt-4 border-t border-slate-800">
                    <Button 
                      onClick={() => setIsSnapshotDrawerOpen(true)}
                      className="rounded-xl bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                    >
                      <History className="mr-2 h-4 w-4 text-indigo-400" />
                      鏃跺厜鏈哄巻鍙?
                      {snapshots.length > 0 && <Badge className="ml-2 bg-indigo-500/20 text-indigo-400">{snapshots.length}</Badge>}
                    </Button>
                    <Button 
                      onClick={handleSaveSnapshot}
                      disabled={isSavingSnapshot}
                      className="rounded-xl bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                    >
                      {isSavingSnapshot ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock3 className="mr-2 h-4 w-4 text-emerald-400" />}
                      灏佸瓨褰撳墠蹇収
                    </Button>
                  </div>
                </div>
              </motion.div>

              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader><SectionTitle icon={BarChart3} title="鎯呮姤瓒嬪娍" /></CardHeader>
                  <CardContent className="h-[280px] p-4">
                    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                      <ComposedChart data={stockState.data.trend || []}>
                        <defs>
                          <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tick={{fontSize: 9}} minTickGap={30} />
                        <YAxis yAxisId="left" tick={{fontSize: 10}} domain={[0, 100]} />
                        <YAxis yAxisId="right" orientation="right" tick={{fontSize: 10, fill: '#3b82f6'}} domain={['auto', 'auto']} hide={false} />
                        <Tooltip 
                          contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)', backgroundColor: 'rgba(255,255,255,0.95)'}} 
                          itemStyle={{fontSize: '12px', fontWeight: 'bold'}}
                        />
                        <Area yAxisId="right" type="monotone" dataKey="price" stroke="#3b82f6" fillOpacity={1} fill="url(#colorPrice)" name="鑲′环鍙嶅悜" />
                        <Line yAxisId="left" type="stepAfter" name="椋庨櫓鍒? dataKey="risk" stroke="#ef4444" strokeWidth={2} dot={false} />
                        <Line yAxisId="left" type="stepAfter" name="浜偣鍒? dataKey="positive" stroke="#10b981" strokeWidth={2} dot={false} />
                        {/* 浜嬩欢閿氱偣鏍囪 */}
                        <Scatter yAxisId="left" data={stockState.data.trend.filter(t => t.isEvent)} fill="#f59e0b" name="鐮斿垽鑺傜偣" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader><SectionTitle icon={ShieldAlert} title="鏁版嵁绌块€忕敾鍍? subtitle="鍩轰簬鍏憡璇佹嵁鏉冮噸鐨勬牳蹇冪淮搴﹂噺鍖? /></CardHeader>
                  <CardContent className="flex h-[320px] items-center justify-center p-4">
                    <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={stockState.data.radar || []}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="k" tick={{fontSize: 12, fontWeight: 500}} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                        <Radar name="寮哄害" dataKey="v" stroke="#0f172a" fill="#0f172a" fillOpacity={0.15} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <SectionTitle icon={FileText} title="鏍稿績鐪嬬偣鍗＄墖" />
                    <div className="flex items-center gap-2 text-sm text-slate-500"><Filter className="h-4 w-4" /> 褰撳墠鍏?{filteredHighlights.length} 鏉?/div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Accordion type="multiple" defaultValue={["risk", "positive"]} className="w-full space-y-3">
                    <AccordionItem value="risk" className="rounded-2xl border">
                      <AccordionTrigger className="px-4 text-base font-semibold">鍒嗘瀽闈細娼滃湪闅愬咖涓庨闄╃嚎绱?/AccordionTrigger>
                      <AccordionContent className="space-y-4 px-2 pb-2">
                        {filteredHighlights.filter((i) => i.side === 'risk').map((item) => (
                          <HighlightCard key={item.id} item={item} onOpen={setActiveHighlight} diff={getHighlightDiff(item)} />
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="positive" className="rounded-2xl border">
                      <AccordionTrigger className="px-4 text-base font-semibold">鍩烘湰闈細浠峰€间寒鐐逛笌鍗氬紙鏈轰細</AccordionTrigger>
                      <AccordionContent className="space-y-4 px-2 pb-2">
                        {filteredHighlights.filter((i) => i.side === 'positive').map((item) => (
                          <HighlightCard key={item.id} item={item} onOpen={setActiveHighlight} diff={getHighlightDiff(item)} />
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  {compareBase && removedHighlights.length > 0 && (
                    <div className="mt-8 pt-8 border-t border-dashed">
                      <div className="mb-4 text-xs font-bold text-slate-400 uppercase tracking-widest px-2">宸叉秷澶?宸茶В闄ょ殑鏃х湅鐐?(瀵规瘮鍘嗗彶闀滃儚)</div>
                      <div className="space-y-4 opacity-50 grayscale">
                        {removedHighlights.map((item) => (
                          <HighlightCard key={`removed-${item.id}`} item={item} onOpen={setActiveHighlight} diff="removed" />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <SectionTitle icon={TrendingUp} title="瀵规瘮妯″紡" subtitle="鐩存帴姣旇緝褰撳墠涓庤繎 1 / 3 / 6 涓湀鐨勫彉鍖? />
                    <Select value={compareWindow} onValueChange={setCompareWindow}>
                      <SelectTrigger className="h-10 w-[140px] rounded-2xl bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1m">杩?1 涓湀</SelectItem>
                        <SelectItem value="3m">杩?3 涓湀</SelectItem>
                        <SelectItem value="6m">杩?6 涓湀</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">椋庨櫓寮哄害鍙樺寲</div>
                      <div className="mt-2 text-2xl font-bold">{compareSummary.riskDelta >= 0 ? '+' : ''}{compareSummary.riskDelta}</div>
                      <p className="mt-2 text-sm text-slate-600">姝ｅ€艰〃绀洪闄╁己搴︽姮鍗囷紝璐熷€艰〃绀洪闄╃紦鍜屻€?/p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">浜偣寮哄害鍙樺寲</div>
                      <div className="mt-2 text-2xl font-bold">{compareSummary.positiveDelta >= 0 ? '+' : ''}{compareSummary.positiveDelta}</div>
                      <p className="mt-2 text-sm text-slate-600">姝ｅ€艰〃绀轰寒鐐瑰寮猴紝璐熷€艰〃绀轰寒鐐瑰噺寮便€?/p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">鏂板鐪嬬偣</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(compareSummary.addedLabels.length > 0 ? compareSummary.addedLabels : ['鏆傛棤']).map((label) => <Badge key={label} variant="secondary" className="rounded-full">{label}</Badge>)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">寮哄寲 / 鍗囩骇鐪嬬偣</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(compareSummary.strengthenedLabels.length > 0 ? compareSummary.strengthenedLabels : ['鏆傛棤']).map((label) => <Badge key={label} variant="secondary" className="rounded-full">{label}</Badge>)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={History} title="杈归檯椹卞姩鍒嗘瀽" /></CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-red-50 p-4 border border-red-100">
                      <div className="text-sm font-bold text-red-800 uppercase tracking-wider">Risk Driver</div>
                      <p className="mt-2 text-sm leading-relaxed text-red-900">
                        {compareSummary.riskDelta > 0 ? (
                          <>
                            椋庨櫓鏁炲彛鎵╁ぇ锛屼富鍥狅細
                            <button className="mx-1 underline font-bold" onClick={() => {
                              const target = stockState.data?.highlights.find(h => h.label === compareSummary.strengthenedLabels[0]);
                              if (target) setActiveHighlight(target);
                            }}>
                              {compareSummary.strengthenedLabels[0] || '鏍稿績椋庨櫓寮哄寲'}
                            </button>
                            銆傛绫诲洜瀛愬叿澶囪緝寮烘儻鎬э紝寤鸿瑙勯伩銆?
                          </>
                        ) : compareSummary.riskDelta < 0 ? '椋庨櫓绔嚭鐜拌竟闄呮敼鍠勶紝鍘熸湁楂樺帇鍥犲瓙鏈夋墍缂撹В锛屽睘浜庢闈俊鍙枫€? : '椋庨櫓鏍煎眬淇濇寔姝婚攣锛屾殏鏃犳柊澧炲啿鍑伙紝浣嗕篃鏈閫昏緫鍙嶈浆銆?}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-100">
                      <div className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Value Driver</div>
                      <p className="mt-2 text-sm leading-relaxed text-emerald-900">
                        {compareSummary.positiveDelta > 0 ? (
                          <>
                            浠峰€奸潰澧炲己锛屽姩鍔涙簮锛?
                            <button className="mx-1 underline font-bold" onClick={() => {
                              const target = stockState.data?.highlights.find(h => h.label === compareSummary.addedLabels[0]);
                              if (target) setActiveHighlight(target);
                            }}>
                              {compareSummary.addedLabels[0] || '鏂板閫昏緫纭'}
                            </button>
                            銆傚缓璁叧娉ㄤ笟缁╁厬鐜板姏搴︺€?
                          </>
                        ) : compareSummary.positiveDelta < 0 ? '浜偣閫昏緫鍑虹幇閽濆寲锛屽競鍦哄叧娉ㄥ害鍙兘鑷劧鍥炶惤锛屽缓璁鎱庤拷韪€? : '浜偣鍥犲瓙渚涢渶骞宠　锛屽浜庨€昏緫鐪熺┖鏈熴€?}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={TrendingUp} title="鏈潵棰勬湡" /></CardHeader>
                <CardContent>
                  {/* 2.2.0 鏂板锛氬疄鏃舵儏鎶ヤ华琛ㄧ洏 */}
        <div className="mb-6 grid gap-6 md:grid-cols-4">
          <Card className="col-span-1 rounded-3xl border bg-slate-900 text-white shadow-xl overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">闆悆浜烘皵姒?/span>
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-black text-emerald-400">{stockState.data.xueqiu?.rank || 'N/A'}</div>
              <div className="mt-2 text-xs text-slate-400">
                {stockState.data.xueqiu?.followers?.toLocaleString()} 浣嶆姇璧勮€呮繁搴﹀叧娉?
              </div>
              <div className="mt-4 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-1000" 
                  style={{ width: `${stockState.data.xueqiu?.popularity || 0}%` }} 
                />
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-3 rounded-3xl border shadow-sm overflow-hidden">
            <CardHeader className="py-3 bg-slate-50 border-b">
              <div className="flex items-center justify-between">
                <SectionTitle icon={Zap} title="7x24 鎯呮姤闂數娴? />
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">瀹炴椂鎯呮姤鎵弿涓?/span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[140px] overflow-y-auto overscroll-contain scrollbar-hide">
                {stockState.data.liveNews && stockState.data.liveNews.length > 0 ? (
                  stockState.data.liveNews.map((news: any, i: number) => (
                    <a 
                      key={i} 
                      href={news.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 border-b p-3 hover:bg-slate-50 transition-colors last:border-0"
                    >
                      <span className="text-[10px] font-mono font-bold text-slate-400 whitespace-nowrap">{news.time}</span>
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-bold">{news.source}</span>
                        {news.tag && (
                          <span className={`text-[9px] px-1 py-0.5 rounded font-black border ${
                            news.tag === '涓偂' ? 'border-orange-200 bg-orange-50 text-orange-600' : 'border-slate-200 bg-slate-50 text-slate-600'
                          }`}>
                            {news.tag}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-medium text-slate-700 truncate">{news.title}</span>
                      <ArrowUpRight className="h-3 w-3 text-slate-300 ml-auto" />
                    </a>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-400">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                    <p className="text-xs italic">姝ｅ湪灏濊瘯鍖归厤涓偂鍙婄浉鍏宠涓氭儏鎶?..</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-semibold">鍒嗘瀽甯堝叡璇?/div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stockState.data.outlook?.consensus || '鏁版嵁鏆備笉鍙敤'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-semibold">鐭湡棰勬湡</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stockState.data.outlook?.shortTerm || '鏁版嵁鏆備笉鍙敤'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-sm font-semibold">浼板€煎彉鍖栭鏈?/div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{stockState.data.outlook?.valuation || '鏁版嵁鏆備笉鍙敤'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={Clock3} title="鏈€杩戝姩鎬佸彉鍖? subtitle="鐩存帴鐪嬫柊澧炪€佸崌绾с€佺紦鍜岀瓑鍔ㄤ綔" /></CardHeader>
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
                            <div className="mt-1 text-sm text-slate-600">{item.action} 路 {item.desc}</div>
                          </div>
                          <ChevronRight className="mt-1 h-4 w-4 text-slate-400" />
                        </button>
                      );
                    })}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border shadow-sm">
                <CardHeader><SectionTitle icon={Sparkles} title="甯傚満鍗氬紙缁撴瀯" subtitle="璇嗗埆褰撳墠澶氱┖瀵瑰啿鐨勫叧閿富绾? /></CardHeader>
                <CardContent>
                  <div className="rounded-2xl bg-purple-50 p-4 text-sm leading-6 text-purple-900">
                    {topRisk && topPositive ? (
                      <>
                        <div>鈥?褰撳墠瀛樺湪鏄庢樉鍗氬紙锛?/div>
                        <div>椋庨櫓锛歿topRisk.label}</div>
                        <div>瀵瑰啿锛歿topPositive.label}</div>
                        <div>鈥?鍏抽敭鍒ゆ柇锛氶渶瑙傚療鍝竴鍥犵礌鍏堝厬鐜帮紝灏嗘洿澶х▼搴︿富瀵艰偂浠锋柟鍚戙€?/div>
                      </>
                    ) : (
                      <div>褰撳墠鏆傛棤鏄庢樉澶氱┖鍐茬獊缁撴瀯銆?/div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        <HighlightDialog item={activeHighlight} onClose={() => setActiveHighlight(null)} />

        {/* 鐮旂┒鏃跺厜鏈烘娊灞?- v4.0 Final */}
        <Dialog open={isSnapshotDrawerOpen} onOpenChange={setIsSnapshotDrawerOpen}>
          <DialogContent className="sm:max-w-md rounded-3xl p-6 bg-white/95 backdrop-blur-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-2xl font-black">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg">
                  <History size={20} />
                </div>
                <span>鐮旂┒鏃跺厜鏈?/span>
              </DialogTitle>
              <DialogDescription className="text-sm font-medium text-slate-500 mt-2">
                瀵规瘮涓嶅悓鐮旂┒闃舵鐨勬儏鎶ラ暅鍍忥紝鎹曟崏鍩烘湰闈㈡牳蹇冨洜瀛愮殑閲忓寲婕斿彉銆?
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 space-y-3 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
              {snapshots.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-50">
                    <Clock3 className="h-8 w-8 text-slate-200" />
                  </div>
                  <div className="text-xs font-bold uppercase tracking-widest mb-1">NO_HISTORICAL_RECORD</div>
                  <p className="text-xs">鐐瑰嚮涓嬫柟鎸夐挳淇濆瓨褰撳墠鎯呮姤浣滀负鍘嗗彶鍩哄噯鐐?/p>
                </div>
              ) : (
                snapshots.map((snap) => (
                  <div 
                    key={snap.id} 
                    className={`group relative rounded-2xl border p-4 transition-all duration-300 hover:shadow-md cursor-pointer
                      ${compareBase?.id === snap.id ? 'border-indigo-500 bg-indigo-50/50 shadow-sm ring-1 ring-indigo-500/20' : 'hover:border-indigo-200 bg-white'}
                    `}
                    onClick={() => {
                      setCompareBase(snap);
                      setIsSnapshotDrawerOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <div className="text-sm font-black text-slate-800 font-mono tracking-tight">{snap.timestamp}</div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="text-[9px] py-0 px-1.5 border-red-200 bg-red-50 text-red-600 font-black">
                            RISK {snap.summary.riskCount}
                          </Badge>
                          <Badge variant="outline" className="text-[9px] py-0 px-1.5 border-emerald-200 bg-emerald-50 text-emerald-600 font-black">
                            POS {snap.summary.positiveCount}
                          </Badge>
                          <Badge variant="outline" className="text-[9px] py-0 px-1.5 border-slate-200 bg-slate-50 text-slate-600 font-black">
                            PE {snap.price || 'N/A'}
                          </Badge>
                        </div>
                      </div>
                      <div className={`h-8 w-8 rounded-xl flex items-center justify-center transition-all ${compareBase?.id === snap.id ? 'bg-indigo-500 text-white scale-110 shadow-lg' : 'bg-slate-50 text-slate-300 group-hover:bg-indigo-100 group-hover:text-indigo-500'}`}>
                        {compareBase?.id === snap.id ? <Zap size={14} /> : <ChevronRight size={14} />}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-8 flex gap-3">
               <Button className="flex-1 rounded-2xl h-12 text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-xl" onClick={handleSaveSnapshot} disabled={isSavingSnapshot}>
                 {isSavingSnapshot ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Clock3 className="h-4 w-4 mr-2" />}
                 璁板綍褰撳墠鏈€鏂伴暅鍍?
               </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
