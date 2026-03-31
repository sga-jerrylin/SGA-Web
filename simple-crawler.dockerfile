FROM node:25-slim

WORKDIR /app

# 复制 package.json
COPY simple-crawler/package.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY simple-crawler/server.js ./

# 暴露端口
EXPOSE 3002

# 启动命令
CMD ["node", "server.js"]
