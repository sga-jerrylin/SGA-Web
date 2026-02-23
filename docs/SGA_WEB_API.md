# SGA-Web API v1（Agent + 搜索 + 爬虫）

> 轻量中文搜索原子能力，面向 AI Agent 编排器（OpenClaw / Dify / LangChain）

## MCP 工具封装推荐（生产可用）

> 截至 **2026-02-20**，仓库提供了 `schema` 能力描述，但未内置独立 MCP 进程。推荐做法是用现有 HTTP API 封装 MCP 工具。

### 推荐架构

- MCP 客户端（Claude/OpenClaw/Dify/LangChain）调用你自己的 MCP 网关进程
- MCP 网关把工具请求转发到 SGA-Web HTTP API
- SGA-Web 返回原始 JSON，网关尽量透传（保留 `request_id` / `timing` / `error.code`）

### 推荐工具集

| MCP工具名 | 对应HTTP接口 | 是否必选 | 用途 |
|------|------|------|------|
| `sga_search` | `GET/POST /v1/agent/search` | **是** | 主搜索工具 |
| `sga_global_search` | `GET/POST /global_search` | 否 | 中文引擎受限时的兜底搜索 |
| `sga_health` | `GET /v1/agent/health` | 否 | 连通性与能力探测 |
| `sga_scrape` | `POST http://localhost:3002/v0/scrape` | 否 | 单页抓取调试/补抓 |
| `sga_site_deep_search` | `POST http://localhost:3002/v0/site_crawl` | 否 | 指定站点多层级深搜 |

### `sga_search` 推荐输入 Schema

```json
{
  "type": "object",
  "properties": {
    "q": {"type": "string", "description": "搜索关键词"},
    "preset": {"type": "string", "enum": ["chinese", "wechat", "general"], "default": "chinese"},
    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
    "sort": {"type": "string", "enum": ["time", "relevance"], "default": "time"},
    "depth": {"type": "string", "enum": ["basic", "enriched"], "default": "basic"},
    "engines": {"type": "string", "description": "可选，逗号分隔引擎名"}
  },
  "required": ["q"]
}
```

### `sga_site_deep_search` 推荐输入 Schema（可选）

```json
{
  "type": "object",
  "properties": {
    "start_url": {"type": "string", "description": "站点起始URL"},
    "query": {"type": "string"},
    "max_depth": {"type": "integer", "minimum": 0, "maximum": 5, "default": 1},
    "max_pages": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
    "include_paths": {"type": "array", "items": {"type": "string"}},
    "exclude_paths": {"type": "array", "items": {"type": "string"}},
    "allow_subdomains": {"type": "boolean", "default": false},
    "respect_robots": {"type": "boolean", "default": true}
  },
  "required": ["start_url"]
}
```

### 工具调用映射建议

| MCP参数 | HTTP参数 | 说明 |
|------|------|------|
| `q` | `q` | 必填，原样透传 |
| `preset` | `preset` | 缺省用 `chinese` |
| `limit` | `limit` | 网关侧可再做一次 1-50 校验 |
| `sort` | `sort` | `time` / `relevance` |
| `depth` | `depth` | `basic` / `enriched` |
| `engines` | `engines` | 高级场景可透传 |

### 错误处理建议（网关层）

- HTTP `400`：映射为 MCP 参数错误（用户可修正输入）
- HTTP `500`：映射为工具执行错误（建议重试 1 次）
- 网络超时：建议设置 8-12 秒超时并返回可重试错误
- 透传 `error.code`（如 `INVALID_QUERY` / `INVALID_PARAM`），便于上层路由策略判断

### 最小实践建议

- 默认只暴露 `sga_search` 一个工具，降低 Agent 选择复杂度
- `sga_scrape` 建议仅内部使用，防止模型任意抓取外网 URL
- 对 `sga_scrape` 增加域名白名单/黑名单和请求频率限制
- `sga_site_deep_search` 建议仅对可信域开放，并限制 `max_depth` 与 `max_pages`

---

## 设计原则

- **无 LLM**：纯算法确定性响应，搜索引擎做"手"，Agent 做"脑"
- **单端点**：一个 URL 覆盖所有场景（中文搜索、微信专搜、通用搜索）
- **简化参数**：5 个参数即可，无需关心富化实现细节
- **结构化输出**：统一 JSON 信封，含 timing / request_id / engines_status
- **MCP 就绪**：schema 端点支持自动发现，`x-mcp-tools` 预定义工具描述
- **搜索优化**：查询改写 → RRF 融合 → 多级时间衰减 → 可选 Reranker

## 端点总览

