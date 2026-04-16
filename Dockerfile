FROM python:3.9-slim

WORKDIR /app

# 先拷贝环境依赖，利用 Docker 缓存层
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 拷贝全量代码，保留 hf_deploy 文件夹结构
COPY . .

# 设置 Python 路径，确保包模式寻址
ENV PYTHONPATH=/app
ENV PORT=7860

# 以完整的包路径启动后端，解决相对导入问题
CMD ["uvicorn", "hf_deploy.app:app", "--host", "0.0.0.0", "--port", "7860"]
