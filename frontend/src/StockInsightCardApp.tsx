import { startTransition, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Bot,
  ChevronDown,
  ExternalLink,
  Heart,
  HelpCircle,
  Loader2,
  RefreshCcw,
  Search,
  Settings2,
  Star,
} from 'lucide-react';

import { useStockHighlights } from './hooks/useStockHighlights';
import { useStockSearch } from './hooks/useStockSearch';
import type {
  AnalysisProfile,
  EvidenceItem,
  HighlightItem,
  SearchStock,
  StockHighlightsResponse,
} from './lib/types';

const RECENT_STOCKS_KEY = 'stock-highlights:recent-stocks:v2';
const WATCHLIST_KEY = 'stock-highlights:watchlist:v2';
const ACTIVE_MODEL_PROFILE_KEY = 'stock-highlights:active-model-profile:v2';
const CUSTOM_MODEL_PROFILES_KEY = 'stock-highlights:custom-model-profiles:v3';

type ModelPreset = {
  id: string;
  label: string;
  vendor: string;
  baseUrl: string;
  model: string;
  note: string;
  kind: AnalysisProfile['kind'];
};

type CustomProfileForm = {
  id?: string;
  label: string;
  vendor: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  kind: AnalysisProfile['kind'];
};

const BUILTIN_MODEL_PROFILES: AnalysisProfile[] = [
  {
    id: 'server-auto',
    label: 'HF 免费优先',
    kind: 'free',
    mode: 'server',
    vendor: '',
    model: '',
    note: '服务端按可用性自动选择免费模型。',
  },
  {
    id: 'server-hf-qwen25',
    label: 'Qwen2.5 72B',
    kind: 'free',
    mode: 'server',
    vendor: 'huggingface',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    note: '中文理解稳定，适合投资要点提炼。',
  },
  {
    id: 'server-hf-qwen3',
    label: 'Qwen3 32B',
    kind: 'free',
    mode: 'server',
    vendor: 'huggingface',
    model: 'Qwen/Qwen3-32B',
    note: '速度更轻，适合快速复核。',
  },
];

const CUSTOM_MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'openai',
    label: 'ChatGPT / OpenAI',
    vendor: 'openai',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    kind: 'api',
    note: '兼容 OpenAI Chat Completions。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    vendor: 'deepseek',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    kind: 'api',
    note: '支持 deepseek-chat / deepseek-reasoner。',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    vendor: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-2.0-flash',
    kind: 'api',
    note: '使用 Google OpenAI 兼容入口。',
  },
  {
    id: 'qwen',
    label: 'Qwen / DashScope',
    vendor: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    kind: 'api',
    note: '阿里云百炼 OpenAI 兼容模式，可改成 qwen3 系列。',
  },
  {
    id: 'local',
    label: '本地兼容接口',
    vendor: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'qwen3:8b',
    kind: 'local',
    note: '仅在服务端能访问该地址时可用。',
  },
  {
    id: 'compatible',
    label: '其他兼容接口',
    vendor: 'openai-compatible',
    baseUrl: '',
    model: '',
    kind: 'api',
    note: '填写任意 OpenAI-compatible 地址。',
  },
];

