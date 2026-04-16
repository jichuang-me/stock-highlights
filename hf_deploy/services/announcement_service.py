import datetime as dt
import requests
import logging
from typing import List, Dict, Any
from functools import lru_cache
from ..core.config import USER_AGENT

CNINFO_QUERY_URL = "https://www.cninfo.com.cn/new/hisAnnouncement/query"

def _date_range(days: int) -> str:
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    return f"{start.isoformat()}~{end.isoformat()}"

@lru_cache(maxsize=128)
def fetch_announcements(code: str, days: int = 180) -> List[Dict[str, Any]]:
    """
    自适应公告抓取服务：彻底废弃 2026-03-01 硬编码。
    """
    plate = "sh" if code.startswith("6") else "sz"
    payload = {
        "pageNum": 1, 
        "pageSize": 50, 
        "column": "szse", 
        "tabName": "fulltext",
        "plate": plate, 
        "stock": "", 
        "searchkey": code, 
        "secid": "", 
        "category": "",
        "trade": "", 
        "seDate": _date_range(days),
    }
    headers = {
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest"
    }
    try:
        resp = requests.post(CNINFO_QUERY_URL, data=payload, timeout=10)
        resp.raise_for_status()
        data = resp.json().get("announcements") or []
        # 严格过滤对应代码的公告
        return [a for a in data if a.get("secCode") == code]
    except Exception as e:
        logging.error(f"Announcement Fetch Error: {e}")
        return []

def build_pdf_url(adjunct_url: str) -> str:
    if not adjunct_url: return ""
    adjunct_url = adjunct_url.lstrip("/")
    return f"https://static.cninfo.com.cn/{adjunct_url}"
