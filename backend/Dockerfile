# 使用轻量级 Python 镜像
FROM python:3.10-slim

# 设置工作目录
WORKDIR /app

# 复制依赖文件并安装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY . .

# Hugging Face Spaces 默认监听 7860 端口
ENV PORT=7860
ENV PYTHONUNBUFFERED=1

# 使用生产级别的 uvicorn 启动方式，这在 Hugging Face 容器中更稳定
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
