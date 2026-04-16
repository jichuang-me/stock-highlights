# --- 阶段 1: 前端构建 ---
FROM node:20 AS frontend-builder
WORKDIR /web
# 复制 package 文件并安装依赖
COPY frontend/package*.json ./
RUN npm install
# 复制源码并执行编译 (Vite 默认产出到 dist 目录)
COPY frontend/ .
RUN npm run build

# --- 阶段 2: 后端运行 ---
FROM python:3.10-slim
WORKDIR /app

# 安装 Python 依赖
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端源码
COPY backend/ .

# 将阶段 1 编译好的静态文件 (dist) 拷贝到后端目录中
# 这样 app.py 里的 StaticFiles 就能找到并托管它
COPY --from=frontend-builder /web/dist ./dist

# Hugging Face Spaces 默认环境变量
ENV PORT=7860
ENV PYTHONUNBUFFERED=1

# 启动全栈服务
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
