import asyncio
from typing import Dict, List, Optional
from urllib.parse import unquote

from fastapi import APIRouter, Path, Query, Request

try:
    from ..models.api_models import HighlightsResponse, RadarPoint, SearchStock, StockInfo, StockSummary
    from ..services.ai_analyst import get_cached_ai_summary, invalidate_ai_summary_cache, queue_ai_summary
    from ..services.announcement_service import fetch_announcements
    from ..services.highlight_engine import analyze_highlights
    from ..services.market_service import fetch_eastmoney_indicators, fetch_sina_prices, fetch_xueqiu_hotness
    from ..services.news_service import get_integrated_news
    from ..services.search_service import get_stock_profile, search_stock_enhanced
except ImportError:
    from models.api_models import HighlightsResponse, RadarPoint, SearchStock, StockInfo, StockSummary
    from services.ai_analyst import get_cached_ai_summary, invalidate_ai_summary_cache, queue_ai_summary
    from services.announcement_service import fetch_announcements
    from services.highlight_engine import analyze_highlights
    from services.market_service import fetch_eastmoney_indicators, fetch_sina_prices, fetch_xueqiu_hotness
    from services.news_service import get_integrated_news
    from services.search_service import get_stock_profile, search_stock_enhanced


router = APIRouter(prefix="/api")


def _clamp(value: float, lower: float = 0, upper: float = 100) -> float:
    return max(lower, min(upper, value))


def _rule_sentiment(risk_count: int, positive_count: int) -> str:
    if risk_count > positive_count:
        return "negative"
    if positive_count > risk_count:
        return "positive"
    return "neutral"


def _extract_ai_profile(request: Request) -> Optional[Dict[str, str]]:
    def decode(name: str) -> str:
        return unquote((request.headers.get(name) or "").strip())

    mode = decode("X-AI-Profile-Mode")
    vendor = decode("X-AI-Profile-Vendor")
    model = decode("X-AI-Profile-Model")

    if not mode and not vendor and not model:
        return None

    return {
        "mode": mode or "server",
        "label": decode("X-AI-Profile-Label") or "系统默认",
        "kind": decode("X-AI-Profile-Kind") or "api",
        "vendor": vendor,
        "model": model,
        "baseUrl": decode("X-AI-Profile-Base-Url"),
        "apiKey": decode("X-AI-Profile-Api-Key"),
    }


@router.get("/health")
async def health():
    return {"status": "ok", "version": "v4.11.0"}


@router.get("/stocks/search", response_model=List[SearchStock])
async def search(q: str = Query(..., min_length=1)):
    return search_stock_enhanced(q)


def _build_rule_market_impression(highlights: List[dict], hotness: dict, indicators: dict) -> str:
    if highlights:
        top_item = highlights[0]
        return (
            f"当前最强主线是{top_item['label']}。{top_item['importance']}"
            f" 市场关注度 {hotness['rank']}，PE {indicators['pe']}，ROE {indicators['roe']}。"
        )

    return (
        f"当前尚未识别到强驱动公告。"
        f" 市场关注度 {hotness['rank']}，PE {indicators['pe']}，ROE {indicators['roe']}。"
    )


