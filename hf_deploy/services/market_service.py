import logging
from contextlib import redirect_stderr, redirect_stdout
from difflib import SequenceMatcher
from functools import lru_cache
from io import StringIO
from typing import Any, Dict, List

try:
    import akshare as ak
except ImportError:  # pragma: no cover - optional at runtime
    ak = None

try:
    from ..core.config import HTTP_SESSION, REQUEST_TIMEOUT, USER_AGENT, XQ_SESSION
except ImportError:
    from core.config import HTTP_SESSION, REQUEST_TIMEOUT, USER_AGENT, XQ_SESSION


BOARD_MARKET_LABELS = {"深A", "沪A", "北A", "创业板", "科创板"}
INDUSTRY_ALIAS_HINTS = {
    "家纺": "服装家纺",
    "毛巾": "服装家纺",
    "纺织": "服装家纺",
    "服装": "服装家纺",
    "电解液": "电池",
    "锂电": "电池",
    "锂电池": "电池",
    "化工": "化学制品",
    "涂层": "化学制品",
    "半导体": "半导体",
    "芯片": "半导体",
    "光伏": "光伏设备",
    "风电": "风电设备",
}


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _safe_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _normalize_board_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    for token in ("行业", "板块", "概念", "申万", "同花顺", " ", "-", "_", "/", "\\", "、", "·", "（", "）", "(", ")"):
        text = text.replace(token, "")
    return text


def _dedupe_keep_order(values: List[str]) -> List[str]:
    seen = set()
    result: List[str] = []
    for value in values:
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


@lru_cache(maxsize=1)
def _load_board_names() -> List[str]:
    if ak is None:
        return []
    try:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            names_df = ak.stock_board_industry_name_ths()
        return [str(row.get("name") or "").strip() for _, row in names_df.iterrows() if str(row.get("name") or "").strip()]
    except Exception as exc:
        logging.warning("THS board names fetch failed: %s", exc)
        return []


@lru_cache(maxsize=1)
def _load_board_summary_lookup() -> Dict[str, Dict[str, Any]]:
    if ak is None:
        return {}
    try:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            summary_df = ak.stock_board_industry_summary_ths()
    except Exception as exc:
        logging.warning("THS board summary fetch failed: %s", exc)
        return {}

    lookup: Dict[str, Dict[str, Any]] = {}
    for _, row in summary_df.iterrows():
        board_name = str(row.get("板块") or "").strip()
        if not board_name:
            continue
        lookup[board_name] = {
            "boardName": board_name,
            "boardPct": _safe_float(row.get("涨跌幅")),
            "boardRank": _safe_int(row.get("序号")),
            "leader": str(row.get("领涨股") or "").strip() or None,
            "leaderPct": _safe_float(row.get("领涨股-涨跌幅")),
        }
    return lookup


@lru_cache(maxsize=1)
def _load_board_rows() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    summary_lookup = _load_board_summary_lookup()
    for board_name in _load_board_names():
        row = {
            "boardName": board_name,
            "boardPct": None,
            "boardRank": None,
            "leader": None,
            "leaderPct": None,
        }
        if board_name in summary_lookup:
            row.update(summary_lookup[board_name])
        rows.append(row)
    return rows


@lru_cache(maxsize=128)
def _fetch_board_pct_from_history(board_name: str) -> float:
    if ak is None or not board_name:
        return 0.0
    try:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            hist_df = ak.stock_board_industry_index_ths(symbol=board_name, start_date="20260101", end_date="20261231")
        if hist_df is None or hist_df.empty or len(hist_df.index) < 2:
            return 0.0
        closes = hist_df["收盘价"].tolist()
        prev_close = _safe_float(closes[-2])
        last_close = _safe_float(closes[-1])
        if prev_close <= 0:
            return 0.0
        return round((last_close - prev_close) / prev_close * 100, 2)
    except Exception as exc:
        logging.warning("THS board history fetch failed for %s: %s", board_name, exc)
        return 0.0


