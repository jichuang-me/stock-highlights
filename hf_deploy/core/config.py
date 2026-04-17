import logging
import os

import requests


PORT = int(os.getenv("PORT", 7860))
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "8"))
CNINFO_DAYS_DEFAULT = int(os.getenv("CNINFO_DAYS_DEFAULT", "180"))
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)
CORS_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]

# AI 模型配置
HF_TOKEN = os.getenv("HF_TOKEN")
# 默认使用 Qwen 2.5 72B，它是目前最强且支持免费 API 的中文模型之一
DEFAULT_AI_MODEL = "Qwen/Qwen2.5-7B-Instruct"


XQ_SESSION = requests.Session()
XQ_SESSION.headers.update({"User-Agent": USER_AGENT})


def init_xq_session():
    try:
        XQ_SESSION.get("https://xueqiu.com/", timeout=REQUEST_TIMEOUT)
    except Exception as exc:
        logging.warning("Failed to initialize Xueqiu session: %s", exc)


init_xq_session()
