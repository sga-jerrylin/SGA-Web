FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# 预下载模型（构建时缓存，避免运行时下载）
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-v2-m3', max_length=512)"

EXPOSE 8765

CMD ["python", "server.py"]
