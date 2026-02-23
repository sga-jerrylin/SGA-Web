"""改进的时间评分模块 — 多级时间衰减

替代 webapp.py 中原有的简单 7 天线性衰减。

衰减策略：
- 0-6h:   +0.5  （极热 — 刚发布几小时）
- 6-24h:  +0.4  （今日热点）
- 1-3d:   +0.3  （近日新闻）
- 3-7d:   +0.2  （本周内容）
- 7-30d:  +0.1  （本月内容）
- 30d+:   +0.0  （无时间加成）
"""

import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger('searx.time_scoring')


def _parse_datetime(val) -> datetime | None:
    """将各种日期格式解析为 datetime"""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        # ISO format
        try:
            return datetime.fromisoformat(val.replace('Z', '+00:00'))
        except Exception:
            pass
        # 常见格式
        for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%Y年%m月%d日', '%m月%d日'):
            try:
                return datetime.strptime(val, fmt)
            except Exception:
                continue
    return None


def time_bonus(published_date, now: datetime | None = None) -> float:
    """
    计算时间加成分数。

    返回 0.0 ~ 0.5 的加成值。
    """
    dt = _parse_datetime(published_date)
    if dt is None:
        return 0.0

    if now is None:
        now = datetime.now(timezone.utc)

    # 确保两个时间都有时区信息
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    delta = now - dt
    hours = max(0, delta.total_seconds() / 3600)

    if hours <= 6:
        return 0.5
    elif hours <= 24:
        # 6h~24h 线性衰减 0.5 -> 0.4
        return 0.5 - 0.1 * (hours - 6) / 18
    elif hours <= 72:  # 3 days
        # 1d~3d 线性衰减 0.4 -> 0.3
        return 0.4 - 0.1 * (hours - 24) / 48
    elif hours <= 168:  # 7 days
        # 3d~7d 线性衰减 0.3 -> 0.2
        return 0.3 - 0.1 * (hours - 72) / 96
    elif hours <= 720:  # 30 days
        # 7d~30d 线性衰减 0.2 -> 0.1
        return 0.2 - 0.1 * (hours - 168) / 552
    else:
        return 0.0


def compute_time_relevance(query_text: str, title: str, content: str,
                            published_date, text_relevance: float) -> float:
    """
    融合文本相关度和时间加成，返回最终分数。

    text_relevance: 原始文本相关度 (0~1)
    返回: 融合后的分数
    """
    tb = time_bonus(published_date)
    return text_relevance + tb
