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
    from ..services.market_service import (
        fetch_board_context,
        fetch_company_profile_facts,
        fetch_eastmoney_indicators,
        fetch_sina_prices,
        fetch_xueqiu_hotness,
    )
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
    from services.market_service import (
        fetch_board_context,
        fetch_company_profile_facts,
        fetch_eastmoney_indicators,
        fetch_sina_prices,
        fetch_xueqiu_hotness,
    )
    from services.news_service import get_integrated_news
    from services.search_service import get_stock_profile, search_stock_enhanced


router = APIRouter(prefix="/api")


def _clamp(value: float, lower: float = 0, upper: float = 100) -> float:
    return max(lower, min(upper, value))


def _rule_sentiment(risk_count: int, positive_count: int, highlights: Optional[List[dict]] = None) -> str:
    if highlights:
        risk_score = sum(int(item.get("score") or 0) for item in highlights if item.get("side") == "risk")
        positive_score = sum(int(item.get("score") or 0) for item in highlights if item.get("side") == "positive")
        if risk_score >= positive_score + 8:
            return "negative"
        if positive_score >= risk_score + 8:
            return "positive"
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


def _build_rule_market_impression(
    company_name: str,
    industry: str,
    company_facts: Dict[str, Any],
    highlights: List[dict],
    hotness: dict,
    indicators: dict,
    board_context: Optional[Dict[str, Any]],
) -> str:
    business_summary = str(company_facts.get("businessSummary") or "").strip()
    product_types = company_facts.get("productTypes") or []
    key_business = business_summary or (f"主营覆盖 {product_types[0]}" if product_types else "")
    industry_label = board_context.get("industry") if board_context else ""
    if not industry_label or industry_label in {"深A", "沪A", "北A", "创业板", "科创板"}:
        industry_label = industry
    has_new_materials = any(
        keyword in f"{business_summary} {' '.join(product_types)}"
        for keyword in ["新材料", "电解液", "VC", "涂层", "锂电", "新能源"]
    )

    profile_parts: List[str] = []
    if key_business:
        if has_new_materials and ("家纺" in key_business or "纺织" in key_business):
            profile_parts.append(
                f"市场更容易把 {company_name} 看成“{industry_label or '传统制造'} + 新材料”双主业公司，{key_business.rstrip('。')}。"
            )
        else:
            profile_parts.append(
                f"市场当前对 {company_name} 的核心认知仍围绕 {industry_label or '主营业务'} 展开，{key_business.rstrip('。')}。"
            )
    elif industry_label:
        profile_parts.append(f"市场通常先把 {company_name} 归到“{industry_label}”这条行业线里定价。")

    if highlights:
        top_item = highlights[0]
        profile_parts.append(f"当前最强影响因子是“{top_item['label']}”，{top_item['importance']}")
    else:
        profile_parts.append("当前公告侧没有形成特别强的新主线，更多是等待经营和价格层面的新验证。")

    if board_context and board_context.get("roleReason"):
        profile_parts.append(board_context["roleReason"])

    pe = _metric_text(indicators.get("pe"), "x")
    pb = _metric_text(indicators.get("pb"), "x")
    roe = _metric_text(indicators.get("roe"), "%")
    metric_bits: List[str] = []
    if pe != "[数据暂不可用]":
        metric_bits.append(f"PE {pe}")
    if pb != "[数据暂不可用]":
        metric_bits.append(f"PB {pb}")
    if roe != "[数据暂不可用]":
        metric_bits.append(f"ROE {roe}")
    if metric_bits:
        profile_parts.append("当前可见的估值/盈利质量指标是 " + "，".join(metric_bits) + "。")

    rank = str(hotness.get("rank") or "").strip()
    if rank and rank != "关注 0" and "暂不可用" not in rank:
        profile_parts.append(f"市场关注度方面，目前处于 {rank}。")

    return " ".join(profile_parts)[:280] or "[数据暂不可用]"


def _impact_level(score: int) -> str:
    if score >= 85:
        return "高"
    if score >= 70:
        return "中"
    return "低"


