import datetime as dt
import re
from typing import List, Dict, Any, Optional
import requests
import json
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

app = FastAPI(title="Stock Highlights Real Data Backend")

@app.on_event("startup")
async def startup_event():
    logger.info("Backend service starting up on cloud environment...")
    # 确保存储目录存在
    if not os.path.exists("data"):
        os.makedirs("data")

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 模拟环境注入 (雪球 Session 管理) ---
XQ_SESSION = requests.Session()
XQ_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
})

def init_xq_session():
    try:
        XQ_SESSION.get("https://xueqiu.com/", timeout=5)
    except:
        pass

init_xq_session()

# --- 情报引擎 v3.0：结构化事件模型与博弈逻辑库 ---
EVENT_CATALOG = {
    "DEBT_RISK": {
        "label": "债务逾期/违约",
        "keywords": ["逾期", "未能清偿", "违约", "到期未回售"],
        "severity": 95,
        "category": "信用违约",
        "interpretation": "公司资金链极度紧张，已触发法律风险。",
        "game_view": "核心关注：债权人是否发起集体诉讼，以及是否会触发债务交叉违约，这是进入破产重整的前兆。"
    },
    "LEGAL_INVESTIGATION": {
        "label": "立案调查/处罚",
        "keywords": ["立案", "处罚", "证监会调查", "限制消费"],
        "severity": 90,
        "category": "合规风险",
        "interpretation": "监管层介入，可能涉及财务造假或合规漏洞。",
        "game_view": "博弈点：关注是否涉及 ST 风险或撤销上市资格。通常立案宣告了‘故事’的终结，出清期可能较长。"
    },
    "ASSET_FREEZE": {
        "label": "股份/资产冻结",
        "keywords": ["冻结", "轮候冻结", "司法拍卖"],
        "severity": 85,
        "category": "治理危机",
        "interpretation": "控股股东股份丧失流动性，可能导致经营权动荡。",
        "game_view": "深度解析：冻结是控制权争夺的‘明牌’。若涉及司法拍卖，需关注接手方背景（如国资是否入场）。"
    },
    "EARNINGS_BOOST": {
        "label": "业绩预增/扭亏",
        "keywords": ["预增", "扭亏", "增长", "盈利"],
        "severity": 70,
        "category": "基本面改善",
        "interpretation": "公司经营性现金流或盈利能力出现边际修复信号。",
        "game_view": "博弈点：区分‘非经常性损益’和‘核心业务驱动’。若是资产处置导致的利润虚增，需警惕冲高回落。"
    },
    "CONTRACT_WIN": {
        "label": "重大合同/中标",
        "keywords": ["中标", "合同", "订单", "协议"],
        "severity": 65,
        "category": "业务增量",
        "interpretation": "在手订单增加，确保未来 6-12 个月的营收确定性。",
        "game_view": "博弈解析：关注合同执行周期及利润率。若属于‘关联交易’，则属于典型的报表粉饰，而非真实利好。"
    },
    "STATE_INTERVENTION": {
        "label": "国资介入/重组",
        "keywords": ["国资", "收储", "重组", "战略合作", "战投"],
        "severity": 80,
        "category": "逻辑反转",
        "interpretation": "外部强力资本注入，旨在优化资产负债表或引入资源。",
        "game_view": "黄金研判：这是困境反转的‘最强背书’。国资背景的层级决定了反转的力度和信用修复的底线。"
    }
}

# --- 抓取适配阶层 ---

@lru_cache(maxsize=128)
def fetch_announcements(code: str, days: int = 180) -> List[Dict]:
    url = "https://www.cninfo.com.cn/new/hisAnnouncement/query"
    end_date = dt.date.today()
    start_date = dt.date(2026, 3, 1)
    payload = {
        "pageNum": 1, "pageSize": 50, "column": "szse", "tabName": "fulltext",
        "plate": "sh" if code.startswith("6") else "sz",
        "stock": "", "searchkey": code, "secid": "", "category": "",
        "trade": "", "seDate": f"{start_date}~{end_date}",
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest"
    }
    try:
        resp = requests.post(url, data=payload, timeout=10)
        data = resp.json().get("announcements") or []
        return [a for a in data if a.get("secCode") == code]
    except:
        return []

def get_pdf_url(adjunct_url: str) -> str:
    return f"https://static.cninfo.com.cn/{adjunct_url}" if adjunct_url else ""