| 端点 | 方法 | 用途 |
|------|------|------|
| `/v1/agent/search` | GET/POST | 统一搜索入口 |
| `/v1/agent/health` | GET | 健康检查 + 能力发现 |
| `/v1/agent/schema` | GET | OpenAPI 3.0 Schema（机器可读） |
| `/global_search` | GET/POST | 全量全域搜索（代理异常兜底） |

> 旧端点 `/chinese_search`、`/wechat_search`、`/search` 仍然可用，不受影响；新增 `/global_search` 用于全量全域兜底。

### 附属服务端点（Simple-Crawler，可选）

| 服务端点 | 方法 | 用途 |
|------|------|------|
| `http://localhost:3002/v0/scrape` | POST | 直接抓取单个网页正文 |
| `http://localhost:3002/v0/site_crawl` | POST | 指定站点多层级抓取/搜索 |
| `http://localhost:3002/health` | GET | 爬虫服务健康检查 |

---

## 1. 搜索 — `/v1/agent/search`

### 参数

| 参数 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `q` | string | **是** | - | 搜索关键词 |
| `preset` | string | 否 | `chinese` | 搜索模式：`chinese` / `wechat` / `general` |
| `limit` | int | 否 | `10` | 返回结果数（1-50） |
| `sort` | string | 否 | `time` | 排序：`time`（最新优先）/ `relevance` |
| `depth` | string | 否 | `basic` | 信息深度：`basic` / `enriched` |
| `engines` | string | 否 | 由preset决定 | 逗号分隔引擎名，覆盖preset默认 |

### preset 预设说明

| preset | 使用引擎 | 适用场景 |
|--------|---------|---------|
| `chinese` | sogou, baidu, 360search, wechat | 中文综合搜索（默认推荐） |
| `wechat` | wechat, sogou wechat | 微信公众号专搜 |
| `general` | 全部可用引擎 | 多语言通用搜索 |

### depth 深度说明

| depth | 行为 | 典型延迟 | 返回字段 |
|-------|------|---------|---------|
| `basic` | 仅搜索，不做内容抓取 | 800-1500ms | title, url, content, domain, published_date |
| `enriched` | Top-5 结果正文抽取+质量评分 | 1500-3000ms | 额外: article, content_excerpt, cover_image, images, snippet_sentences, quality_score |

### 请求示例

```bash
# 基础中文搜索（最快）
curl "http://localhost:8888/v1/agent/search?q=人工智能最新进展&preset=chinese&limit=5"

# 微信公众号搜索 + 正文抽取
curl "http://localhost:8888/v1/agent/search?q=GPT-5&preset=wechat&depth=enriched&limit=3"

# 按相关性排序
curl "http://localhost:8888/v1/agent/search?q=量子计算&sort=relevance&limit=10"

# 指定引擎
curl "http://localhost:8888/v1/agent/search?q=科技新闻&engines=sogou,baidu&limit=5"
```

### 成功响应

```json
{
  "status": "ok",
  "request_id": "req_a1b2c3d4e5f6g7h8",
  "timing": {
    "total_ms": 1523,
    "search_ms": 820,
    "rewrite_ms": 2,
    "rerank_ms": 0,
    "enrich_ms": 703,
    "cached": false
  },
  "query": {
    "raw": "GPT-5",
    "variants": ["GPT-5", "GPT-5 2026年02月", "大模型-5"],
    "preset": "chinese",
    "engines_used": ["sogou", "baidu", "360search", "wechat"],
    "sort": "time",
    "depth": "enriched",
    "rrf_fused": true,
    "reranker_used": false
  },
  "engines_status": {
    "sogou": {"status": "ok"},
    "baidu": {"status": "ok"},
    "360search": {"status": "ok"},
    "wechat": {"status": "ok"}
  },
  "results": [
    {
      "title": "GPT-5 技术架构详解",
      "url": "https://mp.weixin.qq.com/s/xxx",
      "content": "OpenAI 近日发布 GPT-5...",
      "published_date": "2026-02-10T08:30:00+00:00",
      "domain": "mp.weixin.qq.com",
      "source_score": 0.9,
      "quality_score": 0.85,
      "reason": ["HTTPS", "标题长度", "摘要长度", "有封面图", "正文摘取"],
      "article": "GPT-5 是 OpenAI 最新发布的大语言模型...(正文内容)...",
      "content_excerpt": "GPT-5 是 OpenAI 最新发布的大语言模型...",
      "cover_image": "https://mmbiz.qpic.cn/xxx",
      "site_name": "Crawler Enhanced",
      "snippet_sentences": [
        "GPT-5 在推理能力上相比 GPT-4 有显著提升",
        "OpenAI 称 GPT-5 的训练数据量扩大了3倍"
      ]
    }
  ],
  "total_results": 15,
  "suggestions": ["GPT-5 发布时间", "GPT-5 vs GPT-4"]
}
```

