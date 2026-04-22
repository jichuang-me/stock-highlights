import asyncio
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from fastapi import APIRouter, Path, Query, Request

try:
    from ..models.api_models import (
        AnalystConsensus,
        BoardContext,
        FutureOutlook,
        HighlightsResponse,
        RadarPoint,
        SearchStock,
        ShortTermOutlook,
        StockInfo,
        StockSummary,
        ValuationOutlook,
        ValuationSnapshot,
    )
    from ..services.ai_analyst import get_cached_ai_summary, invalidate_ai_summary_cache, queue_ai_summary
    from ..services.announcement_service import fetch_announcements
    from ..services.highlight_engine import analyze_highlights
    from ..services.market_service import fetch_board_context, fetch_eastmoney_indicators, fetch_sina_prices, fetch_xueqiu_hotness
    from ..services.news_service import get_integrated_news
    from ..services.search_service import get_stock_profile, search_stock_enhanced
except ImportError:
    from models.api_models import (
        AnalystConsensus,
        BoardContext,
        FutureOutlook,
        HighlightsResponse,
        RadarPoint,
        SearchStock,
        ShortTermOutlook,
        StockInfo,
        StockSummary,
        ValuationOutlook,
        ValuationSnapshot,
    )
    from services.ai_analyst import get_cached_ai_summary, invalidate_ai_summary_cache, queue_ai_summary
    from services.announcement_service import fetch_announcements
    from services.highlight_engine import analyze_highlights
    from services.market_service import fetch_board_context, fetch_eastmoney_indicators, fetch_sina_prices, fetch_xueqiu_hotness
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
    return {"status": "ok", "version": "v4.15.0"}


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


def _build_news_fallback(highlights: List[dict], stock_price: dict) -> List[dict]:
    items: List[dict] = []
    seen_titles = set()

    for item in highlights:
        for evidence in item.get("evidence", []):
            title = (evidence.get("title") or "").strip()
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)
            items.append(
                {
                    "title": f"{item['label']}：{title}",
                    "time": evidence.get("published_at") or "最新",
                    "url": evidence.get("url") or "",
                    "source": evidence.get("source") or "公告补位",
                    "tag": "证据补位",
                }
            )
            if len(items) >= 3:
                return items

    price = float(stock_price.get("price") or 0)
    pct = float(stock_price.get("pct") or 0)
    if price:
        direction = "上涨" if pct > 0 else "下跌" if pct < 0 else "震荡"
        items.append(
            {
                "title": f"盘面反馈：当前价 {price:.2f}，涨跌幅 {pct:+.2f}%，短线仍在等待新的外部快讯确认。",
                "time": "当前",
                "url": "",
                "source": "行情反馈",
                "tag": direction,
            }
        )

    return items


def _metric_text(value: object, suffix: str = "") -> str:
    text = str(value or "").strip()
    if not text or text in {"-", "--", "None"}:
        return "[数据暂不可用]"
    return f"{text}{suffix}"


def _consensus_stance(sentiment: str) -> str:
    if sentiment == "positive":
        return "看好"
    if sentiment == "negative":
        return "看空"
    return "中性"


def _build_consensus(summary_sentiment: str, market_impression: str, board_context: Optional[Dict[str, Any]]) -> AnalystConsensus:
    stance = _consensus_stance(summary_sentiment)
    board_note = ""
    if board_context and board_context.get("roleReason"):
        board_note = f" {board_context['roleReason']}"
    rationale = f"{market_impression}{board_note}".strip()[:220] or "[数据暂不可用]"
    return AnalystConsensus(stance=stance, rationale=rationale)


