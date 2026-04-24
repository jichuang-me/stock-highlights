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
        fetch_analyst_snapshot,
        fetch_board_context,
        fetch_company_profile_facts,
        fetch_eastmoney_indicators,
        fetch_financial_snapshot,
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
        fetch_analyst_snapshot,
        fetch_board_context,
        fetch_company_profile_facts,
        fetch_eastmoney_indicators,
        fetch_financial_snapshot,
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
    financial_snapshot: Optional[Dict[str, Any]],
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

    annual_profit_yoy = (financial_snapshot or {}).get("annualParentNetProfitYoY")
    quarterly_profit_yoy = (financial_snapshot or {}).get("quarterlyParentNetProfitYoY")
    annual_revenue_yoy = (financial_snapshot or {}).get("annualRevenueYoY")
    dividend_per10 = (financial_snapshot or {}).get("latestDividendPer10")
    if annual_profit_yoy is not None or quarterly_profit_yoy is not None:
        profile_parts.append(
            f"最新财务截面上，年报归母净利润同比 {_yoy_text(annual_profit_yoy)}，最新季度同比 {_yoy_text(quarterly_profit_yoy)}。"
        )
    if annual_revenue_yoy is not None and annual_revenue_yoy < 0:
        profile_parts.append(f"但收入端仍有压力，年报营收同比 {_yoy_text(annual_revenue_yoy)}，需要继续验证改善是否可持续。")
    if dividend_per10 is not None and dividend_per10 > 0:
        profile_parts.append(f"公司还披露了每10股派息 {dividend_per10:.2f} 元的分红方案，对市场认知有一定支撑。")

    rank = str(hotness.get("rank") or "").strip()
    if rank and rank != "关注 0" and "暂不可用" not in rank:
        profile_parts.append(f"市场关注度方面，目前处于 {rank}。")

    return " ".join(profile_parts)[:520] or "[数据暂不可用]"


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


def _money_text(value: Optional[float]) -> str:
    if value is None:
        return "[数据暂不可用]"
    abs_value = abs(value)
    if abs_value >= 1e8:
        return f"{value / 1e8:.2f} 亿元"
    if abs_value >= 1e4:
        return f"{value / 1e4:.2f} 万元"
    return f"{value:.2f} 元"


def _yoy_text(value: Optional[float]) -> str:
    if value is None:
        return "[数据暂不可用]"
    return f"{value:+.2f}%"