@lru_cache(maxsize=128)
def fetch_eastmoney_indicators(code: str) -> Dict[str, Any]:
    market = "1" if code.startswith("6") else "0"
    url = f"http://push2.eastmoney.com/api/qt/stock/get?secid={market}.{code}&fields=f162,f43,f167,f117"
    try:
        resp = requests.get(url, timeout=5)
        data = resp.json().get("data") or {}
        return {
            "pe": data.get("f162", "-"),
            "pb": data.get("f167", "-"),
            "roe": data.get("f117", "-")
        }
    except:
        return {"pe": "-", "pb": "-", "roe": "-"}

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
            code_num = "".join(filter(str.isdigit, line.split("=")[0].split("_")[-1]))
            data = line.split("=")[1].replace('"', '').split(",")
            if len(data) > 4:
                price = float(data[3])
                pre_close = float(data[2])
                pct = round((price - pre_close) / pre_close * 100, 2) if pre_close > 0 else 0
                results[code_num] = {"price": price, "pct": pct}
    except:
        pass
    return results

@lru_cache(maxsize=64)
def fetch_price_history(code: str) -> List[Dict]:
    """行情追踪器 v4.1：抓取近 30 个交易日的收盘价序列"""
    symbol = f"{'sh' if code.startswith('6') else 'sz'}{code}"
    url = f"http://money.finance.sina.com.cn/quotes_service/api/jsonp_v2.php/var%20_val=/CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen=30"
    try:
        resp = requests.get(url, timeout=5)
        text = resp.text
        if "=" in text:
            json_str = text.split("=", 1)[1].strip().rstrip(";")
            import ast
            data = ast.literal_eval(json_str)
            return [{"date": it["day"], "price": float(it["close"])} for it in data]
    except Exception as e:
        logger.error(f"Price History Fetch Error: {e}")
    return []

@lru_cache(maxsize=128)
def fetch_sina_live_news(code: str, name: str = "", industry: str = "") -> List[Dict]:
    api_url = "https://feed.sina.com.cn/api/roll/get?num=50&page=1&field=title,url,time&z=1&ch=finance&lid=1023"
    try:
        resp = requests.get(api_url, timeout=5)
        raw_items = resp.json().get("result", {}).get("data", [])
        news = []
        seen = set()
        for it in raw_items:
            title = it.get("title", "").strip()
            if title in seen: continue
            is_hit = False
            tag = "实时"
            if code in title or (name and name[:2] in title):
                is_hit = True; tag = "个股"
            elif industry and industry[:2] in title:
                is_hit = True; tag = "行业"
            if is_hit:
                seen.add(title)
                news.append({
                    "title": title,
                    "time": dt.datetime.fromtimestamp(int(it["time"])).strftime("%H:%M"),
                    "url": it["url"], "source": "新浪7x24", "tag": tag
                })
        return news[:10]
    except: return []

@lru_cache(maxsize=128)
def fetch_cls_news(code: str, name: str = "") -> List[Dict]:
    url = "https://www.cls.cn/telegraph"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        match = re.search(r'window\.__NEXT_DATA__\s*=\s*(\{.*?\});', resp.text)
        if not match: return []
        json_data = json.loads(match.group(1))
        # 简单提取逻辑 (v4.0 适配)
        try:
            items = json_data['props']['pageProps']['telegraphList']
        except:
            items = json_data['props']['initialState']['telegraph']['telegraphList']
        news = []
        kw = name if name else code
        for it in items:
            if kw in (it.get("title", "") + it.get("content", "")):
                news.append({
                    "title": it.get("title") or it.get("content")[:50],
                    "time": dt.datetime.fromtimestamp(it["ctime"]).strftime("%H:%M"),
                    "url": f"https://www.cls.cn/detail/{it['id']}",
                    "source": "财联社电报", "tag": "实时"
                })
        return news
    except: return []

@lru_cache(maxsize=128)
def fetch_xueqiu_hotness(code: str) -> Dict:
    symbol = f"SH{code}" if code.startswith("6") else f"SZ{code}"
    try:
        url = f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={symbol}&extend=detail"
        resp = XQ_SESSION.get(url, timeout=5)
        data = resp.json().get("data", {}).get("quote", {})
        followers = data.get("followers", 0)
        return {
            "popularity": 75 if followers > 10000 else 60,
            "followers": followers,
            "rank": f"关注 {followers:,}",
            "sentiment": "bullish" if followers > 50000 else "neutral"
        }
    except:
        return {"popularity": 65, "followers": 0, "rank": "情报探测中", "sentiment": "neutral"}

# --- 核心路由 ---

@app.get("/api/health")
def health():
    return {"status": "ok", "source": "v4.1_stable"}