type SourceRef = {
  number: number;
  evidence: EvidenceItem;
  side: 'positive' | 'risk' | 'neutral';
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function customFormFromPreset(preset: ModelPreset): CustomProfileForm {
  return {
    label: preset.label,
    vendor: preset.vendor,
    model: preset.model,
    baseUrl: preset.baseUrl,
    apiKey: '',
    kind: preset.kind,
  };
}

function customFormFromProfile(profile: AnalysisProfile): CustomProfileForm {
  return {
    id: profile.id,
    label: profile.label,
    vendor: profile.vendor || 'openai-compatible',
    model: profile.model || '',
    baseUrl: profile.baseUrl || '',
    apiKey: profile.apiKey || '',
    kind: profile.kind,
  };
}

function customProfileFromForm(form: CustomProfileForm): AnalysisProfile {
  const label = form.label.trim() || CUSTOM_MODEL_PRESETS.find((preset) => preset.vendor === form.vendor)?.label || '自定义模型';
  return {
    id: form.id || `custom-${Date.now()}`,
    label,
    kind: form.kind,
    mode: 'custom',
    vendor: form.vendor.trim() || 'openai-compatible',
    model: form.model.trim(),
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey.trim(),
    note: `${form.vendor || 'OpenAI-compatible'} · ${form.model.trim() || '未填写模型'}`,
  };
}

function mergeModelProfiles(customProfiles: AnalysisProfile[]) {
  const custom = customProfiles.filter((profile) => profile.mode === 'custom' && profile.baseUrl && profile.model);
  return [...BUILTIN_MODEL_PROFILES, ...custom];
}

function presetIdForVendor(vendor: string) {
  return CUSTOM_MODEL_PRESETS.find((preset) => preset.vendor === vendor)?.id || 'compatible';
}

function pctText(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function pctClass(value: number) {
  if (value > 0) return 'border-red-400/30 bg-red-500/10 text-red-200';
  if (value < 0) return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
}

function impactLevel(score: number) {
  if (score >= 80) return '高';
  if (score >= 60) return '中';
  return '低';
}

function sideLabel(side: HighlightItem['side']) {
  return side === 'positive' ? '亮点' : '风险';
}

function refKey(evidence: EvidenceItem) {
  return `${evidence.url || ''}|${evidence.source || ''}|${evidence.title || ''}|${evidence.published_at || ''}`;
}

function makeCitationIndex(data: StockHighlightsResponse | null) {
  const refs: SourceRef[] = [];
  const map = new Map<string, SourceRef>();
  if (!data) return { refs, map };

  const add = (evidence: EvidenceItem | undefined, side: SourceRef['side']) => {
    if (!evidence || !evidence.title) return;
    const key = refKey(evidence);
    if (map.has(key)) return;
    const item = { number: refs.length + 1, evidence, side };
    refs.push(item);
    map.set(key, item);
  };

  data.highlights
    .filter((item) => item.side === 'positive')
    .forEach((item) => item.evidence?.forEach((evidence) => add(evidence, 'positive')));
  data.highlights
    .filter((item) => item.side === 'risk')
    .forEach((item) => item.evidence?.forEach((evidence) => add(evidence, 'risk')));
  data.liveNews.forEach((news) =>
    add(
      {
        source: news.source || '资讯',
        title: news.title,
        published_at: news.time,
        url: news.url,
      },
      'neutral',
    ),
  );

  return { refs, map };
}

function citationColor(side: SourceRef['side']) {
  if (side === 'positive') return 'text-red-300 hover:text-red-100';
  if (side === 'risk') return 'text-sky-300 hover:text-sky-100';
  return 'text-amber-300 hover:text-amber-100';
}

function Citation({
  evidence,
  map,
  onOpen,
}: {
  evidence?: EvidenceItem;
  map: Map<string, SourceRef>;
  onOpen: (ref: SourceRef) => void;
}) {
  if (!evidence) return null;
  const ref = map.get(refKey(evidence));
  if (!ref) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(ref)}
      className={`ml-1 align-super text-[11px] font-bold ${citationColor(ref.side)}`}
      title="查看依据"
    >
      [{ref.number}]
    </button>
  );
}

