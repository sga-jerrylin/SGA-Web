const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// 添加更多HTTP客户端选项
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const port = 3002;

app.use(cors());
app.use(express.json());

// 完全基于案例的爬取函数
async function scrapeUrl(url) {
  try {
    console.log(`开始爬取: ${url}`);
    
    // 检查是否是微信文章
    const isWechatArticle = url.includes('mp.weixin.qq.com');
    
    let html = await getHtml(url, isWechatArticle);
    
    if (!html || html.trim().length === 0) {
      throw new Error('获取的HTML为空');
    }
    
    console.log(`获取HTML成功，长度: ${html.length}`);
    
    // 如果是微信文章，修复图片
    if (isWechatArticle) {
      html = fixWechatImages(html);
    }
    
    // 解析HTML并转换为Markdown
    const result = parseHtmlToMarkdown(html, url);
    
    console.log(`爬取成功: ${result.title}`);
    
    return {
      success: true,
      data: {
        title: result.title,
        content: result.markdown,
        markdown: result.markdown,
        html: result.content,
        metadata: {
          title: result.title,
          description: result.description || '',
          language: 'zh'
        },
        url
      }
    };
    
  } catch (error) {
    console.error(`爬取失败: ${error.message}`);
    throw error;
  }
}

// 获取HTML内容（完全按案例实现 - 模拟HuTool + JSoup备选）
async function getHtml(url, isWechatArticle = false, timeoutMs = 30000) {
  console.log(`开始获取HTML: ${url}`);

  // 方法1：模拟HuTool HTTP请求（主要方法）
  try {
    console.log(`使用HuTool风格请求获取: ${url}`);

    const headers = {
      // 完全按照案例的请求头
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      'Referer': isWechatArticle ? 'https://mp.weixin.qq.com/' : url,
      'Cookie': '', // 按案例设置空cookie
    };

    // 使用fetch模拟HuTool的行为
    const response = await fetch(url, {
      method: 'GET',
      headers,
      timeout: timeoutMs,
      redirect: 'follow', // 启用重定向
      agent: new https.Agent({
        rejectUnauthorized: false
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    if (!html || html.trim().length === 0) {
      throw new Error('HuTool风格请求获取的HTML为空');
    }

    console.log(`成功从 ${url} 获取HTML，长度: ${html.length}`);

    if (isWechatArticle) {
      // 针对微信文章进行特殊处理，尝试修复图片URL
      return fixWechatImages(html);
    }

    return html;

  } catch (hutoolError) {
    console.log(`HuTool风格请求失败: ${hutoolError.message}，尝试JSoup备选方案`);

    // 方法2：使用JSoup风格连接（备用方法）
    try {
      console.log(`尝试使用JSoup风格连接获取HTML`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36'
        },
        timeout: timeoutMs,
        maxRedirects: 5,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      });

      const html = response.data;

      if (!html || html.trim().length === 0) {
        throw new Error('JSoup风格连接获取的HTML为空');
      }

      console.log(`JSoup风格连接成功获取HTML，长度: ${html.length}`);

      if (isWechatArticle) {
        return fixWechatImages(html);
      }

      return html;

    } catch (jsoupError) {
      console.error(`JSoup风格连接也失败: ${jsoupError.message}`);
      throw new Error(`所有方法都失败了: HuTool(${hutoolError.message}), JSoup(${jsoupError.message})`);
    }
  }
}



// 解析HTML并转换为Markdown（按案例实现）
function parseHtmlToMarkdown(html, url) {
  const $ = cheerio.load(html);
  
  // 移除不需要的元素
  $('script, style, iframe, nav, footer, header, .adsbygoogle, .advertisement, #sidebar, .sidebar, .nav, .menu, .comment').remove();
  
  // 获取标题
  const title = $('title').text() || '';
  
  // 尝试获取主要内容
  let mainContent = '';
  
  // 尝试常见的内容容器
  const contentSelectors = [
    'article',
    '.content, .main, #content, #main, .post, .entry',
    'main',
    '.article-content, .post-content',
    '.rich_media_content', // 微信文章
    '#js_content' // 微信文章
  ];
  
  for (const selector of contentSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      const text = element.text().trim();
      if (text.length > mainContent.length) {
        mainContent = text;
      }
    }
  }
  
  // 如果内容太短，可能没有正确提取到，尝试获取body所有文本
  if (mainContent.length < 100) {
    mainContent = $('body').text().trim();
  }
  
  // 清理内容
  mainContent = mainContent.replace(/\s+/g, ' ').trim();
  
  // 组合结果为Markdown格式
  const markdown = `# ${title}\n\n${mainContent}`;
  
  return {
    title,
    content: mainContent,
    markdown,
    description: $('meta[name="description"]').attr('content') || ''
  };
}

// 修复微信图片（完全按案例实现）
function fixWechatImages(html) {
  const $ = cheerio.load(html);

  console.log('开始处理微信文章图片');

  // 处理微信特有的图片样式
  const wxImages = $('.rich_pages, .wxw-img, .rich_pages.wxw-img');
  console.log(`找到微信特殊图片: ${wxImages.length} 张`);
  wxImages.each((i, img) => {
    const dataSrc = $(img).attr('data-src');
    if (dataSrc) {
      console.log(`修复微信图片data-src: ${dataSrc}`);
      $(img).attr('src', dataSrc);
    }
  });

  // 处理所有section中的图片
  const sectionImages = $('section img');
  console.log(`找到section中的图片: ${sectionImages.length} 张`);
  sectionImages.each((i, img) => {
    const dataSrc = $(img).attr('data-src');
    if (dataSrc && (!$(img).attr('src') || $(img).attr('src').includes('data:'))) {
      console.log(`修复section中图片data-src: ${dataSrc}`);
      $(img).attr('src', dataSrc);
    }
  });

  // 处理懒加载图片
  const lazyImages = $('img[data-src]');
  console.log(`找到懒加载图片: ${lazyImages.length} 张`);
  lazyImages.each((i, img) => {
    const dataSrc = $(img).attr('data-src');
    if (dataSrc) {
      console.log(`修复懒加载图片data-src: ${dataSrc}`);
      $(img).attr('src', dataSrc);
    }
  });

  // 处理其他常见的微信图片属性
  const allImages = $('img');
  console.log(`找到所有图片: ${allImages.length} 张`);
  let fixedCount = 0;
  allImages.each((i, img) => {
    // 检查各种可能的属性
    const possibleAttrs = ['data-src', 'data-original', 'data-backupSrc', 'data-backsrc', 'data-imgfileid'];
    for (const attr of possibleAttrs) {
      const value = $(img).attr(attr);
      if (value && (!$(img).attr('src') || $(img).attr('src').includes('data:'))) {
        console.log(`通过属性${attr}修复图片: ${value}`);
        $(img).attr('src', value);
        fixedCount++;
        break;
      }
    }

    // 确保所有图片都有alt属性，即使为空
    if (!$(img).attr('alt')) {
      $(img).attr('alt', '');
    }
  });
  console.log(`修复了 ${fixedCount} 张图片的URL`);

  // 特别检查目标图片是否存在并正确处理
  const targetImage = $('img[src*=fFKE45D7xmicHicSr92dA3YoaeO9IAyleH]');
  if (targetImage.length > 0) {
    console.log(`找到目标图片: ${targetImage.attr('src')}`);
  } else {
    console.log('未找到目标图片');
    // 尝试在data-src中查找
    const dataTargetImage = $('img[data-src*=fFKE45D7xmicHicSr92dA3YoaeO9IAyleH]');
    if (dataTargetImage.length > 0) {
      console.log(`在data-src中找到目标图片: ${dataTargetImage.attr('data-src')}`);
      dataTargetImage.attr('src', dataTargetImage.attr('data-src'));
    }
  }

  // 有些微信图片URL可能带有转义字符，修正它们
  let html2 = $.html().replace(/&amp;/g, '&');

  console.log('已修复微信文章中的图片URL');
  return html2;
}

function normalizeBool(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const low = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(low)) {
      return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(low)) {
      return false;
    }
  }
  return defaultValue;
}

