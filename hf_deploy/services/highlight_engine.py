import datetime as dt
from typing import List, Dict, Any
from ..services.announcement_service import build_pdf_url

# 事件模型与博弈逻辑库
EVENT_CATALOG = {
    "DEBT_RISK": {
        "label": "债务逾期/违约",
        "keywords": ["逾期", "未能清偿", "违约", "到期未回售"],
        "severity": 95,
        "category": "信用违约",
        "interpretation": "公司资金链极度紧张，已触发法律风险。",
        "game_view": "核心关注：债权人是否发起集体诉讼，以及是否会触发债务交叉违约，这是进入破产重整的前兆。"
    },
    "LEGAL_INVESTIGATION": {
        "label": "立案调查/处罚",
        "keywords": ["立案", "处罚", "证监会调查", "限制消费"],
        "severity": 90,
        "category": "合规风险",
        "interpretation": "监管层介入，可能涉及财务造假或合规漏洞。",
        "game_view": "博弈点：关注是否涉及 ST 风险或撤销上市资格。通常立案宣告了‘故事’的终结，出清期可能较长。"
    },
    "ASSET_FREEZE": {
        "label": "股份/资产冻结",
        "keywords": ["冻结", "轮候冻结", "司法拍卖"],
        "severity": 85,
        "category": "治理危机",
        "interpretation": "控股股东股份丧失流动性，可能导致经营权动荡。",
        "game_view": "深度解析：冻结是控制权争夺的‘明牌’。若涉及司法拍卖，需关注接手方背景（如国资是否入场）。"
    },
    "EARNINGS_BOOST": {
        "label": "业绩预增/扭亏",
        "keywords": ["预增", "扭亏", "增长", "盈利"],
        "severity": 70,
        "category": "基本面改善",
        "interpretation": "公司经营性现金流或盈利能力出现边际修复信号。",
        "game_view": "博弈点：区分‘非经常性损益’和‘核心业务驱动’。若是资产处置导致的利润虚增，需警惕冲高回落。"
    },
    "CONTRACT_WIN": {
        "label": "重大合同/中标",
        "keywords": ["中标", "合同", "订单", "协议"],
        "severity": 65,
        "category": "业务增量",
        "interpretation": "在手订单增加，确保未来 6-12 个月的营收确定性。",
        "game_view": "博弈解析：关注合同执行周期及利润率。若属于‘关联交易’，则属于典型的报表粉饰，而非真实利好。"
    },
    "STATE_INTERVENTION": {
        "label": "国资介入/重组",
        "keywords": ["国资", "收储", "重组", "战略合作", "战投"],
        "severity": 80,
        "category": "逻辑反转",
        "interpretation": "外部强力资本注入，旨在优化资产负债表或引入资源。",
        "game_view": "黄金研判：这是困境反转的‘最强背书’。国资背景的层级决定了反转的力度和信用修复的底线。"
    }
}

def analyze_highlights(raw_ann: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    highlights = []
    for item in raw_ann[:20]:
        title = item.get("announcementTitle", "")
        # 处理时间戳
        timestamp = item.get("announcementTime", 0)
        published_at = dt.datetime.fromtimestamp(timestamp/1000).strftime("%Y-%m-%d") if timestamp else "未知日期"
        
        matched = None
        for k, meta in EVENT_CATALOG.items():
            if any(kw in title for kw in meta["keywords"]):
                matched = meta
                break
        
        if matched:
            side = "risk" if matched["severity"] > 75 else "positive"
            highlights.append({
                "id": f"ev-{item.get('announcementId', '0')}",
                "side": side,
                "label": matched["label"],
                "score": matched["severity"],
                "category": matched["category"],
                "why": title,
                "interpretation": matched["interpretation"],
                "game_view": matched["game_view"],
                "evidence": [{
                    "source": "巨潮公告",
                    "title": title,
                    "published_at": published_at,
                    "url": build_pdf_url(item.get("adjunctUrl", ""))
                }]
            })
    return highlights
