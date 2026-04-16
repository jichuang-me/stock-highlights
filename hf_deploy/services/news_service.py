import requests
from typing import List, Dict, Any
from ..core.config import USER_AGENT

def fetch_cls_telegraph(code: str) -> List[Dict[str, Any]]:
    """获取财联社电报"""
    url = "https://www.cls.cn/api/sw?type=telegram"
    params = {"keyword": code, "page": 1, "os": "web"}
    try:
        resp = requests.get(url, params=params, timeout=5)
        data = resp.json().get("data", {}).get("telegram", {}).get("items", [])
        return [{
            "title": it.get("title") or it.get("content")[:50],
            "time": it.get("ctime"),
            "url": f"https://www.cls.cn/detail/{it.get('id')}"
        } for it in data[:10]]
    except:
        return []

def fetch_sina_news(code: str) -> List[Dict[str, Any]]:
    """获取新浪个股新闻"""
    url = f"https://finance.sina.com.cn/realstock/company/{code}/index.shtml"
    # 这里通常需要解析 HTML 或调用特定接口，
    # 鉴于稳定性，我们先实现 CLS 电报作为核心新闻源，
    # 新浪财经保留占位符或简单链接。
    return []

def get_integrated_news(code: str) -> List[Dict[str, Any]]:
    cls_news = fetch_cls_telegraph(code)
    # 可以在此合并更多源
    return cls_news