def _build_financial_highlights(code: str, financial_snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
    generated: List[Dict[str, Any]] = []

    annual_profit_yoy = financial_snapshot.get("annualParentNetProfitYoY")
    quarterly_profit_yoy = financial_snapshot.get("quarterlyParentNetProfitYoY")
    annual_profit = financial_snapshot.get("annualParentNetProfit")
    quarterly_profit = financial_snapshot.get("quarterlyParentNetProfit")
    annual_label = financial_snapshot.get("annualReportLabel") or "最新年报"
    quarterly_label = financial_snapshot.get("quarterlyReportLabel") or "最新季度"

    if (
        (annual_profit_yoy is not None and annual_profit_yoy >= 15)
        or (quarterly_profit_yoy is not None and quarterly_profit_yoy >= 20)
    ):
        generated.append(
            {
                "id": f"financial-profit-{code}",
                "side": "positive",
                "label": "业绩增长与利润兑现",
                "score": 86,
                "category": "业绩兑现",
                "why": f"{annual_label}归母净利润 {_money_text(annual_profit)}，同比 {_yoy_text(annual_profit_yoy)}；{quarterly_label}归母净利润 {_money_text(quarterly_profit)}，同比 {_yoy_text(quarterly_profit_yoy)}。",
                "thesis": "利润增长已经从报表层面得到验证，这类依据比单纯公告催化更接近价值投资者会持续跟踪的核心逻辑。",
                "importance": "如果年报和最新季度利润都保持较强增长，市场更容易把它理解为基本面改善而不是一次性刺激。",
                "interpretation": "利润增长能否继续支撑估值抬升，取决于其持续性以及能否同步扩散到收入和现金流层面。",
                "game_view": "后续重点看半年报和后续季度利润能否继续兑现，而不是只看单季高点。",
                "evidenceChain": [
                    f"起点：{annual_label}归母净利润 {_money_text(annual_profit)}，同比 {_yoy_text(annual_profit_yoy)}。",
                    f"强化：{quarterly_label}归母净利润 {_money_text(quarterly_profit)}，同比 {_yoy_text(quarterly_profit_yoy)}。",
                    "当前关键：利润增长是否由主营改善驱动，而不是单次非经常项目拉动。",
                    "后续验证：看后续季度收入、扣非利润和现金流能否继续同步改善。",
                ],
                "evidence": [
                    {
                        "source": "东方财富利润表",
                        "title": f"{annual_label} / {quarterly_label} 利润增长",
                        "published_at": "最新",
                        "url": "",
                    }
                ],
            }
        )

    operate_cash = financial_snapshot.get("quarterlyOperateCash")
    operate_cash_yoy = financial_snapshot.get("quarterlyOperateCashYoY")
    if operate_cash is not None and operate_cash > 0 and (operate_cash_yoy is None or operate_cash_yoy >= 20):
        generated.append(
            {
                "id": f"financial-cashflow-{code}",
                "side": "positive",
                "label": "经营现金流改善",
                "score": 78,
                "category": "现金流质量",
                "why": f"{quarterly_label}经营活动现金流净额 {_money_text(operate_cash)}，同比 {_yoy_text(operate_cash_yoy)}。",
                "thesis": "利润能不能转成现金，是区分账面增长和真实经营改善的关键一步。",
                "importance": "经营现金流同步改善，通常说明回款和经营质量更可能支撑当前业绩增长。",
                "interpretation": "现金流改善会提高市场对利润质量和分红能力的信任度。",
                "game_view": "后续继续看回款、存货和应收项变化，确认现金流改善不是季节性扰动。",
                "evidenceChain": [
                    f"起点：{quarterly_label}经营活动现金流净额 {_money_text(operate_cash)}。",
                    f"强化：同比变化 {_yoy_text(operate_cash_yoy)}，现金流并未弱于利润表现。",
                    "当前关键：经营现金流是否持续好于利润增速，决定市场是否认可其质量。",
                    "后续验证：看后续季度现金流、应收账款和存货周转变化。",
                ],
                "evidence": [
                    {
                        "source": "东方财富现金流量表",
                        "title": f"{quarterly_label} 经营现金流净额",
                        "published_at": "最新",
                        "url": "",
                    }
                ],
            }
        )

    dividend_per10 = financial_snapshot.get("latestDividendPer10")
    if dividend_per10 is not None and dividend_per10 > 0:
        generated.append(
            {
                "id": f"financial-dividend-{code}",
                "side": "positive",
                "label": "分红与股东回报",
                "score": 70,
                "category": "股东回报",
                "why": f"最新分红方案为每10股派息 {dividend_per10:.2f} 元，当前进度 {financial_snapshot.get('latestDividendProgress') or '[数据暂不可用]'}。",
                "thesis": "持续分红说明公司并非只有增长叙事，也愿意把经营成果回馈给股东。",
                "importance": "对价值投资视角下的短期分析来说，分红能提高安全边际，也能部分验证现金流和盈利质量。",
                "interpretation": "高分红本身不是主线，但会改善市场对公司治理和股东回报的认知。",
                "game_view": "后续看分红方案落地、分红比例是否稳定，以及是否影响后续资本开支和成长投入。",
                "evidenceChain": [
                    f"起点：最新公告分红方案为每10股派息 {dividend_per10:.2f} 元。",
                    f"强化：当前分红进度为 {financial_snapshot.get('latestDividendProgress') or '[数据暂不可用]'}。",
                    "当前关键：市场会把分红视为现金流和治理稳定性的侧面验证。",
                    "后续验证：看分红落地后公司是否仍能保持成长投入和利润兑现。",
                ],
                "evidence": [
                    {
                        "source": "历史分红明细",
                        "title": f"{financial_snapshot.get('latestDividendDate') or '最新'} 分红方案",
                        "published_at": financial_snapshot.get("latestDividendDate") or "最新",
                        "url": "",
                    }
                ],
            }
        )

    annual_revenue_yoy = financial_snapshot.get("annualRevenueYoY")
    if annual_revenue_yoy is not None and annual_revenue_yoy < 0:
        generated.append(
            {
                "id": f"financial-revenue-risk-{code}",
                "side": "risk",
                "label": "收入增长承压",
                "score": 72,
                "category": "经营压力",
                "why": f"{annual_label}营业总收入 {_money_text(financial_snapshot.get('annualRevenue'))}，同比 {_yoy_text(annual_revenue_yoy)}。",
                "thesis": "如果收入端已经转弱，利润改善的持续性就需要更谨慎看待。",
                "importance": "收入承压意味着公司不能只靠利润率改善或一次性因素支撑估值，后续增长质量需要再验证。",
                "interpretation": "市场会继续追问收入下滑是周期扰动、业务切换，还是需求端已经转弱。",
                "game_view": "后续重点看核心主业订单、销量和收入恢复节奏。",
                "evidenceChain": [
                    f"起点：{annual_label}营业总收入 {_money_text(financial_snapshot.get('annualRevenue'))}，同比 {_yoy_text(annual_revenue_yoy)}。",
                    "强化：收入没有同步走强时，利润增长更容易被质疑成阶段性改善。",
                    "当前关键：收入何时恢复增长，决定估值修复能否真正站稳。",
                    "后续验证：看主营订单、销量和后续季度收入变化。",
                ],
                "evidence": [
                    {
                        "source": "东方财富利润表",
                        "title": f"{annual_label} 营业总收入",
                        "published_at": "最新",
                        "url": "",
                    }
                ],
            }
        )

    return generated


def _consensus_stance(sentiment: str) -> str:
    if sentiment == "positive":
        return "看好"
    if sentiment == "negative":
        return "看空"
    return "中性"


def _build_consensus(
    summary_sentiment: str,
    market_impression: str,
    board_context: Optional[Dict[str, Any]],
    analyst_snapshot: Optional[Dict[str, Any]],
    financial_snapshot: Optional[Dict[str, Any]],
) -> AnalystConsensus:
    stance = (analyst_snapshot or {}).get("stance") or _consensus_stance(summary_sentiment)
    board_note = ""
    if board_context and board_context.get("roleReason"):
        board_note = f" {board_context['roleReason']}"
    rating_summary = (analyst_snapshot or {}).get("ratingSummary") or ""
    target_range = (analyst_snapshot or {}).get("targetRange") or ""
    target_space = (analyst_snapshot or {}).get("targetSpace") or ""
    if (financial_snapshot or {}).get("latestDividendPer10"):
        catalysts.append(
            f"鍒嗙孩鏂规钀藉湴杩涘害锛氭瘡10鑲℃淳鎭?{financial_snapshot['latestDividendPer10']:.2f} 鍏冿紝褰撳墠杩涘害 {financial_snapshot.get('latestDividendProgress') or '[鏁版嵁鏆備笉鍙敤]'}銆?"
        )
    if (financial_snapshot or {}).get("quarterlyParentNetProfitYoY") is not None:
        catalysts.append(
            f"{financial_snapshot.get('quarterlyReportLabel') or '鏈€鏂板崟瀛ｅ害'}涓氱哗楠岃瘉锛氬綊姣嶅噣鍒╂鼎鍚屾瘮 {_yoy_text(financial_snapshot.get('quarterlyParentNetProfitYoY'))}銆?"
        )

    report_titles = (analyst_snapshot or {}).get("reportTitles") or []
    report_note = ""
    if report_titles:
        first_title = report_titles[0].get("title") or ""
        if first_title:
            report_note = f" 近端研报更关注“{first_title}”。"

    rationale = f"{market_impression}{board_note}".strip()
    if rating_summary:
        rationale += f" 当前机构评级分布为 {rating_summary}。"
    if target_range and target_range != "[数据暂不可用]":
        rationale += f" 可见目标价区间 {target_range}"
        if target_space:
            rationale += f"，对应空间 {target_space}"
        rationale += "。"
    annual_profit_yoy = (financial_snapshot or {}).get("annualParentNetProfitYoY")
    quarterly_profit_yoy = (financial_snapshot or {}).get("quarterlyParentNetProfitYoY")
    if annual_profit_yoy is not None or quarterly_profit_yoy is not None:
        rationale += f" 骞存姤/鏈€鏂板崟瀛ｅ害褰掓瘝鍚屾瘮鍒嗗埆涓?{_yoy_text(annual_profit_yoy)} 鍜?{_yoy_text(quarterly_profit_yoy)}銆?"
    rationale += report_note
    rationale = rationale[:260] or "[数据暂不可用]"
    return AnalystConsensus(stance=stance, rationale=rationale)


def _build_short_term_outlook(
    highlights: List[dict],
    news: List[dict],
    analyst_snapshot: Optional[Dict[str, Any]],
    financial_snapshot: Optional[Dict[str, Any]],
) -> ShortTermOutlook:
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

    report_titles = (analyst_snapshot or {}).get("reportTitles") or []
    for item in report_titles[:3]:
        title = str(item.get("title") or "").strip()
        if title:
            catalysts.append(f"券商跟踪重点：{title}")
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

    eps_forecasts = (analyst_snapshot or {}).get("epsForecasts") or []
    if positive_labels:
        earnings_expectation = f"未来1-3个月更值得跟踪 {positive_labels[0]} 的兑现强度，若持续获得订单、业绩或价格验证，短期预期有望继续改善。"
    elif risk_labels:
        earnings_expectation = f"未来1-3个月更需要防守 {risk_labels[0]} 的继续发酵，若负面扰动扩散，短期预期可能进一步走弱。"
    else:
        earnings_expectation = "[数据暂不可用]"

    if eps_forecasts:
        first_forecast = eps_forecasts[0]
        year = first_forecast.get("year") or ""
        avg_eps = first_forecast.get("avgEps")
        institution_count = first_forecast.get("institutionCount")
        if avg_eps:
            eps_text = f"{year} 年机构一致预期 EPS 约 {avg_eps:.2f}"
            if institution_count:
                eps_text += f"，基于 {institution_count} 家机构预测"
            eps_text += "。"
            earnings_expectation = f"{earnings_expectation} {eps_text}"

    if (not eps_forecasts) and (financial_snapshot or {}).get("quarterlyParentNetProfitYoY") is not None:
        earnings_expectation = (
            f"{earnings_expectation} {financial_snapshot.get('quarterlyReportLabel') or '鏈€鏂板崟瀛ｅ害'}褰掓瘝鍑€鍒╂鼎鍚屾瘮"
            f" {_yoy_text(financial_snapshot.get('quarterlyParentNetProfitYoY'))}锛屽悗缁湅鏀跺叆鍜岀幇閲戞祦鏄惁缁х画鍖归厤銆?"
        )

    return ShortTermOutlook(
        catalysts=deduped[:3] or ["[数据暂不可用]"],
        earningsExpectation=earnings_expectation,
    )


def _build_valuation_outlook(
    indicators: dict,
    highlights: List[dict],
    board_context: Optional[Dict[str, Any]],
    analyst_snapshot: Optional[Dict[str, Any]],
    financial_snapshot: Optional[Dict[str, Any]],
) -> ValuationOutlook:
    pe = _metric_text(indicators.get("pe"), "x")
    pb = _metric_text(indicators.get("pb"), "x")
    roe = _metric_text(indicators.get("roe"), "%")
    current_level = f"当前估值：PE {pe}，PB {pb}，ROE {roe}。"

    target_range = (analyst_snapshot or {}).get("targetRange") or "[数据暂不可用]"
    target_space = (analyst_snapshot or {}).get("targetSpace") or ""
    if target_space and target_range != "[数据暂不可用]":
        target_range = f"{target_range}（相对当前空间 {target_space}）"

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
    analyst_snapshot: Optional[Dict[str, Any]],
    financial_snapshot: Optional[Dict[str, Any]],
) -> FutureOutlook:
    business_summary = str(company_facts.get("businessSummary") or "").strip()
    product_types = company_facts.get("productTypes") or []
    enriched_highlights = list(highlights)
    if business_summary and not any(item.get("side") == "positive" for item in enriched_highlights):
        enriched_highlights.extend(_build_supplemental_positive_highlights("profile", company_facts, indicators))

    analyst_consensus = _build_consensus(sentiment, market_impression, board_context, analyst_snapshot)
    if business_summary:
        analyst_consensus = AnalystConsensus(
            stance=analyst_consensus.stance,
            rationale=f"{analyst_consensus.rationale} 主营业务显示公司核心经营线围绕“{business_summary}”展开。".strip()[:260],
        )

    short_term = _build_short_term_outlook(enriched_highlights, news, analyst_snapshot)
    if business_summary and short_term.earningsExpectation != "[数据暂不可用]":
        short_term = ShortTermOutlook(
            catalysts=short_term.catalysts,
            earningsExpectation=f"{short_term.earningsExpectation} 同时继续跟踪主营“{business_summary}”里更高景气业务的兑现进度。",
        )

    valuation_outlook = _build_valuation_outlook(indicators, enriched_highlights, board_context, analyst_snapshot)
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


