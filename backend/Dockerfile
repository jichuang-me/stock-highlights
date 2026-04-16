# 使用轻量级 Python 镜像
FROM python:3.10-slim

# 设置工作目录
WORKDIR /app

# 复制依赖文件并安装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY . .

# Cloud Run 通常根据 $PORT 环境变量设置端口，默认为 8080
ENV PORT=8080

# 启动命令
CMD ["python", "app.py"]
