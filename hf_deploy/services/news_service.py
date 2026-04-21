import logging
import time
from datetime import datetime
from typing import Any, Dict, List

try:
    import akshare as ak
except ImportError:  # pragma: no cover - optional at runtime
    ak = None


NEWS_CACHE_TTL = 120
_news_cache: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}


def _normalize_news_item(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": str(item.get("新闻标题") or "").strip(),
        "time": str(item.get("发布时间") or "").strip() or "最新",
        "url": str(item.get("新闻链接") or "").strip(),
        "source": str(item.get("文章来源") or "").strip() or "东方财富",
        "tag": "外部资讯",
    }


def _sort_key(item: Dict[str, Any]) -> float:
    value = str(item.get("time") or "").strip()
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value, pattern).timestamp()
        except ValueError:
            continue
    return 0.0


def fetch_stock_news(code: str) -> List[Dict[str, Any]]:
    cached = _news_cache.get(code)
    now = time.time()
    if cached and now - cached[0] < NEWS_CACHE_TTL:
        return cached[1]

    if ak is None:
        return []

    try:
        news_df = ak.stock_news_em(symbol=code)
        records = news_df.to_dict(orient="records")
        result = [_normalize_news_item(item) for item in records[:20] if item.get("新闻标题")]
        result.sort(key=_sort_key, reverse=True)
        result = result[:12]
        _news_cache[code] = (now, result)
        return result
    except Exception as exc:
        logging.error("Eastmoney stock news fetch failed for %s: %s", code, exc)
        return []


def get_integrated_news(code: str) -> List[Dict[str, Any]]:
    return fetch_stock_news(code)
