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

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

# ... (rest of imports)

# ... (app initialization)

# Mount frontend static files
frontend_path = os.path.join(os.getcwd(), "frontend", "dist")

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    # Check if the requested path is an API call
    if full_path.startswith("api/"):
        return {"error": "Not Found"}
    
    # Check if the requested file exists in dist
    file_path = os.path.join(frontend_path, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    
    # Default: Serve index.html for SPA routing
    index_file = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"error": "Frontend not built"}

# We no longer need app.mount("/") because serve_frontend handles it with higher reliability



# Health check endpoint moved to a non-conflicting path if needed, 
# but router already has /api/health

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
