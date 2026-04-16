import datetime as dt
import re
from typing import List, Dict, Any, Optional
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import sys
import logging
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

# 配置日志输出到 stdout 以便在云端查看
logging.basicConfig(stream=sys.stdout, level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Stock Highlights Real Data Backend",
    redirect_slashes=False
)

# --- 雪球会话持久化集成 ---
XQ_SESSION = requests.Session()
XQ_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
})

def init_xq_session():
    """激活雪球 Session，获取动态 Cookie"""
    try:
        XQ_SESSION.get("https://xueqiu.com/", timeout=10)
        logger.info("Xueqiu session initialized successfully.")
    except Exception as e:
        logger.error(f"Xueqiu initialization failed: {e}")

@app.on_event("startup")
async def startup_event():
    init_xq_session()
    # 打印路由表以便调试
    logger.info("ROUTING_TABLE_START")
    for route in app.routes:
        logger.info(f"ROUTE_PATH: {route.path} | METHODS: {route.methods}")
    logger.info("ROUTING_TABLE_END")
    logger.info("Backend service v4.3.0-MASTER starting up...")

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 核心数据接口 ---

@app.get("/health_check")
def health_check():
    return {"status": "ok", "v": "4.3.0-MASTER", "desc": "Desensitized Path"}

@app.get("/api/health")
def health():
    return {"status": "ok", "v": "4.3.0-MASTER", "desc": "Legacy Path"}

@app.get("/api/stocks/search")
def search_stock(q: str = Query(...)):
    """基于东财最新 SearchAPI 的高性能搜索"""
    q = q.strip()
    if not q: return []
    url = "https://searchapi.eastmoney.com/api/suggest/get"
    params = { "input": q, "type": "14", "token": "D43A3003844103BA765F8397C224F2AD" }
    headers = { "User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/" }
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        table = resp.json().get("QuotationCodeTable", {})
        data_list = table.get("Data", [])
        if not data_list:
            if re.fullmatch(r"\d{6}", q): return [{"code": q, "name": f"直达 {q}", "industry": "穿透"}]
            return []
        
        # 批量获取报价
        results = []
        top_items = data_list[:5]
        sina_query = []
        for it in top_items:
            c = it.get("Code")
            prefix = "sh" if c.startswith("6") else "sz"
            if c.startswith("4") or c.startswith("8"): prefix = "bj"
            sina_query.append(f"{prefix}{c}")
        
        prices_map = fetch_sina_prices(",".join(sina_query))
        
        for item in data_list:
            code = item.get("Code")
            p_data = prices_map.get(code, {"price": 0, "pct": 0})
            results.append({
                "code": code,
                "name": item.get("Name"),
                "industry": item.get("SecurityTypeName"),
                "price": p_data.get("price"),
                "pct": p_data.get("pct")
            })
        return results
    except Exception as e:
        logger.error(f"Search error: {e}")
        return []

# --- 业务常量与模型 ---
EVENT_CATALOG = {
    "DEBT_RISK": {
        "label": "债务逾期/违约", "keywords": ["逾期", "未能清偿", "违约", "到期未回售"],
        "severity": 95, "category": "信用违约",
        "interpretation": "公司资金链极度紧张，已触发法律风险。",
        "game_view": "核心关注：债权人是否发起集体诉讼，以及是否会触发债务交叉违约。"
    },
    "LEGAL_INVESTIGATION": {
        "label": "立案调查/处罚", "keywords": ["立案", "处罚", "证监会调查", "限制消费"],
        "severity": 90, "category": "合规风险",
        "interpretation": "监管层介入，可能涉及财务造假或合规漏洞。",
        "game_view": "博弈点：关注是否涉及 ST 风险或撤销上市资格。"
    },
    "ASSET_FREEZE": {
        "label": "股份/资产冻结", "keywords": ["冻结", "轮候冻结", "司法拍卖"],
        "severity": 85, "category": "治理危机",
        "interpretation": "控股股东股份丧失流动性，可能导致经营权动荡。",
        "game_view": "深度解析：冻结是控制权争夺的‘明牌’。"
    },
    "EARNINGS_BOOST": {
        "label": "业绩预增/扭亏", "keywords": ["预增", "扭亏", "增长", "盈利"],
        "severity": 70, "category": "基本面改善",
        "interpretation": "公司经营性现金流或盈利能力出现边际修复信号。",
        "game_view": "博弈点：区分‘非经常性损益’和‘核心业务驱动’。"
    },
    "CONTRACT_WIN": {
        "label": "重大合同/中标", "keywords": ["中标", "合同", "订单", "协议"],
        "severity": 65, "category": "业务增量",
        "interpretation": "在手订单增加，确保未来营收确定性。",
        "game_view": "博弈解析：关注合同执行周期及利润率。"
    },
    "STATE_INTERVENTION": {
        "label": "国资介入/重组", "keywords": ["国资", "收储", "重组", "战略合作", "战投"],
        "severity": 80, "category": "逻辑反转",
        "interpretation": "外部强力资本注入，旨在优化资产负债表或引入资源。",
        "game_view": "黄金研判：这是困境反转的‘最强背书’。"
    }
}

