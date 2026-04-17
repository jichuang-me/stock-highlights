import json
import logging
import aiohttp
import re
from typing import Any, Dict, List, Optional
from huggingface_hub import AsyncInferenceClient

from ..core.config import HF_TOKEN, AI_MODEL_POOL, DASHSCOPE_API_KEY, DEEPSEEK_API_KEY
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
    """调用 Hugging Face Inference Router (OpenAI 兼容接口)"""
    if not HF_TOKEN:
        return None
    
    # 使用最新的路由器接口，避免直连模型 ID 导致的 404
    url = "https://router.huggingface.co/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {HF_TOKEN}"
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
            async with session.post(url, headers=headers, json=payload, timeout=35) as resp:
                if resp.status != 200:
                    err_msg = await resp.text()
                    logging.warning(f"HF Router ({model}) returned {resp.status}: {err_msg}")
                    return None
                data = await resp.json()
                content = data['choices'][0]['message']['content']
                return json.loads(content)
    except Exception as e:
        logging.warning(f"HF Router ({model}) failed: {e}")
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
            async with session.post(url, headers=headers, json=payload, timeout=60) as resp:
                if resp.status != 200:
                    err_msg = await resp.text()
                    logging.warning(f"DashScope {model} returned {resp.status}: {err_msg}")
                    return None
                data = await resp.json()
                content = data['choices'][0]['message']['content']
                return json.loads(content)
    except Exception as e:
        logging.warning(f"DashScope {model} failed ({type(e).__name__}): {e}")
        return None

async def call_huggingface_direct(model: str, user_input: str) -> Optional[Dict[str, Any]]:
    """直接调用 Hugging Face Inference API (具备思维链剥离与 JSON 强力提取能力)"""
    if not HF_TOKEN:
        return None
    
    url = f"https://api-inference.huggingface.co/models/{model}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {HF_TOKEN}"
    }
    # 针对 R1-Distill 优化 Prompt：明确指令模型在“非思考模式”下必须以纯 JSON 结尾
    payload = {
        "inputs": f"<|im_start|>system\n{SYSTEM_PROMPT}\n注意：输出必须是合法的 JSON，不要返回任何 Markdown 标记或多余文字。<|im_end|>\n<|im_start|>user\n{user_input}<|im_end|>\n<|im_start|>assistant\n",
        "parameters": {
            "return_full_text": False,
            "max_new_tokens": 4096,
            "temperature": 0.1
        }
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload, timeout=50) as resp:
                if resp.status != 200:
                    err_msg = await resp.text()
                    logging.warning(f"HF Direct ({model}) returned {resp.status}: {err_msg}")
                    return None
                
                # 直连 API 返回的是列表格式 [{ "generated_text": "..." }]
                data = await resp.json()
                content = data[0]['generated_text'] if isinstance(data, list) else data.get('generated_text', '')
                
                # 核心处理：剥离 DeepSeek 的 <think> 模块
                content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL)
                
                # 清洗输出（移除 Markdown 代码块标记）
                content = content.replace("```json", "").replace("```", "").strip()
                
                # 强力提取：由于 R1 可能在 JSON 前后输出额外文字，使用正则定位 JSON 核
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    json_str = match.group()
                    try:
                        return json.loads(json_str)
                    except json.JSONDecodeError:
                        logging.error(f"Failed to decode regex-extracted JSON for {model}")
                
                return json.loads(content)
    except Exception as e:
        logging.warning(f"HF Direct ({model}) failed ({type(e).__name__}): {e}")
        return None

async def call_deepseek_reasoner(model: str, user_input: str) -> Optional[Dict[str, Any]]:
    """通过官方接口调用 DeepSeek R1 (Reasoner)"""
    if not DEEPSEEK_API_KEY:
        return None
    
    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
    }
    payload = {
        "model": model, 
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_input}
        ],
        "response_format": {"type": "json_object"} if model == "deepseek-chat" else None,
        "temperature": 0.6 if model == "deepseek-reasoner" else 0.2
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload, timeout=90) as resp:
                if resp.status != 200:
                    err_msg = await resp.text()
                    logging.warning(f"DeepSeek {model} returned {resp.status}: {err_msg}")
                    return None
                data = await resp.json()
                choice = data['choices'][0]['message']
                
                # 特色处理：如果存在思维链 (仅 R1 有)，记录到日志中
                if 'reasoning_content' in choice:
                    logging.info(f"DeepSeek R1 Thinking: {choice['reasoning_content'][:500]}...")
                
                content = choice['content']
                # 强力提取 JSON (应对 R1 或非 JSON Mode 的情况)
                if model != "deepseek-chat":
                    match = re.search(r'\{.*\}', content, re.DOTALL)
                    if match:
                        return json.loads(match.group())
                return json.loads(content)
    except Exception as e:
        logging.warning(f"DeepSeek {model} failed ({type(e).__name__}): {e}")
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
    """核心入口：双轨制多模型轮换调用逻辑"""
    
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
    for attempt in AI_MODEL_POOL:
        vendor = attempt['vendor']
        model = attempt['model']
        
        logging.info(f"Attempting AI analysis for {code} using {vendor}:{model}")
        
        result = None
        if vendor == 'deepseek':
            result = await call_deepseek_reasoner(model, user_input)
        elif vendor == 'dashscope':
            result = await call_dashscope(model, user_input)
        elif vendor == 'huggingface':
            result = await call_huggingface(model, user_input)
        elif vendor == 'huggingface_direct':
            result = await call_huggingface_direct(model, user_input)
            
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
