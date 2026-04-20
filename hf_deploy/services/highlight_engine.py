import datetime as dt
from typing import Any, Dict, List, Optional, Tuple

try:
    from ..services.announcement_service import build_pdf_url
except ImportError:
    from services.announcement_service import build_pdf_url


EVENT_CATALOG = {
    "DEBT_RISK": {
        "label": "债务逾期/违约",
        "keywords": ["逾期", "未能清偿", "违约", "到期未兑付"],
        "severity": 95,
        "category": "信用违约",
        "interpretation": "现金流已经出现公开风险信号，短线更容易触发估值折价和情绪踩踏。",
        "game_view": "先盯连锁违约、债权人动作和融资渠道是否继续收缩。",
    },
    "LEGAL_INVESTIGATION": {
        "label": "立案调查/处罚",
        "keywords": ["立案", "处罚", "证监会调查", "监管函"],
        "severity": 90,
        "category": "合规风险",
        "interpretation": "监管介入后，不确定性会继续压制短线风险偏好。",
        "game_view": "重点看是否继续升级到 ST、退市或融资受限，而不是只看单条公告。",
    },
    "ASSET_FREEZE": {
        "label": "股份/资产冻结",
        "keywords": ["冻结", "轮候冻结", "司法拍卖"],
        "severity": 85,
        "category": "治理危机",
        "interpretation": "控制权稳定性下降，经营和融资两端都可能继续承压。",
        "game_view": "继续跟踪接盘方背景和控制权变化，别只看标题刺激。",
    },
    "STATE_INTERVENTION": {
        "label": "国资介入/重组",
        "keywords": ["国资", "重组", "战略合作", "战投", "收购"],
        "severity": 80,
        "category": "逻辑反转",
        "interpretation": "外部资本介入有机会修复资产负债表和市场预期。",
        "game_view": "真正要看的是接盘主体层级、资源兑现能力和执行进度。",
    },
    "EARNINGS_BOOST": {
        "label": "业绩预增/扭亏",
        "keywords": ["预增", "扭亏", "增长", "盈利"],
        "severity": 70,
        "category": "基本面改善",
        "interpretation": "利润端出现改善信号，但需要继续验证是否具有持续性。",
        "game_view": "区分一次性收益和主营改善，避免把报表波动误判成趋势反转。",
    },
    "CONTRACT_WIN": {
        "label": "重大合同/中标",
        "keywords": ["中标", "合同", "订单", "协议"],
        "severity": 65,
        "category": "业务增量",
        "interpretation": "新增订单提升了未来收入确定性，容易带来情绪催化。",
        "game_view": "重点看执行周期、毛利率和回款质量，而不只是合同金额。",
    },
}


def _match_event(title: str) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    for event_key, meta in EVENT_CATALOG.items():
        if any(keyword in title for keyword in meta["keywords"]):
            return event_key, meta
    return None, None


def _format_date(timestamp: Any) -> tuple[int, str]:
    if not timestamp:
        return 0, "未知日期"
    ts = int(timestamp)
    return ts, dt.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")


def _build_evidence(item: Dict[str, Any]) -> Dict[str, Any]:
    title = item.get("announcementTitle", "").strip()
    raw_ts, published_at = _format_date(item.get("announcementTime"))
    return {
        "source": "巨潮公告",
        "title": title,
        "published_at": published_at,
        "url": build_pdf_url(item.get("adjunctUrl", "")),
        "_timestamp": raw_ts,
    }


def _build_thesis(meta: Dict[str, Any], evidence: List[Dict[str, Any]]) -> str:
    latest = evidence[0]
    if len(evidence) == 1:
        return f"{meta['label']} 当前主要由“{latest['title']}”触发，短线先围绕这条主线看市场是否继续买单。"
    return (
        f"{meta['label']} 不是单点消息，最近连续出现 {len(evidence)} 条相关公告，"
        f"当前关键证据是“{latest['title']}”。"
    )


def _build_importance(meta: Dict[str, Any], evidence: List[Dict[str, Any]]) -> str:
    if len(evidence) == 1:
        return f"当前阶段最重要的是验证这条消息能否继续扩散，而不是只看单次刺激。{meta['game_view']}"
    return (
        f"这类信号已经形成连续证据链，说明市场后续会更关注是否继续升级、兑现或被证伪。"
        f"{meta['game_view']}"
    )


def _build_evidence_chain(meta: Dict[str, Any], evidence: List[Dict[str, Any]]) -> List[str]:
    if not evidence:
        return []

    latest = evidence[0]

    if len(evidence) == 1:
        return [
            f"起点：{latest['title']}（{latest['published_at']}）",
            "强化：当前还没有看到同类公告继续强化，先按单点催化处理。",
            f"当前关键：市场会先围绕“{latest['title']}”定价，重点看是否继续获得价格和消息承接。",
            f"后续验证：{meta['game_view']}",
        ]

    oldest = evidence[-1]
    chain = [f"起点：{oldest['title']}（{oldest['published_at']}）"]

    middle = evidence[1:-1]
    if middle:
        chain.append("强化：" + "；".join(f"{item['title']}（{item['published_at']}）" for item in middle[:2]))
    else:
        chain.append("强化：当前没有更多中间证据，先看最新公告能否把原有逻辑继续推升。")

    chain.append(f"当前关键：{latest['title']}（{latest['published_at']}）")
    chain.append(f"后续验证：{meta['game_view']}")
    return chain


def _public_evidence(evidence: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for item in evidence:
        cleaned.append(
            {
                "source": item["source"],
                "title": item["title"],
                "published_at": item["published_at"],
                "url": item["url"],
            }
        )
    return cleaned


def analyze_highlights(raw_ann: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}

    for item in raw_ann[:30]:
        title = item.get("announcementTitle", "").strip()
        if not title:
            continue

        event_key, meta = _match_event(title)
        if not event_key or not meta:
            continue

        evidence = _build_evidence(item)
        group = grouped.setdefault(
            event_key,
            {
                "meta": meta,
                "titles": set(),
                "evidence": [],
            },
        )

        if evidence["title"] in group["titles"]:
            continue

        group["titles"].add(evidence["title"])
        group["evidence"].append(evidence)

    highlights: List[Dict[str, Any]] = []

    for event_key, group in grouped.items():
        meta = group["meta"]
        evidence = sorted(group["evidence"], key=lambda item: item["_timestamp"], reverse=True)
        if not evidence:
            continue

        latest = evidence[0]
        score = min(100, meta["severity"] + min(max(len(evidence) - 1, 0) * 3, 9))
        side = "risk" if meta["severity"] >= 80 else "positive"

        highlights.append(
            {
                "id": f"{event_key.lower()}-{latest['_timestamp'] or len(evidence)}",
                "side": side,
                "label": meta["label"],
                "score": score,
                "category": meta["category"],
                "why": latest["title"],
                "thesis": _build_thesis(meta, evidence),
                "importance": _build_importance(meta, evidence),
                "interpretation": meta["interpretation"],
                "game_view": meta["game_view"],
                "evidenceChain": _build_evidence_chain(meta, evidence),
                "evidence": _public_evidence(evidence[:4]),
            }
        )

    return sorted(highlights, key=lambda item: item["score"], reverse=True)
