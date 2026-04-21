import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
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
    label: '系统免费池',
    kind: 'free',
    mode: 'server',
    vendor: '',
    model: '',
    note: '按服务器优先级自动选择可用免费模型。',
  },
  {
    id: 'server-hf-qwen25',
    label: 'HF Qwen2.5 72B',
    kind: 'free',
    mode: 'server',
    vendor: 'huggingface',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    note: '中文理解稳，适合主线提炼。',
  },
  {
    id: 'server-hf-qwen3',
    label: 'HF Qwen3 32B',
    kind: 'free',
    mode: 'server',
    vendor: 'huggingface',
    model: 'Qwen/Qwen3-32B',
    note: '速度更轻快，适合快速复盘。',
  },
  {
    id: 'server-hf-gemma3',
    label: 'HF Gemma 3 27B',
    kind: 'free',
    mode: 'server',
    vendor: 'huggingface',
    model: 'google/gemma-3-27b-it',
    note: '风格稳，适合补充第二判断。',
  },
  {
    id: 'server-hf-llama33',
    label: 'HF Llama 3.3 70B',
    kind: 'free',
    mode: 'server',
    vendor: 'huggingface',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    note: '通用能力强，适合交叉验证。',
  },
];

const DEFAULT_MODEL_PROFILE_IDS = new Set(DEFAULT_MODEL_PROFILES.map((profile) => profile.id));

function sanitizeSavedProfiles(profiles: AnalysisProfile[]) {
  return profiles.filter((profile) => {
    if (!profile || typeof profile !== 'object') {
      return false;
    }

    if (profile.mode === 'server') {
      return DEFAULT_MODEL_PROFILE_IDS.has(profile.id);
    }

    return Boolean(profile.id && profile.label && profile.model && profile.baseUrl);
  });
}

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

function shortlineScoreClass(tone?: 'strong' | 'watch' | 'weak') {
  if (tone === 'strong') return 'border-red-400/20 bg-red-500/12 text-red-300';
  if (tone === 'watch') return 'border-amber-400/20 bg-amber-500/12 text-amber-300';
  return 'border-emerald-400/20 bg-emerald-500/12 text-emerald-300';
}

