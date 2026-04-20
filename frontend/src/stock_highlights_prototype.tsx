import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

import { useStockHighlights } from './hooks/useStockHighlights';
import { useStockSearch } from './hooks/useStockSearch';
import type { HighlightItem, SearchStock } from './lib/types';
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

const sideMeta = {
  risk: {
    icon: AlertTriangle,
    chip: 'bg-red-100 text-red-700 border-red-200',
    panel: 'border-red-200 bg-red-50/80',
    label: '风险',
  },
  positive: {
    icon: Sparkles,
    chip: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    panel: 'border-emerald-200 bg-emerald-50/80',
    label: '亮点',
  },
} as const;

function sentimentLabel(sentiment: 'positive' | 'negative' | 'neutral') {
  if (sentiment === 'positive') return '偏正向';
  if (sentiment === 'negative') return '偏谨慎';
  return '中性';
}

function percentText(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function SummaryCard({
  title,
  value,
  helper,
}: {
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <Card className="rounded-3xl border-white/10 bg-white/5 text-white shadow-none">
      <CardHeader className="pb-3">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{title}</div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
        <p className="mt-2 text-sm text-slate-400">{helper}</p>
      </CardContent>
    </Card>
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
              <DialogTitle className="flex items-center gap-2">
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
                <div className="text-sm font-semibold text-slate-900">分析解读</div>
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
                      {evidence.url && (
                        <a
                          className="inline-flex items-center gap-1 text-xs text-slate-500 underline"
                          href={evidence.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          原文 <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
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

export default function StockHighlightsPrototype() {
  const [query, setQuery] = useState('');
  const [selectedStock, setSelectedStock] = useState<SearchStock | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<HighlightItem | null>(null);

  const { results, loading: searchLoading, error: searchError } = useStockSearch(query);
  const { data, loading, error } = useStockHighlights(selectedStock?.code ?? '');

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

  const sortedHighlights = useMemo(
    () => [...(data?.highlights ?? [])].sort((left, right) => right.score - left.score),
    [data?.highlights],
  );

  const handleSelectStock = (stock: SearchStock) => {
    setSelectedStock(stock);
    setQuery(`${stock.code} ${stock.name}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (results[0]) {
      handleSelectStock(results[0]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 space-y-3">
          <Badge className="bg-cyan-400/15 text-cyan-300">Single Hugging Face Space</Badge>
          <h1 className="text-4xl font-semibold tracking-tight">Stock Highlights</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-400">
            聚焦股票搜索、公告亮点、市场情绪和实时快讯。当前页面只消费后端真实提供的接口，
            不再依赖未实现的历史、快照和对比功能。
          </p>
        </div>

        <Card className="rounded-3xl border-white/10 bg-white/5 text-white shadow-none">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-cyan-400/15 p-3 text-cyan-300">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-semibold">搜索股票</div>
                <div className="text-sm text-slate-400">支持代码、名称和拼音缩写</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleSubmit}>
              <Input
                className="h-12 rounded-2xl border-white/10 bg-slate-900 text-white placeholder:text-slate-500"
                placeholder="输入股票代码或简称"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button className="h-12 rounded-2xl bg-cyan-400 text-slate-950 hover:bg-cyan-300" type="submit">
                {searchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                查询
              </Button>
            </form>

            {(searchLoading || results.length > 0 || searchError) && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3">
                {searchLoading && <div className="text-sm text-slate-400">正在获取候选股票...</div>}
                {!searchLoading && searchError && <div className="text-sm text-red-300">{searchError}</div>}
                {!searchLoading && !searchError && results.length === 0 && query.trim() && (
                  <div className="text-sm text-slate-400">没有匹配到结果。</div>
                )}
                {!searchLoading && results.length > 0 && (
                  <div className="grid gap-2">
                    {results.slice(0, 8).map((stock) => (
                      <button
                        key={stock.code}
                        className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
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
                          <div className={stock.pct >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                            {percentText(stock.pct || 0)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {!selectedStock && (
          <Card className="mt-8 rounded-3xl border-dashed border-white/10 bg-transparent text-white shadow-none">
            <CardContent className="py-16 text-center text-slate-400">
              先选择一只股票，再查看公告亮点、市场印象和实时快讯。
            </CardContent>
          </Card>
        )}

        {selectedStock && (
          <div className="mt-8 space-y-8">
            {loading && (
              <Card className="rounded-3xl border-white/10 bg-white/5 text-white shadow-none">
                <CardContent className="flex items-center gap-3 py-10 text-slate-300">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  正在拉取后端数据...
                </CardContent>
              </Card>
            )}

            {error && !loading && (
              <Card className="rounded-3xl border-red-400/30 bg-red-500/10 text-white shadow-none">
                <CardContent className="py-6 text-sm text-red-200">{error}</CardContent>
              </Card>
            )}

            {data && displayStock && !loading && (
              <>
                <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
                  <Card className="rounded-3xl border-white/10 bg-white/5 text-white shadow-none lg:col-span-1">
                    <CardHeader className="space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-3xl font-semibold">{displayStock.name}</div>
                          <div className="mt-2 text-sm text-slate-400">
                            {displayStock.code} · {displayStock.industry}
                          </div>
                        </div>
                        <Badge className="bg-slate-800 text-slate-200">{sentimentLabel(data.summary.sentiment)}</Badge>
                      </div>
                      <div>
                        <div className="text-4xl font-semibold">{data.price.toFixed(2)}</div>
                        <div className={data.pctChange >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                          {percentText(data.pctChange)}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-6 text-slate-300">{data.marketImpression}</p>
                    </CardContent>
                  </Card>

                  <SummaryCard
                    title="风险事件"
                    value={String(data.summary.riskCount)}
                    helper="来自公告规则识别的风险项数量"
                  />
                  <SummaryCard
                    title="亮点事件"
                    value={String(data.summary.positiveCount)}
                    helper="来自公告规则识别的正向项数量"
                  />
                  <SummaryCard
                    title="市场情绪"
                    value={sentimentLabel(data.summary.sentiment)}
                    helper="按亮点和风险事件数量做的粗略归纳"
                  />
                </div>

                <div className="grid gap-8 xl:grid-cols-[1.5fr_1fr]">
                  <div className="space-y-8">
                    <Card className="rounded-3xl border-white/10 bg-white/5 text-white shadow-none">
                      <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                          <div className="text-lg font-semibold">公告亮点</div>
                          <div className="text-sm text-slate-400">仅展示后端已识别的公告事件</div>
                        </div>
                        <Badge className="bg-slate-800 text-slate-200">{sortedHighlights.length} 条</Badge>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {sortedHighlights.length === 0 && (
                          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
                            当前没有命中规则的公告亮点。
                          </div>
                        )}

                        {sortedHighlights.map((item) => {
                          const meta = sideMeta[item.side];
                          const Icon = meta.icon;
                          return (
                            <div key={item.id} className={`rounded-3xl border p-5 ${meta.panel}`}>
                              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge className={meta.chip}>
                                      <Icon className="mr-1 h-3.5 w-3.5" />
                                      {meta.label}
                                    </Badge>
                                    <Badge variant="outline">Score {item.score}</Badge>
                                    <Badge variant="outline">{item.category}</Badge>
                                  </div>
                                  <div className="text-xl font-semibold text-slate-950">{item.label}</div>
                                  <p className="text-sm leading-6 text-slate-700">{item.why}</p>
                                  <p className="text-sm leading-6 text-slate-600">{item.interpretation}</p>
                                </div>
                                <Button
                                  className="rounded-2xl"
                                  variant="outline"
                                  onClick={() => setActiveHighlight(item)}
                                >
                                  查看详情
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>

                    <Card className="rounded-3xl border-white/10 bg-white/5 text-white shadow-none">
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <div className="rounded-2xl bg-cyan-400/15 p-3 text-cyan-300">
                            <TrendingUp className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-lg font-semibold">雷达概览</div>
                            <div className="text-sm text-slate-400">后端返回的基础维度评分</div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {data.radar.map((point) => (
                          <RadarMeter key={point.k} label={point.k} value={point.v} />
                        ))}
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="rounded-3xl border-white/10 bg-white/5 text-white shadow-none">
                    <CardHeader>
                      <div className="text-lg font-semibold">实时快讯</div>
                      <div className="text-sm text-slate-400">当前接入财联社电报聚合结果</div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {data.liveNews.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
                          暂时没有匹配到快讯。
                        </div>
                      )}

                      {data.liveNews.map((news) => (
                        <a
                          key={`${news.url}-${news.time}`}
                          className="block rounded-2xl border border-white/10 bg-slate-900/70 p-4 transition hover:border-white/20"
                          href={news.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="bg-slate-800 text-slate-200">{news.source}</Badge>
                            {news.tag ? <Badge variant="outline">{news.tag}</Badge> : null}
                            <span className="text-xs text-slate-500">{news.time}</span>
                          </div>
                          <div className="mt-3 text-sm leading-6 text-slate-200">{news.title}</div>
                        </a>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </div>
        )}

        <HighlightDetailsDialog item={activeHighlight} onClose={() => setActiveHighlight(null)} />
      </div>
    </div>
  );
}
