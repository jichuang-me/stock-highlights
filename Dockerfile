# 使用轻量级 Python 镜像
FROM python:3.10-slim

# 设置工作目录
WORKDIR /app

# 安装必要的系统库（如果有需要）
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖定义
COPY hf_deploy/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制整个模块化后端
COPY hf_deploy/ .

# 设置环境变量
ENV PORT=7860
ENV PYTHONUNBUFFERED=1

# 启动模块化入口 (app.py)
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