function normalizeInt(value, defaultValue, minValue, maxValue) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) {
    return defaultValue;
  }
  return Math.max(minValue, Math.min(maxValue, num));
}

function normalizePathList(value) {
  let arr = [];
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'string') {
    arr = value.split(',');
  }
  return arr
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0)
    .map((item) => (item.startsWith('/') ? item : `/${item}`));
}

function normalizeHttpUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }
  parsed.hash = '';
  return parsed;
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) {
    return true;
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1'
  ) {
    return true;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split('.').map((v) => Number.parseInt(v, 10));
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    if (parts[0] === 10) {
      return true;
    }
    if (parts[0] === 127) {
      return true;
    }
    if (parts[0] === 169 && parts[1] === 254) {
      return true;
    }
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }
    if (parts[0] === 192 && parts[1] === 168) {
      return true;
    }
    if (parts[0] === 0) {
      return true;
    }
  }

  // 简单 IPv6 私网识别（fc00::/7, fe80::/10）
  if (host.includes(':')) {
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

function isInDomainScope(targetUrlObj, rootUrlObj, allowSubdomains) {
  const targetHost = targetUrlObj.hostname.toLowerCase();
  const rootHost = rootUrlObj.hostname.toLowerCase();
  if (!allowSubdomains) {
    return targetHost === rootHost;
  }
  return targetHost === rootHost || targetHost.endsWith(`.${rootHost}`);
}

function matchesPathFilters(urlObj, includePaths, excludePaths) {
  const path = urlObj.pathname || '/';
  if (includePaths.length > 0) {
    const includeHit = includePaths.some((prefix) => path.startsWith(prefix));
    if (!includeHit) {
      return false;
    }
  }
  if (excludePaths.length > 0) {
    const excludeHit = excludePaths.some((prefix) => path.startsWith(prefix));
    if (excludeHit) {
      return false;
    }
  }
  return true;
}

function tokenizeQuery(query) {
  if (!query) {
    return [];
  }
  const tokens = String(query)
    .toLowerCase()
    .match(/[\u4e00-\u9fff]+|[a-z0-9]+/g);
  if (!tokens) {
    return [];
  }
  return Array.from(new Set(tokens.filter((t) => t.length >= 1)));
}

function computeQueryScore(tokens, title, content) {
  if (!tokens || tokens.length === 0) {
    return 0;
  }
  const titleText = String(title || '').toLowerCase();
  const contentText = String(content || '').toLowerCase();
  let hits = 0;

  for (const token of tokens) {
    if (titleText.includes(token)) {
      hits += 2;
    } else if (contentText.includes(token)) {
      hits += 1;
    }
  }

  const base = hits / (tokens.length * 2);
  const contentBonus = Math.min(contentText.length / 5000, 0.2);
  return Number((base + contentBonus).toFixed(3));
}

function parseRobotsTxt(robotsText, userAgent) {
  const groups = new Map();
  const lines = String(robotsText || '').split(/\r?\n/);
  let currentAgents = [];
  let lastDirective = '';

  for (const rawLine of lines) {
    const noComment = rawLine.split('#')[0].trim();
    if (!noComment) {
      continue;
    }
    const separatorIndex = noComment.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = noComment.slice(0, separatorIndex).trim().toLowerCase();
    const value = noComment.slice(separatorIndex + 1).trim();

    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      if (!agent) {
        continue;
      }
      if (lastDirective === 'user-agent') {
        currentAgents.push(agent);
      } else {
        currentAgents = [agent];
      }
      for (const a of currentAgents) {
        if (!groups.has(a)) {
          groups.set(a, { allow: [], disallow: [] });
        }
      }
      lastDirective = 'user-agent';
      continue;
    }

    if (key === 'allow' || key === 'disallow') {
      if (currentAgents.length === 0) {
        currentAgents = ['*'];
      }
      for (const agent of currentAgents) {
        if (!groups.has(agent)) {
          groups.set(agent, { allow: [], disallow: [] });
        }
        groups.get(agent)[key].push(value);
      }
      lastDirective = 'rule';
    }
  }

  const ua = String(userAgent || 'sga-site-crawler').toLowerCase();
  let selected = groups.get('*') || { allow: [], disallow: [] };
  let selectedAgentLength = selected === groups.get('*') ? 1 : 0;

  for (const [agent, rules] of groups.entries()) {
    if (agent === '*') {
      continue;
    }
    if (ua.includes(agent) && agent.length > selectedAgentLength) {
      selected = rules;
      selectedAgentLength = agent.length;
    }
  }

  return {
    allow: Array.isArray(selected.allow) ? selected.allow : [],
    disallow: Array.isArray(selected.disallow) ? selected.disallow : []
  };
}

