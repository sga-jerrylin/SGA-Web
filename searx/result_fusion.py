"""RRF (Reciprocal Rank Fusion) 多引擎结果融合模块

算法：score(d) = Σ ( weight_i / (k + rank_i) )

用于将多次搜索（多查询变体 × 多引擎）的结果融合为统一排序。
"""

import logging
from collections import defaultdict

logger = logging.getLogger('searx.result_fusion')

# RRF 默认参数
DEFAULT_K = 60          # RRF 的 k 参数，越大排名差异越平滑
DEFAULT_WEIGHT = 1.0    # 默认每个排名列表的权重


def _url_key(result) -> str:
    """统一提取结果的 URL 作为去重 key"""
    if isinstance(result, dict):
        return (result.get('url') or '').strip().rstrip('/')
    return (getattr(result, 'url', '') or '').strip().rstrip('/')


def _get_field(result, field):
    """兼容 dict 和对象两种结果格式"""
    if isinstance(result, dict):
        return result.get(field)
    return getattr(result, field, None)


def rrf_fuse(
    ranked_lists: list[list],
    weights: list[float] | None = None,
    k: int = DEFAULT_K,
    limit: int = 50,
) -> list:
    """
    RRF 融合多个排名列表。

    参数:
        ranked_lists: 多个排名列表，每个列表是有序的搜索结果
        weights: 每个列表的权重，默认等权
        k: RRF 的平滑参数
        limit: 最大返回数量

    返回:
        融合后的有序结果列表（去重，按 RRF 分数降序）
    """
    if not ranked_lists:
        return []

    # 只有一个列表，直接返回
    if len(ranked_lists) == 1:
        return ranked_lists[0][:limit]

    if weights is None:
        weights = [DEFAULT_WEIGHT] * len(ranked_lists)

    # URL -> RRF 累积分数
    url_scores: dict[str, float] = defaultdict(float)
    # URL -> 最完整的结果对象（优先保留内容更丰富的版本）
    url_best: dict[str, any] = {}

    for list_idx, result_list in enumerate(ranked_lists):
        w = weights[list_idx] if list_idx < len(weights) else DEFAULT_WEIGHT
        for rank, result in enumerate(result_list, start=1):
            url = _url_key(result)
            if not url:
                continue

            # 累加 RRF 分数
            url_scores[url] += w / (k + rank)

            # 保留内容更丰富的版本
            existing = url_best.get(url)
            if existing is None:
                url_best[url] = result
            else:
                # 比较内容长度，保留更长的
                new_content = _get_field(result, 'content') or ''
                old_content = _get_field(existing, 'content') or ''
                if len(str(new_content)) > len(str(old_content)):
                    url_best[url] = result

    # 按 RRF 分数降序排列
    sorted_urls = sorted(url_scores.keys(), key=lambda u: url_scores[u], reverse=True)

    fused = []
    for url in sorted_urls[:limit]:
        result = url_best[url]
        # 注入 RRF 分数到结果中（如果是 dict）
        if isinstance(result, dict):
            result['rrf_score'] = round(url_scores[url], 6)
        fused.append(result)

    logger.debug(
        f'[RRF] Fused {len(ranked_lists)} lists ({sum(len(r) for r in ranked_lists)} items) -> {len(fused)} results'
    )
    return fused


def multi_query_search(search_fn, queries: list[str], **search_kwargs) -> list:
    """
    对多个查询变体分别搜索，然后用 RRF 融合结果。

    参数:
        search_fn: 搜索函数，签名 fn(query, **kwargs) -> list
        queries: 查询变体列表（第一个是原始查询，权重最高）
        **search_kwargs: 传递给搜索函数的其他参数

    返回:
        RRF 融合后的结果列表
    """
    if not queries:
        return []

    if len(queries) == 1:
        return search_fn(queries[0], **search_kwargs)

    ranked_lists = []
    weights = []

    for i, q in enumerate(queries):
        try:
            results = search_fn(q, **search_kwargs)
            if results:
                ranked_lists.append(results)
                # 原始查询权重最高，变体逐步降低
                weights.append(1.0 if i == 0 else max(0.3, 1.0 - i * 0.2))
        except Exception as e:
            logger.warning(f'[RRF] Search failed for variant "{q}": {e}')
            continue

    return rrf_fuse(ranked_lists, weights=weights, limit=search_kwargs.get('limit', 50))
