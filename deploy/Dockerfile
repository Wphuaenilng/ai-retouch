# 单镜像：Node 服务同时提供 API、任务 worker 与前端静态产物。
# 无原生依赖（数据库用 Node 内置 node:sqlite，像素处理在前端）。
#
# 两点不显然的：
#   1. 生产仍是 tsx 直跑 TS —— tsconfig 用 moduleResolution=Bundler，源码里的相对
#      导入都不带 .js 后缀，编译成纯 ESM 后 Node 找不到模块。真要出编译产物，得先把
#      后缀补齐（一次全仓机械改动，单独提交），这版不夹带。所以 tsx 在 package.json
#      里属于 dependencies，不是 devDependencies。
#   2. node:sqlite 在 22.13 之前藏在 --experimental-sqlite 后面，所以基座锁 22.20+；
#      只写 node:22-alpine 的话，将来 tag 漂回老补丁版就直接起不来。

# ---------- 构建：只为了前端产物 ----------
FROM node:22.20-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_HOME=/pnpm/corepack
# corepack prepare 必须显式跑一次：只 corepack enable 的话，pnpm 的下载发生在
# 第一次调用时，而那时已经是非 root 的 node 用户，缓存目录不可写 → 容器起不来
RUN corepack enable && corepack prepare pnpm@10.32.0 --activate && chmod -R a+rX /pnpm
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
# sourcemap 关在 vite.config.ts 里（以前 3.7MB TS 源码随产物公开可下载）
RUN pnpm --filter @retouch/web build

# ---------- 运行：只装生产依赖 ----------
FROM node:22.20-alpine AS runtime
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_HOME=/pnpm/corepack NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.32.0 --activate && chmod -R a+rX /pnpm
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# tsx 已挪进 dependencies，所以 --prod 也装得到它
RUN pnpm install --frozen-lockfile --prod --filter @retouch/server...

# 只拷源码，不拷构建阶段的 node_modules：pnpm 的依赖是软链到根 node_modules/.pnpm 的，
# 整目录 --from=build 过去会带一堆断链，反而盖掉上面装好的那份
COPY packages packages
COPY apps/server apps/server
COPY --from=build /app/apps/web/dist /app/apps/web/dist
# 备份/恢复脚本要在容器里能 exec（以前没 COPY，文档里那条命令必然找不到文件）。
# Windows 检出丢执行位，这里补一次，不指望 git 模式
COPY deploy /app/deploy
RUN chmod +x /app/deploy/*.sh

# 数据卷：DATA_DIR 与 SQLITE_PATH 必须都指向它，以前只设 DATA_DIR，
# 库会落到镜像内的 /app/data —— 不经 compose 直接 docker run 会静默丢库
RUN mkdir -p /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data SQLITE_PATH=/data/retouch.db BACKUP_DIR=/data/backups
VOLUME ["/data"]
EXPOSE 8787
# 非 root 运行；PID 1 的 SIGTERM 转发由 compose 的 init:true 负责
USER node
STOPSIGNAL SIGTERM
CMD ["pnpm", "--filter", "@retouch/server", "start"]