function isAllowedByRobots(pathWithQuery, rules) {
  const path = pathWithQuery || '/';
  let bestAllow = -1;
  let bestDisallow = -1;

  for (const rule of rules.allow || []) {
    if (!rule) {
      continue;
    }
    if (path.startsWith(rule)) {
      bestAllow = Math.max(bestAllow, rule.length);
    }
  }
  for (const rule of rules.disallow || []) {
    if (!rule) {
      continue;
    }
    if (path.startsWith(rule)) {
      bestDisallow = Math.max(bestDisallow, rule.length);
    }
  }

  if (bestDisallow < 0) {
    return true;
  }
  if (bestAllow < 0) {
    return false;
  }
  return bestAllow >= bestDisallow;
}

async function getRobotsRulesForOrigin(origin, userAgent, timeoutMs, robotsCache) {
  if (robotsCache.has(origin)) {
    return robotsCache.get(origin);
  }

  const fallback = { allow: [], disallow: [] };
  try {
    const robotsUrl = `${origin.replace(/\/$/, '')}/robots.txt`;
    const response = await fetch(robotsUrl, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent
      },
      timeout: Math.max(3000, Math.min(timeoutMs, 10000)),
      redirect: 'follow',
      agent: new https.Agent({
        rejectUnauthorized: false
      })
    });

    if (!response.ok) {
      robotsCache.set(origin, fallback);
      return fallback;
    }

    const text = await response.text();
    const rules = parseRobotsTxt(text, userAgent);
    robotsCache.set(origin, rules);
    return rules;
  } catch (error) {
    robotsCache.set(origin, fallback);
    return fallback;
  }
}

