import datetime as dt
import logging
from functools import lru_cache
from typing import Any, Dict, List

import requests

try:
    from ..core.config import CNINFO_DAYS_DEFAULT, REQUEST_TIMEOUT, USER_AGENT
except ImportError:
    from core.config import CNINFO_DAYS_DEFAULT, REQUEST_TIMEOUT, USER_AGENT


CNINFO_QUERY_URL = "https://www.cninfo.com.cn/new/hisAnnouncement/query"


def _date_range(days: int) -> str:
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    return f"{start.isoformat()}~{end.isoformat()}"


@lru_cache(maxsize=128)
def fetch_announcements(code: str, days: int = CNINFO_DAYS_DEFAULT) -> List[Dict[str, Any]]:
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
        "X-Requested-With": "XMLHttpRequest",
    }
    try:
        resp = requests.post(
            CNINFO_QUERY_URL,
            data=payload,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json().get("announcements") or []
        return [item for item in data if item.get("secCode") == code]
    except Exception as exc:
        logging.error("Announcement fetch failed for %s: %s", code, exc)
        return []


def build_pdf_url(adjunct_url: str) -> str:
    if not adjunct_url:
        return ""
    return f"https://static.cninfo.com.cn/{adjunct_url.lstrip('/')}"
