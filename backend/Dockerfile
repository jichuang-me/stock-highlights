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

# 启动命令
CMD ["python", "app.py"]
