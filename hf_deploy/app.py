import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api.router import router
from .core.config import PORT

app = FastAPI(title="Stock Highlights API", version="4.3.1-STABLE")

# 配置 CORS，允许 GitHub Pages 跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # 生产环境下建议限定为您的 github.io 域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载业务路由
app.include_router(router)

@app.get("/")
async def root():
    return {
        "message": "Intelligent Stock Intelligence Terminal Ready",
        "endpoints": ["/api/health", "/api/stocks/search", "/api/stocks/highlights"]
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