def _merge_generated_highlights(highlights: List[dict], generated: List[dict]) -> List[dict]:
    merged = list(highlights)
    seen = {(str(item.get("side") or ""), str(item.get("label") or "")) for item in merged}
    for item in generated:
        key = (str(item.get("side") or ""), str(item.get("label") or ""))
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return sorted(merged, key=lambda item: int(item.get("score") or 0), reverse=True)


def _enrich_market_impression_with_financials(market_impression: str, financial_snapshot: Dict[str, Any]) -> str:
    if "最新财务截面" in market_impression or "年报归母净利润" in market_impression:
        return market_impression

    extra_bits: List[str] = []
    annual_profit_yoy = financial_snapshot.get("annualParentNetProfitYoY")
    quarterly_profit_yoy = financial_snapshot.get("quarterlyParentNetProfitYoY")
    annual_revenue_yoy = financial_snapshot.get("annualRevenueYoY")
    dividend_per10 = financial_snapshot.get("latestDividendPer10")

    if annual_profit_yoy is not None or quarterly_profit_yoy is not None:
        extra_bits.append(
            f"最新财务截面上，年报归母净利润同比 {_yoy_text(annual_profit_yoy)}，最新季度同比 {_yoy_text(quarterly_profit_yoy)}。"
        )
    if annual_revenue_yoy is not None and annual_revenue_yoy < 0:
        extra_bits.append(f"但收入端仍有压力，年报营收同比 {_yoy_text(annual_revenue_yoy)}。")
    if dividend_per10 is not None and dividend_per10 > 0:
        extra_bits.append(f"公司还披露了每10股派息 {dividend_per10:.2f} 元的分红方案。")

    if not extra_bits:
        return market_impression
    return f"{market_impression} {' '.join(extra_bits)}"[:520]