def _build_supplemental_positive_highlights(
    code: str,
    company_facts: Dict[str, Any],
    indicators: Dict[str, Any],
) -> List[Dict[str, Any]]:
    business_summary = str(company_facts.get("businessSummary") or "").strip()
    product_types = company_facts.get("productTypes") or []
    product_names = company_facts.get("productNames") or []
    condensed_products = "、".join((product_types[:4] or product_names[:4])) or business_summary
    joined = " ".join([business_summary, *product_types, *product_names])
    generated: List[Dict[str, Any]] = []

    if business_summary and ("、" in business_summary or "和" in business_summary):
        generated.append(
            {
                "id": f"profile-mix-{code}",
                "side": "positive",
                "label": "双主业/业务结构",
                "score": 72,
                "category": "经营结构",
                "why": business_summary,
                "thesis": f"公司主营已经不是单一业务线，而是围绕“{business_summary}”展开，经营韧性相对更强。",
                "importance": "主营业务本身呈现双主业或多业务结构，市场更容易把它理解成“基本盘 + 新增长点”的组合。",
                "interpretation": "多业务结构能提升估值叙事空间，但关键仍是新业务能否持续放量。",
                "game_view": "后续要继续跟踪新业务收入占比、盈利质量和订单兑现，而不只是看概念标签。",
                "evidenceChain": [
                    f"起点：主营业务披露为“{business_summary}”。",
                    "强化：业务结构已经不再是单一主业，说明公司存在新的增长抓手。",
                    "当前关键：市场会更关注新业务贡献是否能继续抬升整体业绩和估值预期。",
                    "后续验证：看新业务收入、利润占比和订单进展。",
                ],
                "evidence": [
                    {
                        "source": "同花顺主营介绍",
                        "title": business_summary,
                        "published_at": "最新",
                        "url": "",
                    }
                ],
            }
        )

    if any(keyword in joined for keyword in ["新材料", "电解液", "VC", "涂层", "锂电", "新能源"]):
        detail = condensed_products
        generated.append(
            {
                "id": f"profile-growth-{code}",
                "side": "positive",
                "label": "新材料/成长业务布局",
                "score": 78,
                "category": "成长属性",
                "why": detail,
                "thesis": f"公司业务描述已经明确覆盖 {detail}，这类业务更容易给公司带来成长股属性。",
                "importance": "当主营里已经包含新材料、电池添加剂、功能涂层等方向时，市场会更愿意给成长性而不是纯制造业估值。",
                "interpretation": "成长业务能否真正抬升估值，取决于订单、产能利用率和毛利率能否持续兑现。",
                "game_view": "看新业务是否继续进入头部客户、放量交付并提升利润贡献。",
                "evidenceChain": [
                    f"起点：主营/产品类型包含“{detail}”。",
                    "强化：这说明公司已经具备超出传统主业的成长业务布局。",
                    "当前关键：市场会盯着新业务收入和利润贡献，而不是只看概念本身。",
                    "后续验证：看客户突破、价格趋势和盈利能力。",
                ],
                "evidence": [
                    {
                        "source": "同花顺主营介绍",
                        "title": detail,
                        "published_at": "最新",
                        "url": "",
                    }
                ],
            }
        )

    pe = _metric_text(indicators.get("pe"), "x")
    pb = _metric_text(indicators.get("pb"), "x")
    roe = _metric_text(indicators.get("roe"), "%")
    if pe != "[数据暂不可用]" or roe != "[数据暂不可用]":
        generated.append(
            {
                "id": f"profile-valuation-{code}",
                "side": "positive",
                "label": "估值与盈利质量可跟踪",
                "score": 64,
                "category": "估值视角",
                "why": f"PE {pe} / PB {pb} / ROE {roe}",
                "thesis": f"当前至少还能跟踪到 PE {pe}、PB {pb}、ROE {roe} 这些基础估值和盈利质量指标，便于把短期交易和中期价值判断放到一起看。",
                "importance": "价值投资视角下的短线，不是只看情绪催化，也要看估值和盈利质量是否支持市场继续给溢价。",
                "interpretation": "如果估值和盈利质量长期背离，短期强势通常更难持续。",
                "game_view": "后续继续看估值是否进入极端区间，以及盈利质量能否继续匹配当前预期。",
                "evidenceChain": [
                    "起点：当前接口已返回 PE、PB、ROE 等基础指标。",
                    "强化：这些指标能帮助区分纯情绪交易和有基本面承托的交易。",
                    "当前关键：估值扩张是否仍有空间，要看盈利质量是否同步改善。",
                    "后续验证：看季报、盈利和估值区间变化。",
                ],
                "evidence": [
                    {
                        "source": "东方财富指标",
                        "title": f"PE {pe} / PB {pb} / ROE {roe}",
                        "published_at": "当前",
                        "url": "",
                    }
                ],
            }
        )

    return generated[:3]
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
        if str(item.get("id") or "").startswith("profile-growth"):
            catalysts.append("新材料/成长业务的订单、客户验证和盈利贡献是否继续提升。")
        elif str(item.get("id") or "").startswith("profile-mix"):
            catalysts.append("双主业结构里成长业务收入占比和毛利率是否继续抬升。")
        elif str(item.get("id") or "").startswith("profile-valuation"):
            catalysts.append("估值是否仍处于可接受区间，以及基本面能否支撑继续给溢价。")
        if len(catalysts) >= 3:
            break

    for item in highlights:
        if item.get("side") == "positive":
            if str(item.get("id") or "").startswith("profile-"):
                reason = ""
            else:
                reason = str(item.get("importance") or item.get("why") or item.get("label") or "").strip()
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
    company_facts: Dict[str, Any],
) -> FutureOutlook:
    business_summary = str(company_facts.get("businessSummary") or "").strip()
    product_types = company_facts.get("productTypes") or []
    enriched_highlights = list(highlights)
    if business_summary and not any(item.get("side") == "positive" for item in enriched_highlights):
        enriched_highlights.extend(_build_supplemental_positive_highlights("profile", company_facts, indicators))

    analyst_consensus = _build_consensus(sentiment, market_impression, board_context)
    if business_summary:
        analyst_consensus = AnalystConsensus(
            stance=analyst_consensus.stance,
            rationale=f"{analyst_consensus.rationale} 主营业务显示公司核心经营线围绕“{business_summary}”展开。".strip()[:260],
        )

    short_term = _build_short_term_outlook(enriched_highlights, news)
    if business_summary and short_term.earningsExpectation != "[数据暂不可用]":
        short_term = ShortTermOutlook(
            catalysts=short_term.catalysts,
            earningsExpectation=f"{short_term.earningsExpectation} 同时继续跟踪主营“{business_summary}”里更高景气业务的兑现进度。",
        )

    valuation_outlook = _build_valuation_outlook(indicators, enriched_highlights, board_context)
    if product_types and valuation_outlook.currentLevel != "[数据暂不可用]":
        valuation_outlook = ValuationOutlook(
            currentLevel=f"{valuation_outlook.currentLevel} 当前估值是否还有提升空间，也取决于 {product_types[0]} 等业务能否继续提供成长性。",
            targetRange=valuation_outlook.targetRange,
            upsideDrivers=valuation_outlook.upsideDrivers,
            downsideRisks=valuation_outlook.downsideRisks,
        )

    return FutureOutlook(
        analystConsensus=analyst_consensus,
        shortTermOutlook=short_term,
        valuationOutlook=valuation_outlook,
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
        company_facts,
    ) = await asyncio.gather(
        asyncio.to_thread(fetch_sina_prices, f"{prefix}{code}"),
        asyncio.to_thread(fetch_xueqiu_hotness, code),
        asyncio.to_thread(fetch_eastmoney_indicators, code),
        asyncio.to_thread(fetch_announcements, code),
        asyncio.to_thread(get_integrated_news, code),
        asyncio.to_thread(get_stock_profile, code),
        asyncio.to_thread(fetch_company_profile_facts, code),
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
    if not positives:
        supplemental_positives = _build_supplemental_positive_highlights(code, company_facts, indicators)
        highlights.extend(supplemental_positives)
        positives = [item for item in highlights if item["side"] == "positive"]
        highlights = sorted(highlights, key=lambda item: item["score"], reverse=True)
    sentiment = _rule_sentiment(len(risks), len(positives))

    market_impression = _build_rule_market_impression(
        company_name or code,
        industry or "",
        company_facts,
        highlights,
        hotness,
        indicators,
        board_context,
    )
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
        company_facts=company_facts,
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
            company_facts,
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
        company_facts,
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
