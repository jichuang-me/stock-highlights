import requests
import json

def test_cls_search():
    # 探测财联社搜索接口，这个接口通常支持按股票名称直达
    url = "https://search-api.cls.cn/search/get_search_list"
    params = {
        "source": "all",
        "type": "telegraph",
        "keywords": "茅台", # 以茅台为例
        "page": 1,
        "page_size": 10
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Referer": "https://www.cls.cn/"
    }
    
    try:
        print(f"Testing CLS Search API: {url}")
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("data", {}).get("telegraph", {}).get("list", [])
            print(f"Found {len(items)} matching telegraphs.")
            if items:
                print("Sample Content:", items[0].get("content", "")[:100])
        else:
            print("Response:", resp.text[:200])
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_cls_search()
