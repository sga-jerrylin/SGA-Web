# SGA-Web

> 面向中文场景与企业私有化部署的智能搜索基础设施。  
> 在 SearXNG 基础上深度增强：中文优先、微信专搜、Agent API、内容富化、站点多层级深搜。

- 中文文档：`README_CN.md`
- API 文档：`docs/SGA_WEB_API.md`
- 许可证：`AGPL-3.0`

## 为什么是 SGA-Web

SGA-Web 不只是“搜索聚合器”，而是给企业知识系统、智能体工作流、情报检索场景准备的搜索底座：

- 中文内容与微信生态优先
- 时间优先排序（默认更贴近资讯和动态检索）
- 一次调用返回更“可直接喂模型”的富化信息
- 私有化部署，不依赖外部 SaaS

## 核心能力

### 1) Agent 优先 API（统一入口）

- `GET/POST /v1/agent/search`
- `GET /v1/agent/health`
- `GET /v1/agent/schema`

支持：查询改写、RRF 多查询融合、多级时间衰减、可选 reranker、可选正文富化。

### 2) 中文与微信专搜

- `GET/POST /chinese_search`
- `GET/POST /wechat_search`

内置中文引擎优先策略，适配中文资讯与公众号检索。

### 3) 全量全域兜底搜索

- `GET/POST /global_search`

当中文链路受代理/网络策略影响时，用全部可用引擎进行兜底检索。

### 4) 智能内容富化（Simple-Crawler）

- `POST /v0/scrape`：单页抓取
- `POST /v0/site_crawl`：指定站点多层级深搜（BFS）

富化字段支持：正文、摘要、图片、评分、命中句等，减少二次抓取成本。

## 架构概览

- `searxng`（Flask）：搜索编排、去重、排序、缓存、Agent API
- `simple-crawler`（Node.js）：内容抓取与站点深搜
- `redis`：短期缓存
- `es`（可选）：BM25 + 时间衰减重排
- `reranker`（可选）：BGE 交叉编码重排

## 快速启动

### Docker（推荐）

```bash
docker compose up --build -d
```

启动后：

- 搜索服务：`http://localhost:8888`
- 爬虫服务：`http://localhost:3002`

### 健康检查

```bash
curl "http://localhost:8888/healthz"
curl "http://localhost:3002/health"
```

## 快速体验

### Agent 统一搜索

```bash
curl "http://localhost:8888/v1/agent/search?q=GPT-5&preset=chinese&depth=enriched&limit=5"
```

### 全量兜底搜索

```bash
curl "http://localhost:8888/global_search?q=python&limit=5"
```

### 站点多层级深搜

```bash
curl -X POST "http://localhost:3002/v0/site_crawl" \
  -H "Content-Type: application/json" \
  -d '{
    "start_url":"https://www.python.org",
    "query":"download python",
    "max_depth":1,
    "max_pages":5,
    "respect_robots":true
  }'
```

## MCP 集成建议

推荐将 SGA-Web 暴露为以下工具：

- `sga_search` -> `/v1/agent/search`（必选）
- `sga_global_search` -> `/global_search`（兜底）
- `sga_site_deep_search` -> `POST /v0/site_crawl`（站点深搜）
- `sga_scrape` -> `POST /v0/scrape`（单页抓取）

详细参数和返回见：`docs/SGA_WEB_API.md`

## 典型应用场景

- 企业内部知识检索与资料发现
- 舆情/新闻/公众号动态追踪
- 智能体 Deep Research 工作流检索层
- 搜索增强生成（RAG）前置召回与清洗

## 版本说明

当前版本建议发布为 `v1.5.0`（含以下重点）：

- 新增：`/global_search` 全量全域兜底
- 新增：`/v0/site_crawl` 站点多层级深搜
- 增强：MCP 工具化文档与 SGA-Web API 文档重构

## 安全与合规建议

- 生产环境建议接入网关鉴权与限流
- 对站点深搜设置域名白名单
- 遵守目标站点 robots.txt 与平台条款
- 在企业合规边界内使用外部网络访问能力

## License

AGPL-3.0
