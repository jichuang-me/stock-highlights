import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

try:
    from .api.router import router
    from .core.config import CORS_ALLOW_ORIGINS, PORT
except ImportError:
    from api.router import router
    from core.config import CORS_ALLOW_ORIGINS, PORT


app = FastAPI(title="Stock Highlights API", version="4.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

dist_candidates = [
    Path.cwd() / "frontend" / "dist",
    Path(__file__).resolve().parent / "dist",
]
dist_dir = next((candidate for candidate in dist_candidates if candidate.exists()), None)

if dist_dir:
    assets_dir = dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/", include_in_schema=False)
    async def serve_root():
        return FileResponse(dist_dir / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            return {"error": "Not Found"}

        requested_path = dist_dir / full_path
        if requested_path.is_file():
            return FileResponse(requested_path)

        return FileResponse(dist_dir / "index.html")
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return {
            "message": "Stock Highlights API is ready.",
            "endpoints": [
                "/api/health",
                "/api/stocks/search",
                "/api/stocks/{code}/highlights",
            ],
        }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
