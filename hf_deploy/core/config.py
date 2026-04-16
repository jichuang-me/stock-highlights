import os
import requests
import logging

# 基础配置
PORT = int(os.getenv("PORT", 7860))
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

# 雪球 Session 管理
XQ_SESSION = requests.Session()
XQ_SESSION.headers.update({"User-Agent": USER_AGENT})

def init_xq_session():
    try:
        XQ_SESSION.get("https://xueqiu.com/", timeout=5)
    except Exception as e:
        logging.warning(f"Failed to initialize Xueqiu session: {e}")

# 初始化
init_xq_session()
