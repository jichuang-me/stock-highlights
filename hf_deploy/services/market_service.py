import logging
from contextlib import redirect_stderr, redirect_stdout
from difflib import SequenceMatcher
from functools import lru_cache
from io import StringIO
from typing import Any, Dict, List, Optional

import pandas as pd

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


def _safe_optional_float(value: Any) -> Optional[float]:
    text = str(value or "").strip()
    if not text or text in {"--", "-", "None", "nan"}:
        return None
    text = (
        text.replace("%", "")
        .replace("亿", "")
        .replace("万", "")
        .replace(",", "")
        .replace("+", "")
        .strip()
    )
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _safe_optional_int(value: Any) -> Optional[int]:
    text = str(value or "").strip()
    if not text or text in {"--", "-", "None", "nan"}:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


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
def _load_board_code_map() -> Dict[str, str]:
    if ak is None:
        return {}
    try:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            names_df = ak.stock_board_industry_name_ths()
        return {
            str(row.get("name") or "").strip(): str(row.get("code") or "").strip()
            for _, row in names_df.iterrows()
            if str(row.get("name") or "").strip() and str(row.get("code") or "").strip()
        }
    except Exception as exc:
        logging.warning("THS board code map fetch failed: %s", exc)
        return {}


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
def _load_board_detail(board_name: str) -> Dict[str, Any]:
    if ak is None or not board_name:
        return {}
    try:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            info_df = ak.stock_board_industry_info_ths(symbol=board_name)
    except Exception as exc:
        logging.warning("THS board detail fetch failed for %s: %s", board_name, exc)
        return {}

    if info_df is None or info_df.empty:
        return {}

    info_map = {
        str(row.get("项目") or "").strip(): str(row.get("值") or "").strip()
        for _, row in info_df.iterrows()
        if str(row.get("项目") or "").strip()
    }

    up_count = None
    down_count = None
    rise_fall_text = info_map.get("涨跌家数", "")
    if rise_fall_text and "/" in rise_fall_text:
        left, right = rise_fall_text.split("/", 1)
        up_count = _safe_optional_int(left)
        down_count = _safe_optional_int(right)

    rank_value = None
    rank_text = info_map.get("涨幅排名", "")
    if rank_text:
        rank_value = _safe_optional_int(rank_text.split("/", 1)[0])

    return {
        "boardPct": _safe_optional_float(info_map.get("板块涨幅")),
        "boardRank": rank_value,
        "upCount": up_count,
        "downCount": down_count,
        "netInflow": _safe_optional_float(info_map.get("资金净流入(亿)")),
    }


@lru_cache(maxsize=128)
def _load_board_constituents(board_name: str) -> List[Dict[str, Any]]:
    if not board_name:
        return []

    board_code = _load_board_code_map().get(board_name)
    if not board_code:
        return []

    url = f"https://q.10jqka.com.cn/thshy/detail/code/{board_code}/"
    try:
        response = HTTP_SESSION.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
        tables = pd.read_html(StringIO(response.text))
    except Exception as exc:
        logging.warning("THS board constituents fetch failed for %s: %s", board_name, exc)
        return []

    if not tables:
        return []

    df = tables[0].copy()
    required = {"代码", "名称", "涨跌幅(%)"}
    if not required.issubset(set(df.columns)):
        return []

    rows: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        code = str(row.get("代码") or "").strip()
        name = str(row.get("名称") or "").strip()
        if not name:
            continue
        rows.append(
            {
                "code": code.zfill(6) if code.isdigit() else code,
                "name": name,
                "pct": _safe_optional_float(row.get("涨跌幅(%)")),
            }
        )

    rows.sort(key=lambda item: item.get("pct") if item.get("pct") is not None else -9999, reverse=True)
    return rows


