from __future__ import annotations

import datetime as dt
import logging
import os
import re
from functools import lru_cache
from typing import Any, Dict, List, Literal, Optional

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_NAME = "stock-highlights-official-announcements"
CNINFO_QUERY_URL = "https://www.cninfo.com.cn/new/hisAnnouncement/query"
CNINFO_STATIC_BASE = "https://static.cninfo.com.cn/"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title=APP_NAME, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# models
# -----------------------------
class HealthOut(BaseModel):
    ok: bool = True
    service: str = APP_NAME


class Evidence(BaseModel):
    title: str
    published_at: str
    source: Literal["cninfo"]
    source_label: str = "巨潮资讯"
    original_url: str
    detail_url: Optional[str] = None
    announcement_type: Optional[str] = None
    keyword_hits: List[str] = Field(default_factory=list)


class HighlightItem(BaseModel):
    id: str
    title: str
    direction: Literal["positive", "negative", "neutral"]
    score: int = Field(ge=0, le=100)
    summary: str
    evidence: List[Evidence] = Field(default_factory=list)


class HighlightResponse(BaseModel):
    code: str
    as_of: str
    data_source: str = "official_public_announcements"
    company_name: Optional[str] = None
    empty: bool = False
    empty_reason: Optional[str] = None
    highlights: List[HighlightItem] = Field(default_factory=list)
    raw_evidence_count: int = 0


class AnnouncementListResponse(BaseModel):
    code: str
    as_of: str
    empty: bool = False
    empty_reason: Optional[str] = None
    announcements: List[Evidence] = Field(default_factory=list)


# -----------------------------
# helper
# -----------------------------
def _normalize_code(code: str) -> str:
    c = re.sub(r"\D", "", code or "")
    if len(c) != 6:
        raise HTTPException(status_code=400, detail="股票代码必须是 6 位数字")
    return c


def _infer_plate(code: str) -> str:
    if code.startswith(("600", "601", "603", "605", "688", "900")):
        return "sh"
    if code.startswith(("000", "001", "002", "003", "300", "301", "200")):
        return "sz"
    if code.startswith(("430", "831", "832", "833", "834", "835", "836", "837", "838", "839", "870", "871", "872", "873", "920")):
        return "bj"
    # 默认走全部，避免误杀
    return ""


def _today() -> str:
    return dt.date.today().isoformat()


def _date_range(days: int) -> str:
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    return f"{start.isoformat()}~{end.isoformat()}"


@lru_cache(maxsize=1)
def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.cninfo.com.cn",
            "Referer": "https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice",
            "X-Requested-With": "XMLHttpRequest",
        }
    )
    return s


def fetch_cninfo_announcements(code: str, page_size: int = 30, days: int = 180) -> List[Dict[str, Any]]:
    """
    最小可落地版本：
    - 仅抓巨潮资讯公告列表
    - 以 searchkey=code 做检索，再做代码严格过滤
    - 抓不到就返回空，不兜底伪造
    """
    code = _normalize_code(code)
    plate = _infer_plate(code)

    payload = {
        "pageNum": 1,
        "pageSize": page_size,
        "column": "szse",
        "tabName": "fulltext",
        "plate": plate,
        "stock": "",
        "searchkey": code,
        "secid": "",
        "category": "",
        "trade": "",
        "seDate": _date_range(days),
        "sortName": "",
        "sortType": "",
        "isHLtitle": "true",
    }

    try:
        resp = _session().post(CNINFO_QUERY_URL, data=payload, timeout=20)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.exception("cninfo request failed")
        raise HTTPException(status_code=502, detail=f"公告源请求失败: {e}")

    announcements = data.get("announcements") or []
    filtered = []
    for item in announcements:
        sec_code = str(item.get("secCode") or item.get("secCodeFull") or "").strip()
        if sec_code == code:
            filtered.append(item)

    return filtered


def _build_pdf_url(adjunct_url: str) -> str:
    adjunct_url = adjunct_url.lstrip("/")
    return CNINFO_STATIC_BASE + adjunct_url


def _build_detail_url(code: str) -> str:
    # 用户可直接打开巨潮资讯公告页继续查证
    return f"https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice&searchkey={code}"


def transform_announcement(code: str, item: Dict[str, Any]) -> Evidence:
    title = (item.get("announcementTitle") or "").strip()
    adjunct_url = item.get("adjunctUrl") or ""
    published_at = (
        item.get("announcementTime")
        or item.get("announcementDate")
        or item.get("adjunctSize")
        or ""
    )

    if isinstance(published_at, (int, float)):
        # 毫秒时间戳
        try:
            published_at = dt.datetime.fromtimestamp(published_at / 1000).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            published_at = str(published_at)

    return Evidence(
        title=title,
        published_at=str(published_at),
        source="cninfo",
        original_url=_build_pdf_url(adjunct_url) if adjunct_url else _build_detail_url(code),
        detail_url=_build_detail_url(code),
        announcement_type=item.get("announcementType") or item.get("announcementTypeName"),
        keyword_hits=[],
    )


POSITIVE_RULES = [
    ("业绩预增/扭亏", ["业绩预告", "业绩预增", "扭亏为盈", "同比增长", "净利润增长", "盈利"]),
    ("中标/订单", ["中标", "收到中标通知书", "签订", "重大合同", "订单"]),
    ("回购/增持", ["回购", "增持", "员工持股计划", "股权激励"]),
    ("分红", ["利润分配", "分红", "派息", "转增"]),
    ("融资推进", ["定增", "向特定对象发行", "可转债", "获受理", "获批复", "注册生效"]),
    ("资产重组推进", ["购买资产", "重组", "并购", "重大资产重组", "吸收合并"]),
]