def _build_consensus_card(
    summary_sentiment: str,
    market_impression: str,
    board_context: Optional[Dict[str, Any]],
    analyst_snapshot: Optional[Dict[str, Any]],
    financial_snapshot: Optional[Dict[str, Any]],
) -> AnalystConsensus:
    stance = (analyst_snapshot or {}).get("stance") or _consensus_stance(summary_sentiment)
    parts = [market_impression.strip()]
    if board_context and board_context.get("roleReason"):
        parts.append(str(board_context["roleReason"]).strip())
    if (analyst_snapshot or {}).get("ratingSummary"):
        parts.append(f"机构评级分布为 {(analyst_snapshot or {}).get('ratingSummary')}。")
    if (analyst_snapshot or {}).get("targetRange") and (analyst_snapshot or {}).get("targetRange") != "[数据暂不可用]":
        target_text = f"可见目标价区间 {(analyst_snapshot or {}).get('targetRange')}"
        if (analyst_snapshot or {}).get("targetSpace"):
            target_text += f"，对应空间 {(analyst_snapshot or {}).get('targetSpace')}"
        parts.append(target_text + "。")
    if (financial_snapshot or {}).get("annualParentNetProfitYoY") is not None:
        parts.append(
            f"年报归母净利润同比 {_yoy_text((financial_snapshot or {}).get('annualParentNetProfitYoY'))}，"
            f"最新季度同比 {_yoy_text((financial_snapshot or {}).get('quarterlyParentNetProfitYoY'))}。"
        )
    rationale = " ".join(part for part in parts if part)[:260] or "[数据暂不可用]"
    return AnalystConsensus(stance=stance, rationale=rationale)