### 错误响应

```json
{
  "status": "error",
  "request_id": "req_a1b2c3d4e5f6g7h8",
  "timing": {
    "total_ms": 12,
    "cached": false
  },
  "error": {
    "code": "INVALID_QUERY",
    "message": "Missing required parameter: q"
  }
}
```

### 错误码

| code | HTTP | 说明 |
|------|------|------|
| `INVALID_QUERY` | 400 | 缺少或无效的 q 参数 |
| `INVALID_PARAM` | 400 | 其他参数错误 |
| `NO_ENGINES` | 400 | 没有可用引擎 |
| `INTERNAL_ERROR` | 500 | 内部错误 |

---

## 2. 健康检查 — `/v1/agent/health`

用于 Agent 连通性检测和能力发现。

### 请求

```bash
curl "http://localhost:8888/v1/agent/health"
```

### 响应

```json
{
  "status": "ok",
  "version": "1.4.0",
  "capabilities": {
    "presets": ["chinese", "wechat", "general"],
    "depths": ["basic", "enriched"],
    "sorts": ["time", "relevance"],
    "max_limit": 50,
    "crawler_available": true,
    "es_available": false,
    "reranker_available": false
  },
  "optimizations": {
    "query_rewriter": true,
    "rrf_fusion": true,
    "time_scoring": "multi_level_decay",
    "hotwords": {
      "enabled": false,
      "url": null,
      "cached_count": 0,
      "last_update": null
    },
    "reranker": {
      "enabled": false,
      "url": null,
      "status": "not_configured"
    }
  },
  "engines": {
    "sogou wechat": "active",
    "wechat": "active",
    "baidu": "active"
  }
}
```

---

## 3. Schema — `/v1/agent/schema`

返回 OpenAPI 3.0 JSON，供 Agent 框架自动生成工具定义。

```bash
curl "http://localhost:8888/v1/agent/schema"
```

Schema 中包含 `x-mcp-tools` 扩展字段，可直接用于 MCP 工具注册。

---

## 4. 全量全域搜索（代理异常兜底）— `/global_search`

当中文专用引擎（如 `wechat`、`sogou`、`baidu`）因代理、网络策略或区域限制不可用时，可以使用该路由作为兜底。

特性：

- 默认使用当前实例内 **全部可用引擎**
- 支持用 `engines` 参数手动覆盖引擎列表
- 返回格式与 `/chinese_search`、`/wechat_search` 一致
- 支持富化参数：`expand`、`enrich_top_k`、`include` 等

### 参数

| 参数 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `q` | string | **是** | - | 搜索关键词 |
| `limit` | int | 否 | `20` | 返回结果数（1-100） |
| `engines` | string | 否 | 全部可用引擎 | 逗号分隔引擎名 |
| `sort_by_time` | bool | 否 | `true` | 是否按时间优先排序 |
| `expand` | string | 否 | `meta` | 富化模式：`meta` / `article` / `full` |
| `enrich_top_k` | int | 否 | `6` | 富化前 K 条结果 |
| `include` | string | 否 | - | 逗号分隔返回字段白名单 |

### 请求示例

```bash
# 全量全域兜底搜索（默认全部可用引擎）
curl "http://localhost:8888/global_search?q=OpenAI+latest+model&limit=10"

# 指定部分国际引擎
curl "http://localhost:8888/global_search?q=AI+news&engines=duckduckgo,google,bing&limit=10"

# 启用正文富化
curl "http://localhost:8888/global_search?q=AI+research&expand=article&enrich_top_k=4"
```

### 响应与错误

- 成功响应：与 `/chinese_search` 相同（`results` 列表 + 可选富化字段）
- `400`：缺少 `q` 或参数非法
- `503`：无可用引擎
- `500`：内部搜索错误

---

## 5. Simple-Crawler API（爬虫服务）

> 这是独立服务（默认端口 `3002`）。`/v1/agent/search?depth=enriched` 会在内部自动调用它；通常不需要手工调用，除非你要单独调试抓取效果。

### 5.1 抓取接口 — `POST /v0/scrape`

请求地址（按部署位置选择）：

- 宿主机/本地：`http://localhost:3002/v0/scrape`
- Docker 容器内互联：`http://simple-crawler:3002/v0/scrape`

请求体：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `url` | string | **是** | 需要抓取的网页 URL |

