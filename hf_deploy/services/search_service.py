import logging
import time
from typing import Any, Dict, List

try:
    from ..core.config import HTTP_SESSION, REQUEST_TIMEOUT, USER_AGENT
    from .market_service import fetch_sina_prices
except ImportError:
    from core.config import HTTP_SESSION, REQUEST_TIMEOUT, USER_AGENT
    from services.market_service import fetch_sina_prices


SEARCH_URL = "https://searchapi.eastmoney.com/api/suggest/get"
SEARCH_HEADERS = {
    "User-Agent": USER_AGENT,
    "Referer": "https://data.eastmoney.com/",
    "Accept": "application/json, text/plain, */*",
}
SEARCH_CACHE_TTL = 300
_search_cache: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}


def _fetch_search_items(q: str) -> List[Dict[str, Any]]:
    cache_key = q.strip()
    now = time.time()
    cached = _search_cache.get(cache_key)
    if cached and now - cached[0] < SEARCH_CACHE_TTL:
        return cached[1]

    params = {"input": cache_key, "type": "14", "token": "D43A3003844103BA765F8397C224F2AD"}
    resp = HTTP_SESSION.get(SEARCH_URL, params=params, headers=SEARCH_HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    items = resp.json().get("QuotationCodeTable", {}).get("Data", [])
    _search_cache[cache_key] = (now, items)
    return items


def search_stock_enhanced(q: str) -> List[Dict[str, Any]]:
    keyword = q.strip()
    if not keyword:
        return []

    try:
        items = _fetch_search_items(keyword)
        if not items:
            return []

        top_codes = []
        for item in items[:5]:
            code = item["Code"]
            prefix = "sh" if code.startswith("6") else "sz"
            top_codes.append(f"{prefix}{code}")

        prices = fetch_sina_prices(",".join(top_codes))
        return [
            {
                "code": item["Code"],
                "name": item["Name"],
                "industry": item.get("SecurityTypeName"),
                "price": prices.get(item["Code"], {}).get("price", 0.0),
                "pct": prices.get(item["Code"], {}).get("pct", 0.0),
            }
            for item in items
        ]
    except Exception as exc:
        logging.error("Search service failed for %s: %s", keyword, exc)
        return []


def get_stock_profile(code: str) -> Dict[str, str]:
    try:
        items = _fetch_search_items(code)
        for item in items:
            if item.get("Code") == code:
                return {
                    "code": code,
                    "name": item.get("Name") or code,
                    "industry": item.get("SecurityTypeName") or "",
                }
    except Exception as exc:
        logging.error("Stock profile fetch failed for %s: %s", code, exc)
    return {"code": code, "name": code, "industry": ""}