def _build_short_term_outlook_card(
    highlights: List[dict],
    news: List[dict],
    analyst_snapshot: Optional[Dict[str, Any]],
    financial_snapshot: Optional[Dict[str, Any]],
) -> ShortTermOutlook:
    catalysts: List[str] = []
    if (financial_snapshot or {}).get("latestDividendPer10"):
        catalysts.append(
            f"分红方案落地进度：每10股派息 {(financial_snapshot or {}).get('latestDividendPer10'):.2f} 元，当前进度 {(financial_snapshot or {}).get('latestDividendProgress') or '[数据暂不可用]'}。"
        )
    if (financial_snapshot or {}).get("quarterlyParentNetProfitYoY") is not None:
        catalysts.append(
            f"{(financial_snapshot or {}).get('quarterlyReportLabel') or '最新季度'}业绩验证：归母净利润同比 {_yoy_text((financial_snapshot or {}).get('quarterlyParentNetProfitYoY'))}。"
        )
    report_titles = (analyst_snapshot or {}).get("reportTitles") or []
    for item in report_titles[:2]:
        title = str(item.get("title") or "").strip()
        if title:
            catalysts.append(f"券商跟踪重点：{title}")
    for item in highlights:
        text = str(item.get("importance") or item.get("why") or item.get("label") or "").strip()
        if text:
            catalysts.append(text[:80])
        if len(catalysts) >= 4:
            break
    if len(catalysts) < 3:
        for item in news[:3]:
            title = str(item.get("title") or "").strip()
            if title:
                catalysts.append(title[:80])
            if len(catalysts) >= 3:
                break

    deduped: List[str] = []
    seen = set()
    for item in catalysts:
        if not item or item in seen:
            continue
        seen.add(item)
        deduped.append(item)
        if len(deduped) >= 3:
            break

    eps_forecasts = (analyst_snapshot or {}).get("epsForecasts") or []
    if eps_forecasts and eps_forecasts[0].get("avgEps") is not None:
        first = eps_forecasts[0]
        institution_text = ""
        if first.get("institutionCount"):
            institution_text = f"，基于 {first.get('institutionCount')} 家机构预测"
        earnings_expectation = (
            f"{first.get('year') or ''} 年机构一致预期 EPS 约 {first.get('avgEps'):.2f}"
            f"{institution_text}。"
        )
    elif (financial_snapshot or {}).get("quarterlyParentNetProfitYoY") is not None:
        earnings_expectation = (
            f"{(financial_snapshot or {}).get('quarterlyReportLabel') or '最新季度'}归母净利润同比"
            f" {_yoy_text((financial_snapshot or {}).get('quarterlyParentNetProfitYoY'))}，后续看收入和现金流是否继续匹配。"
        )
    else:
        earnings_expectation = "[数据暂不可用]"

    return ShortTermOutlook(
        catalysts=deduped or ["[数据暂不可用]"],
        earningsExpectation=earnings_expectation,
    )