请求示例：

```bash
curl -X POST "http://localhost:3002/v0/scrape" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

成功响应示例：

```json
{
  "success": true,
  "data": {
    "title": "示例页面标题",
    "content": "# 示例页面标题\n\n正文内容...",
    "markdown": "# 示例页面标题\n\n正文内容...",
    "html": "正文内容...",
    "metadata": {
      "title": "示例页面标题",
      "description": "页面描述",
      "language": "zh"
    },
    "url": "https://example.com"
  }
}
```

字段说明：

- `content` / `markdown`：Markdown 格式正文（两者当前等价）
- `html`：提取后的纯文本正文（字段名历史保留）
- `metadata`：页面元信息（标题、描述、语言）

错误响应：

- `400 Bad Request`：缺少 `url` 字段
- `500 Internal Server Error`：抓取失败，返回 `error` 字段（具体失败原因）

### 5.2 站点多层级深搜 — `POST /v0/site_crawl`

用于指定网站的多层级抓取与检索（站内 BFS 递进抓取）。

请求体：

| 字段 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `start_url` | string | **是** | - | 起始站点 URL（仅 http/https） |
| `query` | string | 否 | `""` | 关键词；为空则不按相关性重排 |
| `max_depth` | int | 否 | `1` | 最大层级深度（0-5） |
| `max_pages` | int | 否 | `20` | 最大抓取页面数（1-100） |
| `include_paths` | string[]/string | 否 | `[]` | 仅抓取这些路径前缀（如 `/docs,/blog`） |
| `exclude_paths` | string[]/string | 否 | `[]` | 排除这些路径前缀 |
| `allow_subdomains` | bool | 否 | `false` | 是否允许子域名 |
| `respect_robots` | bool | 否 | `true` | 是否遵守 robots.txt |
| `mode` | string | 否 | `http` | 预留：`http`/`auto`/`browser`（当前统一回退 `http`） |
| `request_timeout_ms` | int | 否 | `15000` | 单页面请求超时（3000-60000） |
| `max_discovered` | int | 否 | `400` | 最大发现链接数（50-2000） |

请求示例：

```bash
curl -X POST "http://localhost:3002/v0/site_crawl" \
  -H "Content-Type: application/json" \
  -d '{
    "start_url":"https://example.com/docs",
    "query":"agent api",
    "max_depth":2,
    "max_pages":30,
    "include_paths":["/docs","/blog"],
    "exclude_paths":["/docs/archive"],
    "respect_robots":true
  }'
```

成功响应示例：

```json
{
  "success": true,
  "data": {
    "start_url": "https://example.com/docs",
    "query": "agent api",
    "mode_requested": "http",
    "mode_used": "http",
    "max_depth": 2,
    "max_pages": 30,
    "crawled_count": 18,
    "visited_count": 24,
    "discovered_links": 73,
    "warnings": [],
    "pages": [
      {
        "url": "https://example.com/docs/agent-api",
        "depth": 1,
        "title": "Agent API Guide",
        "score": 0.833,
        "content_excerpt": "..."
      }
    ],
    "failures": []
  }
}
```

错误响应：

- `400`：`start_url` 缺失或 URL 非法
- `403`：目标为私有地址/localhost（安全限制）
- `500`：服务内部错误

### 5.3 健康检查 — `GET /health`

```bash
curl "http://localhost:3002/health"
```

响应示例：

```json
{
  "status": "ok",
  "timestamp": "2026-02-20T08:00:00.000Z",
  "service": "simple-crawler"
}
```

---

## OpenClaw 集成指南

### 方式一：HTTP API 直连

在 OpenClaw 配置中添加 SGA-Web 为 HTTP 工具：

```yaml
tools:
  - name: sga_search
    type: http
    endpoint: http://your-sga-host:8888/v1/agent/search
    method: GET
    parameters:
      q: {type: string, required: true}
      preset: {type: string, default: "chinese"}
      limit: {type: integer, default: 10}
      sort: {type: string, default: "time"}
      depth: {type: string, default: "basic"}
```

### 方式二：MCP 网关封装（推荐）

将 `/v1/agent/search` 封装为 `sga_search` MCP 工具，对 Agent 暴露统一输入：

```json
{
  "name": "sga_search",
  "description": "SGA 中文搜索，支持微信专搜与富化",
  "inputSchema": {
    "type": "object",
    "properties": {
      "q": {"type": "string"},
      "preset": {"type": "string", "enum": ["chinese", "wechat", "general"]},
      "limit": {"type": "integer", "minimum": 1, "maximum": 50},
      "sort": {"type": "string", "enum": ["time", "relevance"]},
      "depth": {"type": "string", "enum": ["basic", "enriched"]}
    },
    "required": ["q"]
  }
}
```

如需代理异常兜底，可再增加一个 `sga_global_search` 工具，映射到 `/global_search`。
如需站内深搜能力，可增加 `sga_site_deep_search` 工具，映射到 `POST http://localhost:3002/v0/site_crawl`。

