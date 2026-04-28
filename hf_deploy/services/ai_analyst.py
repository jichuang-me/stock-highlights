import datetime as dt
import hashlib
import json
import logging
import re
import threading
import time
from typing import Any, Dict, List, Optional

import requests

try:
    from ..core.config import AI_MODEL_POOL, HF_TOKEN, REQUEST_TIMEOUT
except ImportError:
    from core.config import AI_MODEL_POOL, HF_TOKEN, REQUEST_TIMEOUT


AI_ANALYSIS_CACHE_TTL = 600
_analysis_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
_analysis_jobs: set[str] = set()
_analysis_lock = threading.Lock()

SYSTEM_PROMPT = """
你是一名面向 A 股的中文个股看点分析助手。目标不是复述资讯，而是基于给定的公告、快讯、价格、热度、主营、财务和估值信息，生成接近专业投研卡片的结构化结论，兼顾价值投资框架和短线催化判断。

请严格只返回 JSON，不要输出 Markdown。缺少数据时写「[数据暂不可用]」，不要编造具体数字。

输出字段：
{
  "headline": "一句话结论，32字以内",
  "marketImpression": "市场印象，说明公司定位、最强驱动、当前证据、情绪位置和下一步验证点，220字以内",
  "sentiment": "positive | negative | neutral",
  "topPositiveLabel": "最重要亮点标签，没有则留空",
  "topRiskLabel": "最重要风险标签，没有则留空",
  "keyTurningPoint": "当前最重要的观察转折点，120字以内",
  "analystConsensusStance": "看好 | 中性 | 看空",
  "analystConsensusRationale": "分析师共识与主要逻辑，180字以内",
  "shortTermCatalysts": ["1-3个月最值得跟踪的催化剂，最多3条"],
  "shortTermEarningsExpectation": "1-3个月业绩或经营验证重点，160字以内",
  "valuationCurrentLevel": "当前估值状态，180字以内",
  "valuationTargetRange": "目标估值区间或[数据暂不可用]",
  "valuationUpsideDrivers": ["估值上行驱动，最多3条"],
  "valuationDownsideRisks": ["估值下行风险，最多3条"]
}
"""


def has_ai_provider(profile: Optional[Dict[str, str]] = None) -> bool:
    if profile and profile.get("mode") == "custom":
        return bool(profile.get("baseUrl") and profile.get("model"))

    if profile and profile.get("vendor"):
        vendor = profile["vendor"]
        if vendor == "huggingface":
            return bool(HF_TOKEN)
        return False

    return bool(HF_TOKEN and AI_MODEL_POOL)


def _cache_key(payload: Dict[str, Any]) -> str:
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _extract_json(content: str) -> Optional[Dict[str, Any]]:
    cleaned = content.strip().replace("```json", "").replace("```", "")
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            return None


def _normalize_chat_completions_url(base_url: str) -> str:
    url = base_url.strip().rstrip("/")
    if not url:
        return url

    lower = url.lower()
    if lower.endswith("/chat/completions"):
        return url
    if "generativelanguage.googleapis.com" in lower:
        return f"{url}/chat/completions" if lower.endswith("/openai") else f"{url}/v1beta/openai/chat/completions"
    if "dashscope.aliyuncs.com" in lower:
        return f"{url}/chat/completions" if lower.endswith("/v1") else f"{url}/compatible-mode/v1/chat/completions"
    if "deepseek.com" in lower:
        return f"{url}/chat/completions"
    if lower.endswith("/v1") or lower.endswith("/v1/"):
        return f"{url}/chat/completions"
    return f"{url}/v1/chat/completions"


def _call_openai_compatible(
    base_url: str,
    model: str,
    user_input: str,
    api_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    endpoint = _normalize_chat_completions_url(base_url)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_input},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }

    for attempt in range(2):
        response = requests.post(
            endpoint,
            headers=headers,
            json=payload if attempt == 0 else {k: v for k, v in payload.items() if k != "response_format"},
            timeout=max(REQUEST_TIMEOUT, 25),
        )
        if response.ok:
            content = response.json()["choices"][0]["message"]["content"]
            return _extract_json(content)
        if attempt == 0 and response.status_code in {400, 422}:
            logging.info("Retrying AI call without response_format for %s", endpoint)
            continue
        response.raise_for_status()
    return None


def _call_builtin_model(vendor: str, model: str, user_input: str) -> Optional[Dict[str, Any]]:
    if vendor == "huggingface":
        return _call_openai_compatible(
            "https://router.huggingface.co/v1/chat/completions",
            model,
            user_input,
            HF_TOKEN or "",
        )

    return None


def _call_custom_model(profile: Dict[str, str], user_input: str) -> Optional[Dict[str, Any]]:
    base_url = (profile.get("baseUrl") or "").strip()
    model = (profile.get("model") or "").strip()
    if not base_url or not model:
        return None

    return _call_openai_compatible(
        base_url,
        model,
        user_input,
        (profile.get("apiKey") or "").strip() or None,
    )


