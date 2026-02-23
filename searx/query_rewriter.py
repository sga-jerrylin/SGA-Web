"""查询改写模块 — 纯规则 + 可选热词API，无 LLM 依赖

三层改写策略：
1. 时间锚定：将"最新""今天"等模糊时间词替换为具体日期
2. 同义扩展：领域同义词和中文搜索常用替换
3. 热词注入：从外部热词 API 拉取实时热词，辅助查询扩展
"""

import os
import re
import time
import threading
import logging
from datetime import datetime, timedelta

logger = logging.getLogger('searx.query_rewriter')

# ---------------------------------------------------------------------------
# 1. 时间锚定
# ---------------------------------------------------------------------------

def _today():
    return datetime.now()

# 格式：(正则, 替换函数)
_TIME_PATTERNS = [
    (re.compile(r'最新的?'), lambda: _today().strftime('%Y年%m月')),
    (re.compile(r'今天的?'), lambda: _today().strftime('%m月%d日')),
    (re.compile(r'昨天的?'), lambda: (_today() - timedelta(days=1)).strftime('%m月%d日')),
    (re.compile(r'昨晚的?'), lambda: (_today() - timedelta(days=1)).strftime('%m月%d日')),
    (re.compile(r'今晚的?'), lambda: _today().strftime('%m月%d日')),
    (re.compile(r'近期的?'), lambda: _today().strftime('%Y年%m月')),
    (re.compile(r'最近的?'), lambda: _today().strftime('%Y年%m月')),
    (re.compile(r'刚刚的?'), lambda: _today().strftime('%m月%d日')),
    (re.compile(r'本周的?'), lambda: _today().strftime('%Y年%m月')),
    (re.compile(r'这几天的?'), lambda: _today().strftime('%m月%d日')),
]


def _time_anchor(query: str) -> list[str]:
    """将时间模糊词替换为具体日期，生成额外查询"""
    variants = []
    for pattern, replacer in _TIME_PATTERNS:
        if pattern.search(query):
            replaced = pattern.sub(replacer(), query).strip()
            if replaced and replaced != query:
                variants.append(replaced)
    return variants


# ---------------------------------------------------------------------------
# 2. 同义扩展
# ---------------------------------------------------------------------------

_SYNONYM_MAP = {
    # 技术领域
    '模型发布': ['大模型发布', 'AI模型上线', 'LLM发布'],
    '模型': ['大模型', 'LLM'],
    '人工智能': ['AI', '人工智能'],
    '发布': ['上线', '推出', '开源'],
    '评测': ['测评', '对比', 'benchmark'],
    '开源': ['开源', 'open source'],
    # 热点类
    '热点': ['热搜', '热门', '热议'],
    '新闻': ['资讯', '快讯', '报道'],
    '教程': ['指南', '入门', '使用方法'],
}

# 停用词：这些词在搜索中无用，去掉后效果更好
_STOPWORDS = {'的', '了', '是', '在', '有', '和', '与', '及', '或', '等', '什么', '怎么', '如何',
              '哪些', '哪个', '能', '可以', '请', '帮我', '告诉我', '搜索', '查找', '查询'}


def _synonym_expand(query: str) -> list[str]:
    """基于同义词表做查询扩展"""
    variants = []
    for term, synonyms in _SYNONYM_MAP.items():
        if term in query:
            for syn in synonyms[:2]:
                expanded = query.replace(term, syn, 1)
                if expanded != query:
                    variants.append(expanded)
    return variants


def _remove_stopwords(query: str) -> str:
    """移除中文搜索停用词"""
    tokens = list(query)
    # 对于短语级停用词
    cleaned = query
    for sw in _STOPWORDS:
        cleaned = cleaned.replace(sw, ' ')
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned if cleaned else query


# ---------------------------------------------------------------------------
# 3. 热词注入（可选，通过环境变量 HOTWORD_API_URL 启用）
# ---------------------------------------------------------------------------

HOTWORD_API_URL = os.environ.get('HOTWORD_API_URL', '')
_hotwords_cache: list[str] = []
_hotwords_lock = threading.Lock()
_hotwords_last_update: float = 0
_HOTWORDS_TTL = 600  # 10分钟刷新