def _build_valuation_outlook_card(
    indicators: dict,
    highlights: List[dict],
    board_context: Optional[Dict[str, Any]],
    analyst_snapshot: Optional[Dict[str, Any]],
    financial_snapshot: Optional[Dict[str, Any]],
) -> ValuationOutlook:
    pe = _metric_text(indicators.get("pe"), "x")
    pb = _metric_text(indicators.get("pb"), "x")
    roe = _metric_text(indicators.get("roe"), "%")
    current_level = f"当前估值：PE {pe}，PB {pb}，ROE {roe}。"
    if (financial_snapshot or {}).get("annualParentNetProfitYoY") is not None:
        current_level += (
            f" 最新年报归母净利润同比 {_yoy_text((financial_snapshot or {}).get('annualParentNetProfitYoY'))}，"
            "需要把利润兑现和当前估值一起看。"
        )

    target_range = (analyst_snapshot or {}).get("targetRange") or "[数据暂不可用]"
    if (analyst_snapshot or {}).get("targetSpace") and target_range != "[数据暂不可用]":
        target_range = f"{target_range}（相对当前空间 {(analyst_snapshot or {}).get('targetSpace')}）"

    upside_drivers: List[str] = []
    downside_risks: List[str] = []
    for item in highlights:
        text = str(item.get("importance") or item.get("label") or "").strip()
        if item.get("side") == "positive" and text and len(upside_drivers) < 3:
            upside_drivers.append(text[:88])
        if item.get("side") == "risk" and text and len(downside_risks) < 3:
            downside_risks.append(text[:88])
    if board_context and board_context.get("summary") and len(upside_drivers) < 3:
        upside_drivers.append(str(board_context.get("summary"))[:88])
    if (financial_snapshot or {}).get("quarterlyParentNetProfitYoY") is not None and len(upside_drivers) < 3:
        upside_drivers.append(
            f"{(financial_snapshot or {}).get('quarterlyReportLabel') or '最新季度'}归母净利润同比 {_yoy_text((financial_snapshot or {}).get('quarterlyParentNetProfitYoY'))}。"
        )
    if (financial_snapshot or {}).get("latestDividendPer10") is not None and len(upside_drivers) < 3:
        upside_drivers.append(
            f"最新分红方案为每10股派息 {(financial_snapshot or {}).get('latestDividendPer10'):.2f} 元，对估值和安全边际有支撑。"
        )
    if (financial_snapshot or {}).get("annualRevenueYoY") is not None and (financial_snapshot or {}).get("annualRevenueYoY") < 0 and len(downside_risks) < 3:
        downside_risks.append(
            f"年报营收同比 {_yoy_text((financial_snapshot or {}).get('annualRevenueYoY'))}，如果收入修复不及预期，估值修复空间会受限。"
        )

    return ValuationOutlook(
        currentLevel=current_level,
        targetRange=target_range,
        upsideDrivers=upside_drivers or ["[数据暂不可用]"],
        downsideRisks=downside_risks or ["[数据暂不可用]"],
    )