def _normalize_result(result: Dict[str, Any], model_name: str, profile_label: str) -> Optional[Dict[str, Any]]:
    headline = str(result.get("headline", "")).strip()
    market_impression = str(result.get("marketImpression", "")).strip()
    sentiment = str(result.get("sentiment", "neutral")).strip().lower()
    top_positive_label = str(result.get("topPositiveLabel", "")).strip()
    top_risk_label = str(result.get("topRiskLabel", "")).strip()
    key_turning_point = str(result.get("keyTurningPoint", "")).strip()
    analyst_consensus_stance = str(result.get("analystConsensusStance", "")).strip()
    analyst_consensus_rationale = str(result.get("analystConsensusRationale", "")).strip()
    short_term_earnings = str(result.get("shortTermEarningsExpectation", "")).strip()
    valuation_current_level = str(result.get("valuationCurrentLevel", "")).strip()
    valuation_target_range = str(result.get("valuationTargetRange", "")).strip()

    def normalize_list(value: Any, limit: int = 3, width: int = 120) -> List[str]:
        if not isinstance(value, list):
            return []
        items: List[str] = []
        seen = set()
        for raw in value:
            text = str(raw or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            items.append(text[:width])
            if len(items) >= limit:
                break
        return items

    short_term_catalysts = normalize_list(result.get("shortTermCatalysts"))
    valuation_upside_drivers = normalize_list(result.get("valuationUpsideDrivers"))
    valuation_downside_risks = normalize_list(result.get("valuationDownsideRisks"))

    if sentiment not in {"positive", "negative", "neutral"}:
        sentiment = "neutral"
    if analyst_consensus_stance not in {"看好", "中性", "看空"}:
        analyst_consensus_stance = ""

    normalized_stance = str(result.get("analystConsensusStance", "")).strip()
    if normalized_stance in {"看好", "中性", "看空"}:
        analyst_consensus_stance = normalized_stance

    if not headline or not market_impression:
        return None

    return {
        "headline": headline[:32],
        "marketImpression": market_impression[:220],
        "sentiment": sentiment,
        "model": model_name,
        "profileLabel": profile_label,
        "topPositiveLabel": top_positive_label[:32] or None,
        "topRiskLabel": top_risk_label[:32] or None,
        "keyTurningPoint": key_turning_point[:120] or None,
        "analystConsensusStance": analyst_consensus_stance or None,
        "analystConsensusRationale": analyst_consensus_rationale[:180] or None,
        "shortTermCatalysts": short_term_catalysts,
        "shortTermEarningsExpectation": short_term_earnings[:160] or None,
        "valuationCurrentLevel": valuation_current_level[:180] or None,
        "valuationTargetRange": valuation_target_range[:80] or None,
        "valuationUpsideDrivers": valuation_upside_drivers,
        "valuationDownsideRisks": valuation_downside_risks,
    }


def _format_timestamp(timestamp: float) -> str:
    return dt.datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")


def _build_context(
    code: str,
    name: str,
    indicators: Dict[str, Any],
    news: List[Dict[str, Any]],
    announcements: List[Dict[str, Any]],
    highlights: List[Dict[str, Any]],
    hotness: Dict[str, Any],
    price_info: Dict[str, Any],
    company_facts: Optional[Dict[str, Any]] = None,
    financial_snapshot: Optional[Dict[str, Any]] = None,
    profile: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    return {
        "stock": {"code": code, "name": name},
        "price": price_info,
        "hotness": {
            "followers": hotness.get("followers", 0),
            "rank": hotness.get("rank", ""),
        },
        "indicators": indicators,
        "companyFacts": {
            "businessSummary": (company_facts or {}).get("businessSummary", ""),
            "productTypes": (company_facts or {}).get("productTypes", []),
            "productNames": (company_facts or {}).get("productNames", []),
        },
        "financialSnapshot": {
            "annualReportLabel": (financial_snapshot or {}).get("annualReportLabel", ""),
            "annualRevenueYoY": (financial_snapshot or {}).get("annualRevenueYoY"),
            "annualParentNetProfitYoY": (financial_snapshot or {}).get("annualParentNetProfitYoY"),
            "quarterlyReportLabel": (financial_snapshot or {}).get("quarterlyReportLabel", ""),
            "quarterlyParentNetProfitYoY": (financial_snapshot or {}).get("quarterlyParentNetProfitYoY"),
            "quarterlyOperateCashYoY": (financial_snapshot or {}).get("quarterlyOperateCashYoY"),
            "latestDividendPer10": (financial_snapshot or {}).get("latestDividendPer10"),
            "latestDividendProgress": (financial_snapshot or {}).get("latestDividendProgress", ""),
        },
        "announcements": [item.get("announcementTitle", "") for item in announcements[:8]],
        "focusHighlights": [
            {
                "side": item.get("side", ""),
                "label": item.get("label", ""),
                "score": item.get("score", 0),
                "thesis": item.get("thesis", ""),
                "importance": item.get("importance", ""),
                "evidenceChain": item.get("evidenceChain", []),
            }
            for item in highlights[:4]
        ],
        "news": [item.get("title", "") for item in news[:8]],
        "analysisProfile": {
            "label": profile.get("label", "系统默认") if profile else "系统默认",
            "kind": profile.get("kind", "api") if profile else "api",
            "vendor": profile.get("vendor", "") if profile else "",
            "model": profile.get("model", "") if profile else "",
        },
    }


def _iter_attempts(profile: Optional[Dict[str, str]]) -> List[Dict[str, str]]:
    if profile:
        if profile.get("mode") == "custom":
            return [profile]
        if profile.get("vendor") and profile.get("model"):
            return [profile]

    return [
        {
            "mode": "server",
            "vendor": attempt["vendor"],
            "model": attempt["model"],
            "label": attempt.get("label") or attempt["model"],
            "kind": "api",
        }
        for attempt in sorted(AI_MODEL_POOL, key=lambda item: item.get("priority", 99))
    ]


def _run_ai_summary(key: str, context: Dict[str, Any], profile: Optional[Dict[str, str]]) -> None:
    user_input = (
        "请根据下面个股上下文生成个股看点卡片。优先形成市场印象、亮点、风险、未来预期，"
        "每个结论都要基于上下文中的公告、快讯、财务、主营或价格信息；数据缺失时写[数据暂不可用]。\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}"
    )

    try:
        for attempt in _iter_attempts(profile):
            try:
                mode = attempt.get("mode", "server")
                vendor = attempt.get("vendor", "")
                model = attempt.get("model", "")
                profile_label = attempt.get("label") or model or "系统默认"
                logging.info(
                    "Trying AI summary for %s with %s/%s",
                    context["stock"]["code"],
                    mode,
                    model,
                )

                if mode == "custom":
                    raw = _call_custom_model(attempt, user_input)
                    model_name = f"custom:{model}"
                else:
                    raw = _call_builtin_model(vendor, model, user_input)
                    model_name = f"{vendor}:{model}"

                if not raw:
                    continue

                result = _normalize_result(raw, model_name, profile_label)
                if result:
                    result["updatedAt"] = _format_timestamp(time.time())
                    with _analysis_lock:
                        _analysis_cache[key] = (time.time(), result)
                    return
            except Exception as exc:
                logging.warning(
                    "AI summary failed for %s via %s: %s",
                    context["stock"]["code"],
                    attempt.get("model") or attempt.get("vendor") or "unknown",
                    exc,
                )
    finally:
        with _analysis_lock:
            _analysis_jobs.discard(key)


def get_cached_ai_summary(
    code: str,
    name: str,
    indicators: Dict[str, Any],
    news: List[Dict[str, Any]],
    announcements: List[Dict[str, Any]],
    highlights: List[Dict[str, Any]],
    hotness: Dict[str, Any],
    price_info: Dict[str, Any],
    company_facts: Optional[Dict[str, Any]] = None,
    financial_snapshot: Optional[Dict[str, Any]] = None,
    profile: Optional[Dict[str, str]] = None,
) -> tuple[Optional[Dict[str, Any]], str]:
    context = _build_context(code, name, indicators, news, announcements, highlights, hotness, price_info, company_facts, financial_snapshot, profile)
    key = _cache_key(context)

    with _analysis_lock:
        cached = _analysis_cache.get(key)
        if cached and time.time() - cached[0] < AI_ANALYSIS_CACHE_TTL:
            return cached[1], key

    return None, key


def queue_ai_summary(
    key: str,
    code: str,
    name: str,
    indicators: Dict[str, Any],
    news: List[Dict[str, Any]],
    announcements: List[Dict[str, Any]],
    highlights: List[Dict[str, Any]],
    hotness: Dict[str, Any],
    price_info: Dict[str, Any],
    company_facts: Optional[Dict[str, Any]] = None,
    financial_snapshot: Optional[Dict[str, Any]] = None,
    profile: Optional[Dict[str, str]] = None,
) -> bool:
    if not has_ai_provider(profile):
        return False

    with _analysis_lock:
        if key in _analysis_jobs:
            return True
        _analysis_jobs.add(key)

    context = _build_context(code, name, indicators, news, announcements, highlights, hotness, price_info, company_facts, financial_snapshot, profile)
    thread = threading.Thread(target=_run_ai_summary, args=(key, context, profile), daemon=True)
    thread.start()
    return True


def invalidate_ai_summary_cache(key: str) -> None:
    with _analysis_lock:
        _analysis_cache.pop(key, None)
