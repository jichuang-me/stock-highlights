import requests
import json
import re

def test_sina_news(code):
    """测试新浪 7x24 实时新闻接口"""
    url = f"https://search.sina.com.cn/api/search/info?q={code}&page=1&size=5"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        print(f"Sina News Status: {resp.status_code}")
        # print(resp.json())
        return resp.json()
    except Exception as e:
        print(f"Sina News Error: {e}")

def test_xueqiu_hotness(code):
    """测试雪球人气排行/详情接口"""
    symbol = f"SH{code}" if code.startswith("6") else f"SZ{code}"
    # 尝试获取人气排名
    url = f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={symbol}&extend=detail"
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Cookie": "u=123456789;" # 需要模拟一个 basic cookie
    }
    try:
        # 先获取一次主页拿 cookie
        s = requests.Session()
        s.get("https://xueqiu.com", headers=headers, timeout=5)
        resp = s.get(url, headers=headers, timeout=5)
        print(f"Xueqiu Status: {resp.status_code}")
        data = resp.json()
        return data
    except Exception as e:
        print(f"Xueqiu Error: {e}")

if __name__ == "__main__":
    code = "600519"
    print("--- Testing Sina News ---")
    test_sina_news(code)
    print("\n--- Testing Xueqiu ---")
    test_xueqiu_hotness(code)