def _fetch_hotwords_background():
    """后台线程：定时拉取热词"""
    global _hotwords_cache, _hotwords_last_update
    while True:
        if HOTWORD_API_URL:
            try:
                import requests as _req
                resp = _req.get(HOTWORD_API_URL, timeout=5)
                if resp.ok:
                    data = resp.json()
                    words = []
                    # 支持两种格式：列表或带 hotwords 键的字典
                    if isinstance(data, list):
                        words = [str(w) for w in data[:50]]
                    elif isinstance(data, dict):
                        items = data.get('hotwords', data.get('data', []))
                        for item in items[:50]:
                            if isinstance(item, str):
                                words.append(item)
                            elif isinstance(item, dict):
                                words.append(item.get('word', item.get('title', '')))
                    with _hotwords_lock:
                        _hotwords_cache = [w for w in words if w]
                        _hotwords_last_update = time.time()
                    logger.info(f'[HOTWORDS] Refreshed {len(_hotwords_cache)} hotwords')
            except Exception as e:
                logger.warning(f'[HOTWORDS] Fetch failed: {e}')
        time.sleep(_HOTWORDS_TTL)


# 启动后台线程
if HOTWORD_API_URL:
    _hw_thread = threading.Thread(target=_fetch_hotwords_background, daemon=True)
    _hw_thread.start()
    logger.info(f'[HOTWORDS] Background fetcher started, URL: {HOTWORD_API_URL}')


def _hotword_expand(query: str) -> list[str]:
    """用热词扩展查询"""
    with _hotwords_lock:
        hotwords = list(_hotwords_cache)

    if not hotwords:
        return []

    query_lower = query.lower()
    matched = []

    for hw in hotwords:
        hw_lower = hw.lower()
        # 热词中的关键字符在查询中出现
        if len(hw) >= 2:
            # 双向匹配：查询包含热词的一部分，或热词包含查询的一部分
            overlap_chars = sum(1 for c in hw_lower if c in query_lower and c.strip())
            if overlap_chars >= max(2, len(hw) * 0.3):
                matched.append(hw)
            elif any(seg in hw_lower for seg in query_lower.split() if len(seg) >= 2):
                matched.append(hw)

    if matched:
        # 返回 "原始查询 + 热词" 作为扩展
        return [query + ' ' + hw for hw in matched[:2]]
    return []


# ---------------------------------------------------------------------------
# 公共接口
# ---------------------------------------------------------------------------

def rewrite_query(query: str) -> list[str]:
    """
    查询改写入口：返回原始查询 + 改写后的查询列表

    策略优先级：
    1. 时间锚定（效果最直接）
    2. 热词注入（实时性最强）
    3. 同义扩展（覆盖面最广）
    4. 停用词清洗（提升精度）

    返回：去重后的查询列表，原始查询在第一个，最多 5 条
    """
    if not query or not query.strip():
        return [query] if query else []

    query = query.strip()
    all_queries = [query]

    # 停用词清洗版本
    cleaned = _remove_stopwords(query)
    if cleaned != query and len(cleaned) >= 2:
        all_queries.append(cleaned)

    # 时间锚定
    all_queries.extend(_time_anchor(query))

    # 热词注入
    all_queries.extend(_hotword_expand(query))

    # 同义扩展
    all_queries.extend(_synonym_expand(query))

    # 去重，保持顺序
    seen = set()
    unique = []
    for q in all_queries:
        q = q.strip()
        if q and q not in seen:
            seen.add(q)
            unique.append(q)

    return unique[:5]


def get_hotwords_status() -> dict:
    """返回热词服务状态，供 health 接口使用"""
    with _hotwords_lock:
        count = len(_hotwords_cache)
        last = _hotwords_last_update
    return {
        'enabled': bool(HOTWORD_API_URL),
        'url': HOTWORD_API_URL or None,
        'cached_count': count,
        'last_update': datetime.fromtimestamp(last).isoformat() if last > 0 else None,
    }
