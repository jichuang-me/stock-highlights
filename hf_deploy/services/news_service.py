import datetime as dt
import logging
import time
from typing import Any, Dict, List

try:
    from ..core.config import HTTP_SESSION, REQUEST_TIMEOUT, USER_AGENT
except ImportError:
    from core.config import HTTP_SESSION, REQUEST_TIMEOUT, USER_AGENT


NEWS_CACHE_TTL = 120
_news_cache: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}


def _format_timestamp(value: Any) -> str:
    if not value:
        return "未知时间"
    try:
        return dt.datetime.fromtimestamp(int(value)).strftime("%m-%d %H:%M")
    except (TypeError, ValueError, OSError):
        return str(value)


def fetch_cls_telegraph(code: str) -> List[Dict[str, Any]]:
    cached = _news_cache.get(code)
    now = time.time()
    if cached and now - cached[0] < NEWS_CACHE_TTL:
        return cached[1]

    url = "https://www.cls.cn/api/sw"
    params = {"type": "telegram", "keyword": code, "page": 1, "os": "web"}
    try:
        resp = HTTP_SESSION.get(
            url,
            params=params,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        items = resp.json().get("data", {}).get("telegram", {}).get("items", [])
        result = [
            {
                "title": item.get("title") or (item.get("content") or "")[:60],
                "time": _format_timestamp(item.get("ctime")),
                "url": f"https://www.cls.cn/detail/{item.get('id')}",
                "source": "财联社电报",
                "tag": "快讯",
            }
            for item in items[:10]
            if item.get("id")
        ]
        _news_cache[code] = (now, result)
        return result
    except Exception as exc:
        logging.error("CLS telegraph fetch failed for %s: %s", code, exc)
        return []


def get_integrated_news(code: str) -> List[Dict[str, Any]]:
    return fetch_cls_telegraph(code)