function inlineInsightChipClass(kind: 'positive' | 'risk' | 'turning') {
  if (kind === 'positive') return 'border-red-400/20 bg-red-500/10 text-red-200';
  if (kind === 'risk') return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200';
  return 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200';
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

function getTurningPointGroups(data: StockHighlightsResponse, highlights: HighlightItem[]) {
  const topPositive = highlights.filter((item) => item.side === 'positive').slice(0, 2);
  const topRisk = highlights.filter((item) => item.side === 'risk').slice(0, 2);

  const upgrade: string[] = [];
  const downgrade: string[] = [];
  const invalidation: string[] = [];

  topPositive.forEach((item) => {
    upgrade.push(`如果 ${item.label} 出现后续公告、快讯或板块联动，主线大概率升级。`);
  });

  if (data.pctChange > 0) {
    upgrade.push('如果价格继续红盘放量并维持承接，短线预期会更容易从观察升级到跟踪。');
  } else {
    upgrade.push('如果价格从弱转强并出现修复性拉升，市场才会重新给这条主线更高权重。');
  }

  if (data.liveNews.length > 0) {
    upgrade.push('如果实时快讯从个股扩散到板块或龙头映射，主线强度会明显上一个台阶。');
  }

  if (data.summary.sentiment === 'positive' && data.pctChange <= 0) {
    downgrade.push('如果亮点继续拿不到价格承接，这条主线会先从发酵降级为观察。');
  }

  if (data.liveNews.length === 0) {
    downgrade.push('如果一直没有新的增量消息补强，市场注意力很容易转走。');
  } else {
    downgrade.push('如果后续快讯停止扩散，只剩孤立消息，短线热度会逐步回落。');
  }

  if (topRisk.length > 0) {
    topRisk.forEach((item) => {
      downgrade.push(`如果 ${item.label} 相关扰动继续升温，当前预期会先被压低一级。`);
      invalidation.push(`如果 ${item.label} 成为市场主导叙事，当前短线逻辑基本失效。`);
    });
  }

  if (data.summary.sentiment === 'negative' || data.pctChange <= -5) {
    invalidation.push('如果价格继续单边走弱且没有修复承接，当前观察价值会明显下降。');
  } else {
    invalidation.push('如果价格快速跌破当前承接并伴随负面扩散，主线应直接转入失效处理。');
  }

  return {
    upgrade: upgrade.slice(0, 3),
    downgrade: downgrade.slice(0, 3),
    invalidation: invalidation.slice(0, 3),
  };
}

function getFocusHighlights(highlights: HighlightItem[]) {
  const focus: HighlightItem[] = [];
  const topPositive = highlights.find((item) => item.side === 'positive');
  const topRisk = highlights.find((item) => item.side === 'risk');

  if (topPositive) {
    focus.push(topPositive);
  }

  if (topRisk) {
    focus.push(topRisk);
  }

  if (focus.length === 0) {
    return highlights.slice(0, 2);
  }

  return focus;
}

function findHighlightByLabel(highlights: HighlightItem[], side: HighlightItem['side'], label?: string | null) {
  if (!label) {
    return highlights.find((item) => item.side === side) || null;
  }

  return highlights.find((item) => item.side === side && item.label === label) || highlights.find((item) => item.side === side) || null;
}

function getChainSegment(item: HighlightItem | undefined, prefix: string) {
  if (!item) {
    return '';
  }

  const matched = item.evidenceChain.find((chainItem) => chainItem.startsWith(prefix));
  return matched ? matched.replace(`${prefix}：`, '').trim() : '';
}

type FocusNewsLink = {
  news: StockHighlightsResponse['liveNews'][number];
  linkedLabel: string;
  score: number;
};

type VerificationSignal = {
  tone: 'positive' | 'risk' | 'neutral';
  label: string;
  description: string;
  news: StockHighlightsResponse['liveNews'][number];
  linkedLabel: string;
};

function splitKeywordPhrases(value: string) {
  return value
    .split(/[，。；：、“”（）()\/\s\-·]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function buildHighlightKeywords(item: HighlightItem) {
  const phrases = new Set<string>();
  [item.label, item.category, item.why, item.thesis, ...item.evidence.map((evidence) => evidence.title)].forEach((value) => {
    splitKeywordPhrases(value).forEach((phrase) => phrases.add(phrase));
  });
  return [...phrases];
}

function scoreNewsAgainstHighlight(title: string, item: HighlightItem) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return 0;
  }

  return buildHighlightKeywords(item).reduce((total, phrase) => {
    if (normalizedTitle.includes(phrase)) {
      return total + Math.min(phrase.length, 6);
    }
    return total;
  }, 0);
}

function linkNewsToFocus(newsItems: StockHighlightsResponse['liveNews'], highlights: HighlightItem[]) {
  const positive: FocusNewsLink[] = [];
  const risk: FocusNewsLink[] = [];
  const neutral: FocusNewsLink[] = [];

  newsItems.forEach((news) => {
    let bestMatch: { item: HighlightItem; score: number } | null = null;

    highlights.forEach((item) => {
      const score = scoreNewsAgainstHighlight(news.title, item);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { item, score };
      }
    });

    if (bestMatch && bestMatch.score > 0) {
      const linked = { news, linkedLabel: bestMatch.item.label, score: bestMatch.score };
      if (bestMatch.item.side === 'positive') {
        positive.push(linked);
      } else {
        risk.push(linked);
      }
      return;
    }

    neutral.push({ news, linkedLabel: '', score: 0 });
  });

  return {
    positive: positive.slice(0, 3),
    risk: risk.slice(0, 3),
    neutral: neutral.slice(0, 3),
  };
}

function getVerificationSignals(linkedNews: ReturnType<typeof linkNewsToFocus>) {
  const signals: VerificationSignal[] = [];

  if (linkedNews.positive[0]) {
    const item = linkedNews.positive[0];
    signals.push({
      tone: 'positive',
      label: '强化主线',
      description: item.linkedLabel
        ? `这条消息继续强化“${item.linkedLabel}”这条主线。`
        : '这条消息继续强化当前主线。',
      news: item.news,
      linkedLabel: item.linkedLabel,
    });
  }

  if (linkedNews.risk[0]) {
    const item = linkedNews.risk[0];
    signals.push({
      tone: 'risk',
      label: '风险扰动',
      description: item.linkedLabel
        ? `这条消息说明“${item.linkedLabel}”相关风险正在扰动当前预期。`
        : '这条消息正在扰动当前短线预期。',
      news: item.news,
      linkedLabel: item.linkedLabel,
    });
  }

  if (linkedNews.neutral[0]) {
    const item = linkedNews.neutral[0];
    signals.push({
      tone: 'neutral',
      label: '待验证增量',
      description: '这条消息暂时还没有直接挂上主线，但值得继续观察是否升级。',
      news: item.news,
      linkedLabel: '',
    });
  }

  if (signals.length < 3) {
    const extraPool = [...linkedNews.positive.slice(1), ...linkedNews.risk.slice(1), ...linkedNews.neutral.slice(1)];
    extraPool.slice(0, 3 - signals.length).forEach((item) => {
      signals.push({
        tone: linkedNews.positive.includes(item) ? 'positive' : linkedNews.risk.includes(item) ? 'risk' : 'neutral',
        label: linkedNews.positive.includes(item)
          ? '继续强化'
          : linkedNews.risk.includes(item)
            ? '继续扰动'
            : '补充观察',
        description:
          linkedNews.positive.includes(item) && item.linkedLabel
            ? `继续补强“${item.linkedLabel}”这条线。`
            : linkedNews.risk.includes(item) && item.linkedLabel
              ? `继续观察“${item.linkedLabel}”相关扰动是否扩散。`
              : '作为补充增量，继续看它是否升级为主线证据。',
        news: item.news,
        linkedLabel: item.linkedLabel,
      });
    });
  }

  return signals.slice(0, 3);
}

