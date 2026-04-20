from typing import List

from fastapi import APIRouter, Path, Query

try:
    from ..models.api_models import HighlightsResponse, RadarPoint, SearchStock, StockInfo, StockSummary
    from ..services.announcement_service import fetch_announcements
    from ..services.highlight_engine import analyze_highlights
    from ..services.market_service import fetch_eastmoney_indicators, fetch_sina_prices, fetch_xueqiu_hotness
    from ..services.news_service import get_integrated_news
    from ..services.search_service import get_stock_profile, search_stock_enhanced
except ImportError:
    from models.api_models import HighlightsResponse, RadarPoint, SearchStock, StockInfo, StockSummary
    from services.announcement_service import fetch_announcements
    from services.highlight_engine import analyze_highlights
    from services.market_service import fetch_eastmoney_indicators, fetch_sina_prices, fetch_xueqiu_hotness
    from services.news_service import get_integrated_news
    from services.search_service import get_stock_profile, search_stock_enhanced


router = APIRouter(prefix="/api")


def _clamp(value: float, lower: float = 0, upper: float = 100) -> float:
    return max(lower, min(upper, value))


@router.get("/health")
async def health():
    return {"status": "ok", "version": "v4.5.0"}


@router.get("/stocks/search", response_model=List[SearchStock])
async def search(q: str = Query(..., min_length=1)):
    return search_stock_enhanced(q)


def _build_highlights_response(code: str) -> HighlightsResponse:
    prefix = "sh" if code.startswith("6") else "sz"
    stock_price = fetch_sina_prices(f"{prefix}{code}").get(code, {"price": 0.0, "pct": 0.0})
    hotness = fetch_xueqiu_hotness(code)
    indicators = fetch_eastmoney_indicators(code)
    raw_ann = fetch_announcements(code)
    highlights = analyze_highlights(raw_ann)
    news = get_integrated_news(code)
    profile = get_stock_profile(code)

    risks = [item for item in highlights if item["side"] == "risk"]
    positives = [item for item in highlights if item["side"] == "positive"]
    sentiment = "neutral"
    if len(risks) > len(positives):
        sentiment = "negative"
    elif len(positives) > len(risks):
        sentiment = "positive"

    company_name = raw_ann[0].get("secName") if raw_ann else profile["name"]
    industry = profile["industry"] or None

    if highlights:
        market_impression = (
            f"当前公告面识别为 {sentiment}，共命中 {len(highlights)} 条高价值事件。"
            f" 关注度 {hotness['rank']}，PE {indicators['pe']}，ROE {indicators['roe']}。"
        )
    else:
        market_impression = (
            f"当前尚未识别到高价值公告事件。关注度 {hotness['rank']}，"
            f"PE {indicators['pe']}，ROE {indicators['roe']}。"
        )

    radar = [
        RadarPoint(k="人气", v=_clamp(float(hotness["popularity"]))),
        RadarPoint(k="波动", v=_clamp(abs(float(stock_price["pct"])) * 10)),
        RadarPoint(k="新闻", v=_clamp(len(news) * 12)),
        RadarPoint(k="风险", v=_clamp(len(risks) * 20)),
        RadarPoint(k="亮点", v=_clamp(len(positives) * 20)),
    ]

    return HighlightsResponse(
        stock=StockInfo(code=code, name=company_name or code, industry=industry),
        summary=StockSummary(
            riskCount=len(risks),
            positiveCount=len(positives),
            sentiment=sentiment,
        ),
        marketImpression=market_impression,
        price=float(stock_price["price"]),
        pctChange=float(stock_price["pct"]),
        highlights=highlights,
        liveNews=news,
        radar=radar,
    )


@router.get("/stocks/{code}/highlights", response_model=HighlightsResponse)
async def get_stock_highlights(code: str = Path(..., pattern=r"^\d{6}$")):
    return _build_highlights_response(code)


@router.get("/highlights", response_model=HighlightsResponse, include_in_schema=False)
async def get_highlights_legacy(code: str = Query(..., pattern=r"^\d{6}$")):
    return _build_highlights_response(code)