function extractLinksFromHtml(html, currentUrl, options) {
  const $ = cheerio.load(html);
  const links = new Set();
  const currentUrlObj = new URL(currentUrl);

  $('a[href]').each((_, element) => {
    const href = String($(element).attr('href') || '').trim();
    if (!href) {
      return;
    }
    if (
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return;
    }

    let targetUrlObj;
    try {
      targetUrlObj = new URL(href, currentUrlObj);
    } catch (error) {
      return;
    }

    if (!['http:', 'https:'].includes(targetUrlObj.protocol)) {
      return;
    }
    targetUrlObj.hash = '';

    if (!isInDomainScope(targetUrlObj, options.rootUrlObj, options.allowSubdomains)) {
      return;
    }
    if (!matchesPathFilters(targetUrlObj, options.includePaths, options.excludePaths)) {
      return;
    }

    links.add(targetUrlObj.toString());
  });

  return Array.from(links);
}

async function crawlSite(options) {
  const warnings = [];
  const failures = [];
  const pages = [];
  const robotsCache = new Map();

  const requestedMode = options.mode || 'http';
  const mode = requestedMode === 'http' ? 'http' : 'http';
  if (requestedMode !== 'http') {
    warnings.push(`mode=${requestedMode} 当前未启用浏览器渲染，已回退到 http`);
  }

  let rootUrlObj;
  try {
    rootUrlObj = normalizeHttpUrl(options.startUrl);
  } catch (error) {
    return {
      success: false,
      error_code: 'INVALID_URL',
      error: `Invalid start_url: ${error.message}`
    };
  }

  if (isPrivateHostname(rootUrlObj.hostname)) {
    return {
      success: false,
      error_code: 'FORBIDDEN_HOST',
      error: 'Private/localhost targets are not allowed'
    };
  }

  const queryTokens = tokenizeQuery(options.query);
  const queue = [{ url: rootUrlObj.toString(), depth: 0 }];
  const queuedSet = new Set([rootUrlObj.toString()]);
  const visited = new Set();

  let skippedByScope = 0;
  let skippedByFilter = 0;
  let skippedByRobots = 0;
  let discoveredLinks = 0;

  while (queue.length > 0 && pages.length < options.maxPages) {
    const current = queue.shift();
    const currentUrl = current.url;
    const currentDepth = current.depth;

    if (visited.has(currentUrl)) {
      continue;
    }
    visited.add(currentUrl);

    let currentUrlObj;
    try {
      currentUrlObj = new URL(currentUrl);
    } catch (error) {
      failures.push({ url: currentUrl, depth: currentDepth, error: 'Invalid URL in queue' });
      continue;
    }

    if (!isInDomainScope(currentUrlObj, rootUrlObj, options.allowSubdomains)) {
      skippedByScope += 1;
      continue;
    }
    if (!matchesPathFilters(currentUrlObj, options.includePaths, options.excludePaths)) {
      skippedByFilter += 1;
      continue;
    }

    if (options.respectRobots) {
      const robotsRules = await getRobotsRulesForOrigin(
        currentUrlObj.origin,
        options.userAgent,
        options.requestTimeoutMs,
        robotsCache
      );
      const pathWithQuery = `${currentUrlObj.pathname || '/'}${currentUrlObj.search || ''}`;
      if (!isAllowedByRobots(pathWithQuery, robotsRules)) {
        skippedByRobots += 1;
        continue;
      }
    }

    let html;
    try {
      html = await getHtml(currentUrl, currentUrl.includes('mp.weixin.qq.com'), options.requestTimeoutMs);
    } catch (error) {
      failures.push({
        url: currentUrl,
        depth: currentDepth,
        error: error.message || 'Fetch failed'
      });
      continue;
    }

    const parsed = parseHtmlToMarkdown(html, currentUrl);
    const content = String(parsed.content || '');
    const score = computeQueryScore(queryTokens, parsed.title || '', content);

    pages.push({
      url: currentUrl,
      depth: currentDepth,
      title: parsed.title || '',
      description: parsed.description || '',
      score,
      content_excerpt: content.slice(0, 1000),
      markdown_excerpt: String(parsed.markdown || '').slice(0, 1500)
    });

    if (currentDepth >= options.maxDepth) {
      continue;
    }

    const childLinks = extractLinksFromHtml(html, currentUrl, {
      rootUrlObj,
      allowSubdomains: options.allowSubdomains,
      includePaths: options.includePaths,
      excludePaths: options.excludePaths
    });

    for (const childUrl of childLinks) {
      discoveredLinks += 1;
      if (queuedSet.has(childUrl) || visited.has(childUrl)) {
        continue;
      }
      if (queuedSet.size >= options.maxDiscovered) {
        break;
      }
      queuedSet.add(childUrl);
      queue.push({
        url: childUrl,
        depth: currentDepth + 1
      });
    }
  }

  if (queryTokens.length > 0) {
    pages.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      return a.url.localeCompare(b.url);
    });
  }

  return {
    success: true,
    data: {
      start_url: rootUrlObj.toString(),
      query: options.query || '',
      mode_requested: requestedMode,
      mode_used: mode,
      max_depth: options.maxDepth,
      max_pages: options.maxPages,
      include_paths: options.includePaths,
      exclude_paths: options.excludePaths,
      allow_subdomains: options.allowSubdomains,
      respect_robots: options.respectRobots,
      request_timeout_ms: options.requestTimeoutMs,
      crawled_count: pages.length,
      visited_count: visited.size,
      discovered_links: discoveredLinks,
      skipped_by_scope: skippedByScope,
      skipped_by_filter: skippedByFilter,
      skipped_by_robots: skippedByRobots,
      warnings,
      pages,
      failures: failures.slice(0, 50)
    }
  };
}

