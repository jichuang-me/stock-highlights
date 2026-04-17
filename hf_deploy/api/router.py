from fastapi import APIRouter, Query, HTTPException
from typing import List
from ..models.api_models import SearchStock, HighlightsResponse, HighlightItem, StockSummary
from ..services.search_service import search_stock_enhanced
from ..services.market_service import fetch_sina_prices, fetch_xueqiu_hotness, fetch_eastmoney_indicators
from ..services.announcement_service import fetch_announcements
from ..services.highlight_engine import analyze_highlights
from ..services.news_service import get_integrated_news

from ..services.ai_analyst import generate_advanced_highlights, fallback_to_rules


router = APIRouter(prefix="/api")

@router.get("/health")
async def health():
    return {"status": "ok", "version": "v4.4.0-AI-SYNC"}

@router.get("/stocks/search", response_model=List[SearchStock])
async def search(q: str = Query(..., min_length=1)):
    return await search_stock_enhanced(q)

@router.get("/stocks/{code}/highlights", response_model=HighlightsResponse)
async def get_highlights_v2(code: str):
    return await get_highlights(code)

@router.get("/highlights", response_model=HighlightsResponse, include_in_schema=False)
async def get_highlights(code: str = Query(..., pattern="^\d{6}$")):
    # 1. 基础并行数据获取
    prefix = "sh" if code.startswith("6") else "sz"
    prices = fetch_sina_prices(f"{prefix}{code}")
    stock_p = prices.get(code, {"price": 0.0, "pct": 0.0})
    
    hotness = fetch_xueqiu_hotness(code)
    indicators = fetch_eastmoney_indicators(code)
    raw_ann = fetch_announcements(code)
    news = get_integrated_news(code)

    # 2. 调用高级 AI 研判
    # 传入所有上下文，让 AI 决定哪些是亮点，哪些是风险
    ai_result = await generate_advanced_highlights(
        code=code,
        name="加载中...", # 这里可以优化为从 indicators 或缓存中获取
        indicators=indicators,
        news=news,
        announcements=raw_ann,
        hotness=hotness,
        price_info=stock_p
    )

    # 3. 结果合并与降级
    if not ai_result:
        # 如果 AI 失败，使用基础降级逻辑
        ai_result = fallback_to_rules(raw_ann)
        # 这里可以继续调用原来的 analyze_highlights 以保持基础功能
        from ..services.highlight_engine import analyze_highlights
        ai_result["highlights"] = analyze_highlights(raw_ann)

    # 4. 计算雷达图分数
    risks = [h for h in ai_result["highlights"] if h["side"] == "risk"]
    positives = [h for h in ai_result["highlights"] if h["side"] == "positive"]
    sentiment_label = "neutral"
    if len(risks) > len(positives): sentiment_label = "negative"
    elif len(positives) > len(risks): sentiment_label = "positive"
    
    # 5. 组装最终响应
    return HighlightsResponse(
        stock={"code": code, "name": indicators.get("name", "加载中..."), "industry": indicators.get("industry")},
        summary={
            "riskCount": len(risks),
            "positiveCount": len(positives),
            "sentiment": sentiment_label
        },
        marketImpression=ai_result["marketImpression"],
        headline=ai_result.get("headline", "AI 研判研判完成"),
        price=stock_p["price"],
        pctChange=stock_p["pct"],
        outlook=ai_result["outlook"],
        highlights=ai_result["highlights"],
        liveNews=news,
        radar=[
            {"k": "人气值", "v": hotness.get("popularity", 50)},
            {"k": "波动率", "v": min(abs(stock_p["pct"]) * 10, 100)},
            {"k": "指标评分", "v": indicators.get("score", 50)},
            {"k": "亮点密度", "v": min(len(positives) * 20, 100)},
            {"k": "风险敞口", "v": min(len(risks) * 20, 100)}
        ]
    )

@router.get("/stocks/{code}/history")
async def get_stock_history(code: str):
    # 返回空列表以防止前端崩溃，后续可对接真实数据库
    return []

@router.get("/stocks/{code}/snapshots")
async def get_stock_snapshots(code: str):
    return []

@router.post("/stocks/{code}/snapshots")
async def save_stock_snapshot(code: str, data: dict):
    return {"status": "success", "id": "local_snap_001"}