NEG_RULES = [(k, v["keywords"]) for k, v in EVENT_CATALOG.items() if v.get("severity", 0) > 75]
POS_RULES = [(k, v["keywords"]) for k, v in EVENT_CATALOG.items() if v.get("severity", 0) <= 75]

# --- 辅助提取函数 ---

@lru_cache(maxsize=128)
def fetch_announcements(code: str, days: int = 180) -> List[Dict]:
    url = "https://www.cninfo.com.cn/new/hisAnnouncement/query"
    end_date = dt.date.today()
    start_date = dt.date(2026, 3, 1)
    payload = {
        "pageNum": 1, "pageSize": 50, "column": "szse", "tabName": "fulltext",
        "plate": "sh" if code.startswith("6") else "sz",
        "stock": "", "searchkey": code, "seDate": f"{start_date}~{end_date}",
    }
    try:
        resp = requests.post(url, data=payload, timeout=10)
        data = resp.json().get("announcements") or []
        return [a for a in data if a.get("secCode") == code]
    except: return []

def get_pdf_url(adjunct_url: str) -> str:
    return f"https://static.cninfo.com.cn/{adjunct_url}" if adjunct_url else ""

@lru_cache(maxsize=128)
def fetch_sina_prices(codes: str) -> Dict[str, Any]:
    url = f"https://hq.sinajs.cn/list={codes}"
    headers = {"Referer": "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0"}
    results = {}
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        text = resp.content.decode("gbk")
        for line in text.split("\n"):
            if "=" not in line: continue
            code_num = "".join(filter(str.isdigit, line.split("=")[0]))
            data = line.split("=")[1].replace('"', '').split(",")
            if len(data) > 4:
                price = float(data[3])
                pre_close = float(data[2])
                pct = round(((price - pre_close) / pre_close * 100), 2) if pre_close > 0 else 0
                results[code_num] = {"price": price, "pct": pct}
    except: pass
    return results

@lru_cache(maxsize=128)
def fetch_eastmoney_indicators(code: str) -> Dict[str, Any]:
    market = "1" if code.startswith("6") else "0"
    url = f"http://push2.eastmoney.com/api/qt/stock/get?secid={market}.{code}&fields=f162,f167,f168,f117"
    try:
        resp = requests.get(url, timeout=5)
        d = resp.json().get("data") or {}
        return {
            "pe": d.get("f162", "-"), "pb": d.get("f167", "-"),
            "turnover": d.get("f168", "-"), "roe": d.get("f117", "-")
        }
    except: return {"pe": "-", "pb": "-", "turnover": "-", "roe": "-"}