NEGATIVE_RULES = [
    ("风险提示", ["风险提示", "可能被终止上市", "退市", "异常波动", "立案", "监管", "处罚"]),
    ("减持/质押", ["减持", "股份质押", "质押", "冻结", "司法拍卖"]),
    ("亏损/下修", ["亏损", "预亏", "下修", "计提减值", "商誉减值"]),
    ("诉讼/担保压力", ["诉讼", "仲裁", "担保", "逾期", "违约"]),
]


def _match_hits(title: str, rules: List[tuple[str, List[str]]]) -> List[tuple[str, List[str]]]:
    hits = []
    for label, kws in rules:
        found = [kw for kw in kws if kw in title]
        if found:
            hits.append((label, found))
    return hits


def generate_highlights(code: str, announcements: List[Dict[str, Any]]) -> HighlightResponse:
    if not announcements:
        return HighlightResponse(
            code=code,
            as_of=_today(),
            empty=True,
            empty_reason="最近官方公告源未检索到该代码的可用公告",
            highlights=[],
            raw_evidence_count=0,
        )

    evidence_items = [transform_announcement(code, x) for x in announcements]
    company_name = announcements[0].get("secName") or announcements[0].get("secNameFull")

    groups: List[HighlightItem] = []

    positive_bucket: Dict[str, List[Evidence]] = {}
    negative_bucket: Dict[str, List[Evidence]] = {}

    for ev in evidence_items:
        pos_hits = _match_hits(ev.title, POSITIVE_RULES)
        neg_hits = _match_hits(ev.title, NEGATIVE_RULES)

        for label, kws in pos_hits:
            ev_copy = ev.model_copy(deep=True)
            ev_copy.keyword_hits = kws
            positive_bucket.setdefault(label, []).append(ev_copy)

        for label, kws in neg_hits:
            ev_copy = ev.model_copy(deep=True)
            ev_copy.keyword_hits = kws
            negative_bucket.setdefault(label, []).append(ev_copy)

    def make_summary(label: str, evidences: List[Evidence], direction: str) -> str:
        latest_titles = [e.title for e in evidences[:2]]
        if direction == "positive":
            return f"最近公告中出现“{label}”相关信号，当前仅基于真实公告标题归纳，不做超出处置。代表公告：{'；'.join(latest_titles)}。"
        return f"最近公告中出现“{label}”相关风险信号，当前仅基于真实公告标题归纳。代表公告：{'；'.join(latest_titles)}。"

    for label, evidences in positive_bucket.items():
        groups.append(
            HighlightItem(
                id=f"pos-{abs(hash((code, label))) % 10**8}",
                title=label,
                direction="positive",
                score=min(90, 50 + len(evidences) * 10),
                summary=make_summary(label, evidences, "positive"),
                evidence=evidences[:5],
            )
        )

    for label, evidences in negative_bucket.items():
        groups.append(
            HighlightItem(
                id=f"neg-{abs(hash((code, label))) % 10**8}",
                title=label,
                direction="negative",
                score=min(90, 50 + len(evidences) * 10),
                summary=make_summary(label, evidences, "negative"),
                evidence=evidences[:5],
            )
        )

    # 没命中规则时，仍返回原始证据，前端可以展示“最近动态/公告列表”
    if not groups:
        groups.append(
            HighlightItem(
                id=f"neutral-{code}",
                title="最近公告",
                direction="neutral",
                score=50,
                summary="已抓到真实官方公告，但暂未命中首版规则词；前端应展示空洞察 + 原始公告列表，不做编造。",
                evidence=evidence_items[:10],
            )
        )

    return HighlightResponse(
        code=code,
        as_of=_today(),
        company_name=company_name,
        empty=False,
        highlights=groups,
        raw_evidence_count=len(evidence_items),
    )


# -----------------------------
# endpoints
# -----------------------------
@app.get("/api/health", response_model=HealthOut)
def health() -> HealthOut:
    return HealthOut()


@app.get("/api/announcements/{code}", response_model=AnnouncementListResponse)
def get_announcements(
    code: str,
    limit: int = Query(default=20, ge=1, le=50),
    days: int = Query(default=180, ge=7, le=365),
) -> AnnouncementListResponse:
    code = _normalize_code(code)
    rows = fetch_cninfo_announcements(code=code, page_size=limit, days=days)
    if not rows:
        return AnnouncementListResponse(
            code=code,
            as_of=_today(),
            empty=True,
            empty_reason="最近官方公告源未检索到该代码的可用公告",
            announcements=[],
        )

    return AnnouncementListResponse(
        code=code,
        as_of=_today(),
        announcements=[transform_announcement(code, x) for x in rows],
    )


@app.get("/api/stocks/{code}/highlights", response_model=HighlightResponse)
def get_stock_highlights(
    code: str,
    limit: int = Query(default=30, ge=1, le=50),
    days: int = Query(default=180, ge=7, le=365),
) -> HighlightResponse:
    code = _normalize_code(code)
    rows = fetch_cninfo_announcements(code=code, page_size=limit, days=days)
    return generate_highlights(code=code, announcements=rows)


@app.get("/api/stocks/search")
def search_stock_hint(q: str = Query(..., min_length=2)) -> Dict[str, Any]:
    """
    这个最小版先只支持“6位代码直达”。
    名称搜索如果你要继续做，我下一步再接交易所官方证券基础资料源。
    """
    q = q.strip()
    if re.fullmatch(r"\d{6}", q):
        return {
            "items": [
                {
                    "code": q,
                    "name": None,
                    "match_type": "code_direct",
                }
            ]
        }
    return {"items": []}


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("official_announcements_backend:app", host=host, port=port, reload=True)