def _extract_industry_candidates(code: str, industry_hint: str) -> List[str]:
    candidates: List[str] = []

    industry_hint = str(industry_hint or "").strip()
    if industry_hint and industry_hint not in BOARD_MARKET_LABELS:
        candidates.append(industry_hint)

    if ak is None:
        return _dedupe_keep_order(candidates)

    try:
        biz_df = ak.stock_zyjs_ths(symbol=code)
        if not biz_df.empty:
            first = biz_df.iloc[0]
            for field in ("主营业务", "产品类型", "产品名称"):
                raw_value = str(first.get(field) or "").strip()
                if not raw_value:
                    continue
                candidates.append(raw_value)
                for splitter in ("、", "，", ",", "；", ";"):
                    if splitter in raw_value:
                        candidates.extend([part.strip() for part in raw_value.split(splitter)[:4]])
    except Exception as exc:
        logging.warning("THS business profile fallback failed for %s: %s", code, exc)

    if not candidates:
        try:
            info_df = ak.stock_individual_info_em(symbol=code)
            info_map = {str(row["item"]).strip(): str(row["value"]).strip() for _, row in info_df.iterrows()}
            industry = info_map.get("行业", "").strip()
            if industry and industry not in BOARD_MARKET_LABELS:
                candidates.append(industry)
        except Exception as exc:
            logging.warning("Eastmoney industry fallback failed for %s: %s", code, exc)

    alias_candidates: List[str] = []
    for candidate in candidates:
        for keyword, alias in INDUSTRY_ALIAS_HINTS.items():
            if keyword in candidate:
                alias_candidates.append(alias)

    return _dedupe_keep_order(candidates + alias_candidates)


def _pick_board_row(candidates: List[str], rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not rows:
        return {}

    best_row: Dict[str, Any] = {}
    best_score = 0.0

    for candidate in candidates:
        candidate_norm = _normalize_board_text(candidate)
        if not candidate_norm:
            continue
        for row in rows:
            board_name = str(row.get("boardName") or "")
            board_norm = _normalize_board_text(board_name)
            if not board_norm:
                continue

            if candidate_norm == board_norm:
                return row

            if candidate_norm in board_norm or board_norm in candidate_norm:
                score = 0.94
            else:
                score = SequenceMatcher(None, candidate_norm, board_norm).ratio()

            if score > best_score:
                best_score = score
                best_row = row

    return best_row if best_score >= 0.42 else {}


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

    candidates = _extract_industry_candidates(code, industry_hint)
    board_rows = _load_board_rows()
    matched_row = _pick_board_row(candidates, board_rows)
    industry = matched_row.get("boardName") or (candidates[0] if candidates else "")

    if not matched_row:
        return {
            "industry": industry,
            "boardName": industry or None,
            "boardPct": None,
            "boardRank": None,
            "leader": None,
            "leaderPct": None,
            "role": "行业跟踪中" if industry else "暂无链条映射",
            "summary": (
                f"当前先按“{industry}”这条行业链跟踪，板块强弱和领涨映射暂时还没完全匹配上。"
                if industry
                else "暂时还没稳定识别出所属行业，先看个股主线和证据链。"
            ),
        }

    board_pct = _safe_float(matched_row.get("boardPct"))
    board_rank = _safe_int(matched_row.get("boardRank"))
    leader = matched_row.get("leader")
    leader_pct = _safe_float(matched_row.get("leaderPct")) if matched_row.get("leader") else None
    if board_pct == 0.0 and not matched_row.get("boardRank") and not leader:
        board_pct = _fetch_board_pct_from_history(str(matched_row.get("boardName") or industry))

    if leader and leader == stock_name:
        role = "领涨"
    elif pct_change >= board_pct + 1.5:
        role = "强于板块"
    elif pct_change <= board_pct - 1.5:
        role = "掉队"
    else:
        role = "跟随"

    summary = f"所属行业映射到“{industry}”，当前板块涨跌幅 {board_pct:+.2f}%"
    if board_rank > 0:
        summary += f"，行业热度第 {board_rank} 位"
    summary += "。"
    if leader:
        summary += f" 当前领涨股是 {leader}"
        if leader_pct is not None:
            summary += f"（{leader_pct:+.2f}%）"
        summary += "。"
    if role == "领涨":
        summary += " 这只票本身就是当前板块里最强的辨识度。"
    elif role == "强于板块":
        summary += " 这只票当前强于所属板块，更像主动强化。"
    elif role == "掉队":
        summary += " 这只票当前弱于所属板块，板块热度未必能直接传导到它。"
    else:
        summary += " 这只票当前更像跟随板块节奏。"

    return {
        "industry": industry,
        "boardName": matched_row.get("boardName") or industry,
        "boardPct": board_pct,
        "boardRank": board_rank if board_rank > 0 else None,
        "leader": leader,
        "leaderPct": leader_pct,
        "role": role,
        "summary": summary,
    }