@lru_cache(maxsize=128)
def fetch_xueqiu_hotness(code: str) -> Dict:
    symbol = f"SH{code}" if code.startswith("6") else f"SZ{code}"
    try:
        url = f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={symbol}&extend=detail"
        resp = XQ_SESSION.get(url, timeout=5)
        if resp.status_code != 200:
            init_xq_session()
            resp = XQ_SESSION.get(url, timeout=5)
        data = resp.json().get("data", {}).get("quote", {})
        followers = data.get("followers", 0)
        pop = min(98, 60 + (followers // 5000))
        return {"popularity": pop, "rank": f"关注 {followers:,}", "sentiment": "bullish" if pop > 75 else "neutral"}
    except: return {"popularity": 68, "rank": "探测中", "sentiment": "neutral"}

# --- 深度情报接口 ---

@app.get("/api/stocks/{code}/highlights")
def get_highlights(code: str):
    with ThreadPoolExecutor(max_workers=3) as executor:
        f_ann = executor.submit(fetch_announcements, code)
        f_ind = executor.submit(fetch_eastmoney_indicators, code)
        f_pop = executor.submit(fetch_xueqiu_hotness, code)
        raw_ann, indicators, xueqiu = f_ann.result(), f_ind.result(), f_pop.result()
    
    if not raw_ann: raise HTTPException(status_code=404, detail="未发现相关公告")
    
    company_name = raw_ann[0].get("secName") or code
    industry = raw_ann[0].get("type") or "通用"
    
    highlights = []
    for item in raw_ann[:15]:
        title = item.get("announcementTitle", "")
        ts = item.get("announcementTime")
        published_at = dt.datetime.fromtimestamp(ts/1000).strftime("%Y-%m-%d") if ts else "未知"
        pdf_url = get_pdf_url(item.get("adjunctUrl"))
        
        matched = None
        for k, v in EVENT_CATALOG.items():
            if any(kw in title for kw in v["keywords"]):
                matched = v; break
        
        if matched:
            side = "risk" if matched["severity"] > 75 else "positive"
            highlights.append({
                "id": f"ev-{item['announcementId']}", "side": side, "label": matched["label"],
                "score": matched["severity"], "category": matched["category"], "why": title,
                "interpretation": matched["interpretation"], "game_view": matched["game_view"],
                "factors": ["公告实证"],
                "evidence": [{"source": "巨潮披露", "title": title, "time": published_at, "url": pdf_url}],
                "history": [{"date": published_at, "action": "事件识别", "desc": matched["label"]}]
            })

    radar = [
        {"k": "价值增长", "v": min(100, len([h for h in highlights if h["side"] == "positive"]) * 30)},
        {"k": "风险对冲", "v": max(20, 100 - len([h for h in highlights if h["side"] == "risk"]) * 25)},
        {"k": "市场人气", "v": xueqiu.get("popularity", 50)},
        {"k": "指标强度", "v": 70}, {"k": "合规盾牌", "v": 85}, {"k": "预期反转", "v": 60}
    ]

    return {
        "stock": {"code": code, "name": company_name, "industry": industry},
        "summary": {"riskCount": len([h for h in highlights if h["side"]=="risk"]), "positiveCount": len([h for h in highlights if h["side"]=="positive"])},
        "highlights": highlights, "radar": radar, "xueqiu": xueqiu
    }

@app.get("/api/stocks/{code}/snapshots")
def get_snapshots(code: str):
    raw_data = fetch_announcements(code)
    timeline = {}
    for item in raw_data:
        ts = item.get("announcementTime")
        if not ts: continue
        month = dt.datetime.fromtimestamp(ts/1000).strftime("%Y-%m")
        title = item.get("announcementTitle", "")
        r = 25 if any(any(kw in title for kw in kws) for _, kws in NEG_RULES) else 0
        p = 20 if any(any(kw in title for kw in kws) for _, kws in POS_RULES) else 0
        if month not in timeline: timeline[month] = {"r": 0, "p": 0}
        timeline[month]["r"] = min(100, timeline[month]["r"] + r)
        timeline[month]["p"] = min(100, timeline[month]["p"] + p)
    return [{"snapshotDate": f"{m}-01", "riskScore": v["r"], "positiveScore": v["p"]} for m, v in sorted(timeline.items())]

@app.get("/api/stocks/{code}/history")
def get_history(code: str):
    try:
        data = get_highlights(code)
        history = []
        for h in data["highlights"]:
            for hist in h["history"]:
                history.append({**hist, "label": h["label"], "side": h["side"]})
        return sorted(history, key=lambda x: x["date"], reverse=True)
    except: return []

# --- 纯净 API 后端模式 ---
# 已移除静态托管逻辑，防止干扰路由匹配

@app.get("/")
def read_root():
    return {"status": "Backend Active", "v": "4.3.1-PURE-API", "msg": "API is online."}

@app.get("/the_ultimate_truth_v431")
def the_ultimate_truth():
    return {"truth": "If you see this, v4.3.1 is LIVE on server.py", "timestamp": str(os.getenv("PORT"))}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", 7860)), reload=True)
