# hf_deploy

This directory contains the FastAPI application and service modules used by the root Hugging Face Space.

## Important
- Do not deploy this directory as a standalone Space anymore.
- The root repository is now the Hugging Face Space source of truth.
- The root `Dockerfile` builds `frontend/` and serves it through `hf_deploy.app`.