def _build_short_term_outlook(highlights: List[dict], news: List[dict]) -> ShortTermOutlook:
    catalysts: List[str] = []

    for item in highlights:
        if item.get("side") == "positive":
            reason = str(item.get("importance") or item.get("why") or "").strip()
            if reason:
                catalysts.append(reason[:80])
        if len(catalysts) >= 3:
            break

    if len(catalysts) < 3:
        for item in news[:5]:
            title = str(item.get("title") or "").strip()
            if title:
                catalysts.append(title[:80])
            if len(catalysts) >= 3:
                break

    deduped: List[str] = []
    seen = set()
    for item in catalysts:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)

    positive_labels = [str(item.get("label") or "").strip() for item in highlights if item.get("side") == "positive"]
    risk_labels = [str(item.get("label") or "").strip() for item in highlights if item.get("side") == "risk"]

    if positive_labels:
        earnings_expectation = f"未来1-3个月更值得跟踪 {positive_labels[0]} 的兑现强度，若持续获得订单、业绩或价格验证，短期预期有望继续改善。"
    elif risk_labels:
        earnings_expectation = f"未来1-3个月更需要防守 {risk_labels[0]} 的继续发酵，若负面扰动扩散，短期预期可能进一步走弱。"
    else:
        earnings_expectation = "[数据暂不可用]"

    return ShortTermOutlook(
        catalysts=deduped[:3] or ["[数据暂不可用]"],
        earningsExpectation=earnings_expectation,
    )


def _build_valuation_outlook(indicators: dict, highlights: List[dict], board_context: Optional[Dict[str, Any]]) -> ValuationOutlook:
    pe = _metric_text(indicators.get("pe"), "x")
    pb = _metric_text(indicators.get("pb"), "x")
    roe = _metric_text(indicators.get("roe"), "%")
    current_level = f"当前估值：PE {pe}，PB {pb}，ROE {roe}。"

    target_range = "[数据暂不可用]"

    upside_drivers: List[str] = []
    downside_risks: List[str] = []

    for item in highlights:
        label = str(item.get("label") or "").strip()
        importance = str(item.get("importance") or "").strip()
        text = importance or label
        if item.get("side") == "positive" and len(upside_drivers) < 3 and text:
            upside_drivers.append(text[:88])
        if item.get("side") == "risk" and len(downside_risks) < 3 and text:
            downside_risks.append(text[:88])

    if board_context and board_context.get("summary") and len(upside_drivers) < 3:
        upside_drivers.append(str(board_context.get("summary"))[:88])

    if not upside_drivers:
        upside_drivers = ["[数据暂不可用]"]
    if not downside_risks:
        downside_risks = ["[数据暂不可用]"]

    return ValuationOutlook(
        currentLevel=current_level,
        targetRange=target_range,
        upsideDrivers=upside_drivers,
        downsideRisks=downside_risks,
    )


def _build_future_outlook(
    sentiment: str,
    market_impression: str,
    indicators: dict,
    highlights: List[dict],
    news: List[dict],
    board_context: Optional[Dict[str, Any]],
) -> FutureOutlook:
    return FutureOutlook(
        analystConsensus=_build_consensus(sentiment, market_impression, board_context),
        shortTermOutlook=_build_short_term_outlook(highlights, news),
        valuationOutlook=_build_valuation_outlook(indicators, highlights, board_context),
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
    news = news or _build_news_fallback(highlights, stock_price)
    board_context = await asyncio.to_thread(
        fetch_board_context,
        code,
        profile_info["name"],
        float(stock_price["pct"]),
        profile_info.get("industry") or "",
    )

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

    valuation_snapshot = ValuationSnapshot(
        pe=_metric_text(indicators.get("pe")),
        pb=_metric_text(indicators.get("pb")),
        roe=_metric_text(indicators.get("roe")),
    )
    future_outlook = _build_future_outlook(
        sentiment,
        market_impression,
        indicators,
        highlights,
        news,
        board_context,
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
        valuationSnapshot=valuation_snapshot,
        futureOutlook=future_outlook,
        highlights=highlights,
        liveNews=news,
        boardContext=BoardContext(**board_context),
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
