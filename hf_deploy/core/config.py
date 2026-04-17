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
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")

# AI 模型优先级池 (Vendor, Model ID, Priority)
# 厂商支持: dashscope (OpenAI 兼容), huggingface (Router), huggingface_direct (Inference API)
AI_MODEL_POOL = [
    {"vendor": "dashscope", "model": "qwen-plus", "priority": 1},
    {"vendor": "dashscope", "model": "qwen-max", "priority": 2},
    {"vendor": "huggingface_direct", "model": "Qwen/Qwen2.5-72B-Instruct", "priority": 3},
    {"vendor": "huggingface", "model": "meta-llama/Llama-3.3-70B-Instruct", "priority": 4},
]

DEFAULT_AI_MODEL = os.getenv("DEFAULT_AI_MODEL", "qwen-plus")


XQ_SESSION = requests.Session()
XQ_SESSION.headers.update({"User-Agent": USER_AGENT})


def init_xq_session():
    try:
        XQ_SESSION.get("https://xueqiu.com/", timeout=REQUEST_TIMEOUT)
    except Exception as exc:
        logging.warning("Failed to initialize Xueqiu session: %s", exc)


init_xq_session()
