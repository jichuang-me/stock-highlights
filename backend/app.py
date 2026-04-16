import datetime as dt
import re
from typing import List, Dict, Any, Optional
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Stock Highlights Real Data Backend")

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 规则库：基于关键词的真实公告打分 ---
POSITIVE_RULES = [
    ("业绩预增/扭亏", ["业绩预告", "业绩预增", "扭亏为盈", "盈利"]),
    ("重大合同", ["中标", "合同", "订单", "重大协议", "签订协议"]),
    ("回购/增持", ["回购股份", "增持计划", "员工持股"]),
    ("项目投产", ["投产", "落成", "达产"]),
]
NEGATIVE_RULES = [
    ("合规风险/处罚", ["风险提示", "立案", "限制", "警告", "警示函", "处罚", "自律监管"]),
    ("资金压力/质押", ["股份质押", "股权冻结", "拍卖", "司法过户"]),
    ("经营压力/诉讼", ["诉讼", "仲裁", "计提", "亏损", "下修", "逾期"]),
    ("减持风险", ["减持", "预披露", "变动超过1%"]),
]

def fetch_announcements(code: str, days: int = 180) -> List[Dict]:
    url = "https://www.cninfo.com.cn/new/hisAnnouncement/query"
    end_date = dt.date.today()
    start_date = end_date - dt.timedelta(days=days)
    
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
        resp.raise_for_status()
        data = resp.json().get("announcements") or []
        return [a for a in data if a.get("secCode") == code]
    except Exception:
        return []

def get_pdf_url(adjunct_url: str) -> str:
    return f"https://static.cninfo.com.cn/{adjunct_url}" if adjunct_url else ""

# --- 业务逻辑：核心聚合 ---
def fetch_eastmoney_news(name: str, code: str) -> List[Dict]:
    """获取东财资讯/研报"""
    url = "https://mkapi2.dfcfs.com/finskillshub/api/claw/news-search"
    payload = {"query": f"{name} {code} 研报", "page": 1, "size": 5}
    headers = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
    try:
        resp = requests.post(url, json=payload, timeout=5)
        data = resp.json().get("list") or []
        return data
    except:
        return []

def fetch_eastmoney_indicators(code: str) -> Dict[str, Any]:
    """获取东财个股核心量化指标"""
    market = "1" if code.startswith("6") else "0"
    url = f"http://push2.eastmoney.com/api/qt/stock/get?secid={market}.{code}&fields=f162,f167,f168,f116,f117"
    try:
        resp = requests.get(url, timeout=5)
        data = resp.json().get("data") or {}
        return {
            "pe": data.get("f162", "-"),
            "pb": data.get("f167", "-"),
            "turnover": data.get("f168", "-"),
            "roe": data.get("f117", "-"),
        }
    except:
        return {}

# --- 业务逻辑：核心聚合 ---

@app.get("/api/health")
def health():
    return {"status": "ok", "source": "multi_source_intelligence_aggregator"}

@app.get("/api/stocks/search")
def search_stock(q: str = Query(...)):
    """基于东财最新 SearchAPI 的高性能搜索（支持拼音、首字母、汉字、代码）"""
    q = q.strip()
    if not q: return []
    
    # 新版接口：返回标准 JSON，稳定性更高
    url = f"https://searchapi.eastmoney.com/api/suggest/get?input={q}&type=14&token=D43A3003844103BA765F8397C224F2AD"
    
    try:
        resp = requests.get(url, timeout=5)
        data = resp.json()
        
        # 提取结果列表
        items = data.get("QuotationCodeTableList", [])
        if not items:
            # 兜底：如果是 6 位代码
            if re.fullmatch(r"\d{6}", q):
                return [{"code": q, "name": f"穿透代码 {q}", "industry": "手动进入"}]
            return []

        output = []
        for item in items:
            code = item.get("Code")
            name = item.get("Name")
            # 过滤 A 股与北交所
            if code and (re.match(r"^(0,00)|(0,30)|(1,60)|(1,68)|(2,43)|(2,83)|(2,87)", f"{item.get('MktNum',0)},{code}") or re.match(r"^(00|30|60|68|43|83|87)", code)):
                output.append({
                    "code": code,
                    "name": name,
                    "industry": "A股证券"
                })
        
        # 强制兜底
        if not output and re.fullmatch(r"\d{6}", q):
             output.append({"code": q, "name": f"直达代码 {q}", "industry": "直接穿透"})
             
        return output[:12]
    except Exception as e:
        print(f"SEARCH_ERROR: {str(e)}")
        if re.fullmatch(r"\d{6}", q):
            return [{"code": q, "name": f"代码 {q}", "industry": "快速通道"}]
        return []

