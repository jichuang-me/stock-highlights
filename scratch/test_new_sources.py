import requests
import json

def test_sina_price():
    # Example: 600519 (SH), 000001 (SZ)
    # Sina expects sh600519 or sz000001
    code = "sh600519"
    url = f"https://hq.sinajs.cn/list={code}"
    headers = {"Referer": "https://finance.sina.com.cn/"}
    try:
        resp = requests.get(url, headers=headers)
        print(f"Sina Result for {code}: {resp.text}")
    except Exception as e:
        print(f"Sina Error: {e}")

def test_xueqiu_hotness():
    # Xueqiu search or hot list
    url = "https://xueqiu.com/service/v5/stock/hot_stock/list?size=10&_={}"
    # Need to simulate a browser or handle cookies for Xueqiu usually
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://xueqiu.com/"
    }
    try:
        resp = requests.get(url, headers=headers)
        print(f"Xueqiu Hot List: {resp.text[:200]}...")
    except Exception as e:
        print(f"Xueqiu Error: {e}")

if __name__ == "__main__":
    test_sina_price()
    test_xueqiu_hotness()
