import json
import logging
import aiohttp
from typing import Any, Dict, List, Optional
from huggingface_hub import AsyncInferenceClient

from ..core.config import HF_TOKEN, AI_MODEL_POOL, DASHSCOPE_API_KEY
from ..models.api_models import HighlightItem, Evidence, StockOutlook, MarketImpression

# 系统提示词 (核心中枢)
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
"""

async def call_huggingface(model: str, user_input: str) -> Optional[Dict[str, Any]]:
    """调用 Hugging Face Inference API"""
    if not HF_TOKEN:
        return None
    try:
        client = AsyncInferenceClient(model=model, token=HF_TOKEN)
        response = await client.post(
            json={
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_input}
                ],
                "response_format": {"type": "json_object"}
            }
        )
        return json.loads(response.decode("utf-8"))
    except Exception as e:
        logging.warning(f"HF Model {model} failed: {e}")
        return None

async def call_dashscope(model: str, user_input: str) -> Optional[Dict[str, Any]]:
    """通过 OpenAI 兼容接口调用阿里云 DashScope"""
    if not DASHSCOPE_API_KEY:
        return None
    
    url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}"
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_input}
        ],
        "response_format": {"type": "json_object"}
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload, timeout=15) as resp:
                if resp.status != 200:
                    err_msg = await resp.text()
                    logging.warning(f"DashScope {model} returned {resp.status}: {err_msg}")
                    return None
                data = await resp.json()
                content = data['choices'][0]['message']['content']
                return json.loads(content)
    except Exception as e:
        logging.warning(f"DashScope {model} failed: {e}")
        return None

async def generate_advanced_highlights(
    code: str,
    name: str,
    indicators: Dict[str, Any],
    news: List[Dict[str, Any]],
    announcements: List[Dict[str, Any]],
    hotness: Dict[str, Any],
    price_info: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """核心入口：多模型轮换调用逻辑"""
    
    context = {
        "stock": {"code": code, "name": name},
        "indicators": indicators,
        "recent_news": news[:5],
        "recent_announcements": announcements[:5],
        "market_sentiment": hotness,
        "current_price": price_info
    }
    user_input = f"请针对以下数据进行深度分析：\n{json.dumps(context, ensure_ascii=False, indent=2)}"

    # 按优先级遍历模型池
    for entry in AI_MODEL_POOL:
        vendor = entry["vendor"]
        model = entry["model"]
        
        logging.info(f"Attempting AI analysis for {code} using {vendor}:{model}")
        
        result = None
        if vendor == "dashscope":
            result = await call_dashscope(model, user_input)
        elif vendor == "huggingface":
            result = await call_huggingface(model, user_input)
            
        if result and "highlights" in result:
            logging.info(f"Successfully generated highlights for {code} using {vendor}:{model}")
            return result
            
    logging.error(f"All AI models exhausted for {code}. Falling back to rules.")
    return None

def fallback_to_rules(raw_ann: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "marketImpression": {
            "summary": "AI 分析暂时不可用，进入基础模式",
            "positioning": "数据采集中",
            "attention": "数据采集中"
        },
        "headline": "基础分析模式已启动",
        "highlights": [],
        "outlook": {
            "consensus": "暂无预期数据",
            "shortTerm": "等待观察",
            "valuation": "估值中枢稳定"
        }
    }
