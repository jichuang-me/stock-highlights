import json
import logging
from typing import Any, Dict, List, Optional
from huggingface_hub import AsyncInferenceClient

from ..core.config import HF_TOKEN, DEFAULT_AI_MODEL
from ..models.api_models import HighlightItem, Evidence, StockOutlook, MarketImpression

# 如果没有配置 Token，我们将记录警告并进入降级逻辑
client = None
if HF_TOKEN:
    client = AsyncInferenceClient(model=DEFAULT_AI_MODEL, token=HF_TOKEN)

SYSTEM_PROMPT = """
你是一名顶级券商的高级策略分析师，擅长从琐碎的金融数据中洞察核心博弈逻辑。
你的任务是根据提供的股票原始数据（财务指标、最新电报内容、巨潮公告标题），生成一份比 iFinD Agent 更深度、更具洞察力的研判卡片。

你的输出必须完全符合以下 JSON 格式。请不要包含任何解释性文字或 Markdown 标签，只返回纯 JSON 对象：

{
  "marketImpression": {
    "summary": "简明总结当前市场对该股的核心认知",
    "positioning": "行业地位分析",
    "attention": "资金关注度与概念热度解析"
  },
  "headline": "一句话神总结：用最犀利的角度概括该股现状",
  "highlights": [
    {
      "id": "item-1",
      "side": "risk" 或 "positive",
      "label": "信号名称（4-8字）",
      "score": 0-100的严重性/亮点分值,
      "category": "所属维度（如：治理、业绩、估值、博弈）",
      "why": "详细的逻辑解读（包含数据支撑）",
      "interpretation": "基本面视角：这对公司基本面意味着什么？",
      "game_view": "博弈视角：二级市场主力资金会如何解读和博弈此消息？",
      "evidence": [{"source": "来源", "title": "具体证据标题", "published_at": "日期", "url": "链接"}]
    }
  ],
  "outlook": {
    "consensus": "分析师共识与市场心理预期",
    "shortTerm": "短期具体的催化剂或利空因素分析",
    "valuation": "估值中枢变动预期及驱动因素"
  }
}

要求：
1. 见解深刻：不要只是复述数据，要分析其背后的业务逻辑或博弈心理。
2. 严谨性：如果数据支持不足，请在 interpretation 中注明观察中。
3. 语境适配：确保使用专业的中国金融市场术语。
"""

async def generate_advanced_highlights(
    code: str,
    name: str,
    indicators: Dict[str, Any],
    news: List[Dict[str, Any]],
    announcements: List[Dict[str, Any]],
    hotness: Dict[str, Any],
    price_info: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """调用大模型生成全量研判内容"""
    if not client:
        logging.warning("HF_TOKEN missing, falling back to rule-based analysis")
        return None

    # 聚合上下文（限制条数防止 Token 过载）
    context = {
        "stock": {"code": code, "name": name},
        "indicators": indicators,
        "recent_news": news[:5],
        "recent_announcements": announcements[:5],
        "market_sentiment": hotness,
        "current_price": price_info
    }

    user_input = f"请针对以下数据进行深度分析：\n{json.dumps(context, ensure_ascii=False, indent=2)}"

    try:
        response = await client.post(
            json={
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_input}
                ],
                "response_format": {"type": "json_object"}
            }
        )
        
        # 尝试解析并返回
        result = json.loads(response.decode("utf-8"))
        if not result or "highlights" not in result:
             return None
             
        return result
    except Exception as exc:
        logging.error(f"AI analysis failed for {code}: {exc}")
        return None

def fallback_to_rules(raw_ann: List[Dict[str, Any]]) -> Dict[str, Any]:
    """旧有的规则引擎降级逻辑，确保基础可用"""
    # 暂时封装一个符合新结构的空对象或基础对象
    return {
        "marketImpression": {
            "summary": "AI 分析暂时不可用，进入基础模式",
            "positioning": "数据采集中",
            "attention": "数据采集中"
        },
        "headline": "基础分析模式已启动",
        "highlights": [], # 这里可以挂之前的 rule-based 结果
        "outlook": {
            "consensus": "暂无预期数据",
            "shortTerm": "等待观察",
            "valuation": "估值中枢稳定"
        }
    }