function SectionTitle({
  title,
  note,
  tone = 'cyan',
}: {
  title: string;
  note?: string;
  tone?: 'cyan' | 'red' | 'sky' | 'amber';
}) {
  const colors = {
    cyan: 'text-cyan-300',
    red: 'text-red-300',
    sky: 'text-sky-300',
    amber: 'text-amber-300',
  };
  return (
    <div className="mb-4 flex items-center gap-2">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      {note ? (
        <span className={`group relative inline-flex ${colors[tone]}`}>
          <HelpCircle className="h-4 w-4" />
          <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-64 -translate-x-1/2 rounded-lg border border-white/10 bg-slate-950 p-3 text-xs leading-relaxed text-slate-200 shadow-xl group-hover:block">
            {note}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function StockButton({ stock, onSelect }: { stock: SearchStock; onSelect: (stock: SearchStock) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(stock)}
      className="flex items-center justify-between rounded-lg border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-left transition hover:border-cyan-400/50 hover:bg-cyan-500/10"
    >
      <span>
        <span className="font-semibold text-white">{stock.name}</span>
        <span className="ml-2 text-sm text-slate-400">{stock.code}</span>
      </span>
      <span className={`rounded-full border px-2 py-0.5 text-xs ${pctClass(stock.pct)}`}>{pctText(stock.pct)}</span>
    </button>
  );
}

function InsightItem({
  item,
  citations,
  onCitation,
  onOpen,
}: {
  item: HighlightItem;
  citations: Map<string, SourceRef>;
  onCitation: (ref: SourceRef) => void;
  onOpen: (item: HighlightItem) => void;
}) {
  const isPositive = item.side === 'positive';
  const border = isPositive ? 'border-red-400/20 bg-red-500/[0.06]' : 'border-sky-400/20 bg-sky-500/[0.06]';
  const chip = isPositive ? 'border-red-400/25 text-red-200' : 'border-sky-400/25 text-sky-200';
  const evidence = item.evidence?.[0];

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`w-full rounded-lg border p-4 text-left transition hover:border-white/25 ${border}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-white">{item.label}</div>
          <div className="mt-1 text-xs text-slate-400">{item.category || sideLabel(item.side)}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${chip}`}>
          影响{impactLevel(item.score)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-7 text-slate-200">
        {item.thesis || item.why || '[数据暂不可用]'}
        <Citation evidence={evidence} map={citations} onOpen={onCitation} />
      </p>
      <p className="mt-2 text-sm leading-7 text-slate-400">
        判断依据：{item.importance || item.interpretation || '[数据暂不可用]'}
        <Citation evidence={evidence} map={citations} onOpen={onCitation} />
      </p>
    </button>
  );
}

function FutureOutlookBlock({ data }: { data: StockHighlightsResponse }) {
  const outlook = data.futureOutlook;
  return (
    <section className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
      <SectionTitle title="未来预期" note="包含共识、1-3个月催化和估值变化；缺失数据会直接标注。" tone="amber" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.06] p-4">
          <div className="text-sm text-amber-200">分析师共识</div>
          <div className="mt-2 text-2xl font-semibold text-white">{outlook?.analystConsensus?.stance || '[数据暂不可用]'}</div>
          <p className="mt-3 text-sm leading-7 text-slate-300">{outlook?.analystConsensus?.rationale || '[数据暂不可用]'}</p>
        </div>
        <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.06] p-4">
          <div className="text-sm text-cyan-200">短期预期</div>
          <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-300">
            {(outlook?.shortTermOutlook?.catalysts?.length ? outlook.shortTermOutlook.catalysts : ['[数据暂不可用]']).map(
              (item) => (
                <li key={item}>{item}</li>
              ),
            )}
          </ul>
          <p className="mt-3 text-sm leading-7 text-slate-400">{outlook?.shortTermOutlook?.earningsExpectation || '[数据暂不可用]'}</p>
        </div>
        <div className="rounded-lg border border-red-400/20 bg-red-500/[0.06] p-4">
          <div className="text-sm text-red-200">估值变化预期</div>
          <p className="mt-3 text-sm leading-7 text-slate-300">{outlook?.valuationOutlook?.currentLevel || '[数据暂不可用]'}</p>
          <p className="mt-3 text-sm leading-7 text-slate-300">目标区间：{outlook?.valuationOutlook?.targetRange || '[数据暂不可用]'}</p>
          <div className="mt-3 grid gap-3 text-sm leading-7 text-slate-400">
            <p>上行驱动：{outlook?.valuationOutlook?.upsideDrivers?.join('；') || '[数据暂不可用]'}</p>
            <p>下行风险：{outlook?.valuationOutlook?.downsideRisks?.join('；') || '[数据暂不可用]'}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SupplementalTracking({ data }: { data: StockHighlightsResponse }) {
  const concepts = useMemo(() => {
    const seeds = [
      ...data.highlights.map((item) => item.category || item.label),
      data.boardContext?.boardName,
      data.boardContext?.industry,
    ]
      .filter(Boolean)
      .map((item) => String(item).replace(/事件|风险|改善|兑现/g, '').trim())
      .filter((item) => item && item !== '深A');
    return Array.from(new Set(seeds)).slice(0, 3);
  }, [data]);

  const linkedStocks = data.boardContext?.linkedStocks || [];
  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-slate-900/55 p-5">
        <SectionTitle title="补充跟踪" note="用核心概念和联动股辅助复核，不替代四块主卡片。" tone="cyan" />
        <div className="flex flex-wrap gap-2">
          {(concepts.length ? concepts : ['[数据暂不可用]']).map((concept) => (
            <button
              key={concept}
              type="button"
              onClick={() => window.open(`https://www.baidu.com/s?wd=${encodeURIComponent(`${concept} A股 概念`)}`, '_blank')}
              className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-sm text-cyan-100 hover:border-cyan-300"
            >
              {concept}
            </button>
          ))}
        </div>
        <div className="mt-5 space-y-2">
          <div className="text-sm font-semibold text-white">同概念联动候选</div>
          {linkedStocks.length ? (
            linkedStocks.slice(0, 5).map((stock) => (
              <button
                key={`${stock.code}-${stock.name}`}
                type="button"
                onClick={() =>
                  window.open(
                    `${window.location.origin}${window.location.pathname}?q=${encodeURIComponent(stock.code || stock.name)}`,
                    '_blank',
                  )
                }
                className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-slate-950/60 px-3 py-3 text-left hover:border-cyan-400/40"
              >
                <span>
                  <span className="font-semibold text-white">{stock.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{stock.code}</span>
                  <span className="mt-1 block text-xs text-slate-400">{stock.reason}</span>
                </span>
                <span className={stock.pct == null ? 'text-slate-400' : stock.pct >= 0 ? 'text-red-300' : 'text-emerald-300'}>
                  {stock.pct == null ? '--' : pctText(stock.pct)}
                </span>
              </button>
            ))
          ) : (
            <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-400">[数据暂不可用]</div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-slate-900/55 p-5">
        <SectionTitle title="补充验证" note="按时间倒序展示少量增量资讯，只作为验证线索。" tone="amber" />
        <div className="space-y-3">
          {data.liveNews.slice(0, 4).map((news) => (
            <a
              key={`${news.time}-${news.title}`}
              href={news.url || undefined}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border border-white/10 bg-slate-950/60 p-3 hover:border-amber-400/40"
            >
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-amber-400/20 px-2 py-0.5 text-amber-200">{news.tag || '增量'}</span>
                <span>{news.time}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-200">{news.title}</p>
            </a>
          ))}
          {!data.liveNews.length ? <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-400">[数据暂不可用]</div> : null}
        </div>
      </section>
    </aside>
  );
}

export default function StockInsightCardApp() {
  const initialQuery = new URLSearchParams(window.location.search).get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<SearchStock | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchlist, setWatchlist] = useState<SearchStock[]>(() => loadJson(WATCHLIST_KEY, []));
  const [recent, setRecent] = useState<SearchStock[]>(() => loadJson(RECENT_STOCKS_KEY, []));
  const [activeProfileId, setActiveProfileId] = useState(() => window.localStorage.getItem(ACTIVE_MODEL_PROFILE_KEY) || 'server-auto');
  const [modelProfiles, setModelProfiles] = useState<AnalysisProfile[]>(() => mergeModelProfiles(loadJson(CUSTOM_MODEL_PROFILES_KEY, [])));
  const [selectedPresetId, setSelectedPresetId] = useState(CUSTOM_MODEL_PRESETS[0].id);
  const [customForm, setCustomForm] = useState<CustomProfileForm>(() => customFormFromPreset(CUSTOM_MODEL_PRESETS[0]));
  const [sourceRef, setSourceRef] = useState<SourceRef | null>(null);
  const [detailItem, setDetailItem] = useState<HighlightItem | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const initialAutoSelectRef = useRef(Boolean(initialQuery));

  const activeProfile = useMemo(
    () => modelProfiles.find((profile) => profile.id === activeProfileId) || modelProfiles[0] || BUILTIN_MODEL_PROFILES[0],
    [activeProfileId, modelProfiles],
  );
  const { results, loading: searching, error: searchError } = useStockSearch(query);
  const { data, loading, error, refreshAnalysis } = useStockHighlights(selected?.code || '', activeProfile);
  const { refs, map: citationMap } = useMemo(() => makeCitationIndex(data), [data]);

  const positives = useMemo(() => (data?.highlights || []).filter((item) => item.side === 'positive').slice(0, 5), [data]);
  const risks = useMemo(() => (data?.highlights || []).filter((item) => item.side === 'risk').slice(0, 5), [data]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      startTransition(() => setQuery(event.key));
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!initialAutoSelectRef.current || selected || !results.length) return;
    initialAutoSelectRef.current = false;
    selectStock(results[0]);
  }, [results, selected]);

  useEffect(() => {
    saveJson(WATCHLIST_KEY, watchlist);
  }, [watchlist]);

  useEffect(() => {
    saveJson(RECENT_STOCKS_KEY, recent);
  }, [recent]);

  useEffect(() => {
    saveJson(
      CUSTOM_MODEL_PROFILES_KEY,
      modelProfiles.filter((profile) => profile.mode === 'custom'),
    );
  }, [modelProfiles]);

  function activateProfile(profile: AnalysisProfile) {
    setActiveProfileId(profile.id);
    window.localStorage.setItem(ACTIVE_MODEL_PROFILE_KEY, profile.id);
    if (profile.mode === 'custom') {
      setCustomForm(customFormFromProfile(profile));
      setSelectedPresetId(presetIdForVendor(profile.vendor));
    }
  }

  function applyPreset(preset: ModelPreset) {
    setSelectedPresetId(preset.id);
    setCustomForm((form) => ({
      ...customFormFromPreset(preset),
      id: form.id,
      apiKey: preset.vendor === form.vendor ? form.apiKey : '',
    }));
  }

  function saveCustomProfile() {
    const profile = customProfileFromForm(customForm);
    if (!profile.baseUrl || !profile.model) return;
    setModelProfiles((profiles) => {
      const builtins = profiles.filter((item) => item.mode !== 'custom');
      const custom = profiles.filter((item) => item.mode === 'custom' && item.id !== profile.id);
      return [...builtins, profile, ...custom].slice(0, 15);
    });
    activateProfile(profile);
  }

  function selectStock(stock: SearchStock) {
    setSelected(stock);
    setWatchOpen(false);
    setRecent((items) => [stock, ...items.filter((item) => item.code !== stock.code)].slice(0, 8));
    window.history.replaceState({}, '', `${window.location.pathname}?q=${encodeURIComponent(stock.code)}`);
  }

  function toggleWatchlist() {
    if (!selected) return;
    setWatchlist((items) =>
      items.some((item) => item.code === selected.code)
        ? items.filter((item) => item.code !== selected.code)
        : [selected, ...items.filter((item) => item.code !== selected.code)].slice(0, 12),
    );
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    const first = results[0];
    if (first) selectStock(first);
  }

  const watched = selected ? watchlist.some((item) => item.code === selected.code) : false;

  return (
    <div className="min-h-screen bg-[#050816] text-slate-100">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3">
          <h1 className="text-2xl font-semibold text-white">AI个股看点</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModelOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 hover:border-cyan-300"
              title="AI研判"
            >
              <Bot className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-slate-900 text-slate-300"
              title="帮助"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
        </header>

        <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-500/10 text-cyan-200">
              <Search className="h-5 w-5" />
            </div>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="输入股票代码或简称，例如 002083 孚日股份"
              className="h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 text-base text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setWatchOpen((value) => !value)}
            className="mt-3 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200"
          >
            <HistoryIcon />
            观察列表（{watchlist.length + recent.length}）
            <ChevronDown className={`h-4 w-4 transition ${watchOpen ? 'rotate-180' : ''}`} />
          </button>
          {watchOpen ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
                  <Heart className="h-4 w-4" />
                  自选
                </div>
                <div className="grid gap-2">{watchlist.map((stock) => <StockButton key={stock.code} stock={stock} onSelect={selectStock} />)}</div>
              </div>
              <div>
                <div className="mb-2 text-sm text-slate-400">最近查看</div>
                <div className="grid gap-2">{recent.map((stock) => <StockButton key={stock.code} stock={stock} onSelect={selectStock} />)}</div>
              </div>
            </div>
          ) : null}
          {query.trim() && results.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {results.slice(0, 8).map((stock) => (
                <StockButton key={stock.code} stock={stock} onSelect={selectStock} />
              ))}
            </div>
          ) : null}
          {searching ? <div className="mt-3 text-sm text-slate-400">正在搜索...</div> : null}
          {searchError ? <div className="mt-3 text-sm text-red-300">{searchError}</div> : null}
        </section>

        {!selected ? (
          <section className="mt-6 rounded-xl border border-dashed border-white/10 p-10 text-center text-slate-400">
            选择一只股票后生成市场印象、亮点、风险和未来预期。
          </section>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <section className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-4xl font-semibold text-white">{data?.stock.name || selected.name}</h2>
                <span className={`rounded-full border px-4 py-2 text-2xl font-semibold ${pctClass(data?.pctChange ?? selected.pct)}`}>
                  {(data?.price || selected.price || 0).toFixed(2)} {pctText(data?.pctChange ?? selected.pct)}
                </span>
                <button
                  type="button"
                  onClick={toggleWatchlist}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${
                    watched ? 'border-amber-400/30 bg-amber-500/15 text-amber-200' : 'border-white/10 bg-slate-900 text-slate-400'
                  }`}
                  title="自选"
                >
                  <Star className="h-5 w-5" fill={watched ? 'currentColor' : 'none'} />
                </button>
                <span className="text-sm text-slate-400">
                  {data?.stock.code || selected.code} · {data?.stock.industry || selected.industry || 'A股'}
                </span>
              </div>

              {loading ? (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-6 text-slate-300">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  正在生成个股看点...
                </div>
              ) : null}
              {error ? <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-red-200">{error}</div> : null}

              {data ? (
                <>
                  <section className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
                    <SectionTitle title="市场印象" note="先回答市场如何给这家公司定位，再给出核心认知。" tone="cyan" />
                    <h3 className="text-2xl font-semibold text-white">{data.headline || `${data.stock.name}投资要点`}</h3>
                    <p className="mt-4 text-base leading-8 text-slate-200">{data.marketImpression || '[数据暂不可用]'}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
                        <div className="text-xs text-slate-500">PE-TTM</div>
                        <div className="mt-1 text-lg font-semibold text-white">{data.valuationSnapshot?.pe || '[数据暂不可用]'}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
                        <div className="text-xs text-slate-500">PB</div>
                        <div className="mt-1 text-lg font-semibold text-white">{data.valuationSnapshot?.pb || '[数据暂不可用]'}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
                        <div className="text-xs text-slate-500">ROE</div>
                        <div className="mt-1 text-lg font-semibold text-white">{data.valuationSnapshot?.roe || '[数据暂不可用]'}</div>
                      </div>
                    </div>
                  </section>

                  <div className="grid gap-6 md:grid-cols-2">
                    <section className="rounded-xl border border-red-400/20 bg-red-500/[0.04] p-5">
                      <SectionTitle title="亮点" note="保留最重要的3-5条正向因素，每条带影响程度和依据。" tone="red" />
                      <div className="space-y-3">
                        {positives.length ? (
                          positives.map((item) => (
                            <InsightItem key={item.id} item={item} citations={citationMap} onCitation={setSourceRef} onOpen={setDetailItem} />
                          ))
                        ) : (
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-4 text-slate-400">[数据暂不可用]</div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-5">
                      <SectionTitle title="风险" note="保留最需要防守的3-5条风险，每条带影响程度和依据。" tone="sky" />
                      <div className="space-y-3">
                        {risks.length ? (
                          risks.map((item) => (
                            <InsightItem key={item.id} item={item} citations={citationMap} onCitation={setSourceRef} onOpen={setDetailItem} />
                          ))
                        ) : (
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-4 text-slate-400">[数据暂不可用]</div>
                        )}
                      </div>
                    </section>
                  </div>

                  <FutureOutlookBlock data={data} />
                </>
              ) : null}
            </section>

            {data ? <SupplementalTracking data={data} /> : null}
          </div>
        )}
      </main>

      {sourceRef ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={() => setSourceRef(null)}>
          <div
            className="max-h-[90vh] w-[min(96vw,34rem)] overflow-y-auto rounded-xl border border-white/10 bg-slate-950 p-5 text-slate-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={`text-sm font-semibold ${citationColor(sourceRef.side)}`}>来源 [{sourceRef.number}]</div>
                <h3 className="mt-2 text-lg font-semibold text-white">{sourceRef.evidence.title}</h3>
              </div>
              <button type="button" onClick={() => setSourceRef(null)} className="text-slate-400 hover:text-white">
                关闭
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <p>来源：{sourceRef.evidence.source || '[数据暂不可用]'}</p>
              <p>时间：{sourceRef.evidence.published_at || '[数据暂不可用]'}</p>
              {sourceRef.evidence.url ? (
                <a href={sourceRef.evidence.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-200 hover:text-cyan-100">
                  打开原始来源 <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="text-slate-500">原始链接暂不可用。</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {detailItem ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={() => setDetailItem(null)}>
          <div
            className="max-h-[90vh] w-[min(96vw,46rem)] overflow-y-auto rounded-xl border border-white/10 bg-slate-950 p-5 text-slate-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={detailItem.side === 'positive' ? 'text-sm font-semibold text-red-300' : 'text-sm font-semibold text-sky-300'}>
                  {sideLabel(detailItem.side)} · 影响{impactLevel(detailItem.score)}
                </div>
                <h3 className="mt-2 text-2xl font-semibold text-white">{detailItem.label}</h3>
              </div>
              <button type="button" onClick={() => setDetailItem(null)} className="text-slate-400 hover:text-white">
                关闭
              </button>
            </div>
            <div className="mt-5 space-y-5 text-sm leading-7 text-slate-300">
              <p>{detailItem.thesis || detailItem.why}</p>
              <p>判断依据：{detailItem.importance || detailItem.interpretation || '[数据暂不可用]'}</p>
              <div>
                <div className="mb-2 font-semibold text-white">证据链</div>
                <div className="space-y-2">
                  {(detailItem.evidenceChain?.length ? detailItem.evidenceChain : ['[数据暂不可用]']).map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                      {item}
                      <Citation evidence={detailItem.evidence?.[index] || detailItem.evidence?.[0]} map={citationMap} onOpen={setSourceRef} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {modelOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={() => setModelOpen(false)}>
          <div
            className="max-h-[90vh] w-[min(96vw,52rem)] overflow-y-auto rounded-xl border border-white/10 bg-slate-950 p-5 text-slate-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-white">AI 模型接口</h3>
                <p className="mt-1 text-sm text-slate-400">
                  当前：{activeProfile.label} · {data?.analysisMode === 'ai' ? data.analysisModel || 'AI' : '规则回退'}
                </p>
              </div>
              <button type="button" onClick={() => setModelOpen(false)} className="text-slate-400 hover:text-white">
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {modelProfiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => activateProfile(profile)}
                  className={`rounded-lg border p-4 text-left ${
                    profile.id === activeProfileId
                      ? 'border-cyan-400/50 bg-cyan-500/10'
                      : 'border-white/10 bg-slate-900/70 hover:border-white/25'
                  }`}
                >
                  <div className="font-semibold text-white">{profile.label}</div>
                  <div className="mt-1 text-sm text-slate-400">{profile.note}</div>
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">自定义接口</div>
                  <div className="text-xs text-slate-400">API Key 仅保存在当前浏览器，并随请求发给后端调用模型。</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {CUSTOM_MODEL_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        selectedPresetId === preset.id
                          ? 'border-cyan-300 bg-cyan-400/15 text-cyan-100'
                          : 'border-white/10 bg-slate-950 text-slate-300 hover:border-white/25'
                      }`}
                      title={preset.note}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-slate-400">
                  显示名称
                  <input
                    value={customForm.label}
                    onChange={(event) => setCustomForm((form) => ({ ...form, label: event.target.value }))}
                    className="h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                    placeholder="例如 DeepSeek 短线分析"
                  />
                </label>
                <label className="space-y-1 text-xs text-slate-400">
                  模型名
                  <input
                    value={customForm.model}
                    onChange={(event) => setCustomForm((form) => ({ ...form, model: event.target.value }))}
                    className="h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                    placeholder="deepseek-chat / gemini-2.0-flash / qwen-plus"
                  />
                </label>
                <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">
                  接口地址
                  <input
                    value={customForm.baseUrl}
                    onChange={(event) => setCustomForm((form) => ({ ...form, baseUrl: event.target.value }))}
                    className="h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                    placeholder="https://api.deepseek.com/chat/completions"
                  />
                </label>
                <label className="space-y-1 text-xs text-slate-400">
                  API Key
                  <input
                    value={customForm.apiKey}
                    onChange={(event) => setCustomForm((form) => ({ ...form, apiKey: event.target.value }))}
                    className="h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                    placeholder="sk-..."
                    type="password"
                    autoComplete="off"
                  />
                </label>
                <label className="space-y-1 text-xs text-slate-400">
                  类型
                  <select
                    value={customForm.kind}
                    onChange={(event) => setCustomForm((form) => ({ ...form, kind: event.target.value as AnalysisProfile['kind'] }))}
                    className="h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-400"
                  >
                    <option value="api">API</option>
                    <option value="local">本地</option>
                  </select>
                </label>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={saveCustomProfile}
                  disabled={!customForm.baseUrl.trim() || !customForm.model.trim()}
                  className="rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  保存并使用
                </button>
                {activeProfile.mode === 'custom' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setModelProfiles((profiles) => profiles.filter((profile) => profile.id !== activeProfile.id));
                      activateProfile(BUILTIN_MODEL_PROFILES[0]);
                    }}
                    className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100"
                  >
                    删除当前自定义
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refreshAnalysis()}
                disabled={!selected}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 disabled:opacity-40"
              >
                <RefreshCcw className="h-4 w-4" />
                重算 AI
              </button>
              {data?.analysisPending ? <span className="text-sm text-amber-200">AI正在生成，稍后自动刷新。</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HistoryIcon() {
  return <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px]">↺</span>;
}
