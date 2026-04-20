import logging
import os

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


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

# AI keys from environment variables.
HF_TOKEN = os.getenv("HF_TOKEN")
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

# AI model priority pool.
AI_MODEL_POOL = [
    {"vendor": "deepseek", "model": "deepseek-reasoner", "priority": 0},
    {"vendor": "deepseek", "model": "deepseek-chat", "priority": 1},
    {"vendor": "dashscope", "model": "qwen-plus", "priority": 2},
    {"vendor": "dashscope", "model": "qwen-max", "priority": 3},
    {"vendor": "huggingface_direct", "model": "Qwen/Qwen2.5-72B-Instruct", "priority": 4},
]

DEFAULT_AI_MODEL = os.getenv("DEFAULT_AI_MODEL", "deepseek-reasoner")


def _build_retry_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=2,
        backoff_factor=0.4,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "HEAD", "OPTIONS"),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update({"User-Agent": USER_AGENT})
    return session


HTTP_SESSION = _build_retry_session()
XQ_SESSION = requests.Session()
XQ_SESSION.headers.update({"User-Agent": USER_AGENT})


def init_xq_session():
    try:
        XQ_SESSION.get("https://xueqiu.com/", timeout=REQUEST_TIMEOUT)
    except Exception as exc:
        logging.warning("Failed to initialize Xueqiu session: %s", exc)


init_xq_session()
