import datetime as dt
from typing import Any, Dict, List

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
        "interpretation": "公司现金流已经承压，债务风险进入公开披露阶段。",
        "game_view": "优先关注交叉违约、债权人行动和融资渠道是否继续收缩。",
    },
    "LEGAL_INVESTIGATION": {
        "label": "立案调查/处罚",
        "keywords": ["立案", "处罚", "证监会调查", "监管函"],
        "severity": 90,
        "category": "合规风险",
        "interpretation": "监管已明确介入，后续可能继续放大估值折价。",
        "game_view": "关键不只是消息本身，而是是否触发 ST、退市或融资受限。",
    },
    "ASSET_FREEZE": {
        "label": "股份/资产冻结",
        "keywords": ["冻结", "轮候冻结", "司法拍卖"],
        "severity": 85,
        "category": "治理危机",
        "interpretation": "股权稳定性下降，控制权和经营层面都可能受到影响。",
        "game_view": "需要继续跟踪接盘方背景和控制权变化，不宜只看事件标题。",
    },
    "STATE_INTERVENTION": {
        "label": "国资介入/重组",
        "keywords": ["国资", "重组", "战略合作", "战投", "收购"],
        "severity": 80,
        "category": "逻辑反转",
        "interpretation": "外部资本介入有机会改善资产负债表和融资环境。",
        "game_view": "要看引入主体层级、资源兑现能力和后续执行，而不是只看重组字样。",
    },
    "EARNINGS_BOOST": {
        "label": "业绩预增/扭亏",
        "keywords": ["预增", "扭亏", "增长", "盈利"],
        "severity": 70,
        "category": "基本面改善",
        "interpretation": "利润端出现改善信号，但仍需继续验证持续性。",
        "game_view": "区分一次性收益和主营改善，避免把报表波动误判成趋势反转。",
    },
    "CONTRACT_WIN": {
        "label": "重大合同/中标",
        "keywords": ["中标", "合同", "订单", "协议"],
        "severity": 65,
        "category": "业务增量",
        "interpretation": "新增订单有望提升未来收入确定性。",
        "game_view": "比合同金额更重要的是执行周期、毛利率和回款质量。",
    },
}


def analyze_highlights(raw_ann: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    highlights: List[Dict[str, Any]] = []

    for item in raw_ann[:20]:
        title = item.get("announcementTitle", "").strip()
        if not title:
            continue

        published_at = "未知日期"
        timestamp = item.get("announcementTime")
        if timestamp:
            published_at = dt.datetime.fromtimestamp(timestamp / 1000).strftime("%Y-%m-%d")

        matched = None
        for meta in EVENT_CATALOG.values():
            if any(keyword in title for keyword in meta["keywords"]):
                matched = meta
                break

        if not matched:
            continue

        highlights.append(
            {
                "id": f"ev-{item.get('announcementId', '0')}",
                "side": "risk" if matched["severity"] >= 80 else "positive",
                "label": matched["label"],
                "score": matched["severity"],
                "category": matched["category"],
                "why": title,
                "interpretation": matched["interpretation"],
                "game_view": matched["game_view"],
                "evidence": [
                    {
                        "source": "巨潮公告",
                        "title": title,
                        "published_at": published_at,
                        "url": build_pdf_url(item.get("adjunctUrl", "")),
                    }
                ],
            }
        )

    return sorted(highlights, key=lambda item: item["score"], reverse=True)