def _build_future_outlook_card(
    sentiment: str,
    market_impression: str,
    indicators: dict,
    highlights: List[dict],
    news: List[dict],
    board_context: Optional[Dict[str, Any]],
    company_facts: Dict[str, Any],
    analyst_snapshot: Optional[Dict[str, Any]],
    financial_snapshot: Optional[Dict[str, Any]],
) -> FutureOutlook:
    business_summary = str(company_facts.get("businessSummary") or "").strip()
    analyst_consensus = _build_consensus_card(
        sentiment,
        market_impression,
        board_context,
        analyst_snapshot,
        financial_snapshot,
    )
    short_term = _build_short_term_outlook_card(highlights, news, analyst_snapshot, financial_snapshot)
    valuation_outlook = _build_valuation_outlook_card(
        indicators,
        highlights,
        board_context,
        analyst_snapshot,
        financial_snapshot,
    )

    if business_summary and short_term.earningsExpectation != "[数据暂不可用]":
        short_term = ShortTermOutlook(
            catalysts=short_term.catalysts,
            earningsExpectation=f"{short_term.earningsExpectation} 同时继续跟踪主营“{business_summary}”里的核心业务兑现进度。",
        )

    return FutureOutlook(
        analystConsensus=analyst_consensus,
        shortTermOutlook=short_term,
        valuationOutlook=valuation_outlook,
    )


