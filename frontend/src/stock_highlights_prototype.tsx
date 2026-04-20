import { startTransition, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  Flame,
  Heart,
  HelpCircle,
  History,
  Loader2,
  RefreshCcw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';

import { useStockHighlights } from './hooks/useStockHighlights';
import { useStockSearch } from './hooks/useStockSearch';
import type { AnalysisProfile, HighlightItem, SearchStock, StockHighlightsResponse } from './lib/types';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader } from './components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Input } from './components/ui/input';

const RECENT_STOCKS_KEY = 'stock-highlights:recent-stocks';
const WATCHLIST_KEY = 'stock-highlights:watchlist';
const MODEL_PROFILES_KEY = 'stock-highlights:model-profiles';
const ACTIVE_MODEL_PROFILE_KEY = 'stock-highlights:active-model-profile';

const DEFAULT_MODEL_PROFILES: AnalysisProfile[] = [
  {
    id: 'server-auto',
    label: '系统自动',
    kind: 'api',
    mode: 'server',
    vendor: '',
    model: '',
    note: '按服务器优先级自动选择可用模型。',
  },
  {
    id: 'server-deepseek',
    label: 'DeepSeek 推理',
    kind: 'api',
    mode: 'server',
    vendor: 'deepseek',
    model: 'deepseek-reasoner',
    note: '偏判断力，适合短线结论。',
  },
  {
    id: 'server-hf-free',
    label: 'HF 免费备选',
    kind: 'free',
    mode: 'server',
    vendor: 'huggingface',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    note: '用服务端 Hugging Face Router 兜底。',
  },
];

const sideMeta = {
  risk: {
    icon: AlertTriangle,
    chip: 'bg-emerald-500/12 text-emerald-300 border-emerald-400/20',
    panel: 'border-emerald-400/20 bg-emerald-500/8',
    label: '风险',
  },
  positive: {
    icon: Sparkles,
    chip: 'bg-red-500/12 text-red-300 border-red-400/20',
    panel: 'border-red-400/20 bg-red-500/8',
    label: '看点',
  },
} as const;

const profileKindLabel: Record<AnalysisProfile['kind'], string> = {
  free: '免费',
  api: 'API',
  local: '本地',
};

function sentimentLabel(sentiment: 'positive' | 'negative' | 'neutral') {
  if (sentiment === 'positive') return '偏强';
  if (sentiment === 'negative') return '偏弱';
  return '中性';
}

