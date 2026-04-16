import requests
import json
import time

def test_cls():
    url = "https://www.cls.cn/nodeapi/telegraphList"
    payload = {
        "app": "CscScreener",
        "os": "web",
        "sv": "7.7.5",
        "last_time": 0
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Origin": "https://www.cls.cn",
        "Referer": "https://www.cls.cn/telegraph"
    }
    
    try:
        print(f"Connecting to {url}...")
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        print(f"Status: {resp.status_code}")
        data = resp.json()
        items = data.get("data", {}).get("roll_data", [])
        print(f"Found {len(items)} news items.")
        if items:
            print("First item sample:")
            print(json.dumps(items[0], indent=2, ensure_ascii=False))
            
            # Check for stock codes
            for it in items[:10]:
                content = it.get("content", "")
                title = it.get("title", "")
                stocks = it.get("stocks", [])
                if stocks:
                    print(f"Item with stocks: {stocks}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_cls()