def _classify_board_role(
    stock_name: str,
    pct_change: float,
    board_pct: float,
    leader: Optional[str],
    leader_pct: Optional[float],
    current_rank: Optional[int],
    total_count: int,
) -> tuple[str, str]:
    rank_is_front = current_rank is not None and current_rank <= max(2, min(5, total_count // 6 if total_count else 2))
    stronger_than_board = pct_change >= board_pct + 0.8
    weaker_than_board = pct_change <= board_pct - 1.0

    if leader and leader == stock_name:
        return "领涨", "当前个股就是同板块里最强辨识度，板块情绪和资金会先围绕它定价。"
    if rank_is_front and stronger_than_board:
        return "补涨", "当前个股明显强于板块均值，但还不是最强龙头，更像板块内的补涨强化。"
    if weaker_than_board or (current_rank is not None and total_count > 0 and current_rank >= max(total_count - 2, int(total_count * 0.75))):
        return "掉队", "板块本身并非最弱，但这只票明显落后于同板块节奏，短线承接偏弱。"
    if leader_pct is not None and pct_change >= leader_pct - 1.2 and pct_change > 0:
        return "补涨", "板块内部已经出现更强龙头，这只票更像顺着板块强势做补涨跟进。"
    return "跟随", "当前更像跟随同板块节奏，既不是领涨核心，也没有明显掉队。"


def _build_linked_stocks(
    constituents: List[Dict[str, Any]],
    code: str,
    stock_name: str,
    pct_change: float,
    board_pct: float,
    current_role: str,
) -> List[Dict[str, Any]]:
    linked: List[Dict[str, Any]] = []
    seen = set()

    def add_row(row: Optional[Dict[str, Any]], role: str, reason: str) -> None:
        if not row:
            return
        key = row.get("code") or row.get("name")
        if not key or key in seen:
            return
        seen.add(key)
        linked.append(
            {
                "code": row.get("code") or "",
                "name": row.get("name") or "",
                "pct": row.get("pct"),
                "role": role,
                "reason": reason,
            }
        )

    current_row = next((item for item in constituents if item.get("code") == code or item.get("name") == stock_name), None)
    leader_row = constituents[0] if constituents else None
    peer_rows = [item for item in constituents if item is not leader_row and item is not current_row]

    add_row(
        current_row
        or {
            "code": code,
            "name": stock_name,
            "pct": pct_change,
        },
        current_role,
        "这是当前个股在同板块链条里的位置判断。",
    )
    add_row(
        leader_row,
        "领涨",
        "当前板块最强辨识度，适合作为主线风向标。",
    )

    for row in peer_rows:
        pct = row.get("pct")
        if pct is None:
            continue
        if pct >= board_pct + 0.8:
            add_row(row, "补涨", "强于板块均值，适合作为补涨和扩散观察对象。")
        elif pct <= board_pct - 1.0:
            add_row(row, "掉队", "明显弱于板块均值，适合作为链条转弱的对照。")
        else:
            add_row(row, "跟随", "更像跟随板块平均节奏，可用来观察链条是否同步。")
        if len(linked) >= 4:
            break

    return linked[:4]


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
            "upCount": None,
            "downCount": None,
            "netInflow": None,
            "leader": None,
            "leaderPct": None,
            "role": "暂无链条映射",
            "roleReason": "当前环境未启用板块映射依赖，先看个股主线和证据链。",
            "summary": "当前环境未启用板块映射依赖，先看个股主线和证据链。",
            "linkedStocks": [],
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
            "upCount": None,
            "downCount": None,
            "netInflow": None,
            "leader": None,
            "leaderPct": None,
            "role": "行业跟踪中" if industry else "暂无链条映射",
            "roleReason": (
                f"先按“{industry}”这条行业链观察，强弱和联动票映射还没完全确认。"
                if industry
                else "暂时还没稳定识别所属行业，先看个股主线和证据链。"
            ),
            "summary": (
                f"当前先按“{industry}”这条行业链跟踪，板块强弱和领涨映射暂时还没完全匹配上。"
                if industry
                else "暂时还没稳定识别出所属行业，先看个股主线和证据链。"
            ),
            "linkedStocks": [],
        }

    board_name = str(matched_row.get("boardName") or industry)
    board_detail = _load_board_detail(board_name)
    constituents = _load_board_constituents(board_name)

    board_pct = _safe_optional_float(matched_row.get("boardPct"))
    if board_pct is None:
        board_pct = board_detail.get("boardPct")
    if board_pct is None:
        board_pct = _fetch_board_pct_from_history(board_name)

    board_rank = _safe_optional_int(matched_row.get("boardRank"))
    if board_rank is None:
        board_rank = board_detail.get("boardRank")

    leader = matched_row.get("leader") or (constituents[0].get("name") if constituents else None)
    leader_pct = _safe_optional_float(matched_row.get("leaderPct"))
    if leader_pct is None and constituents:
        leader_pct = constituents[0].get("pct")

    up_count = board_detail.get("upCount")
    down_count = board_detail.get("downCount")
    net_inflow = board_detail.get("netInflow")

    current_rank = next(
        (
            index + 1
            for index, row in enumerate(constituents)
            if row.get("code") == code or row.get("name") == stock_name
        ),
        None,
    )

    role, role_reason = _classify_board_role(
        stock_name=stock_name,
        pct_change=pct_change,
        board_pct=board_pct or 0.0,
        leader=leader,
        leader_pct=leader_pct,
        current_rank=current_rank,
        total_count=len(constituents),
    )

    linked_stocks = _build_linked_stocks(
        constituents=constituents,
        code=code,
        stock_name=stock_name,
        pct_change=pct_change,
        board_pct=board_pct or 0.0,
        current_role=role,
    )

    summary_parts = [
        f"所属行业映射到“{industry}”",
        f"当前板块涨跌幅 {board_pct:+.2f}%",
    ]
    if board_rank:
        summary_parts.append(f"行业热度第 {board_rank} 位")
    if up_count is not None and down_count is not None:
        summary_parts.append(f"上涨/下跌家数 {up_count}/{down_count}")
    if net_inflow is not None:
        summary_parts.append(f"资金净流入 {net_inflow:+.2f} 亿")
    if leader:
        leader_text = f"当前领涨股是 {leader}"
        if leader_pct is not None:
            leader_text += f"（{leader_pct:+.2f}%）"
        summary_parts.append(leader_text)
    if current_rank:
        summary_parts.append(f"这只票当前排在同板块第 {current_rank} 位，更像“{role}”")
    else:
        summary_parts.append(f"当前更像“{role}”")
    summary = "，".join(summary_parts) + "。"

    return {
        "industry": industry,
        "boardName": board_name,
        "boardPct": board_pct,
        "boardRank": board_rank if board_rank and board_rank > 0 else None,
        "upCount": up_count,
        "downCount": down_count,
        "netInflow": net_inflow,
        "leader": leader,
        "leaderPct": leader_pct,
        "role": role,
        "roleReason": role_reason,
        "summary": summary,
        "linkedStocks": linked_stocks,
    }
