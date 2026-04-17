# --- 第一阶段：前端构建 ---
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
# 拷贝 package.json 并安装依赖
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
# 拷贝前端全量代码并构建
COPY frontend/ ./
# 注入环境变量（使用 Space 的公网地址）
ENV VITE_API_BASE_URL=https://jichuang123-stock-backend.hf.space
RUN npm run build

# --- Stage 2: Backend Runtime stage
FROM python:3.9-slim

# Set timezone
ENV TZ=Asia/Shanghai
RUN apt-get update && apt-get install -y tzdata && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 安装 python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 先复制后端代码（不包含大型前端源码）
COPY hf_deploy/ ./hf_deploy/

# 从第一阶段拷贝构建产物
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PYTHONPATH=/app
ENV PORT=7860

# 启动命令
CMD ["uvicorn", "hf_deploy.app:app", "--host", "0.0.0.0", "--port", "7860"]
