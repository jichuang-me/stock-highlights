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
你是一名面向二级市场的中文股票研究助手。你的任务不是复述新闻，而是基于给定的行情、公告和快讯，
给出一段适合个人投资者快速判断的总结。

请严格返回 JSON，格式如下：
{
  "headline": "一句话结论，18字以内",
  "marketImpression": "120字以内，说明当前最值得关注的核心矛盾、催化或风险",
  "sentiment": "positive | negative | neutral"
}
"""


def has_ai_provider() -> bool:
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


def _call_openai_compatible(base_url: str, api_key: str, model: str, user_input: str) -> Optional[Dict[str, Any]]:
    if not api_key:
        return None

    response = requests.post(
        base_url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
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


def _call_model(vendor: str, model: str, user_input: str) -> Optional[Dict[str, Any]]:
    if vendor == "deepseek":
        return _call_openai_compatible(
            "https://api.deepseek.com/chat/completions",
            DEEPSEEK_API_KEY or "",
            model,
            user_input,
        )

    if vendor == "dashscope":
        return _call_openai_compatible(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            DASHSCOPE_API_KEY or "",
            model,
            user_input,
        )

    if vendor == "huggingface":
        return _call_openai_compatible(
            "https://router.huggingface.co/v1/chat/completions",
            HF_TOKEN or "",
            model,
            user_input,
        )

    return None


def _normalize_result(result: Dict[str, Any], vendor: str, model: str) -> Optional[Dict[str, Any]]:
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
        "model": f"{vendor}:{model}",
    }


def _format_timestamp(timestamp: float) -> str:
    return dt.datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")


def _build_context(
    code: str,
    name: str,
    indicators: Dict[str, Any],
    news: List[Dict[str, Any]],
    announcements: List[Dict[str, Any]],
    hotness: Dict[str, Any],
    price_info: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        "stock": {"code": code, "name": name},
        "price": price_info,
        "hotness": {
            "followers": hotness.get("followers", 0),
            "rank": hotness.get("rank", ""),
        },
        "indicators": indicators,
        "announcements": [item.get("announcementTitle", "") for item in announcements[:6]],
        "news": [item.get("title", "") for item in news[:6]],
    }


def _run_ai_summary(key: str, context: Dict[str, Any]) -> None:
    user_input = (
        "请根据以下股票上下文生成总结，重点回答当前最值得关注的主线、风险或催化。\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}"
    )

    try:
        for attempt in sorted(AI_MODEL_POOL, key=lambda item: item.get("priority", 99)):
            vendor = attempt["vendor"]
            model = attempt["model"]
            try:
                logging.info("Trying AI summary for %s with %s:%s", context["stock"]["code"], vendor, model)
                raw = _call_model(vendor, model, user_input)
                if not raw:
                    continue
                result = _normalize_result(raw, vendor, model)
                if result:
                    result["updatedAt"] = _format_timestamp(time.time())
                    with _analysis_lock:
                        _analysis_cache[key] = (time.time(), result)
                    return
            except Exception as exc:
                logging.warning(
                    "AI summary failed for %s via %s:%s: %s",
                    context["stock"]["code"],
                    vendor,
                    model,
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
    hotness: Dict[str, Any],
    price_info: Dict[str, Any],
) -> tuple[Optional[Dict[str, Any]], str]:
    context = _build_context(code, name, indicators, news, announcements, hotness, price_info)
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
    hotness: Dict[str, Any],
    price_info: Dict[str, Any],
) -> bool:
    if not has_ai_provider():
        return False

    with _analysis_lock:
        if key in _analysis_jobs:
            return True
        _analysis_jobs.add(key)

    context = _build_context(code, name, indicators, news, announcements, hotness, price_info)
    thread = threading.Thread(target=_run_ai_summary, args=(key, context), daemon=True)
    thread.start()
    return True


def invalidate_ai_summary_cache(key: str) -> None:
    with _analysis_lock:
        _analysis_cache.pop(key, None)
