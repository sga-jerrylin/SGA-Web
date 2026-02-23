# SearXNG Dockerfile (Windows compatibility included)
FROM python:3.11-slim

# 设置工作目录
WORKDIR /usr/local/searxng

# 创建用户
RUN groupadd -r searxng && useradd -r -g searxng searxng

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
    zlib1g-dev \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制requirements文件
COPY requirements-windows.txt ./requirements.txt

# 安装Python依赖
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir uwsgi

# 复制应用代码（精简，仅保留运行所需）
COPY searx/ ./searx/

# 复制配置文件（精简，仅保留限流配置）
COPY limiter.toml /etc/searxng/limiter.toml

# 创建启动脚本
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# 设置环境变量\n\
export PYTHONPATH="/usr/local/searxng"\n\
export SEARXNG_SETTINGS_PATH="/etc/searxng/settings.yml"\n\
\n\
# 检查配置文件\n\
if [ ! -f "$SEARXNG_SETTINGS_PATH" ]; then\n\
    echo "创建默认配置文件..."\n\
    mkdir -p /etc/searxng\n\
    cp ./searx/settings.yml "$SEARXNG_SETTINGS_PATH"\n\
fi\n\
\n\
# 启动SearXNG\n\
echo "启动 SearXNG 服务..."\n\
echo "地址: http://0.0.0.0:8888"\n\
echo "Agent API:    http://0.0.0.0:8888/v1/agent/search"\n\
echo "Agent Health: http://0.0.0.0:8888/v1/agent/health"\n\
echo "Agent Schema: http://0.0.0.0:8888/v1/agent/schema"\n\
echo "中文搜索API: http://0.0.0.0:8888/chinese_search"\n\
echo "微信专搜API: http://0.0.0.0:8888/wechat_search"\n\
echo "容器已就绪！"\n\
\n\
exec python -m searx.webapp\n\
' > ./entrypoint.sh && chmod +x ./entrypoint.sh

# 设置环境变量
ENV PYTHONPATH="/usr/local/searxng"
ENV SEARXNG_SETTINGS_PATH="/etc/searxng/settings.yml"
ENV FLASK_APP="searx.webapp"

# 创建配置目录
RUN mkdir -p /etc/searxng /var/log/searxng

# 设置权限
RUN chown -R searxng:searxng /usr/local/searxng /etc/searxng /var/log/searxng

# 暴露端口
EXPOSE 8888

# 切换到非root用户
USER searxng

# 启动命令
ENTRYPOINT ["./entrypoint.sh"] 