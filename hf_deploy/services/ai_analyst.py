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
    from ..core.config import AI_MODEL_POOL, DASHSCOPE_API_KEY, DEEPSEEK_API_KEY, HF_TOKEN, REQUEST_TIMEOUT
except ImportError:
    from core.config import AI_MODEL_POOL, DASHSCOPE_API_KEY, DEEPSEEK_API_KEY, HF_TOKEN, REQUEST_TIMEOUT


AI_ANALYSIS_CACHE_TTL = 600
_analysis_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
_analysis_jobs: set[str] = set()
_analysis_lock = threading.Lock()

SYSTEM_PROMPT = """
你是一名面向 A 股短线交易的中文个股看点分析助手。
你的任务不是复述资讯，而是基于给定的公告、快讯、价格和热度信息，
提炼出当前这只股票最值得短线关注的主线、情绪和风险。

如果上下文里有 focusHighlights，你必须优先围绕这些焦点看点写结论，
不要重新罗列一批重复标题。请优先抓最重要的一条主线，
并在 marketImpression 中明确提到：
1. 当前最强驱动是什么
2. 当前关键证据是什么
3. 接下来要验证或防守的点是什么

请严格返回 JSON，格式如下：
{
  "headline": "一句话短线结论，18字以内",
  "marketImpression": "120字以内，说明当前最强驱动、情绪位置、当前关键证据和需要盯防的验证点",
  "sentiment": "positive | negative | neutral"
}
"""


def has_ai_provider(profile: Optional[Dict[str, str]] = None) -> bool:
    if profile and profile.get("mode") == "custom":
        return bool(profile.get("baseUrl") and profile.get("model"))

    if profile and profile.get("vendor"):
        vendor = profile["vendor"]
        if vendor == "deepseek":
            return bool(DEEPSEEK_API_KEY)
        if vendor == "dashscope":
            return bool(DASHSCOPE_API_KEY)
        if vendor == "huggingface":
            return bool(HF_TOKEN)

    return bool(DEEPSEEK_API_KEY or DASHSCOPE_API_KEY or HF_TOKEN)


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


def _call_openai_compatible(
    base_url: str,
    model: str,
    user_input: str,
    api_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    response = requests.post(
        base_url,
        headers=headers,
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_input},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
        },
        timeout=max(REQUEST_TIMEOUT, 25),
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return _extract_json(content)


def _call_builtin_model(vendor: str, model: str, user_input: str) -> Optional[Dict[str, Any]]:
    if vendor == "deepseek":
        return _call_openai_compatible(
            "https://api.deepseek.com/chat/completions",
            model,
            user_input,
            DEEPSEEK_API_KEY or "",
        )

    if vendor == "dashscope":
        return _call_openai_compatible(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            model,
            user_input,
            DASHSCOPE_API_KEY or "",
        )

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

    if sentiment not in {"positive", "negative", "neutral"}:
        sentiment = "neutral"

    if not headline or not market_impression:
        return None

    return {
        "headline": headline[:32],
        "marketImpression": market_impression[:220],
        "sentiment": sentiment,
        "model": model_name,
        "profileLabel": profile_label,
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
        "请根据以下个股上下文生成短线结论。"
        "如果存在 focusHighlights，请只抓最重要的一条主线，优先引用其中的当前关键证据和后续验证点。"
        "不要把多个重复公告分别讲一遍。\n"
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
    profile: Optional[Dict[str, str]] = None,
) -> tuple[Optional[Dict[str, Any]], str]:
    context = _build_context(code, name, indicators, news, announcements, highlights, hotness, price_info, profile)
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
    profile: Optional[Dict[str, str]] = None,
) -> bool:
    if not has_ai_provider(profile):
        return False

    with _analysis_lock:
        if key in _analysis_jobs:
            return True
        _analysis_jobs.add(key)

    context = _build_context(code, name, indicators, news, announcements, highlights, hotness, price_info, profile)
    thread = threading.Thread(target=_run_ai_summary, args=(key, context, profile), daemon=True)
    thread.start()
    return True


def invalidate_ai_summary_cache(key: str) -> None:
    with _analysis_lock:
        _analysis_cache.pop(key, None)