@app.get("/api/stocks/search")
def search_stock(q: str = Query(...)):
    q = q.strip()
    if not q: return []
    url = "https://searchapi.eastmoney.com/api/suggest/get"
    params = {"input": q, "type": "14", "token": "D43A3003844103BA765F8397C224F2AD"}
    try:
        resp = requests.get(url, params=params, timeout=10)
        items = resp.json().get("QuotationCodeTable", {}).get("Data", [])
        if not items: return []
        results = []
        top_codes = []
        for it in items[:5]:
            c = it["Code"]
            prefix = "sh" if c.startswith("6") else "sz"
            top_codes.append(f"{prefix}{c}")
        prices = fetch_sina_prices(",".join(top_codes))
        for it in items:
            code = it["Code"]
            p = prices.get(code, {"price": 0, "pct": 0})
            results.append({
                "code": code, "name": it["Name"], "industry": it["SecurityTypeName"],
                "price": p["price"], "pct": p["pct"]
            })
        return results
    except: return []

@app.get("/api/stocks/{code}/highlights")
def get_highlights(code: str):
    with ThreadPoolExecutor(max_workers=5) as executor:
        f_ann = executor.submit(fetch_announcements, code)
        f_ind = executor.submit(fetch_eastmoney_indicators, code)
        f_pop = executor.submit(fetch_xueqiu_hotness, code)
        f_price = executor.submit(fetch_price_history, code)
        
        raw_ann = f_ann.result()
        indicators = f_ind.result()
        xueqiu = f_pop.result()
        price_history = f_price.result()

    prefix = "sh" if code.startswith("6") else "sz"
    price_info = fetch_sina_prices(f"{prefix}{code}").get(code, {"price": 0.0, "pct": 0.0})
    name = raw_ann[0].get("secName") if raw_ann else f"代码 {code}"
    ind = raw_ann[0].get("type") if raw_ann else "自选"
    
    cls_news = fetch_cls_news(code, name)
    sina_news = fetch_sina_live_news(code, name, ind)
    live_news = sorted((cls_news or []) + (sina_news or []), key=lambda x: x["time"], reverse=True)
    
    highlights = []
    total_risk = 0; total_pos = 0
    for item in raw_ann[:15]:
        title = item.get("announcementTitle", "")
        published_at = dt.datetime.fromtimestamp(item["announcementTime"]/1000).strftime("%Y-%m-%d")
        matched = None
        for k, meta in EVENT_CATALOG.items():
            if any(kw in title for kw in meta["keywords"]):
                matched = meta; break
        if matched:
            side = "risk" if matched["severity"] > 75 else "positive"
            highlights.append({
                "id": f"ev-{item['announcementId']}", "side": side, "label": matched["label"],
                "score": matched["severity"], "category": matched["category"], "why": title,
                "interpretation": matched["interpretation"], "game_view": matched["game_view"],
                "evidence": [{"source": "巨潮公告", "title": title, "time": published_at, "url": get_pdf_url(item["adjunctUrl"])}],
                "history": [{"date": published_at, "action": "事件识别", "desc": matched["label"], "delta": "NEW"}]
            })
            if side == "risk": total_risk += 1
            else: total_pos += 1

    radar = [
        {"k": "价值增长", "v": min(100, total_pos * 30)},
        {"k": "风险对冲", "v": max(0, 100 - total_risk * 25)},
        {"k": "估值水平", "v": 70},
        {"k": "市场人气", "v": xueqiu.get("popularity", 50)}
    ]
    
    return {
        "stock": {"code": code, "name": name, "industry": ind},
        "summary": {"riskCount": total_risk, "positiveCount": total_pos, "sentiment": xueqiu["sentiment"]},
        "marketImpression": f"深度监测中。当前包含 {total_risk} 项风险与 {total_pos} 项亮点。",
        "price": price_info["price"], "pctChange": price_info["pct"], "priceHistory": price_history,
        "highlights": highlights, "liveNews": live_news[:10], "radar": radar, "xueqiu": xueqiu
    }

@app.get("/api/stocks/{code}/snapshots")
def list_snapshots(code: str):
    file_path = f"data/snapshots_{code}.json"
    if not os.path.exists(file_path): return []
    try:
        with open(file_path, "r", encoding="utf-8") as f: return json.load(f)
    except: return []

@app.post("/api/stocks/{code}/snapshots")
def save_snapshot(code: str, snapshot_data: Dict):
    file_path = f"data/snapshots_{code}.json"
    snapshots = list_snapshots(code)
    snapshot_data["timestamp"] = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    snapshot_data["id"] = f"snap-{int(dt.datetime.now().timestamp())}"
    snapshots.insert(0, snapshot_data)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(snapshots[:10], f, ensure_ascii=False, indent=2)
    return {"status": "success", "id": snapshot_data["id"]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8001)))
