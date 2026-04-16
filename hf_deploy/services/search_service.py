import requests
from typing import List, Dict, Any
from .market_service import fetch_sina_prices

def search_stock_enhanced(q: str) -> List[Dict[str, Any]]:
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
                "code": code,
                "name": it["Name"],
                "industry": it["SecurityTypeName"],
                "price": p["price"],
                "pct": p["pct"]
            })
        return results
    except Exception as e:
        print(f"Search Service Error: {e}")
        return []