function getMainlineStrength(
  data: StockHighlightsResponse,
  highlights: HighlightItem[],
  verificationSignals: VerificationSignal[],
  turningPointGroups: ReturnType<typeof getTurningPointGroups>,
) {
  const topPositive = highlights.filter((item) => item.side === 'positive').slice(0, 2);
  const topRisk = highlights.filter((item) => item.side === 'risk').slice(0, 2);
  const positiveWeight = topPositive.reduce((total, item) => total + item.score, 0);
  const riskWeight = topRisk.reduce((total, item) => total + item.score, 0);
  const positiveSignals = verificationSignals.filter((item) => item.tone === 'positive').length;
  const riskSignals = verificationSignals.filter((item) => item.tone === 'risk').length;

  const rawScore =
    50 +
    positiveWeight * 0.18 -
    riskWeight * 0.14 +
    positiveSignals * 8 -
    riskSignals * 10 +
    Math.max(Math.min(data.pctChange * 2.2, 14), -14) +
    Math.min(data.liveNews.length * 3, 9);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const upgradeHint = turningPointGroups.upgrade[0] || '继续看是否出现新的强化证据。';
  const downgradeHint = turningPointGroups.downgrade[0] || '继续看主线承接是否开始转弱。';

  if (score >= 70) {
    return {
      score,
      tone: 'red' as const,
      label: '强化中',
      summary: '当前主线处在强化段，最重要的是确认它是不是还能继续获得价格承接和增量验证。',
      drivers: [
        topPositive[0] ? `最强强化来自 ${topPositive[0].label}。` : '当前主要强化来自正向证据和价格承接。',
        positiveSignals > 0 ? '实时增量消息正在继续给主线加分。' : '当前主线更依赖已有证据，增量消息还不算密集。',
        `继续看：${upgradeHint}`,
      ],
    };
  }

  if (score >= 48) {
    return {
      score,
      tone: 'amber' as const,
      label: '待确认',
      summary: '当前主线还没有彻底走成，重点不在表态，而在继续确认强化信号有没有延续。',
      drivers: [
        topPositive[0] ? `${topPositive[0].label} 还在，但强度没有完全拉开。` : '当前还缺一条足够强的单边驱动。',
        topRisk[0] ? `${topRisk[0].label} 仍在压制预期。` : '当前主要问题是增量和承接都不算特别强。',
        `如果转弱，先看：${downgradeHint}`,
      ],
    };
  }

  return {
    score,
    tone: 'emerald' as const,
    label: '转弱',
    summary: '当前主线更像在走弱或失去承接，先防守，等下一条更强的确认信号。',
    drivers: [
      topRisk[0] ? `最主要的压制来自 ${topRisk[0].label}。` : '当前更明显的是风险反馈，而不是主线强化。',
      riskSignals > 0 ? '实时扰动已经开始压过强化信号。' : '即使没有新扰动，现有主线也缺少继续走强的证据。',
      `失守后重点看：${turningPointGroups.invalidation[0] || '主线是否继续失去价格承接。'}`,
    ],
  };
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
  onClick,
  tone = 'neutral',
}: {
  title: string;
  value: string;
  helper: string;
  onClick?: () => void;
  tone?: 'neutral' | 'cyan' | 'red' | 'emerald' | 'amber';
}) {
  const toneClass =
    tone === 'cyan'
      ? 'border-cyan-400/20 bg-cyan-500/10'
      : tone === 'red'
        ? 'border-red-400/20 bg-red-500/10'
        : tone === 'emerald'
          ? 'border-emerald-400/20 bg-emerald-500/10'
          : tone === 'amber'
            ? 'border-amber-400/20 bg-amber-500/10'
            : 'border-white/10 bg-white/[0.03]';
  const content = (
    <>
      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{helper}</div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-3xl border p-5 text-left transition hover:border-white/20 hover:bg-white/[0.05] ${toneClass}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`rounded-3xl border p-5 ${toneClass}`}>
      {content}
    </div>
  );
}

