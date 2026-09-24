# 单镜像：Node 服务同时提供 API、任务 worker 与前端静态产物
# 无原生依赖（数据库用 Node 内置 node:sqlite，像素处理在前端），因此镜像很小也无需编译链
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
RUN pnpm --filter @retouch/web build

FROM node:22-alpine AS runtime
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod=false --filter @retouch/server...

COPY --from=build /app/packages /app/packages
COPY --from=build /app/apps/server /app/apps/server
# 前端产物：服务端检测到 apps/web/dist 存在就会一并托管（同源，免 CORS）
COPY --from=build /app/apps/web/dist /app/apps/web/dist

ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
CMD ["pnpm", "--filter", "@retouch/server", "start"]
