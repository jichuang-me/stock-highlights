from fastapi import APIRouter, Query, HTTPException
import asyncio
from typing import List
from ..models.api_models import SearchStock, HighlightsResponse, HighlightItem, StockSummary
from ..services.search_service import search_stock_enhanced
from ..services.market_service import (
    fetch_sina_prices_async, fetch_xueqiu_hotness_async, fetch_eastmoney_indicators_async
)
from ..services.announcement_service import fetch_announcements_async
from ..services.news_service import get_integrated_news_async
from ..services.ai_analyst import generate_advanced_highlights, generate_rule_based_highlights


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
    """
    获取个股多维研报 (全异步并发版)
    """
    try:
        # 1. 基础并行数据获取
        tasks = [
            fetch_sina_prices_async(code),
            fetch_xueqiu_hotness_async(code),
            fetch_eastmoney_indicators_async(code),
            fetch_announcements_async(code),
            get_integrated_news_async(code)
        ]
        
        # 并发启动 5 个网络 IO 任务
        price_data, hotness, indicators, raw_ann, news = await asyncio.gather(*tasks)
        stock_p = price_data.get(code, {"price": 0.0, "pct": 0.0})

        # 2. 调用高级 AI 研判
        ai_result = await generate_advanced_highlights(
            code=code,
            name=indicators.get("name", "加载中..."),
            indicators=indicators,
            news=news,
            announcements=raw_ann,
            hotness=hotness,
            price_info=stock_p
        )

        # 3. 结果合并与降级
        if not ai_result or "highlights" not in ai_result:
            ai_result = await generate_rule_based_highlights(code, raw_ann)

        # 4. 计算雷达图分数
        risks = [h for h in ai_result["highlights"] if h["side"] == "risk"]
        positives = [h for h in ai_result["highlights"] if h["side"] == "positive"]
        sentiment_label = ai_result.get("summary", {}).get("sentiment", "neutral")
        
        # 5. 组装最终响应
        return HighlightsResponse(
            stock={"code": code, "name": indicators.get("name", "未命名"), "industry": indicators.get("industry", "A股")},
            summary={
                "riskCount": len(risks),
                "positiveCount": len(positives),
                "sentiment": sentiment_label,
                "confidence": ai_result.get("summary", {}).get("confidence", 70)
            },
            marketImpression=ai_result["marketImpression"],
            headline=ai_result.get("headline", "智能透视分析完成"),
            price=stock_p["price"],
            pctChange=stock_p["pct"],
            outlook=ai_result["outlook"],
            highlights=ai_result["highlights"],
            liveNews=news,
            radar=[
                {"k": "人气值", "v": hotness.get("popularity", 50)},
                {"k": "指标评分", "v": indicators.get("score", 60)},
                {"k": "风险敞口", "v": min(len(risks) * 20, 100)},
                {"k": "亮点密度", "v": min(len(positives) * 20, 100)},
                {"k": "研报可信度", "v": ai_result.get("summary", {}).get("confidence", 80)}
            ]
        )
    except Exception as e:
        import logging
        logging.error(f"Highlight generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
