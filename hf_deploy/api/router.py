from fastapi import APIRouter, Query, HTTPException
from typing import List
from ..models.api_models import SearchStock, HighlightsResponse, HighlightItem, StockSummary
from ..services.search_service import search_stock_enhanced
from ..services.market_service import fetch_sina_prices, fetch_xueqiu_hotness, fetch_eastmoney_indicators
from ..services.announcement_service import fetch_announcements
from ..services.highlight_engine import analyze_highlights
from ..services.news_service import get_integrated_news

router = APIRouter(prefix="/api")

@router.get("/health")
async def health():
    return {"status": "ok", "version": "v4.3.1-STABLE-REFL"}

@router.get("/the_ultimate_truth_v431")
async def the_truth():
    return {"truth": "The backend is now structured and pure.", "timestamp": "2026-04-16"}

@router.get("/stocks/search", response_model=List[SearchStock])
async def search(q: str = Query(..., min_length=1)):
    return search_stock_enhanced(q)

@router.get("/highlights", response_model=HighlightsResponse)
async def get_highlights(code: str = Query(..., pattern="^\d{6}$")):
    # 1. 获取基础报价与涨跌幅
    prefix = "sh" if code.startswith("6") else "sz"
    prices = fetch_sina_prices(f"{prefix}{code}")
    stock_p = prices.get(code, {"price": 0.0, "pct": 0.0})
    
    # 2. 获取人气与热度
    hotness = fetch_xueqiu_hotness(code)
    
    # 3. 获取基本面指标
    indicators = fetch_eastmoney_indicators(code)
    
    # 4. 获取原始公告并分析高亮
    raw_ann = fetch_announcements(code)
    highlights_data = analyze_highlights(raw_ann)
    
    # 5. 获取实时资讯
    news = get_integrated_news(code)
    
    # 6. 计算摘要
    risks = [h for h in highlights_data if h["side"] == "risk"]
    positives = [h for h in highlights_data if h["side"] == "positive"]
    sentiment_label = "neutral"
    if len(risks) > len(positives): sentiment_label = "negative"
    elif len(positives) > len(risks): sentiment_label = "positive"
    
    # 7. 组装响应
    return HighlightsResponse(
        stock={"code": code, "name": "加载中..."}, # 名称通常由前端搜索结果缓存或在此补充
        summary=StockSummary(
            riskCount=len(risks),
            positiveCount=len(positives),
            sentiment=sentiment_label
        ),
        marketImpression=f"当前热度：{hotness['rank']} | PE: {indicators['pe']} | ROE: {indicators['roe']}",
        price=stock_p["price"],
        pctChange=stock_p["pct"],
        highlights=highlights_data,
        liveNews=news,
        radar=[
            {"subject": "人气值", "A": hotness["popularity"], "fullMark": 100},
            {"subject": "波动率", "A": abs(stock_p["pct"]) * 10, "fullMark": 100},
            {"subject": "机构关注", "A": 50, "fullMark": 100},
            {"subject": "新闻密度", "A": len(news) * 10, "fullMark": 100},
            {"subject": "风险敞口", "A": len(risks) * 20, "fullMark": 100}
        ]
    )
