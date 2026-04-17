import aiohttp
import time
from typing import List, Dict, Any
from .market_service import fetch_sina_prices_async

# --- Simple TTL Cache ---
SEARCH_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL = 300 # 5 minutes

async def search_stock_enhanced(q: str) -> List[Dict[str, Any]]:
    q = q.strip().upper()
    if not q: return []
    
    # Check Cache
    now = time.time()
    if q in SEARCH_CACHE:
        cache_entry = SEARCH_CACHE[q]
        if now - cache_entry['time'] < CACHE_TTL:
            return cache_entry['data']
    
    url = "https://searchapi.eastmoney.com/api/suggest/get"
    params = {"input": q, "type": "14", "token": "D43A3003844103BA765F8397C224F2AD"}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=5) as resp:
                data = await resp.json()
                items = data.get("QuotationCodeTable", {}).get("Data", [])
                if not items: return []
                
                # Fetch prices for top results in parallel
                top_codes = []
                for it in items[:8]: # Increase to 8 for better density
                    c = it["Code"]
                    prefix = "sh" if c.startswith("6") else "sz"
                    top_codes.append(f"{prefix}{c}")
                
                prices = await fetch_sina_prices_async(",".join(top_codes))
                
                results = []
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
                
                # Update Cache
                SEARCH_CACHE[q] = {'time': now, 'data': results}
                return results
    except Exception as e:
        import logging
        logging.error(f"Async Search Service Error: {e}")
        return []