// API 路由
app.post('/v0/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }
    
    const result = await scrapeUrl(url);
    res.json(result);
    
  } catch (error) {
    console.error('API错误:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/v0/site_crawl', async (req, res) => {
  try {
    const payload = req.body || {};
    const startUrl = payload.start_url || payload.url;

    if (!startUrl) {
      return res.status(400).json({
        success: false,
        error_code: 'INVALID_PARAM',
        error: 'start_url is required'
      });
    }

    const options = {
      startUrl: String(startUrl).trim(),
      query: String(payload.query || '').trim(),
      maxDepth: normalizeInt(payload.max_depth, 1, 0, 5),
      maxPages: normalizeInt(payload.max_pages, 20, 1, 100),
      includePaths: normalizePathList(payload.include_paths),
      excludePaths: normalizePathList(payload.exclude_paths),
      allowSubdomains: normalizeBool(payload.allow_subdomains, false),
      respectRobots: normalizeBool(payload.respect_robots, true),
      mode: String(payload.mode || 'http').trim().toLowerCase(),
      requestTimeoutMs: normalizeInt(payload.request_timeout_ms, 15000, 3000, 60000),
      userAgent: String(payload.user_agent || 'sga-site-crawler/1.0').trim(),
      maxDiscovered: normalizeInt(payload.max_discovered, 400, 50, 2000)
    };

    const result = await crawlSite(options);
    if (!result.success) {
      const statusCode = result.error_code === 'INVALID_URL' || result.error_code === 'INVALID_PARAM' ? 400 : 403;
      return res.status(statusCode).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error('site_crawl API错误:', error);
    return res.status(500).json({
      success: false,
      error_code: 'INTERNAL_ERROR',
      error: error.message
    });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'simple-crawler'
  });
});

app.listen(port, () => {
  console.log(`简单爬虫服务启动，端口: ${port}`);
});
