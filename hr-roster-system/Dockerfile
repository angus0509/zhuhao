FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制完整的、经 .dockerignore 安全过滤后的项目，确保构建测试依赖不会随新增测试遗漏。
COPY . .

# Web/API 镜像不包含独立发布的小程序源码，因此执行 Web/API 专用检查。
RUN npm run check:web

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "src/app.js"]
