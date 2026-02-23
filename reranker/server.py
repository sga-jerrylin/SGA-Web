"""BGE-Reranker 微服务 — 可选的交叉编码器重排序

模型: BAAI/bge-reranker-v2-m3 (多语言，支持中文)
接口: POST /rerank
      GET  /health

通过环境变量配置:
  MODEL_NAME: 模型名称/路径 (默认 BAAI/bge-reranker-v2-m3)
  MAX_LENGTH: 最大输入长度 (默认 512)
  BATCH_SIZE: 批处理大小 (默认 32)
  PORT: 服务端口 (默认 8765)
"""

import os
import logging
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('reranker')

app = FastAPI(title='BGE-Reranker Service', version='1.0.0')

MODEL_NAME = os.environ.get('MODEL_NAME', 'BAAI/bge-reranker-v2-m3')
MAX_LENGTH = int(os.environ.get('MAX_LENGTH', '512'))
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', '32'))

# 延迟加载模型
_model = None


def _get_model():
    global _model
    if _model is None:
        logger.info(f'Loading reranker model: {MODEL_NAME}')
        t0 = time.time()
        from sentence_transformers import CrossEncoder
        _model = CrossEncoder(MODEL_NAME, max_length=MAX_LENGTH)
        logger.info(f'Model loaded in {time.time() - t0:.1f}s')
    return _model


class RerankRequest(BaseModel):
    query: str
    documents: list[str]
    top_k: int = 10


class RerankResult(BaseModel):
    index: int
    score: float
    text: str


class RerankResponse(BaseModel):
    results: list[RerankResult]
    model: str
    latency_ms: int


@app.post('/rerank', response_model=RerankResponse)
async def rerank(req: RerankRequest):
    if not req.query:
        raise HTTPException(400, 'query is required')
    if not req.documents:
        raise HTTPException(400, 'documents list is empty')

    t0 = time.time()
    model = _get_model()

    # 构建 query-document 对
    pairs = [(req.query, doc) for doc in req.documents]

    # 批量计算分数
    scores = model.predict(pairs, batch_size=BATCH_SIZE)

    # 按分数降序排列
    scored = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
    top_k = min(req.top_k, len(scored))

    results = [
        RerankResult(
            index=idx,
            score=round(float(s), 6),
            text=req.documents[idx][:200],
        )
        for idx, s in scored[:top_k]
    ]

    latency = int((time.time() - t0) * 1000)
    return RerankResponse(results=results, model=MODEL_NAME, latency_ms=latency)


@app.get('/health')
async def health():
    model_loaded = _model is not None
    return {
        'status': 'ok',
        'model': MODEL_NAME,
        'model_loaded': model_loaded,
    }


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8765'))
    # 启动时预加载模型
    logger.info('Pre-loading model...')
    _get_model()
    logger.info(f'Starting reranker service on port {port}')
    uvicorn.run(app, host='0.0.0.0', port=port)
