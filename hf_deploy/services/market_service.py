import logging
from functools import lru_cache
from typing import Any, Dict

try:
    import akshare as ak
except ImportError:  # pragma: no cover - optional at runtime
    ak = None

try:
    from ..core.config import HTTP_SESSION, REQUEST_TIMEOUT, USER_AGENT, XQ_SESSION
except ImportError:
    from core.config import HTTP_SESSION, REQUEST_TIMEOUT, USER_AGENT, XQ_SESSION


@lru_cache(maxsize=128)
def fetch_sina_prices(codes: str) -> Dict[str, Any]:
    if not codes:
        return {}

    url = f"https://hq.sinajs.cn/list={codes}"
    headers = {"Referer": "https://finance.sina.com.cn/", "User-Agent": USER_AGENT}
    results: Dict[str, Any] = {}
    try:
        resp = HTTP_SESSION.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        text = resp.content.decode("gbk", errors="ignore")
        for line in text.splitlines():
            if "=" not in line:
                continue
            code_num = "".join(filter(str.isdigit, line.split("=")[0].split("_")[-1]))
            data = line.split("=")[1].replace('"', "").split(",")
            if len(data) <= 4:
                continue
            try:
                price = float(data[3])
                pre_close = float(data[2])
            except (TypeError, ValueError):
                continue
            pct = round((price - pre_close) / pre_close * 100, 2) if pre_close > 0 else 0.0
            results[code_num] = {"price": price, "pct": pct}
    except Exception as exc:
        logging.error("Sina price fetch failed for %s: %s", codes, exc)
    return results


@lru_cache(maxsize=64)
def fetch_xueqiu_hotness(code: str) -> Dict[str, Any]:
    symbol = f"SH{code}" if code.startswith("6") else f"SZ{code}"
    try:
        url = f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={symbol}&extend=detail"
        resp = XQ_SESSION.get(url, timeout=REQUEST_TIMEOUT)
        data = resp.json().get("data", {}).get("quote", {})
        followers = data.get("followers", 0)
        return {
            "popularity": 75 if followers > 10000 else 60,
            "followers": followers,
            "rank": f"关注 {followers:,}",
            "sentiment": "bullish" if followers > 50000 else "neutral",
        }
    except Exception as exc:
        logging.error("Xueqiu hotness fetch failed for %s: %s", code, exc)
        return {"popularity": 65, "followers": 0, "rank": "关注数据暂不可用", "sentiment": "neutral"}


@lru_cache(maxsize=128)
def fetch_eastmoney_indicators(code: str) -> Dict[str, Any]:
    market = "1" if code.startswith("6") else "0"
    url = f"http://push2.eastmoney.com/api/qt/stock/get?secid={market}.{code}&fields=f162,f167,f117"
    try:
        resp = HTTP_SESSION.get(url, timeout=REQUEST_TIMEOUT)
        data = resp.json().get("data") or {}
        return {
            "pe": data.get("f162", "-"),
            "pb": data.get("f167", "-"),
            "roe": data.get("f117", "-"),
        }
    except Exception as exc:
        logging.error("Eastmoney indicators fetch failed for %s: %s", code, exc)
        return {"pe": "-", "pb": "-", "roe": "-"}


@lru_cache(maxsize=128)
def fetch_board_context(code: str, stock_name: str, pct_change: float, industry_hint: str = "") -> Dict[str, Any]:
    if ak is None:
        return {
            "industry": "",
            "boardName": None,
            "boardPct": None,
            "boardRank": None,
            "leader": None,
            "leaderPct": None,
            "role": "暂无链条映射",
            "summary": "当前环境未启用板块映射依赖，先看个股主线和证据链。",
        }

    try:
        industry = industry_hint.strip()
        if industry in {"深A", "沪A", "北A", "创业板", "科创板"}:
            industry = ""
        if not industry:
            info_df = ak.stock_individual_info_em(symbol=code)
            info_map = {str(row["item"]).strip(): row["value"] for _, row in info_df.iterrows()}
            industry = str(info_map.get("行业") or "").strip()
        if not industry:
            return {
                "industry": "",
                "boardName": None,
                "boardPct": None,
                "boardRank": None,
                "leader": None,
                "leaderPct": None,
                "role": "暂无链条映射",
                "summary": "暂时没有拿到所属行业，先看个股自身驱动。",
            }

        board_df = ak.stock_board_industry_name_em()
        matched = board_df[board_df["板块名称"] == industry]
        if matched.empty:
            return {
                "industry": industry,
                "boardName": industry,
                "boardPct": None,
                "boardRank": None,
                "leader": None,
                "leaderPct": None,
                "role": "行业跟踪中",
                "summary": f"当前能确认的链条是 {industry}，但暂时没有拿到更细的板块强弱映射。",
            }

        row = matched.iloc[0]
        board_pct = float(row.get("涨跌幅") or 0)
        board_rank = int(row.get("排名") or 0)
        leader = str(row.get("领涨股票") or "").strip() or None
        leader_pct = float(row.get("领涨股票-涨跌幅") or 0)

        if leader and leader == stock_name:
            role = "板块龙头"
        elif pct_change >= board_pct + 1.5:
            role = "强于板块"
        elif pct_change <= board_pct - 1.5:
            role = "弱于板块"
        else:
            role = "板块同步"

        summary = (
            f"所属行业是{industry}，当前板块涨跌幅 {board_pct:+.2f}%，"
            f"板块热度排名第 {board_rank}。"
        )
        if leader:
            summary += f" 当前板块领涨股是 {leader}（{leader_pct:+.2f}%），"
        if role == "板块龙头":
            summary += "这只票就是当前板块最强辨识度。"
        elif role == "强于板块":
            summary += "这只票当前强于所属板块，短线更像主动强化。"
        elif role == "弱于板块":
            summary += "这只票当前弱于所属板块，板块热度未必能直接传导到它。"
        else:
            summary += "这只票当前更像跟随板块节奏。"

        return {
            "industry": industry,
            "boardName": industry,
            "boardPct": board_pct,
            "boardRank": board_rank,
            "leader": leader,
            "leaderPct": leader_pct,
            "role": role,
            "summary": summary,
        }
    except Exception as exc:
        logging.error("Board context fetch failed for %s: %s", code, exc)
        return {
            "industry": industry,
            "boardName": industry or None,
            "boardPct": None,
            "boardRank": None,
            "leader": None,
            "leaderPct": None,
            "role": "行业跟踪中" if industry else "暂无链条映射",
            "summary": (
                f"当前先按 {industry} 这条行业链跟踪，板块热度数据暂时获取失败。"
                if industry
                else "板块链条数据当前获取失败，先看个股主线和证据链。"
            ),
        }