### 方式三：原生 MCP Server（未来）

SGA-Web 预留了 MCP 工具描述（`x-mcp-tools`），后续将提供独立的 MCP Server 进程：

```bash
# 未来计划
python -m searx.mcp_server --port 3100
```

MCP Server 将复用 `_do_search_core()` 核心逻辑，通过 SSE 或 stdio 协议提供服务。

### DeepResearch 编排示例

```
OpenClaw DeepResearch 流程：

轮次1: sga_search(q="GPT-5 技术进展", preset="chinese", depth="basic")
       → 分析标题，发现需要更多细节

轮次2: sga_search(q="GPT-5 架构论文", preset="chinese", depth="enriched", limit=3)
       sga_search(q="GPT-5 技术解读", preset="wechat", depth="enriched", limit=3)
       → 两次并行调用，交叉验证

轮次3: 基于前两轮的 article 内容，生成综合报告
       → Agent 完成，无需 SGA-Web 参与总结
```

---

## 性能特性

| 指标 | 值 |
|------|-----|
| basic 搜索延迟 | 800-1500ms |
| enriched 搜索延迟 | 1500-3000ms |
| 缓存命中延迟 | <10ms |
| 缓存 TTL | 60 秒 |
| 最大缓存条目 | 512 |
| 富化缓存 TTL | 6 小时 |
| 并发富化线程 | 8 |

## 缓存行为

- 相同 `q + preset + limit + sort + depth` 组合在 60 秒内返回缓存结果
- 响应中 `timing.cached = true` 标记缓存命中
- 富化结果（URL 级别）缓存 6 小时，跨请求复用

## 旧端点兼容

| 旧端点 | 等价 Agent API 调用 |
|--------|-------------------|
| `/chinese_search?q=xxx&limit=10` | `/v1/agent/search?q=xxx&preset=chinese&limit=10` |
| `/wechat_search?q=xxx&limit=10` | `/v1/agent/search?q=xxx&preset=wechat&limit=10` |
| `/chinese_search?q=xxx&expand=article&enrich_top_k=5` | `/v1/agent/search?q=xxx&depth=enriched` |
| `/global_search?q=xxx&limit=10` | `/v1/agent/search?q=xxx&preset=general&limit=10`（注意：`global_search` 默认全量引擎，`preset=general` 默认不会全量） |

---

## 搜索优化管线

Agent API 内置四层搜索优化，自动生效，无需额外参数：

### 1. 查询改写 (Query Rewriter)

- **时间锚定**：`最新的模型发布` → `2026年02月 模型发布`
- **同义扩展**：`模型发布` → `大模型发布` / `LLM发布`
- **停用词清洗**：去除"请帮我搜索"等无用词
- **热词注入**（可选）：配置 `HOTWORD_API_URL` 环境变量接入实时热词

### 2. RRF 多查询融合 (Reciprocal Rank Fusion)

对最多 3 个查询变体分别搜索，然后用 RRF 算法融合：

```
score(d) = Σ ( weight_i / (k + rank_i) )
```

- 原始查询权重 1.0，变体逐步降权
- 响应中 `query.rrf_fused: true` 表示启用了融合
- `query.variants` 展示实际使用的查询变体

### 3. 多级时间衰减

替代原有的 7 天线性衰减，采用更精细的分段策略：

| 时间段 | 加成分数 | 语义 |
|--------|---------|------|
| 0-6h   | +0.50   | 极热（刚发布） |
| 6-24h  | +0.40~0.50 | 今日热点 |
| 1-3d   | +0.30~0.40 | 近日新闻 |
| 3-7d   | +0.20~0.30 | 本周内容 |
| 7-30d  | +0.10~0.20 | 本月内容 |
| 30d+   | +0.00   | 无加成 |

### 4. BGE-Reranker（可选微服务）

使用 `BAAI/bge-reranker-v2-m3` 交叉编码器重排序：

```yaml
# docker-compose.yml 中取消注释以启用
environment:
  - RERANKER_URL=http://reranker:8765
```

- 对 Top-30 结果做深度语义重排
- 需要 GPU 或大内存 CPU
- 响应中 `query.reranker_used: true` 表示已启用