async def _build_highlights_response(
    code: str,
    request: Request,
    refresh: bool = False,
) -> HighlightsResponse:
    prefix = "sh" if code.startswith("6") else "sz"
    profile = _extract_ai_profile(request)

    (
        all_prices,
        hotness,
        indicators,
        raw_ann,
        news,
        profile_info,
    ) = await asyncio.gather(
        asyncio.to_thread(fetch_sina_prices, f"{prefix}{code}"),
        asyncio.to_thread(fetch_xueqiu_hotness, code),
        asyncio.to_thread(fetch_eastmoney_indicators, code),
        asyncio.to_thread(fetch_announcements, code),
        asyncio.to_thread(get_integrated_news, code),
        asyncio.to_thread(get_stock_profile, code),
    )

    stock_price = all_prices.get(code, {"price": 0.0, "pct": 0.0})
    highlights = analyze_highlights(raw_ann)

    company_name = raw_ann[0].get("secName") if raw_ann else profile_info["name"]
    industry = profile_info["industry"] or None

    risks = [item for item in highlights if item["side"] == "risk"]
    positives = [item for item in highlights if item["side"] == "positive"]
    sentiment = _rule_sentiment(len(risks), len(positives))

    market_impression = _build_rule_market_impression(highlights, hotness, indicators)
    headline = None
    analysis_mode = "rules"
    analysis_model = None
    analysis_pending = False
    analysis_updated_at = None
    analysis_profile_label = profile.get("label") if profile else "系统默认"
    ai_top_positive_label = None
    ai_top_risk_label = None
    ai_turning_point = None

    ai_summary, cache_key = await asyncio.to_thread(
        get_cached_ai_summary,
        code=code,
        name=company_name or code,
        indicators=indicators,
        news=news,
        announcements=raw_ann,
        highlights=highlights,
        hotness=hotness,
        price_info=stock_price,
        profile=profile,
    )

    if refresh:
        await asyncio.to_thread(invalidate_ai_summary_cache, cache_key)
        ai_summary = None

    if ai_summary:
        market_impression = ai_summary["marketImpression"]
        headline = ai_summary["headline"]
        sentiment = ai_summary.get("sentiment", sentiment)
        analysis_mode = "ai"
        analysis_model = ai_summary.get("model")
        analysis_updated_at = ai_summary.get("updatedAt")
        analysis_profile_label = ai_summary.get("profileLabel", analysis_profile_label)
        ai_top_positive_label = ai_summary.get("topPositiveLabel")
        ai_top_risk_label = ai_summary.get("topRiskLabel")
        ai_turning_point = ai_summary.get("keyTurningPoint")
    else:
        analysis_pending = await asyncio.to_thread(
            queue_ai_summary,
            cache_key,
            code,
            company_name or code,
            indicators,
            news,
            raw_ann,
            highlights,
            hotness,
            stock_price,
            profile,
        )

    radar = [
        RadarPoint(k="人气热度", v=_clamp(float(hotness["popularity"]))),
        RadarPoint(k="盘中波动", v=_clamp(abs(float(stock_price["pct"])) * 10)),
        RadarPoint(k="消息密度", v=_clamp(len(news) * 12)),
        RadarPoint(k="风险压力", v=_clamp(len(risks) * 20)),
        RadarPoint(k="看点强度", v=_clamp(len(positives) * 20)),
    ]

    return HighlightsResponse(
        stock=StockInfo(code=code, name=company_name or code, industry=industry),
        summary=StockSummary(
            riskCount=len(risks),
            positiveCount=len(positives),
            sentiment=sentiment,
        ),
        headline=headline,
        marketImpression=market_impression,
        analysisMode=analysis_mode,
        analysisPending=analysis_pending,
        analysisModel=analysis_model,
        analysisUpdatedAt=analysis_updated_at,
        analysisProfileLabel=analysis_profile_label,
        aiTopPositiveLabel=ai_top_positive_label,
        aiTopRiskLabel=ai_top_risk_label,
        aiTurningPoint=ai_turning_point,
        price=float(stock_price["price"]),
        pctChange=float(stock_price["pct"]),
        highlights=highlights,
        liveNews=news,
        radar=radar,
    )


@router.get("/stocks/{code}/highlights", response_model=HighlightsResponse)
async def get_stock_highlights(
    request: Request,
    code: str = Path(..., pattern=r"^\d{6}$"),
    refresh: bool = Query(False),
):
    return await _build_highlights_response(code, request, refresh=refresh)


@router.get("/highlights", response_model=HighlightsResponse, include_in_schema=False)
async def get_highlights_legacy(
    request: Request,
    code: str = Query(..., pattern=r"^\d{6}$"),
    refresh: bool = Query(False),
):
    return await _build_highlights_response(code, request, refresh=refresh)