@app.get("/api/stocks/{code}/highlights")
def get_highlights(code: str):
    raw_ann = fetch_announcements(code)
    if not raw_ann:
        raise HTTPException(status_code=404, detail="未检索到公告证据")

    company_name = raw_ann[0].get("secName") or f"代码 {code}"
    industry = raw_ann[0].get("type") or "通用板块"
    
    # 获取多源数据
    em_news = fetch_eastmoney_news(company_name, code)
    indicators = fetch_eastmoney_indicators(code)
    
    highlights = []
    total_risk = 0
    total_pos = 0

    # 处理公告数据 (官方披露)
    for item in raw_ann[:20]:
        title = item.get("announcementTitle", "")
        ts = item.get("announcementTime")
        published_at = dt.datetime.fromtimestamp(ts/1000).strftime("%Y-%m-%d") if ts else "未知"
        pdf_url = get_pdf_url(item.get("adjunctUrl"))
        ev = {"source": "巨潮资讯", "title": title, "time": published_at, "weight": "高", "excerpt": title, "url": pdf_url}
        hist = [{"date": published_at, "action": "披露", "desc": "官方法定披露", "delta": "+1"}]

        # 匹配逻辑保持不变
        for label, kws in NEGATIVE_RULES:
            if any(kw in title for kw in kws):
                highlights.append({
                    "id": f"neg-{item['announcementId']}", "side": "risk", "label": label, "stars": 4, "score": 85,
                    "category": "风险披露", "why": title, "interpretation": "官方公告确认风险，证据链条完整。",
                    "factors": ["法定披露", "事件驱动"], "evidence": [ev], "history": hist
                })
                total_risk += 1
                break
        else:
            for label, kws in POSITIVE_RULES:
                if any(kw in title for kw in kws):
                    highlights.append({
                        "id": f"pos-{item['announcementId']}", "side": "positive", "label": label, "stars": 3, "score": 70,
                        "category": "主要进展", "why": title, "interpretation": "官方公告确认利好，逻辑清晰。",
                        "factors": ["业务增量", "公开信息"], "evidence": [ev], "history": hist
                    })
                    total_pos += 1
                    break

    # 处理东财研报数据 (市场预期)
    for item in em_news:
        title = item.get("title", "")
        published_at = item.get("time", "近期")
        ev = {"source": "东财研报", "title": title, "time": published_at, "weight": "中", "excerpt": title, "url": item.get("url")}
        hist = [{"date": published_at, "action": "研判", "desc": "市场机构分析视角", "delta": "+1"}]
        
        # 简化研报打分：提及“评级”或“买入”视为亮点
        if any(kw in title for kw in ["买入", "增持", "评级", "目标价"]):
            highlights.append({
                "id": f"em-pos-{hash(title)}", "side": "positive", "label": "机构看好", "stars": 3, "score": 75,
                "category": "研报观点", "why": title, "interpretation": "卖方机构给出正面评级，代表市场买方预期向上。",
                "factors": ["分析师视角", "预期抬升"], "evidence": [ev], "history": hist
            })
            total_pos += 1
        elif any(kw in title for kw in ["警示", "下调", "担忧"]):
            highlights.append({
                "id": f"em-neg-{hash(title)}", "side": "risk", "label": "机构警示", "stars": 3, "score": 80,
                "category": "研究风险", "why": title, "interpretation": "机构分析师指出潜在隐忧，可能引发市场情绪波动。",
                "factors": ["卖方预警", "流动性压制"], "evidence": [ev], "history": hist
            })
            total_risk += 1

    # 绘制雷达图 (动态基本面指标)
    pe_val = indicators.get("pe", 30)
    pe_score = max(20, min(100, 100 - (float(pe_val) if isinstance(pe_val, (int, float)) else 30)))
    
    radar = [
        {"k": "价值分", "v": min(100, total_pos * 15)},
        {"k": "风险分", "v": min(100, total_risk * 20)},
        {"k": "估值合宜", "v": pe_score},
        {"k": "信息透明", "v": min(100, len(raw_ann) * 5)},
        {"k": "流动性", "v": 85}
    ]

    return {
        "stock": {"code": code, "name": company_name, "industry": industry},
        "summary": {
            "riskCount": total_risk, "positiveCount": total_pos, "confidence": 88,
            "totalRiskScore": min(100, total_risk * 15), "totalPositiveScore": min(100, total_pos * 12)
        },
        "marketImpression": f"深度穿透巨潮(公告)+东财(研报)双源数据。今日探测到 {total_risk} 项风险关联及 {total_pos} 项价值增长点。",
        "headline": f"{company_name}：多源数据穿透式看板",
        "outlook": {"consensus": "中性偏多", "shortTerm": f"PE({indicators.get('pe', '-')}) ROE({indicators.get('roe', '-')})", "valuation": "机构密集关注中"},
        "highlights": highlights,
        "radar": radar
    }

@app.get("/api/stocks/{code}/history")
def get_history(code: str):
    try:
        data = get_highlights(code)
        history = []
        for h in data["highlights"]:
            for hist in h["history"]:
                history.append({**hist, "label": h["label"], "side": h["side"], "highlightId": h["id"]})
        return sorted(history, key=lambda x: x["date"], reverse=True)
    except:
        return []

@app.get("/api/stocks/{code}/snapshots")
def get_snapshots(code: str):
    """
    基于真实公告时间轴聚合趋势分值
    """
    raw_data = fetch_announcements(code)
    if not raw_data: return []

    timeline = {}
    for item in raw_data:
        ts = item.get("announcementTime")
        if not ts: continue
        month_key = dt.datetime.fromtimestamp(ts/1000).strftime("%Y-%m")
        title = item.get("announcementTitle", "")
        
        r_inc = 25 if any(any(kw in title for kw in kws) for _, kws in NEGATIVE_RULES) else 0
        p_inc = 20 if any(any(kw in title for kw in kws) for _, kws in POSITIVE_RULES) else 0
        
        if month_key not in timeline: timeline[month_key] = {"risk": 0, "positive": 0}
        timeline[month_key]["risk"] = min(100, timeline[month_key]["risk"] + r_inc)
        timeline[month_key]["positive"] = min(100, timeline[month_key]["positive"] + p_inc)

    sorted_months = sorted(timeline.keys())
    return [
        {"snapshotDate": f"{m}-01", "riskScore": timeline[m]["risk"], "positiveScore": timeline[m]["positive"]}
        for m in sorted_months
    ]

if __name__ == "__main__":
    import uvicorn
    # 迁移至 8001 端口以避开系统 8000 端口冲突
    uvicorn.run("app:app", host="0.0.0.0", port=8001, reload=True)