function percentText(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function priceTextClass(value: number) {
  if (value > 0) return 'text-red-300';
  if (value < 0) return 'text-emerald-300';
  return 'text-slate-300';
}

function priceBadgeClass(value: number) {
  if (value > 0) return 'border-red-400/20 bg-red-500/12 text-red-300';
  if (value < 0) return 'border-emerald-400/20 bg-emerald-500/12 text-emerald-300';
  return 'border-slate-500/20 bg-slate-500/12 text-slate-300';
}

function getSentimentStage(data: StockHighlightsResponse) {
  if (data.summary.sentiment === 'positive') {
    if (data.pctChange >= 5) {
      return {
        title: '情绪升温',
        description: '价格和看点同步强化，短线更像情绪加速段，但追高风险也在抬升。',
      };
    }
    if (data.pctChange > 0) {
      return {
        title: '发酵中',
        description: '当前偏强但未完全一致，适合盯量价和后续消息确认。',
      };
    }
    return {
      title: '分歧博弈',
      description: '看点存在，但价格反馈偏弱，说明市场认可度还在拉扯。',
    };
  }

  if (data.summary.sentiment === 'negative') {
    if (data.pctChange <= -5) {
      return {
        title: '情绪退潮',
        description: '风险事件主导，负反馈已经兑现到价格，优先控制回撤。',
      };
    }
    return {
      title: '承压观察',
      description: '短线风险偏好不足，先看是否有修复催化再决定是否继续跟踪。',
    };
  }

  return {
    title: '等待选择',
    description: '当前没有形成单边预期，更适合等待新消息或盘口确认方向。',
  };
}

function getShortlinePhase(data: StockHighlightsResponse, highlights: HighlightItem[]) {
  const positiveCount = highlights.filter((item) => item.side === 'positive').length;
  const riskCount = highlights.filter((item) => item.side === 'risk').length;
  const newsCount = data.liveNews.length;

  if (data.summary.sentiment === 'positive') {
    if (data.pctChange >= 7 && positiveCount >= 2) {
      return {
        label: '高潮',
        action: '只适合盯强，不适合无条件追高。',
        reason: '价格和看点同时很强，说明市场已经给出高溢价，但过热回落风险也在同步放大。',
        tone: 'hot' as const,
      };
    }

    if (data.pctChange >= 2 && (positiveCount >= 1 || newsCount >= 2)) {
      return {
        label: '发酵',
        action: '重点看是否继续扩散和获得承接。',
        reason: '正向催化正在形成一致预期，最关键的是后续还能不能继续被市场买单。',
        tone: 'warm' as const,
      };
    }

    return {
      label: '启动',
      action: '先观察量价确认，再决定是否升级关注。',
      reason: '有正向信号，但价格反馈和情绪一致性还不够强，更像刚开始被注意到。',
      tone: 'warm' as const,
    };
  }

  if (data.summary.sentiment === 'negative') {
    if (data.pctChange <= -6 || riskCount >= 2) {
      return {
        label: '退潮',
        action: '先防守，等风险释放后再看是否有修复。',
        reason: '风险事件或负反馈已经压制了短线预期，当前更像情绪撤退阶段。',
        tone: 'cold' as const,
      };
    }

    return {
      label: '分歧转弱',
      action: '先看能否止跌和减弱负面扩散。',
      reason: '市场开始犹豫，负面因素尚未完全定价结束，预期容易继续走弱。',
      tone: 'cold' as const,
    };
  }

  return {
    label: '分歧',
    action: '等待一侧先赢，别在模糊阶段仓促下判断。',
    reason: '当前多空没有形成单边预期，更适合等待新的价格或消息确认。',
    tone: 'neutral' as const,
  };
}

function getShortlineChecklist(data: StockHighlightsResponse, highlights: HighlightItem[]) {
  const topItems = highlights.slice(0, 3);
  const fallback = [
    '先看消息是否继续扩散，避免只看单条标题就下结论。',
    '盯住量价反馈，短线逻辑没被价格承接时要降低预期。',
    '优先观察高分事件是否有后续跟进，而不是一次性刺激。',
  ];

  if (topItems.length === 0) {
    return fallback;
  }

  const checklist = topItems.map((item) => `${item.label}：${item.game_view}`);
  if (data.liveNews.length > 0) {
    checklist.push(`快讯联动：最近 ${data.liveNews.length} 条实时消息，注意是否形成板块共振。`);
  }
  return checklist.slice(0, 4);
}

function getShortlineSignal(data: StockHighlightsResponse, highlights: HighlightItem[]) {
  const positiveScore = highlights
    .filter((item) => item.side === 'positive')
    .slice(0, 3)
    .reduce((total, item) => total + item.score, 0);
  const riskScore = highlights
    .filter((item) => item.side === 'risk')
    .slice(0, 3)
    .reduce((total, item) => total + item.score, 0);

  const rawScore =
    50 +
    positiveScore * 0.18 -
    riskScore * 0.16 +
    Math.min(data.liveNews.length * 4, 14) +
    Math.max(Math.min(data.pctChange * 2.5, 16), -16);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  if (score >= 72) {
    return {
      score,
      tone: 'strong' as const,
      title: '可重点跟踪',
      summary: '当前驱动、价格和消息形成了相对一致的短线合力，但要防止情绪过热后的回落。',
    };
  }

  if (score >= 48) {
    return {
      score,
      tone: 'watch' as const,
      title: '边走边看',
      summary: '有看点但一致性还不够，适合观察是否继续获得价格承接和消息扩散。',
    };
  }

  return {
    score,
    tone: 'weak' as const,
    title: '先观察不着急',
    summary: '当前短线合力偏弱，更适合等待下一条催化或更明确的价格反馈。',
  };
}

function getInvalidationSignals(data: StockHighlightsResponse, highlights: HighlightItem[]) {
  const signals: string[] = [];
  const topRisk = highlights.filter((item) => item.side === 'risk').slice(0, 2);

  topRisk.forEach((item) => {
    signals.push(`${item.label}继续发酵，短线预期会明显转弱。`);
  });

  if (data.summary.sentiment === 'positive' && data.pctChange <= 0) {
    signals.push('正向逻辑如果持续拿不到价格承接，主线强度会快速下降。');
  }

  if (data.liveNews.length === 0) {
    signals.push('当前缺少实时增量消息，若后续没有扩散，容易从看点变成孤立事件。');
  }

  if (signals.length === 0) {
    signals.push('暂未看到明显失效信号，重点还是盯价格是否继续强化。');
  }

  return signals.slice(0, 3);
}

function getNextTriggers(data: StockHighlightsResponse, highlights: HighlightItem[]) {
  const triggers: string[] = [];
  const topPositive = highlights.filter((item) => item.side === 'positive').slice(0, 2);

  topPositive.forEach((item) => {
    triggers.push(`继续跟踪 ${item.label} 是否出现后续公告、快讯或板块联动。`);
  });

  if (data.pctChange > 0) {
    triggers.push('观察后续是否继续放量、是否还能维持红盘强势。');
  } else {
    triggers.push('观察是否出现修复性拉升，确认市场是否愿意重新定价。');
  }

  if (data.liveNews.length > 0) {
    triggers.push('留意实时快讯是否从个股扩散到板块或龙头映射。');
  }

  return triggers.slice(0, 3);
}

function phaseBadgeClass(tone: 'hot' | 'warm' | 'cold' | 'neutral') {
  if (tone === 'hot') return 'border-red-400/20 bg-red-500/12 text-red-300';
  if (tone === 'warm') return 'border-amber-400/20 bg-amber-500/12 text-amber-300';
  if (tone === 'cold') return 'border-emerald-400/20 bg-emerald-500/12 text-emerald-300';
  return 'border-white/10 bg-white/5 text-slate-200';
}

function loadSavedArray<T>(key: string, limit: number): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    window.localStorage.removeItem(key);
    return [];
  }
}

