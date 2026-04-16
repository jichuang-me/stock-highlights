import requests
import json

q = "贵州茅台"
token = "D43A3003844103BA765F8397C224F2AD"
url = "https://searchapi.eastmoney.com/api/suggest/get"
params = {
    "input": q,
    "type": "14",
    "token": token
}

try:
    print(f"Testing with query: {q}")
    resp = requests.get(url, params=params, timeout=5)
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.text[:500]}...")
except Exception as e:
    print(f"Error: {e}")

q_pinyin = "gzmt"
params["input"] = q_pinyin
try:
    print(f"\nTesting with pinyin: {q_pinyin}")
    resp = requests.get(url, params=params, timeout=5)
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.text[:500]}...")
except Exception as e:
    print(f"Error: {e}")
