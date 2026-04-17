import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from fastapi.staticfiles import StaticFiles
import os

try:
    from .api.router import router
    from .core.config import CORS_ALLOW_ORIGINS, PORT
except ImportError:
    from api.router import router
    from core.config import CORS_ALLOW_ORIGINS, PORT

import os
import time

# Enforce Timezone at Application Level
os.environ['TZ'] = 'Asia/Shanghai'
if hasattr(time, 'tzset'):
    time.tzset()

app = FastAPI(title="Stock Highlights API", version="4.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Mount frontend static files
frontend_path = os.path.join(os.getcwd(), "frontend", "dist")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")



# Health check endpoint moved to a non-conflicting path if needed, 
# but router already has /api/health

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