function SummaryTile({
  title,
  value,
  helper,
}: {
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{helper}</div>
    </div>
  );
}

function RadarMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-medium text-white">{Math.round(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function HighlightDetailsDialog({
  item,
  onClose,
}: {
  item: HighlightItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl border-slate-200 bg-white sm:max-w-2xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{item.label}</span>
                <Badge className={sideMeta[item.side].chip}>{sideMeta[item.side].label}</Badge>
                <Badge variant="outline">Score {item.score}</Badge>
              </DialogTitle>
              <DialogDescription>{item.category}</DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">触发原因</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.why}</p>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">短线解读</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.interpretation}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.game_view}</p>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-semibold text-slate-900">证据来源</div>
                {item.evidence.map((evidence) => (
                  <div key={`${item.id}-${evidence.url}`} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{evidence.source}</Badge>
                      <span className="text-xs text-slate-500">{evidence.published_at}</span>
                      {evidence.url ? (
                        <a
                          className="inline-flex items-center gap-1 text-xs text-slate-500 underline"
                          href={evidence.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          原文 <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{evidence.title}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModelManagerDialog({
  open,
  onOpenChange,
  profiles,
  activeProfileId,
  onSelect,
  onCreate,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: AnalysisProfile[];
  activeProfileId: string;
  onSelect: (profileId: string) => void;
  onCreate: (profile: Omit<AnalysisProfile, 'id'>) => void;
  onRemove: (profileId: string) => void;
}) {
  const [form, setForm] = useState({
    label: '',
    kind: 'api' as AnalysisProfile['kind'],
    model: '',
    baseUrl: '',
    apiKey: '',
    note: '',
  });

  const resetForm = () => {
    setForm({
      label: '',
      kind: 'api',
      model: '',
      baseUrl: '',
      apiKey: '',
      note: '',
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.label.trim() || !form.model.trim() || !form.baseUrl.trim()) {
      return;
    }

    onCreate({
      label: form.label.trim(),
      kind: form.kind,
      mode: 'custom',
      vendor: 'openai-compatible',
      model: form.model.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      note: form.note.trim(),
    });
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-slate-200 bg-white sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>模型工作台</DialogTitle>
          <DialogDescription>
            用于选择默认分析模型，或添加你自己的 OpenAI 兼容模型端点。
            如果是本地模型，请提供当前 Hugging Face Space 能访问到的地址，而不是你电脑的 localhost。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="text-sm font-semibold text-slate-900">当前可用配置</div>
            <div className="grid gap-3">
              {profiles.map((profile) => {
                const active = profile.id === activeProfileId;
                const isBuiltin = DEFAULT_MODEL_PROFILES.some((item) => item.id === profile.id);
                return (
                  <div
                    key={profile.id}
                    className={`rounded-3xl border p-4 ${
                      active ? 'border-cyan-400/60 bg-cyan-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-slate-900">{profile.label}</div>
                          <Badge variant="outline">{profileKindLabel[profile.kind]}</Badge>
                          <Badge variant="outline">{profile.mode === 'server' ? '服务端' : '自定义端点'}</Badge>
                        </div>
                        <div className="mt-2 text-sm text-slate-600">
                          {profile.vendor || 'server-auto'} / {profile.model || '按服务器优先级自动选择'}
                        </div>
                        {profile.note ? <div className="mt-2 text-sm text-slate-500">{profile.note}</div> : null}
                        {profile.baseUrl ? (
                          <div className="mt-2 break-all text-xs text-slate-400">{profile.baseUrl}</div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          className="rounded-2xl"
                          onClick={() => onSelect(profile.id)}
                        >
                          {active ? '当前使用中' : '切换为默认'}
                        </Button>
                        {!isBuiltin ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl"
                            onClick={() => onRemove(profile.id)}
                          >
                            删除
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-sm font-semibold text-slate-900">添加自定义模型</div>
            <form className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">名称</label>
                <Input
                  placeholder="例如：本地 Qwen 32B"
                  value={form.label}
                  onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">类型</label>
                <select
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={form.kind}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, kind: event.target.value as AnalysisProfile['kind'] }))
                  }
                >
                  <option value="free">免费</option>
                  <option value="api">API</option>
                  <option value="local">本地</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">模型名</label>
                <Input
                  placeholder="例如：qwen-plus 或 Qwen/Qwen2.5-72B-Instruct"
                  value={form.model}
                  onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">兼容 OpenAI 的 API 地址</label>
                <Input
                  placeholder="例如：https://your-endpoint.example.com/v1/chat/completions"
                  value={form.baseUrl}
                  onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">API Key</label>
                <Input
                  placeholder="可选；本地无鉴权端点可留空"
                  type="password"
                  value={form.apiKey}
                  onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">备注</label>
                <textarea
                  className="min-h-[96px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="例如：适合情绪总结，速度慢但质量高。"
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                />
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                本地模型说明：当前应用部署在 Hugging Face Space，服务端无法直接访问你电脑上的 localhost。
                如果想用本地模型，请提供局域网、反向代理或其他可访问地址。
              </div>

              <Button className="w-full rounded-2xl" type="submit">
                保存并加入列表
              </Button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function StockHighlightsPrototype() {
  const [query, setQuery] = useState('');
  const [selectedStock, setSelectedStock] = useState<SearchStock | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<HighlightItem | null>(null);
  const [recentStocks, setRecentStocks] = useState<SearchStock[]>([]);
  const [watchlist, setWatchlist] = useState<SearchStock[]>([]);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiInsightOpen, setAiInsightOpen] = useState(false);
  const [modelProfiles, setModelProfiles] = useState<AnalysisProfile[]>(DEFAULT_MODEL_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState(DEFAULT_MODEL_PROFILES[0].id);

  const { results, loading: searchLoading, error: searchError } = useStockSearch(query);
  const activeProfile =
    modelProfiles.find((profile) => profile.id === activeProfileId) || DEFAULT_MODEL_PROFILES[0];
  const { data, loading, error, refreshAnalysis } = useStockHighlights(selectedStock?.code ?? '', activeProfile);

  useEffect(() => {
    setRecentStocks(loadSavedArray<SearchStock>(RECENT_STOCKS_KEY, 6));
    setWatchlist(loadSavedArray<SearchStock>(WATCHLIST_KEY, 12));

    try {
      const rawProfiles = window.localStorage.getItem(MODEL_PROFILES_KEY);
      const savedActiveProfile = window.localStorage.getItem(ACTIVE_MODEL_PROFILE_KEY);
      if (rawProfiles) {
        const parsed = JSON.parse(rawProfiles) as AnalysisProfile[];
        if (Array.isArray(parsed)) {
          const customProfiles = parsed.filter(
            (profile) => !DEFAULT_MODEL_PROFILES.some((item) => item.id === profile.id),
          );
          const nextProfiles = [...DEFAULT_MODEL_PROFILES, ...customProfiles];
          setModelProfiles(nextProfiles);
          if (savedActiveProfile && nextProfiles.some((profile) => profile.id === savedActiveProfile)) {
            setActiveProfileId(savedActiveProfile);
          }
        }
      } else if (savedActiveProfile) {
        setActiveProfileId(savedActiveProfile);
      }
    } catch {
      window.localStorage.removeItem(MODEL_PROFILES_KEY);
      window.localStorage.removeItem(ACTIVE_MODEL_PROFILE_KEY);
    }
  }, []);

  const displayStock = useMemo(() => {
    if (!selectedStock && !data) {
      return null;
    }

    const fallbackName = selectedStock?.name || data?.stock.code || '';
    const resolvedName =
      data?.stock.name && data.stock.name !== data.stock.code ? data.stock.name : fallbackName;

    return {
      code: data?.stock.code || selectedStock?.code || '',
      name: resolvedName,
      industry: data?.stock.industry || selectedStock?.industry || '未分类',
    };
  }, [data, selectedStock]);

  const selectedStockForList = useMemo(() => {
    if (!displayStock) {
      return null;
    }

    return {
      code: displayStock.code,
      name: displayStock.name,
      industry: displayStock.industry,
      price: data?.price ?? selectedStock?.price ?? 0,
      pct: data?.pctChange ?? selectedStock?.pct ?? 0,
    } satisfies SearchStock;
  }, [data, displayStock, selectedStock]);

  const sortedHighlights = useMemo(
    () => [...(data?.highlights ?? [])].sort((left, right) => right.score - left.score),
    [data?.highlights],
  );

  const watched = useMemo(
    () => !!selectedStockForList && watchlist.some((item) => item.code === selectedStockForList.code),
    [selectedStockForList, watchlist],
  );

  const stageInfo = data ? getSentimentStage(data) : null;
  const phaseInfo = data ? getShortlinePhase(data, sortedHighlights) : null;
  const checklist = data ? getShortlineChecklist(data, sortedHighlights) : [];
  const shortlineSignal = data ? getShortlineSignal(data, sortedHighlights) : null;
  const invalidationSignals = data ? getInvalidationSignals(data, sortedHighlights) : [];
  const nextTriggers = data ? getNextTriggers(data, sortedHighlights) : [];

  const persistRecentStocks = (nextStock: SearchStock) => {
    setRecentStocks((current) => {
      const next = [nextStock, ...current.filter((item) => item.code !== nextStock.code)].slice(0, 6);
      window.localStorage.setItem(RECENT_STOCKS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const persistWatchlist = (next: SearchStock[]) => {
    setWatchlist(next);
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  };

  const persistProfiles = (nextProfiles: AnalysisProfile[], nextActiveProfileId = activeProfileId) => {
    setModelProfiles(nextProfiles);
    setActiveProfileId(nextActiveProfileId);
    window.localStorage.setItem(MODEL_PROFILES_KEY, JSON.stringify(nextProfiles));
    window.localStorage.setItem(ACTIVE_MODEL_PROFILE_KEY, nextActiveProfileId);
  };

  const handleSelectStock = (stock: SearchStock) => {
    startTransition(() => {
      setSelectedStock(stock);
      setQuery(`${stock.code} ${stock.name}`);
      persistRecentStocks(stock);
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (results[0]) {
      handleSelectStock(results[0]);
    }
  };

  const toggleWatchlist = () => {
    if (!selectedStockForList) {
      return;
    }

    const exists = watchlist.some((item) => item.code === selectedStockForList.code);
    const next = exists
      ? watchlist.filter((item) => item.code !== selectedStockForList.code)
      : [selectedStockForList, ...watchlist.filter((item) => item.code !== selectedStockForList.code)].slice(0, 12);

    persistWatchlist(next);
  };

  const handleCreateProfile = (profile: Omit<AnalysisProfile, 'id'>) => {
    const nextProfile: AnalysisProfile = {
      ...profile,
      id: `custom-${Date.now()}`,
    };
    const nextProfiles = [...modelProfiles, nextProfile];
    persistProfiles(nextProfiles, nextProfile.id);
  };

  const handleRemoveProfile = (profileId: string) => {
    const nextProfiles = modelProfiles.filter((profile) => profile.id !== profileId);
    const nextActiveId = activeProfileId === profileId ? DEFAULT_MODEL_PROFILES[0].id : activeProfileId;
    persistProfiles(nextProfiles, nextActiveId);
  };

  return (
    <div className="min-h-screen bg-[#060816] text-white">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid gap-4">
          <section className="space-y-4">
            <div className="flex items-center justify-between rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.96))] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-300">短线终端</Badge>
                  <div className="text-xl font-semibold tracking-tight text-white">AI 个股短线看点</div>
                </div>
              </div>
              <button
                type="button"
                aria-label="查看说明"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/20 hover:text-white"
                onClick={() => setHelpOpen(true)}
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>

            <Card className="rounded-[24px] border-white/10 bg-white/[0.03] text-white shadow-none">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="rounded-2xl bg-cyan-400/15 p-2 text-cyan-300">
                      <Search className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">快速搜股</div>
                      <div className="text-[11px] text-slate-500">代码、名称、拼音缩写</div>
                    </div>
                  </div>

                  <button
                    className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5 text-left transition hover:border-white/20 lg:self-auto"
                    onClick={() => setModelDialogOpen(true)}
                    type="button"
                  >
                    <Settings2 className="h-3.5 w-3.5 text-cyan-300" />
                    <span className="max-w-[9rem] truncate text-sm font-medium text-white">{activeProfile.label}</span>
                    <Badge className="border-white/10 bg-white/5 px-2 py-0 text-[10px] leading-5 text-slate-300">
                      {profileKindLabel[activeProfile.kind]}
                    </Badge>
                  </button>
                </div>

                <form className="flex flex-col gap-2 md:flex-row" onSubmit={handleSubmit}>
                  <Input
                    className="h-10 rounded-2xl border-white/10 bg-slate-950 text-white placeholder:text-slate-500"
                    placeholder="输入股票代码或简称，例如 600519、贵州茅台"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Button className="h-10 rounded-2xl bg-cyan-400 px-5 text-slate-950 hover:bg-cyan-300" type="submit">
                    {searchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    查询
                  </Button>
                </form>

                {watchlist.length > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <Heart className="h-3.5 w-3.5" />
                      自选观察
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {watchlist.map((stock) => (
                        <Button
                          key={stock.code}
                          type="button"
                          variant="outline"
                          className="h-8 rounded-2xl border-white/10 bg-slate-950 px-3 text-slate-200 hover:bg-slate-900"
                          onClick={() => handleSelectStock(stock)}
                        >
                          <Star className="mr-1.5 h-3.5 w-3.5 fill-current text-amber-300" />
                          {stock.name} {stock.code}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {recentStocks.length > 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <History className="h-3.5 w-3.5" />
                      最近查看
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recentStocks.map((stock) => (
                        <Button
                          key={stock.code}
                          type="button"
                          variant="outline"
                          className="h-8 rounded-2xl border-white/10 bg-slate-950 px-3 text-slate-200 hover:bg-slate-900"
                          onClick={() => handleSelectStock(stock)}
                        >
                          {stock.name} {stock.code}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {(searchLoading || results.length > 0 || searchError) && (
                  <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-2">
                    {searchLoading ? <div className="text-sm text-slate-400">正在获取候选股票...</div> : null}
                    {!searchLoading && searchError ? <div className="text-sm text-red-300">{searchError}</div> : null}
                    {!searchLoading && !searchError && results.length === 0 && query.trim() ? (
                      <div className="text-sm text-slate-400">没有匹配到结果。</div>
                    ) : null}
                    {!searchLoading && results.length > 0 ? (
                      <div className="grid gap-2">
                        {results.slice(0, 8).map((stock) => (
                          <button
                            key={stock.code}
                            className={`flex items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition ${
                              selectedStock?.code === stock.code
                                ? 'border-cyan-400/60 bg-cyan-400/10'
                                : 'border-white/10 bg-white/5 hover:border-white/20'
                            }`}
                            onClick={() => handleSelectStock(stock)}
                            type="button"
                          >
                            <div>
                              <div className="font-medium text-white">
                                {stock.name} <span className="text-slate-400">({stock.code})</span>
                              </div>
                              <div className="text-sm text-slate-400">{stock.industry || '未分类'}</div>
                            </div>
                            <div className="text-right">
                              <div className="font-medium text-white">{stock.price?.toFixed(2) ?? '--'}</div>
                              <div className={priceTextClass(stock.pct || 0)}>{percentText(stock.pct || 0)}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        {!selectedStock ? (
          <Card className="mt-6 rounded-[26px] border-dashed border-white/10 bg-transparent text-white shadow-none">
            <CardContent className="py-10 text-center text-sm text-slate-400">
              先选择一只股票，再看 AI 结论、情绪位置、核心驱动和实时快讯。
            </CardContent>
          </Card>
        ) : null}

        {selectedStock ? (
          <div className="mt-6 space-y-6">
            {loading ? (
              <Card className="rounded-[30px] border-white/10 bg-white/[0.03] text-white shadow-none">
                <CardContent className="flex items-center gap-3 py-10 text-slate-300">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  正在拉取个股看点...
                </CardContent>
              </Card>
            ) : null}

            {error && !loading ? (
              <Card className="rounded-[30px] border-red-400/30 bg-red-500/10 text-white shadow-none">
                <CardContent className="py-6 text-sm text-red-200">{error}</CardContent>
              </Card>
            ) : null}

            {data && displayStock && !loading ? (
              <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
                <section className="space-y-6">
                  <Card className="rounded-[30px] border-white/10 bg-white/[0.03] text-white shadow-none">
                    <CardHeader className="space-y-4 border-b border-white/10 pb-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-3xl font-semibold">{displayStock.name}</h2>
                            <div
                              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 ${priceBadgeClass(
                                data.pctChange,
                              )}`}
                            >
                              <span className="text-2xl font-semibold">{data.price.toFixed(2)}</span>
                              <span className="text-lg font-semibold">{percentText(data.pctChange)}</span>
                            </div>
                            <button
                              type="button"
                              aria-label={watched ? '移出自选' : '加入自选'}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/20 hover:text-white"
                              onClick={toggleWatchlist}
                            >
                              <Star className={`h-4 w-4 ${watched ? 'fill-current text-amber-300' : ''}`} />
                            </button>
                          </div>
                          <div className="text-sm text-slate-400">
                            {displayStock.code} · {displayStock.industry}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="border-white/10 bg-white/5 text-slate-200">
                            {sentimentLabel(data.summary.sentiment)}
                          </Badge>
                          <button
                            type="button"
                            className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition hover:border-white/20 ${
                              data.analysisMode === 'ai'
                                ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300'
                                : 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                            }`}
                            onClick={() => setAiInsightOpen(true)}
                          >
                            {data.analysisMode === 'ai' ? (
                              <>
                                <Bot className="mr-1 h-3.5 w-3.5" />
                                AI 研判
                              </>
                            ) : data.analysisPending ? (
                              <>
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                AI 生成中
                              </>
                            ) : (
                              <>
                                <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                                规则回退
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
                        <div className="rounded-[26px] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(34,211,238,0.12),rgba(8,47,73,0.08))] p-5">
                          <div className="mb-2 text-xs uppercase tracking-[0.22em] text-cyan-300">短线主线</div>
                          <div className="text-2xl font-semibold text-white">
                            {data.headline || 'AI 尚未生成主线，先看规则看点和快讯。'}
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-200">{data.marketImpression}</p>
                        </div>

                        <div className="rounded-[26px] border border-white/10 bg-slate-950/80 p-5">
                          <div className="text-xs uppercase tracking-[0.22em] text-slate-500">情绪位置</div>
                          <div className="mt-3 text-xl font-semibold text-white">{stageInfo?.title}</div>
                          <p className="mt-2 text-sm leading-6 text-slate-300">{stageInfo?.description}</p>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 pt-5">
                      <div className="grid gap-4 md:grid-cols-3">
                        <SummaryTile
                          title="风险事件"
                          value={String(data.summary.riskCount)}
                          helper="优先识别会压制风险偏好的公告事件。"
                        />
                        <SummaryTile
                          title="看点事件"
                          value={String(data.summary.positiveCount)}
                          helper="追踪能被市场继续买单的催化线索。"
                        />
                        <SummaryTile
                          title="当前情绪"
                          value={sentimentLabel(data.summary.sentiment)}
                          helper="优先采用 AI 结论，无结果时回退到规则统计。"
                        />
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[0.72fr_0.88fr_0.88fr]">
                        <div
                          className={`rounded-[26px] border p-5 ${
                            shortlineSignal?.tone === 'strong'
                              ? 'border-red-400/20 bg-red-500/10'
                              : shortlineSignal?.tone === 'watch'
                                ? 'border-amber-400/20 bg-amber-500/10'
                                : 'border-white/10 bg-slate-950/80'
                          }`}
                        >
                          <div className="text-xs uppercase tracking-[0.22em] text-slate-400">短线态势分</div>
                          <div className="mt-3 text-5xl font-semibold text-white">{shortlineSignal?.score ?? '--'}</div>
                          <div className="mt-3 text-base font-medium text-white">{shortlineSignal?.title}</div>
                          <p className="mt-3 text-sm leading-6 text-slate-300">{shortlineSignal?.summary}</p>
                        </div>

                        <div className="rounded-[26px] border border-white/10 bg-slate-950/80 p-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">情绪阶段</div>
                            <Badge className={phaseBadgeClass(phaseInfo?.tone || 'neutral')}>
                              {phaseInfo?.label || '观察中'}
                            </Badge>
                          </div>
                          <div className="mt-3 text-lg font-semibold text-white">{phaseInfo?.action}</div>
                          <p className="mt-2 text-sm leading-6 text-slate-300">{phaseInfo?.reason}</p>
                        </div>

                        <div className="rounded-[26px] border border-white/10 bg-slate-950/80 p-5">
                          <div className="text-xs uppercase tracking-[0.22em] text-slate-500">下一观察触发器</div>
                          <div className="mt-4 space-y-3">
                            {nextTriggers.slice(0, 4).map((item, index) => (
                              <div key={`${item}-${index}`} className="flex gap-3">
                                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-300" />
                                <div className="text-sm leading-6 text-slate-300">{item}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                    </CardContent>
                  </Card>

                  <Card className="rounded-[30px] border-white/10 bg-white/[0.03] text-white shadow-none">
                    <CardHeader className="space-y-3 border-b border-white/10 pb-5">
                      <div className="flex items-center gap-3">
                        <Flame className="h-5 w-5 text-red-300" />
                        <div>
                          <div className="text-lg font-semibold">核心驱动与观察要点</div>
                          <div className="text-sm text-slate-400">
                            把最值得短线关注的主因和失效条件压缩成可执行观察清单。
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-4 pt-6 lg:grid-cols-[1fr_1fr]">
                      <div className="space-y-3">
                        <div className="text-sm font-semibold text-slate-200">核心驱动</div>
                        {sortedHighlights.length > 0 ? (
                          sortedHighlights.slice(0, 3).map((item) => {
                            const Icon = sideMeta[item.side].icon;
                            return (
                              <button
                                key={item.id}
                                className={`w-full rounded-3xl border p-4 text-left transition hover:border-white/20 ${sideMeta[item.side].panel}`}
                                onClick={() => setActiveHighlight(item)}
                                type="button"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <Icon className="h-4 w-4" />
                                    <span className="font-medium">{item.label}</span>
                                  </div>
                                  <Badge className={sideMeta[item.side].chip}>Score {item.score}</Badge>
                                </div>
                                <div className="mt-3 text-sm leading-6 text-slate-200">{item.interpretation}</div>
                              </button>
                            );
                          })
                        ) : (
                          <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                            当前没有识别到高置信度公告驱动，先看快讯和价格反馈。
                          </div>
                        )}
                      </div>

                      <div className="space-y-3">
                        <div className="text-sm font-semibold text-slate-200">失效条件</div>
                        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-4">
                          <div className="space-y-3">
                            {invalidationSignals.map((item, index) => (
                                <div key={`${item}-${index}`} className="flex gap-3">
                                  <div className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-300" />
                                  <div className="text-sm leading-6 text-slate-300">{item}</div>
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-[30px] border-white/10 bg-white/[0.03] text-white shadow-none">
                    <CardHeader className="space-y-3 border-b border-white/10 pb-5">
                      <div className="flex items-center gap-3">
                        <Sparkles className="h-5 w-5 text-cyan-300" />
                        <div>
                          <div className="text-lg font-semibold">个股看点流</div>
                          <div className="text-sm text-slate-400">
                            按短线价值排序，只保留真正值得点开看的事件。
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-6">
                      {sortedHighlights.length === 0 ? (
                        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 text-sm text-slate-400">
                          还没有识别到可用看点，先等待新公告、快讯或价格反馈。
                        </div>
                      ) : (
                        sortedHighlights.map((item) => {
                          const Icon = sideMeta[item.side].icon;
                          return (
                            <button
                              key={item.id}
                              className={`w-full rounded-[28px] border p-5 text-left transition hover:border-white/20 ${sideMeta[item.side].panel}`}
                              onClick={() => setActiveHighlight(item)}
                              type="button"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <div className="rounded-2xl bg-white/10 p-2">
                                    <Icon className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <div className="text-lg font-semibold text-white">{item.label}</div>
                                    <div className="text-sm text-slate-300">{item.category}</div>
                                  </div>
                                </div>
                                <Badge className={sideMeta[item.side].chip}>Score {item.score}</Badge>
                              </div>
                              <div className="mt-4 text-sm leading-7 text-slate-200">{item.why}</div>
                              <div className="mt-3 text-sm leading-7 text-slate-300">{item.game_view}</div>
                            </button>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section className="space-y-6">
                  <Card className="rounded-[30px] border-white/10 bg-white/[0.03] text-white shadow-none">
                    <CardHeader className="space-y-3 border-b border-white/10 pb-5">
                      <div className="flex items-center gap-3">
                        {data.pctChange >= 0 ? (
                          <TrendingUp className="h-5 w-5 text-red-300" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-emerald-300" />
                        )}
                        <div>
                          <div className="text-lg font-semibold">情绪雷达</div>
                          <div className="text-sm text-slate-400">帮助你快速判断当前短线节奏。</div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-6">
                      {data.radar.map((point) => (
                        <RadarMeter key={point.k} label={point.k} value={point.v} />
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="rounded-[30px] border-white/10 bg-white/[0.03] text-white shadow-none">
                    <CardHeader className="space-y-3 border-b border-white/10 pb-5">
                      <div className="flex items-center gap-3">
                        <Zap className="h-5 w-5 text-amber-300" />
                        <div>
                          <div className="text-lg font-semibold">实时情绪快讯</div>
                          <div className="text-sm text-slate-400">只保留会影响短线预期的最新消息。</div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-6">
                      {data.liveNews.length === 0 ? (
                        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                          暂无实时快讯。
                        </div>
                      ) : (
                        data.liveNews.map((news, index) => (
                          <a
                            key={`${news.url}-${index}`}
                            className="block rounded-3xl border border-white/10 bg-slate-950/80 p-4 transition hover:border-white/20"
                            href={news.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                              <Badge variant="outline">{news.source}</Badge>
                              <span>{news.time}</span>
                              {news.tag ? <span>{news.tag}</span> : null}
                            </div>
                            <div className="mt-3 text-sm font-medium leading-6 text-white">{news.title}</div>
                          </a>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </section>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <HighlightDetailsDialog item={activeHighlight} onClose={() => setActiveHighlight(null)} />

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="rounded-3xl border-slate-200 bg-white sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>使用说明</DialogTitle>
            <DialogDescription>
              这个应用只服务短线观察，不追求做成大而全的资讯门户。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm leading-7 text-slate-700">
            <div>1. 先看主线和情绪，再看细节。</div>
            <div>2. 重点关注实时驱动、当前阶段和市场是否继续买单。</div>
            <div>3. AI 要给判断，不是复读资讯。</div>
            <div>4. 模型可以切换，也可以添加你自己的 OpenAI 兼容端点。</div>
            <div>5. 如果使用本地模型，请提供当前 Hugging Face Space 可以访问到的地址，而不是电脑本机的 localhost。</div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aiInsightOpen} onOpenChange={setAiInsightOpen}>
        <DialogContent className="rounded-3xl border-white/10 bg-slate-950 text-white sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>AI 研判详情</DialogTitle>
            <DialogDescription className="text-slate-400">
              模型配置、执行状态和重算入口都收在这里。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">模型配置</div>
                <div className="mt-2 font-medium text-white">{data?.analysisProfileLabel || activeProfile.label}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">执行模型</div>
                <div className="mt-2 font-medium text-white">{data?.analysisModel || '尚未返回'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">最近更新</div>
                <div className="mt-2 font-medium text-white">{data?.analysisUpdatedAt || '等待生成'}</div>
              </div>
            </div>

            {data?.analysisPending ? (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                已先返回规则结果，AI 总结生成后会自动刷新。
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button className="rounded-2xl" onClick={() => void refreshAnalysis()} type="button">
                <RefreshCcw className="mr-2 h-4 w-4" />
                重算 AI
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl border-white/10 bg-slate-950 text-slate-200 hover:bg-slate-900"
                onClick={() => {
                  setAiInsightOpen(false);
                  setModelDialogOpen(true);
                }}
              >
                <Settings2 className="mr-2 h-4 w-4" />
                切换模型
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ModelManagerDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        profiles={modelProfiles}
        activeProfileId={activeProfileId}
        onSelect={(profileId) => persistProfiles(modelProfiles, profileId)}
        onCreate={handleCreateProfile}
        onRemove={handleRemoveProfile}
      />
    </div>
  );
}
