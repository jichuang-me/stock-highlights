import requests
import re

def test():
    q = "lyjs"
    url = f"http://suggest.eastmoney.com/suggest/default.aspx?k={q}&t=1"
    resp = requests.get(url)
    print(f"Status: {resp.status_code}")
    print(f"Content: {resp.text}")
    
    text = resp.text
    start = text.find('[')
    end = text.rfind(']')
    if start != -1 and end != -1:
        content = text[start+1:end]
        print(f"Inner Content: {content}")
        raw_items = []
        for item in content.split('","'):
            cleaned = item.strip('"')
            print(f"Item: {cleaned}")

test()