def _merge_ai_future_outlook(future_outlook: FutureOutlook, ai_summary: Dict[str, Any]) -> FutureOutlook:
    consensus_stance = ai_summary.get("analystConsensusStance")
    consensus_rationale = ai_summary.get("analystConsensusRationale")
    short_term_catalysts = ai_summary.get("shortTermCatalysts") or []
    short_term_earnings = ai_summary.get("shortTermEarningsExpectation")
    valuation_current = ai_summary.get("valuationCurrentLevel")
    valuation_target = ai_summary.get("valuationTargetRange")
    valuation_upside = ai_summary.get("valuationUpsideDrivers") or []
    valuation_downside = ai_summary.get("valuationDownsideRisks") or []

    return FutureOutlook(
        analystConsensus=AnalystConsensus(
            stance=consensus_stance or future_outlook.analystConsensus.stance,
            rationale=consensus_rationale or future_outlook.analystConsensus.rationale,
        ),
        shortTermOutlook=ShortTermOutlook(
            catalysts=short_term_catalysts or future_outlook.shortTermOutlook.catalysts,
            earningsExpectation=short_term_earnings or future_outlook.shortTermOutlook.earningsExpectation,
        ),
        valuationOutlook=ValuationOutlook(
            currentLevel=valuation_current or future_outlook.valuationOutlook.currentLevel,
            targetRange=valuation_target or future_outlook.valuationOutlook.targetRange,
            upsideDrivers=valuation_upside or future_outlook.valuationOutlook.upsideDrivers,
            downsideRisks=valuation_downside or future_outlook.valuationOutlook.downsideRisks,
        ),
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
    analyst_snapshot, financial_snapshot = await asyncio.gather(
        asyncio.to_thread(fetch_analyst_snapshot, code, float(stock_price["price"])),
        asyncio.to_thread(fetch_financial_snapshot, code),
    )
    highlights = analyze_highlights(raw_ann)
    highlights = _merge_generated_highlights(highlights, _build_financial_highlights(code, financial_snapshot))
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
        highlights = _merge_generated_highlights(highlights, supplemental_positives)
        positives = [item for item in highlights if item["side"] == "positive"]
        risks = [item for item in highlights if item["side"] == "risk"]
    sentiment = _rule_sentiment(len(risks), len(positives))

    market_impression = _build_rule_market_impression(
        company_name or code,
        industry or "",
        company_facts,
        highlights,
        hotness,
        indicators,
        board_context,
        financial_snapshot,
    )
    market_impression = _enrich_market_impression_with_financials(market_impression, financial_snapshot)
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
        financial_snapshot=financial_snapshot,
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
            financial_snapshot,
            profile,
        )

    valuation_snapshot = ValuationSnapshot(
        pe=_metric_text(indicators.get("pe")),
        pb=_metric_text(indicators.get("pb")),
        roe=_metric_text(indicators.get("roe")),
    )
    future_outlook = _build_future_outlook_card(
        sentiment,
        market_impression,
        indicators,
        highlights,
        news,
        board_context,
        company_facts,
        analyst_snapshot,
        financial_snapshot,
    )
    if ai_summary:
        future_outlook = _merge_ai_future_outlook(future_outlook, ai_summary)

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
