import aiohttp
import logging
import asyncio
import requests
from functools import lru_cache
from typing import Any, Dict

try:
    from ..core.config import REQUEST_TIMEOUT, USER_AGENT, XQ_SESSION
except ImportError:
    from core.config import REQUEST_TIMEOUT, USER_AGENT, XQ_SESSION

# --- Async Fetchers ---

async def fetch_sina_prices_async(codes: str) -> Dict[str, Any]:
    """异步抓取新浪实时价格"""
    if not codes:
        return {}

    url = f"https://hq.sinajs.cn/list={codes}"
    headers = {"Referer": "https://finance.sina.com.cn/", "User-Agent": USER_AGENT}
    results: Dict[str, Any] = {}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=10) as resp:
                if resp.status != 200:
                    return {}
                content = await resp.read()
                text = content.decode("gbk", errors="ignore")
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
        logging.error("Async Sina price fetch failed: %s", exc)
    return results

async def fetch_eastmoney_indicators_async(code: str) -> Dict[str, Any]:
    """异步抓取东财核心指标"""
    market = "1" if code.startswith("6") else "0"
    url = f"http://push2.eastmoney.com/api/qt/stock/get?secid={market}.{code}&fields=f162,f167,f117,f58"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=5) as resp:
                data = await resp.json()
                d = data.get("data") or {}
                return {
                    "name": d.get("f58", "加载中..."),
                    "pe": d.get("f162", "-"),
                    "pb": d.get("f167", "-"),
                    "roe": d.get("f117", "-"),
                }
    except Exception as exc:
        logging.error("Async Eastmoney fetch failed for %s: %s", code, exc)
        return {"name": "加载中...", "pe": "-", "pb": "-", "roe": "-"}

async def fetch_xueqiu_hotness_async(code: str) -> Dict[str, Any]:
    """异步抓取雪球热度数据"""
    symbol = f"SH{code}" if code.startswith("6") else f"SZ{code}"
    url = f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={symbol}&extend=detail"
    
    # 模拟浏览器 Cookie 策略，雪球通常需要预访问，但在简单 API 下可以尝试直连
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Referer": "https://xueqiu.com/"
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            # 尝试获取一个基础 Cookie
            async with session.get("https://xueqiu.com/", headers=headers, timeout=5):
                async with session.get(url, headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        quote = data.get("data", {}).get("quote", {})
                        followers = quote.get("followers", 0)
                        return {
                            "popularity": 75 if followers > 10000 else 60,
                            "followers": followers,
                            "rank": f"关注 {followers:,}",
                            "sentiment": "bullish" if followers > 50000 else "neutral",
                        }
    except Exception as exc:
        logging.warning("Async Xueqiu hotness fetch failed: %s", exc)
    
    # 回退到默认值
    return {"popularity": 65, "followers": 0, "rank": "关注数据暂不可用", "sentiment": "neutral"}


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
