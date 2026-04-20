---
title: Stock Highlights
emoji: 📈
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Stock Highlights
Financial intelligence aggregator and sentiment analyzer.

## Deployment
This Space hosts both the FastAPI backend and the static frontend in a single Docker container.
- API: `/api`
- Frontend: `/`

## Runtime Layout
- `frontend/` is built during the Docker image build.
- `hf_deploy/` contains the FastAPI app and data services.
- The built frontend is served by `hf_deploy.app` so the browser and API share one Hugging Face domain.

## Local Development
- Run the API with `uvicorn hf_deploy.app:app --reload --port 7860`
- Run the frontend with `cd frontend && npm run dev`
- Vite proxies `/api` to `http://localhost:7860`, so no local env file is required.
