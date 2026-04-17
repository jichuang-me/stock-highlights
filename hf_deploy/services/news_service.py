import requests
import aiohttp
import logging
from typing import List, Dict, Any
from ..core.config import USER_AGENT

async def fetch_cls_telegraph_async(code: str) -> List[Dict[str, Any]]:
    """异步获取财联社电报"""
    url = "https://www.cls.cn/api/sw?type=telegram"
    params = {"keyword": code, "page": 1, "os": "web"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=5) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()
                items = data.get("data", {}).get("telegram", {}).get("items", [])
                return [{
                    "title": it.get("title") or it.get("content")[:50],
                    "time": it.get("ctime"),
                    "url": f"https://www.cls.cn/detail/{it.get('id')}"
                } for it in items[:10]]
    except Exception as exc:
        logging.warning("Async CLS fetch failed: %s", exc)
        return []

def fetch_cls_telegraph(code: str) -> List[Dict[str, Any]]:
    """获取财联社电报 (同步版)"""
    url = "https://www.cls.cn/api/sw?type=telegram"
    params = {"keyword": code, "page": 1, "os": "web"}
    headers = {"User-Agent": USER_AGENT}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=5)
        data = resp.json().get("data", {}).get("telegram", {}).get("items", [])
        return [{
            "title": it.get("title") or it.get("content")[:50],
            "time": it.get("ctime"),
            "url": f"https://www.cls.cn/detail/{it.get('id')}"
        } for it in data[:10]]
    except:
        return []

def fetch_sina_news(code: str) -> List[Dict[str, Any]]:
    """获取新浪个股新闻 (占位)"""
    return []

async def get_integrated_news_async(code: str) -> List[Dict[str, Any]]:
    """异步集成新闻源"""
    return await fetch_cls_telegraph_async(code)

def get_integrated_news(code: str) -> List[Dict[str, Any]]:
    """集成新闻源 (同步版)"""
    return fetch_cls_telegraph(code)
