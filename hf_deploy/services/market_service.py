import logging
from functools import lru_cache
from typing import Any, Dict

import requests

try:
    from ..core.config import REQUEST_TIMEOUT, USER_AGENT, XQ_SESSION
except ImportError:
    from core.config import REQUEST_TIMEOUT, USER_AGENT, XQ_SESSION


@lru_cache(maxsize=128)
def fetch_sina_prices(codes: str) -> Dict[str, Any]:
    if not codes:
        return {}

    url = f"https://hq.sinajs.cn/list={codes}"
    headers = {"Referer": "https://finance.sina.com.cn/", "User-Agent": USER_AGENT}
    results: Dict[str, Any] = {}
    try:
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        text = resp.content.decode("gbk", errors="ignore")
        for line in text.splitlines():
            if "=" not in line:
                continue
            code_num = "".join(filter(str.isdigit, line.split("=")[0].split("_")[-1]))
            data = line.split("=")[1].replace('"', "").split(",")
            if len(data) <= 4:
                continue
            try:
                price = float(data[3])
                pre_close = float(data[2])
            except (TypeError, ValueError):
                continue
            pct = round((price - pre_close) / pre_close * 100, 2) if pre_close > 0 else 0.0
            results[code_num] = {"price": price, "pct": pct}
    except Exception as exc:
        logging.error("Sina price fetch failed for %s: %s", codes, exc)
    return results


@lru_cache(maxsize=64)
def fetch_xueqiu_hotness(code: str) -> Dict[str, Any]:
    symbol = f"SH{code}" if code.startswith("6") else f"SZ{code}"
    try:
        url = f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={symbol}&extend=detail"
        resp = XQ_SESSION.get(url, timeout=REQUEST_TIMEOUT)
        data = resp.json().get("data", {}).get("quote", {})
        followers = data.get("followers", 0)
        return {
            "popularity": 75 if followers > 10000 else 60,
            "followers": followers,
            "rank": f"关注 {followers:,}",
            "sentiment": "bullish" if followers > 50000 else "neutral",
        }
    except Exception as exc:
        logging.error("Xueqiu hotness fetch failed for %s: %s", code, exc)
        return {"popularity": 65, "followers": 0, "rank": "关注数据暂不可用", "sentiment": "neutral"}


@lru_cache(maxsize=128)
def fetch_eastmoney_indicators(code: str) -> Dict[str, Any]:
    market = "1" if code.startswith("6") else "0"
    url = f"http://push2.eastmoney.com/api/qt/stock/get?secid={market}.{code}&fields=f162,f167,f117"
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        data = resp.json().get("data") or {}
        return {
            "pe": data.get("f162", "-"),
            "pb": data.get("f167", "-"),
            "roe": data.get("f117", "-"),
        }
    except Exception as exc:
        logging.error("Eastmoney indicators fetch failed for %s: %s", code, exc)
        return {"pe": "-", "pb": "-", "roe": "-"}
