import requests
import json

def test_modular_search():
    # 指向我们重构后的唯一权威后端
    url = "https://jichuang123-stock-backend.hf.space/api/stocks/search"
    params = {"q": "茅台"}
    
    print(f"Testing Modular Search API: {url}")
    print("-" * 30)
    
    try:
        resp = requests.get(url, params=params, timeout=15)
        print(f"Status Code: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"Successfully retrieved {len(data)} results.")
            if data:
                print("\nTop Result Sample:")
                print(json.dumps(data[0], indent=2, ensure_ascii=False))
        else:
            print(f"Build in progress or Error. Response: {resp.text[:200]}")
            
    except Exception as e:
        print(f"Connection Error: {e}")

if __name__ == "__main__":
    test_modular_search()
