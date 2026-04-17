# --- 第一阶段：前端构建 ---
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
# 拷贝 package.json 并安装依赖
COPY frontend/package*.json ./
RUN npm install
# 拷贝前端全量代码并构建
COPY frontend/ ./
# 注入环境变量（使用 Space 的公网地址）
ENV VITE_API_BASE_URL=https://jichuang123-stock-backend.hf.space
RUN npm run build

# --- 第二阶段：后端运行 ---
FROM python:3.9-slim
WORKDIR /app

# 安装 python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 拷贝后端代码
COPY . .
# 从第一阶段拷贝构建产物，覆盖本地可能为空或缺失的 dist 文件夹
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PYTHONPATH=/app
ENV PORT=7860

# 启动命令
CMD ["uvicorn", "hf_deploy.app:app", "--host", "0.0.0.0", "--port", "7860"]