function getRadarValue(data: StockHighlightsResponse | null, label: string) {
  return data?.radar.find((point) => point.k === label)?.v ?? 0;
}

function getEmotionDrivers(data: StockHighlightsResponse, phaseInfo: ReturnType<typeof getShortlinePhase>) {
  const popularity = Math.round(getRadarValue(data, '人气热度'));
  const momentum = Math.round(getRadarValue(data, '看点强度'));
  const newsDensity = Math.round(getRadarValue(data, '消息密度'));
  const riskPressure = Math.round(getRadarValue(data, '风险压力'));
  const volatility = Math.round(getRadarValue(data, '盘中波动'));

  const drivers = [
    {
      label: '人气与关注',
      value: `${popularity}`,
      tone: popularity >= 60 ? 'text-red-300' : 'text-slate-200',
      description:
        popularity >= 60
          ? '市场关注度已经抬起来了，主线更容易继续发酵。'
          : '关注度还不够高，主线想继续走强还需要更多市场注意力。',
    },
    {
      label: '消息与催化',
      value: `${newsDensity}`,
      tone: newsDensity >= 50 ? 'text-red-300' : 'text-slate-200',
      description:
        newsDensity >= 50
          ? '当前有足够的增量消息在强化预期。'
          : '增量消息还不够密集，主线容易缺少持续强化材料。',
    },
    {
      label: '风险压力',
      value: `${riskPressure}`,
      tone: riskPressure >= 50 ? 'text-emerald-300' : 'text-slate-200',
      description:
        riskPressure >= 50
          ? '风险项已经明显抬头，任何追强都要先看负反馈会不会继续放大。'
          : '风险扰动暂时不算主导，重点还是看强势主线能否继续获得承接。',
    },
    {
      label: '波动与承接',
      value: `${volatility}`,
      tone: volatility >= 55 ? 'text-amber-300' : 'text-slate-200',
      description:
        volatility >= 55
          ? '波动较大，说明情绪交易浓度高，既可能加速也容易分歧。'
          : '波动还算可控，当前更适合观察预期是否稳步强化。',
    },
  ];

  const summary =
    momentum >= 60 && riskPressure < 45
      ? '当前更像正向主线在发酵，核心是看关注度和快讯是否继续强化。'
      : riskPressure >= 50
        ? '当前更像风险项在牵引短线预期，核心不是找新逻辑，而是看负反馈是否扩散。'
        : '当前情绪并不极端，更多是边走边看，等待下一条确认信号。';

  return { drivers, summary };
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
                  <div className="text-sm font-semibold text-slate-900">核心判断</div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{item.thesis}</p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">为什么它现在重要</div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{item.importance}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{item.interpretation}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{item.game_view}</p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">完整证据链</div>
                  <div className="mt-3 space-y-3">
                    {item.evidenceChain.map((chainItem, index) => (
                      <div key={`${item.id}-detail-chain-${index}`} className="flex gap-3">
                        <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-500" />
                        <div className="text-sm leading-6 text-slate-700">{chainItem}</div>
                      </div>
                    ))}
                  </div>
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

function EmotionDetailsDialog({
  open,
  onOpenChange,
  stageInfo,
  phaseInfo,
  emotionDrivers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageInfo: ReturnType<typeof getSentimentStage> | null;
  phaseInfo: ReturnType<typeof getShortlinePhase> | null;
  emotionDrivers: ReturnType<typeof getEmotionDrivers> | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl border-white/10 bg-slate-950 text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>当前情绪</DialogTitle>
          <DialogDescription className="text-slate-400">把情绪阶段和拆解说明放到一处，不再重复展示。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-semibold text-white">{stageInfo?.title || '观察中'}</div>
              <Badge className={phaseBadgeClass(phaseInfo?.tone || 'neutral')}>{phaseInfo?.label || '观察中'}</Badge>
            </div>
            <div className="mt-3 text-sm leading-6 text-slate-300">{stageInfo?.description}</div>
            {phaseInfo?.action ? <div className="mt-3 text-sm leading-6 text-slate-200">当前动作：{phaseInfo.action}</div> : null}
          </div>

          {emotionDrivers ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-200">
                {emotionDrivers.summary}
              </div>
              <div className="space-y-3">
                {emotionDrivers.drivers.map((driver) => (
                  <div key={driver.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{driver.label}</div>
                      <div className={`text-sm font-semibold ${driver.tone}`}>{driver.value}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">{driver.description}</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InsightDetailsDialog({
  open,
  onOpenChange,
  title,
  summary,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  summary: string;
  items: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl border-white/10 bg-slate-950 text-white sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-slate-400">{summary}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={`${title}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
              {item}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TurningPointsDialog({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ReturnType<typeof getTurningPointGroups>;
}) {
  const sections = [
    {
      title: '升级条件',
      items: groups.upgrade,
      tone: 'border-red-400/20 bg-red-500/10 text-red-200',
      dot: 'bg-red-300',
    },
    {
      title: '降级条件',
      items: groups.downgrade,
      tone: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
      dot: 'bg-amber-300',
    },
    {
      title: '失效条件',
      items: groups.invalidation,
      tone: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
      dot: 'bg-emerald-300',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl border-white/10 bg-slate-950 text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>观察转折点</DialogTitle>
          <DialogDescription className="text-slate-400">把下一步最关键的升级、降级和失效条件拆开看。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.title} className={`rounded-2xl border p-4 ${section.tone}`}>
              <div className="text-sm font-semibold">{section.title}</div>
              <div className="mt-3 space-y-3">
                {section.items.map((item, index) => (
                  <div key={`${section.title}-${index}`} className="flex gap-3">
                    <div className={`mt-2 h-2.5 w-2.5 rounded-full ${section.dot}`} />
                    <div className="text-sm leading-6">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
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
  const [listsExpanded, setListsExpanded] = useState(true);
  const [emotionOpen, setEmotionOpen] = useState(false);
  const [signalOpen, setSignalOpen] = useState(false);
  const [turningPointsOpen, setTurningPointsOpen] = useState(false);
  const [modelProfiles, setModelProfiles] = useState<AnalysisProfile[]>(DEFAULT_MODEL_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState(DEFAULT_MODEL_PROFILES[0].id);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
          const sanitizedProfiles = sanitizeSavedProfiles(parsed);
          const customProfiles = sanitizedProfiles.filter((profile) => profile.mode === 'custom');
          const nextProfiles = [...DEFAULT_MODEL_PROFILES, ...customProfiles];
          setModelProfiles(nextProfiles);
          window.localStorage.setItem(MODEL_PROFILES_KEY, JSON.stringify(nextProfiles));
          if (savedActiveProfile && nextProfiles.some((profile) => profile.id === savedActiveProfile)) {
            setActiveProfileId(savedActiveProfile);
          } else {
            window.localStorage.setItem(ACTIVE_MODEL_PROFILE_KEY, DEFAULT_MODEL_PROFILES[0].id);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key.length !== 1 || /\s/.test(event.key)) {
        return;
      }

      searchInputRef.current?.focus();
      setQuery(event.key);
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
  const focusHighlights = useMemo(() => getFocusHighlights(sortedHighlights), [sortedHighlights]);
  const secondaryHighlights = useMemo(
    () => sortedHighlights.filter((item) => !focusHighlights.some((focus) => focus.id === item.id)),
    [focusHighlights, sortedHighlights],
  );
  const compactSecondaryHighlights = useMemo(
    () =>
      secondaryHighlights.slice(0, 3).map((item) => ({
        item,
        currentKey: getChainSegment(item, '当前关键'),
        validation: getChainSegment(item, '后续验证'),
      })),
    [secondaryHighlights],
  );
  const primaryFocusHighlight = useMemo(
    () => [...focusHighlights].sort((left, right) => right.score - left.score)[0],
    [focusHighlights],
  );
  const topPositiveHighlight = useMemo(
    () => findHighlightByLabel(sortedHighlights, 'positive', data?.aiTopPositiveLabel),
    [data?.aiTopPositiveLabel, sortedHighlights],
  );
  const topRiskHighlight = useMemo(
    () => findHighlightByLabel(sortedHighlights, 'risk', data?.aiTopRiskLabel),
    [data?.aiTopRiskLabel, sortedHighlights],
  );
  const mainlineHighlight = useMemo(
    () => topPositiveHighlight || primaryFocusHighlight,
    [primaryFocusHighlight, topPositiveHighlight],
  );
  const primaryCurrentKey = useMemo(
    () => getChainSegment(mainlineHighlight, '当前关键'),
    [mainlineHighlight],
  );
  const primaryValidation = useMemo(
    () => getChainSegment(mainlineHighlight, '后续验证'),
    [mainlineHighlight],
  );
  const stageInfo = data ? getSentimentStage(data) : null;
  const phaseInfo = data ? getShortlinePhase(data, sortedHighlights) : null;
  const checklist = data ? getShortlineChecklist(data, sortedHighlights) : [];
  const shortlineSignal = data ? getShortlineSignal(data, sortedHighlights) : null;
  const invalidationSignals = data ? getInvalidationSignals(data, sortedHighlights) : [];
  const nextTriggers = data ? getNextTriggers(data, sortedHighlights) : [];
  const turningPointGroups = data
    ? getTurningPointGroups(data, sortedHighlights)
    : { upgrade: [], downgrade: [], invalidation: [] };
  const linkedFocusNews = useMemo(
    () => linkNewsToFocus(data?.liveNews ?? [], focusHighlights),
    [data?.liveNews, focusHighlights],
  );
  const verificationSignals = useMemo(() => getVerificationSignals(linkedFocusNews), [linkedFocusNews]);
  const mainlineStrength = useMemo(
    () => (data ? getMainlineStrength(data, sortedHighlights, verificationSignals, turningPointGroups) : null),
    [data, sortedHighlights, verificationSignals, turningPointGroups],
  );
  const emotionDrivers = useMemo(
    () => (data ? getEmotionDrivers(data, phaseInfo) : null),
    [data, phaseInfo],
  );

  const watched = useMemo(
    () => !!selectedStockForList && watchlist.some((item) => item.code === selectedStockForList.code),
    [selectedStockForList, watchlist],
  );

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
            <div className="flex items-center justify-between rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] px-4 py-3">
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

            <Card className="rounded-[24px] border-white/10 bg-[rgba(6,8,22,0.92)] text-white shadow-none">
              <CardContent className="space-y-3 p-4">
                <form className="flex items-center gap-3" onSubmit={handleSubmit}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-cyan-400/10 text-cyan-300">
                    <Search className="h-4 w-4" />
                  </div>
                  <Input
                    ref={searchInputRef}
                    className="h-10 rounded-2xl border-white/10 bg-slate-950 text-white placeholder:text-slate-500"
                    placeholder="输入股票代码或简称，例如 600519、贵州茅台"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </form>

                {watchlist.length > 0 || recentStocks.length > 0 ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      className="flex items-center gap-2 text-[11px] text-slate-500 transition hover:text-slate-300"
                      onClick={() => setListsExpanded((current) => !current)}
                    >
                      <History className="h-3.5 w-3.5" />
                      观察列表
                      <span className="text-slate-600">({watchlist.length + recentStocks.length})</span>
                      <ChevronDown className={`h-3.5 w-3.5 transition ${listsExpanded ? '' : '-rotate-90'}`} />
                    </button>
                    {listsExpanded ? (
                      <div className="space-y-2">
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
                      </div>
                    ) : null}
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
                  <div className="space-y-4 text-white">
                    <div className="space-y-4">
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
                          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
                            <div>
                              {displayStock.code} · {displayStock.industry}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:border-white/25 ${inlineInsightChipClass('positive')} ${
                                  topPositiveHighlight ? '' : 'cursor-default opacity-70'
                                }`}
                                disabled={!topPositiveHighlight}
                                onClick={() => topPositiveHighlight && setActiveHighlight(topPositiveHighlight)}
                              >
                                <span>亮点</span>
                                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] leading-none">
                                  {data.summary.positiveCount}
                                </span>
                              </button>
                              <button
                                type="button"
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:border-white/25 ${inlineInsightChipClass('risk')} ${
                                  topRiskHighlight ? '' : 'cursor-default opacity-70'
                                }`}
                                disabled={!topRiskHighlight}
                                onClick={() => topRiskHighlight && setActiveHighlight(topRiskHighlight)}
                              >
                                <span>风险</span>
                                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] leading-none">
                                  {data.summary.riskCount}
                                </span>
                              </button>
                              <button
                                type="button"
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:border-white/25 ${inlineInsightChipClass('turning')} ${
                                  turningPointGroups.upgrade.length +
                                    turningPointGroups.downgrade.length +
                                    turningPointGroups.invalidation.length >
                                  0
                                    ? ''
                                    : 'opacity-70'
                                }`}
                                onClick={() => setTurningPointsOpen(true)}
                              >
                                <span>转折点</span>
                                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] leading-none">
                                  {turningPointGroups.upgrade.length +
                                    turningPointGroups.downgrade.length +
                                    turningPointGroups.invalidation.length}
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition hover:border-white/25 ${shortlineScoreClass(
                              shortlineSignal?.tone,
                            )}`}
                            onClick={() => setSignalOpen(true)}
                          >
                            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-100/80">短线态势分</span>
                            <span className="text-base font-semibold">{shortlineSignal?.score ?? '--'}</span>
                          </button>
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

                      <div className="rounded-[26px] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(34,211,238,0.12),rgba(8,47,73,0.08))] p-5">
                        <div className="mb-2 text-xs uppercase tracking-[0.22em] text-cyan-300">短线主线</div>
                        <div className="text-2xl font-semibold text-white">
                          {data.headline || 'AI 尚未生成主线，先看规则看点和快讯。'}
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-200">{data.marketImpression}</p>
                        {primaryCurrentKey || primaryValidation ? (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {primaryCurrentKey ? (
                              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                                <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">当前关键证据</div>
                                <div className="mt-2 text-sm leading-6 text-slate-100">{primaryCurrentKey}</div>
                              </div>
                            ) : null}
                            {primaryValidation ? (
                              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                                <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">后续验证</div>
                                <div className="mt-2 text-sm leading-6 text-slate-100">{primaryValidation}</div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {mainlineStrength ? (
                          <div
                            className={`mt-4 rounded-2xl border px-4 py-3 ${
                              mainlineStrength.tone === 'red'
                                ? 'border-red-400/20 bg-red-500/10'
                                : mainlineStrength.tone === 'amber'
                                  ? 'border-amber-400/20 bg-amber-500/10'
                                  : 'border-emerald-400/20 bg-emerald-500/10'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-200">主线强度演进</div>
                              <div
                                className={`text-sm font-semibold ${
                                  mainlineStrength.tone === 'red'
                                    ? 'text-red-300'
                                    : mainlineStrength.tone === 'amber'
                                      ? 'text-amber-300'
                                      : 'text-emerald-300'
                                }`}
                              >
                                {mainlineStrength.label} · {mainlineStrength.score}
                              </div>
                            </div>
                            <div className="mt-2 text-sm leading-6 text-slate-100">{mainlineStrength.summary}</div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

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
                        {focusHighlights.length > 0 ? (
                          focusHighlights.map((item) => {
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
                                <div className="mt-3 text-sm leading-6 text-slate-100">{item.thesis}</div>
                                <div className="mt-3 text-sm leading-6 text-slate-300">{item.importance}</div>
                                <div className="mt-4 space-y-2">
                                  {item.evidenceChain.slice(0, 3).map((chainItem, index) => (
                                    <div key={`${item.id}-chain-${index}`} className="flex gap-2 text-sm text-slate-200">
                                      <div className="mt-1 h-2 w-2 rounded-full bg-white/70" />
                                      <div className="leading-6">{chainItem}</div>
                                    </div>
                                  ))}
                                </div>
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
                          <div className="text-lg font-semibold">次级线索</div>
                          <div className="text-sm text-slate-400">
                            只留主线之外，但还值得顺手跟踪的少量补充信号。
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-6">
                      {sortedHighlights.length === 0 ? (
                        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 text-sm text-slate-400">
                          还没有识别到可用看点，先等待新公告、快讯或价格反馈。
                        </div>
                      ) : secondaryHighlights.length === 0 ? (
                        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 text-sm text-slate-400">
                          当前最重要的看点已经在上方拆解完成，暂时没有额外但同样值得展开的次级线索。
                        </div>
                      ) : (
                        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/80">
                          {compactSecondaryHighlights.map(({ item, currentKey, validation }, index) => {
                            const Icon = sideMeta[item.side].icon;
                            return (
                              <button
                                key={item.id}
                                className="w-full px-4 py-4 text-left transition hover:bg-white/[0.03]"
                                onClick={() => setActiveHighlight(item)}
                                type="button"
                              >
                                <div className={index > 0 ? 'border-t border-white/10 pt-4' : ''}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex items-start gap-3">
                                      <div className="rounded-2xl bg-white/5 p-2">
                                        <Icon className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <div className="text-sm font-semibold text-white">{item.label}</div>
                                          <div className="text-xs text-slate-500">{item.category}</div>
                                        </div>
                                        <div className="mt-2 text-sm leading-6 text-slate-300">
                                          {currentKey || item.importance}
                                        </div>
                                        {validation ? (
                                          <div className="mt-2 text-xs leading-5 text-slate-500">后续看：{validation}</div>
                                        ) : null}
                                      </div>
                                    </div>
                                    <Badge className={`${sideMeta[item.side].chip} shrink-0`}>{item.score}</Badge>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section className="space-y-6">
                  <div className="grid gap-4">
                    <SummaryTile
                      title="当前情绪"
                      value={sentimentLabel(data.summary.sentiment)}
                      helper={`${stageInfo?.title || '观察中'} · ${phaseInfo?.label || '观察中'}，点开看完整拆解。`}
                      onClick={() => setEmotionOpen(true)}
                      tone="amber"
                    />
                  </div>

                  <Card className="rounded-[30px] border-white/10 bg-white/[0.03] text-white shadow-none">
                    <CardHeader className="space-y-3 border-b border-white/10 pb-5">
                      <div className="flex items-center gap-3">
                        <Zap className="h-5 w-5 text-amber-300" />
                        <div>
                          <div className="text-lg font-semibold">主线验证快讯</div>
                          <div className="text-sm text-slate-400">只留最能证明、扰动或等待确认主线的少量增量消息。</div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5 pt-6">
                      {data.liveNews.length === 0 ? (
                        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                          暂无外部快讯，先看最新证据补位。
                        </div>
                      ) : verificationSignals.length === 0 ? (
                        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-400">
                          当前快讯还没有和主线形成明确挂钩，先看上面的证据链和量价反馈。
                        </div>
                      ) : (
                        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/80">
                          {verificationSignals.map((signal, index) => {
                            const SignalContainer = signal.news.url ? 'a' : 'div';
                            return (
                            <SignalContainer
                              key={`${signal.label}-${signal.news.url}-${index}`}
                              className="block px-4 py-4 transition hover:bg-white/[0.03]"
                              {...(signal.news.url
                                ? {
                                    href: signal.news.url,
                                    target: '_blank',
                                    rel: 'noreferrer',
                                  }
                                : {})}
                            >
                              <div className={index > 0 ? 'border-t border-white/10 pt-4' : ''}>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                  <Badge
                                    className={
                                      signal.tone === 'positive'
                                        ? 'border-red-400/20 bg-red-500/12 text-red-300'
                                        : signal.tone === 'risk'
                                          ? 'border-emerald-400/20 bg-emerald-500/12 text-emerald-300'
                                          : 'border-white/10 bg-white/5 text-slate-200'
                                    }
                                  >
                                    {signal.label}
                                  </Badge>
                                  {signal.linkedLabel ? <Badge variant="outline">{signal.linkedLabel}</Badge> : null}
                                  <Badge variant="outline">{signal.news.source}</Badge>
                                  <span>{signal.news.time}</span>
                                </div>
                                <div className="mt-2 text-sm leading-6 text-slate-300">{signal.description}</div>
                                <div className="mt-2 text-sm font-medium leading-6 text-white">{signal.news.title}</div>
                              </div>
                            </SignalContainer>
                          )})}
                        </div>
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
      <EmotionDetailsDialog
        open={emotionOpen}
        onOpenChange={setEmotionOpen}
        stageInfo={stageInfo}
        phaseInfo={phaseInfo}
        emotionDrivers={emotionDrivers}
      />
      <InsightDetailsDialog
        open={signalOpen}
        onOpenChange={setSignalOpen}
        title="短线态势分"
        summary={shortlineSignal?.summary || '当前还没有形成足够明确的短线态势说明。'}
        items={[
          `当前分值：${shortlineSignal?.score ?? '--'}`,
          `当前判断：${shortlineSignal?.title || '等待信号'}`,
          `主线强度：${mainlineStrength?.label || '待确认'}${mainlineStrength ? ` (${mainlineStrength.score})` : ''}`,
          `解释：${shortlineSignal?.summary || '等待更多价格、消息和证据链确认。'}`,
          ...(mainlineStrength?.drivers ?? []).map((item) => `强度演进：${item}`),
        ]}
      />
      <TurningPointsDialog open={turningPointsOpen} onOpenChange={setTurningPointsOpen} groups={turningPointGroups} />

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

            {data ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">AI 排序亮点</div>
                  <div className="mt-2 text-sm font-medium text-white">{data.aiTopPositiveLabel || '未单独挑出'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">AI 排序风险</div>
                  <div className="mt-2 text-sm font-medium text-white">{data.aiTopRiskLabel || '未单独挑出'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">AI 转折点</div>
                  <div className="mt-2 text-sm font-medium text-white">{data.aiTurningPoint || '等待生成'}</div>
                </div>
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
